-- Channel recommendations storage: what the narrator said, and what humans answered.
--
-- The detector slice (20260823120000) records only what deterministic code
-- computed. ADR 0037 adds a second fenced worker that reads those findings and
-- writes model-authored narration back, every recommendation citing the
-- findings it used. ADR 0038 adds the judge that grades the prose and the
-- human triage vote that grades it again.
--
-- This migration is storage only. It creates five tables, makes them readable
-- to organization members with `report.read`, and makes them writable from no
-- session at all: there are deliberately no insert/update/delete policies,
-- because everything is written later through security-definer worker and
-- member RPCs. What can be checked without those RPCs is checked here — tenant
-- composite keys so nothing cites another tenant's row, and a dismissal that
-- must say why it dismissed.

-- Recommendations ----------------------------------------------------------------

-- One model-written narration over one analysis run's findings. `label`
-- carries the narrator's own admission of what it produced; an honest
-- `needs_data` row is stored rather than left silent, for the same reason the
-- detectors store theirs. The digests bind each row to the exact prompt and
-- output that produced it, so what is read later is what was written then.
create table public.channel_recommendations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  channel_id uuid not null,
  branch_id uuid,
  analysis_run_id uuid not null,
  window_start date not null,
  window_end date not null,
  period_grain text not null check (period_grain in ('day', 'week', 'month')),
  label text not null check (label in ('observation', 'recommendation', 'needs_data')),
  headline text not null,
  detail text not null,
  supported_actions jsonb not null default '[]'::jsonb,
  limitations jsonb not null default '[]'::jsonb,
  prompt_version integer not null check (prompt_version >= 1),
  prompt_digest text not null,
  output_digest text not null,
  provider text not null,
  model_id text not null,
  result_digest text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (analysis_run_id, result_digest)
);

comment on table public.channel_recommendations is
  'Model-written narration over one analysis run''s findings (ADR 0037). Written only by the fenced narration worker; never by a session.';
comment on column public.channel_recommendations.label is
  'What the narrator claims it produced: observation = restating evidence; recommendation = proposing an action; needs_data = the evidence could not support either.';
comment on column public.channel_recommendations.result_digest is
  'Digest of the whole submission, so one run cannot record two different answers under the same identity.';

-- Citations ----------------------------------------------------------------------

-- Every recommendation names the stored findings it was built from, by
-- tenant-composite foreign key exactly as channel_finding_evidence does, so a
-- citation cannot point across tenants or at a finding that is gone.
create table public.channel_recommendation_citations (
  recommendation_id uuid not null,
  finding_id uuid not null,
  organization_id uuid not null,
  primary key (recommendation_id, finding_id),
  foreign key (organization_id, recommendation_id)
    references public.channel_recommendations(organization_id, id) on delete cascade,
  foreign key (organization_id, finding_id)
    references public.channel_findings(organization_id, id) on delete restrict
);

comment on table public.channel_recommendation_citations is
  'The findings a recommendation was built from. ADR 0037: every recommendation must cite what it used, by tenant-composite key.';

-- Human triage --------------------------------------------------------------------

-- One person''s answer to one recommendation. Dismissing without saying why is
-- refused here rather than trusted to an RPC, because an unexplained dismissal
-- teaches the prompt nothing.
create table public.channel_recommendation_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  recommendation_id uuid not null,
  decision text not null check (decision in ('acknowledged', 'dismissed', 'planned')),
  dismissal_reason text,
  actor_id uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, recommendation_id)
    references public.channel_recommendations(organization_id, id) on delete restrict,
  check (decision <> 'dismissed' or (dismissal_reason is not null and length(btrim(dismissal_reason)) > 0))
);

comment on table public.channel_recommendation_decisions is
  'A human triage answer to one recommendation. The prose stays in the recommendation; this table records only who answered what.';

-- Feedback vote -------------------------------------------------------------------

-- One helpful/not-helpful vote per actor per recommendation, upserted in place:
-- changing your mind moves the same row rather than stacking votes.
create table public.channel_recommendation_feedback (
  organization_id uuid not null,
  recommendation_id uuid not null,
  actor_id uuid not null,
  helpful boolean not null,
  updated_at timestamptz not null default now(),
  primary key (recommendation_id, actor_id),
  foreign key (organization_id, recommendation_id)
    references public.channel_recommendations(organization_id, id) on delete restrict
);

comment on table public.channel_recommendation_feedback is
  'One helpfulness vote per actor per recommendation.';

-- Judge evaluations -----------------------------------------------------------------

-- ADR 0038: the judge reports and never modifies. One verdict per
-- recommendation; re-judging replaces the verdict through its own worker RPC
-- rather than accumulating scores. Advisory only — nothing here changes a
-- recommendation or a ranking.
create table public.channel_recommendation_evaluations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  recommendation_id uuid not null,
  batch_id uuid not null,
  citation_faithful boolean not null,
  label_appropriate boolean not null,
  invented_value_detected boolean not null,
  uncertainty_honest boolean not null,
  score integer not null check (score between 1 and 5),
  issues jsonb not null default '[]'::jsonb,
  notes text not null,
  judge_provider text not null,
  judge_model text not null,
  judge_prompt_version integer not null,
  judge_prompt_digest text not null,
  judge_output_digest text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (recommendation_id),
  foreign key (organization_id, recommendation_id)
    references public.channel_recommendations(organization_id, id) on delete restrict
);

comment on table public.channel_recommendation_evaluations is
  'One judge verdict per recommendation (ADR 0038). Quality evidence for humans; never a modification of the judged row.';

-- Indexes ---------------------------------------------------------------------------

create index channel_recommendations_scope_idx
  on public.channel_recommendations (organization_id, channel_id, window_start desc, created_at desc);
create index channel_recommendation_citations_finding_idx
  on public.channel_recommendation_citations (organization_id, finding_id);
create index channel_recommendation_decisions_recommendation_idx
  on public.channel_recommendation_decisions (organization_id, recommendation_id);
create index channel_recommendation_feedback_recommendation_idx
  on public.channel_recommendation_feedback (organization_id, recommendation_id);
create index channel_recommendation_evaluations_batch_idx
  on public.channel_recommendation_evaluations (organization_id, batch_id);

-- Audit ------------------------------------------------------------------------------

-- `channel_recommendation.triaged` records who answered what, ids and state
-- transitions only. The headline, the detail, and the dismissal reason are the
-- operator''s words about their business; they stay in the rows that need them
-- and out of the audit trail.
create function private.audit_channel_recommendation_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_events (
    organization_id, event_name, actor_type, actor_id, entity_type, entity_id, payload
  ) values (
    coalesce(new.organization_id, old.organization_id),
    'channel_recommendation.triaged',
    'user'::public.audit_actor_type,
    coalesce(new.actor_id, old.actor_id),
    'channel_recommendation',
    coalesce(new.recommendation_id, old.recommendation_id),
    jsonb_build_object(
      'decisionId', coalesce(new.id, old.id),
      'transition', case tg_op when 'INSERT' then 'recorded' when 'UPDATE' then 'changed' else 'removed' end,
      'decision', case when tg_op = 'DELETE' then old.decision else new.decision end,
      'priorDecision', case when tg_op = 'UPDATE' then old.decision else null end)
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger channel_recommendation_decisions_audit
after insert or update or delete on public.channel_recommendation_decisions
for each row execute function private.audit_channel_recommendation_decision();

-- Row level security ------------------------------------------------------------------

revoke all on function private.audit_channel_recommendation_decision() from public;
revoke all on table public.channel_recommendations, public.channel_recommendation_citations,
  public.channel_recommendation_decisions, public.channel_recommendation_feedback,
  public.channel_recommendation_evaluations
  from public, anon, authenticated;

alter table public.channel_recommendations enable row level security;
alter table public.channel_recommendations force row level security;
alter table public.channel_recommendation_citations enable row level security;
alter table public.channel_recommendation_citations force row level security;
alter table public.channel_recommendation_decisions enable row level security;
alter table public.channel_recommendation_decisions force row level security;
alter table public.channel_recommendation_feedback enable row level security;
alter table public.channel_recommendation_feedback force row level security;
alter table public.channel_recommendation_evaluations enable row level security;
alter table public.channel_recommendation_evaluations force row level security;

-- Readable, never writable, from a session — mirroring how channel_findings
-- grants readability. The only writes are the Task 2/3 RPCs.
create policy "members with report read can view channel recommendations"
on public.channel_recommendations for select to authenticated
using (private.has_organization_permission(organization_id, 'report.read'));
create policy "members with report read can view channel recommendation citations"
on public.channel_recommendation_citations for select to authenticated
using (private.has_organization_permission(organization_id, 'report.read'));
create policy "members with report read can view channel recommendation decisions"
on public.channel_recommendation_decisions for select to authenticated
using (private.has_organization_permission(organization_id, 'report.read'));
create policy "members with report read can view channel recommendation feedback"
on public.channel_recommendation_feedback for select to authenticated
using (private.has_organization_permission(organization_id, 'report.read'));
create policy "members with report read can view channel recommendation evaluations"
on public.channel_recommendation_evaluations for select to authenticated
using (private.has_organization_permission(organization_id, 'report.read'));

grant select on table public.channel_recommendations, public.channel_recommendation_citations,
  public.channel_recommendation_decisions, public.channel_recommendation_feedback,
  public.channel_recommendation_evaluations
  to authenticated;
