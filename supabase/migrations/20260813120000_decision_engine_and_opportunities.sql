-- Decision Engine V1 ledger prerequisite. All nine tables are organization-owned:
-- composite foreign keys make a misplaced UUID fail even for a privileged worker.

create table public.playbook_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_.-]{1,120}$'),
  name text not null check (char_length(name) between 1 and 160),
  owner_scope text not null check (owner_scope in ('core', 'pack', 'organization')),
  industry_pack_slug text,
  business_objective text not null check (char_length(business_objective) between 1 and 240),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, key)
);

create table public.playbook_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  playbook_definition_id uuid not null,
  semantic_version text not null check (semantic_version ~ '^v?[0-9]+\\.[0-9]+\\.[0-9]+$'),
  eligibility_rules jsonb not null default '{}'::jsonb,
  required_capability_keys text[] not null default '{}',
  required_data_keys text[] not null default '{}',
  trigger_signal_keys text[] not null default '{}',
  hypothesis_template text not null check (char_length(hypothesis_template) between 1 and 4000),
  action_definition jsonb not null,
  risk_class smallint not null check (risk_class between 0 and 4),
  primary_metric_key text not null,
  guardrail_metric_keys text[] not null default '{}',
  measurement_window_days integer not null check (measurement_window_days between 1 and 730),
  prior jsonb,
  resurface_condition jsonb,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  unique (organization_id, id),
  unique (organization_id, playbook_definition_id, semantic_version),
  foreign key (organization_id, playbook_definition_id)
    references public.playbook_definitions (organization_id, id) on delete restrict
);
create unique index playbook_versions_one_active_idx
  on public.playbook_versions (organization_id, playbook_definition_id) where is_active;

create table public.artifact_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  artifact_key text not null check (artifact_key ~ '^[a-z][a-z0-9_.-]{1,120}$'),
  version text not null check (char_length(version) between 1 and 80),
  basis text not null check (char_length(basis) between 1 and 2000),
  authored_by text not null check (char_length(authored_by) between 1 and 160),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, artifact_key, version)
);
create unique index artifact_versions_one_active_idx
  on public.artifact_versions (organization_id, artifact_key) where is_active;

create table public.decision_cycles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  trigger_name text not null check (char_length(trigger_name) between 1 and 160),
  correlation_id uuid not null,
  slot_budget integer not null check (slot_budget >= 0),
  max_scored_candidates integer not null check (max_scored_candidates >= 0),
  screened_count integer not null default 0 check (screened_count >= 0),
  scored_count integer not null default 0 check (scored_count >= 0),
  termination_reason text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  check (scored_count <= screened_count),
  check (completed_at is null or completed_at >= started_at)
);

create table public.decision_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  decision_cycle_id uuid not null,
  correlation_id uuid not null,
  outcome text not null check (outcome in ('action_selected', 'no_action', 'needs_data')),
  reason text,
  selected_candidate_fingerprint text check (selected_candidate_fingerprint ~ '^[0-9a-f]{64}$'),
  opportunity_id uuid,
  rejection_histogram jsonb not null default '{}'::jsonb check (jsonb_typeof(rejection_histogram) = 'object'),
  screened_count integer not null check (screened_count >= 0),
  scored_count integer not null check (scored_count >= 0),
  inputs_digest text not null check (inputs_digest ~ '^[0-9a-f]{64}$'),
  artifact_version_tuple jsonb not null check (
    jsonb_typeof(artifact_version_tuple) = 'object'
    and artifact_version_tuple ? 'confidence_calibration'
    and artifact_version_tuple ->> 'confidence_calibration' <> ''
  ),
  policy_version_id uuid,
  propensity numeric(3,2) not null default 1 check (propensity = 1),
  is_exploration boolean not null default false check (is_exploration = false),
  retention_until timestamptz not null default (now() + interval '400 days'),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, decision_cycle_id)
    references public.decision_cycles (organization_id, id) on delete restrict,
  check (scored_count <= screened_count),
  check (
    (outcome = 'action_selected' and reason is null and selected_candidate_fingerprint is not null and opportunity_id is not null)
    or (outcome in ('no_action', 'needs_data') and reason is not null and selected_candidate_fingerprint is null and opportunity_id is null)
  ),
  check (retention_until >= created_at + interval '400 days')
);

create table public.decision_candidates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  decision_record_id uuid not null,
  playbook_version_id uuid not null,
  candidate_fingerprint text not null check (candidate_fingerprint ~ '^[0-9a-f]{64}$'),
  subject_kind text not null references public.subject_kinds(key),
  subject_ref text not null check (char_length(subject_ref) between 1 and 200),
  parameter_digest text not null check (parameter_digest ~ '^[0-9a-f]{64}$'),
  impact_low_minor bigint not null,
  impact_high_minor bigint not null,
  confidence numeric(5,4) not null check (confidence >= 0 and confidence <= 1),
  execution_cost_minor bigint not null,
  expected_contribution_minor bigint not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  evidence_tier text check (evidence_tier in ('computed', 'observed', 'prior')),
  eligibility_result jsonb not null,
  policy_result jsonb not null,
  rejection_reason text,
  rank integer check (rank > 0),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, decision_record_id, candidate_fingerprint),
  foreign key (organization_id, decision_record_id)
    references public.decision_records (organization_id, id) on delete restrict,
  foreign key (organization_id, playbook_version_id)
    references public.playbook_versions (organization_id, id) on delete restrict,
  check (impact_high_minor >= impact_low_minor)
);

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  decision_record_id uuid not null,
  playbook_version_id uuid not null,
  candidate_fingerprint text not null check (candidate_fingerprint ~ '^[0-9a-f]{64}$'),
  title text not null check (char_length(title) between 1 and 240),
  summary text not null check (char_length(summary) between 1 and 4000),
  hypothesis text not null check (char_length(hypothesis) between 1 and 4000),
  subject_kind text not null references public.subject_kinds(key),
  subject_ref text not null check (char_length(subject_ref) between 1 and 200),
  evidence_bundle jsonb not null check (jsonb_typeof(evidence_bundle) = 'object'),
  assumptions jsonb not null default '[]'::jsonb check (jsonb_typeof(assumptions) = 'array'),
  impact_low_minor bigint not null,
  impact_high_minor bigint not null,
  confidence numeric(5,4) not null check (confidence >= 0 and confidence <= 1),
  confidence_rationale text not null check (char_length(confidence_rationale) between 1 and 2000),
  evidence_tier text not null check (evidence_tier in ('computed', 'observed', 'prior')),
  execution_cost_minor bigint not null,
  expected_contribution_minor bigint not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  time_to_impact_days integer not null check (time_to_impact_days >= 0),
  risk_tier smallint not null check (risk_tier between 0 and 3),
  approval_path text not null check (approval_path in ('automatic', 'human_approval')),
  guardrails jsonb not null default '[]'::jsonb check (jsonb_typeof(guardrails) = 'array'),
  assertions jsonb not null check (jsonb_typeof(assertions) = 'array' and jsonb_array_length(assertions) > 0),
  evaluation_plan jsonb not null check (jsonb_typeof(evaluation_plan) = 'object'),
  expires_at timestamptz not null,
  status text not null check (status in ('proposed', 'awaiting_approval', 'approved', 'rejected', 'snoozed', 'expired')),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, decision_record_id)
    references public.decision_records (organization_id, id) on delete restrict,
  foreign key (organization_id, playbook_version_id)
    references public.playbook_versions (organization_id, id) on delete restrict,
  check (impact_high_minor >= impact_low_minor),
  check (expires_at > created_at)
);

create table public.decision_feedback (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  opportunity_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  feedback_kind text not null check (feedback_kind in ('approved', 'rejected', 'snoozed', 'edited', 'more_evidence_requested')),
  reason text,
  edit_diff jsonb,
  correlation_id uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, opportunity_id)
    references public.opportunities (organization_id, id) on delete restrict,
  check (feedback_kind <> 'edited' or edit_diff is not null)
);

create table public.candidate_suppressions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  candidate_fingerprint text not null check (candidate_fingerprint ~ '^[0-9a-f]{64}$'),
  playbook_version_id uuid not null,
  source_decision_record_id uuid not null,
  reason text not null check (char_length(reason) between 1 and 240),
  suppressed_until timestamptz,
  resolved_at timestamptz,
  resolution_kind text check (resolution_kind in ('operator_unsuppressed', 'fingerprint_changed', 'playbook_version_changed', 'resurface_condition_met', 'window_elapsed')),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, playbook_version_id)
    references public.playbook_versions (organization_id, id) on delete restrict,
  foreign key (organization_id, source_decision_record_id)
    references public.decision_records (organization_id, id) on delete restrict,
  check ((resolved_at is null and resolution_kind is null) or (resolved_at is not null and resolution_kind is not null))
);

create index decision_cycles_organization_started_idx on public.decision_cycles (organization_id, started_at desc);
create index decision_records_organization_created_idx on public.decision_records (organization_id, created_at desc);
create index decision_candidates_record_rank_idx on public.decision_candidates (organization_id, decision_record_id, rank);
create index opportunities_feed_idx on public.opportunities (organization_id, evidence_tier, expected_contribution_minor desc, time_to_impact_days, created_at desc)
  where status in ('proposed', 'awaiting_approval', 'approved');
create index candidate_suppressions_active_idx on public.candidate_suppressions (organization_id, candidate_fingerprint)
  where resolved_at is null;

-- Ledger history is append-only. A correction is a new row, so a future
-- outcome analysis can reconstruct what the engine actually considered.
create function private.reject_decision_ledger_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'decision_ledger_is_append_only' using errcode = '23514';
end;
$$;

create trigger decision_records_append_only before update or delete on public.decision_records
  for each row execute function private.reject_decision_ledger_mutation();
create trigger decision_candidates_append_only before update or delete on public.decision_candidates
  for each row execute function private.reject_decision_ledger_mutation();
create trigger decision_feedback_append_only before update or delete on public.decision_feedback
  for each row execute function private.reject_decision_ledger_mutation();
create trigger artifact_versions_append_only before update or delete on public.artifact_versions
  for each row execute function private.reject_decision_ledger_mutation();

-- RLS and grants are separate gates. No new decision ledger table is exposed
-- to anon; only the feed and feedback append are available to authenticated users.
alter table public.playbook_definitions enable row level security;
alter table public.playbook_definitions force row level security;
alter table public.playbook_versions enable row level security;
alter table public.playbook_versions force row level security;
alter table public.artifact_versions enable row level security;
alter table public.artifact_versions force row level security;
alter table public.decision_cycles enable row level security;
alter table public.decision_cycles force row level security;
alter table public.decision_records enable row level security;
alter table public.decision_records force row level security;
alter table public.decision_candidates enable row level security;
alter table public.decision_candidates force row level security;
alter table public.decision_feedback enable row level security;
alter table public.decision_feedback force row level security;
alter table public.candidate_suppressions enable row level security;
alter table public.candidate_suppressions force row level security;
alter table public.opportunities enable row level security;
alter table public.opportunities force row level security;

create policy "members can read opportunities" on public.opportunities for select to authenticated
  using (private.has_organization_role(organization_id, array['owner', 'admin', 'operator', 'viewer']::public.organization_role[]));
create policy "members can append feedback" on public.decision_feedback for insert to authenticated
  with check (
    actor_id = (select auth.uid())
    and private.has_organization_role(organization_id, array['owner', 'admin', 'operator']::public.organization_role[])
  );

revoke all on table public.playbook_definitions, public.playbook_versions, public.artifact_versions,
  public.decision_cycles, public.decision_records, public.decision_candidates, public.decision_feedback,
  public.candidate_suppressions, public.opportunities from anon;
revoke all on table public.playbook_definitions, public.playbook_versions, public.artifact_versions,
  public.decision_cycles, public.decision_records, public.decision_candidates, public.decision_feedback,
  public.candidate_suppressions, public.opportunities from authenticated;
grant select on table public.opportunities to authenticated;

create function public.start_decision_cycle(target_organization_id uuid, input_cycle jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare saved_id uuid := coalesce((input_cycle ->> 'id')::uuid, gen_random_uuid());
begin
  if target_organization_id is null or input_cycle ->> 'organization_id' is distinct from target_organization_id::text then
    raise exception 'decision_cycle_organization_mismatch' using errcode = '42501';
  end if;
  insert into public.decision_cycles (id, organization_id, trigger_name, correlation_id, slot_budget, max_scored_candidates)
  values (saved_id, target_organization_id, input_cycle ->> 'trigger_name', (input_cycle ->> 'correlation_id')::uuid,
    (input_cycle ->> 'slot_budget')::integer, (input_cycle ->> 'max_scored_candidates')::integer);
  return saved_id;
end;
$$;

create function public.persist_decision_record(target_organization_id uuid, input_record jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare saved_id uuid := gen_random_uuid();
begin
  if target_organization_id is null or input_record ->> 'organizationId' is distinct from target_organization_id::text then
    raise exception 'decision_record_organization_mismatch' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.decision_cycles cycle
    where cycle.organization_id = target_organization_id and cycle.id = (input_record ->> 'decisionCycleId')::uuid
  ) then raise exception 'decision_cycle_not_found' using errcode = '42501'; end if;
  if input_record ->> 'outcome' = 'action_selected' and not exists (
    select 1 from public.opportunities opportunity
    where opportunity.organization_id = target_organization_id and opportunity.id = (input_record ->> 'opportunityId')::uuid
  ) then raise exception 'decision_opportunity_not_found' using errcode = '42501'; end if;
  insert into public.decision_records (
    id, organization_id, decision_cycle_id, correlation_id, outcome, reason, selected_candidate_fingerprint,
    opportunity_id, rejection_histogram, screened_count, scored_count, inputs_digest, artifact_version_tuple, propensity, is_exploration
  ) values (
    saved_id, target_organization_id, (input_record ->> 'decisionCycleId')::uuid, (input_record ->> 'correlationId')::uuid,
    input_record ->> 'outcome', input_record ->> 'reason', input_record ->> 'selectedCandidateFingerprint',
    (input_record ->> 'opportunityId')::uuid, coalesce(input_record -> 'rejectionHistogram', '{}'::jsonb),
    (input_record ->> 'screenedCount')::integer, (input_record ->> 'scoredCount')::integer,
    input_record ->> 'inputsDigest', input_record -> 'artifactVersions', (input_record ->> 'propensity')::numeric,
    (input_record ->> 'isExploration')::boolean
  );
  return saved_id;
end;
$$;

create function public.append_decision_feedback(
  target_organization_id uuid, target_opportunity_id uuid, input_feedback_kind text,
  input_reason text, input_edit_diff jsonb, input_correlation_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare saved_id uuid;
begin
  if auth.uid() is null or not private.has_organization_role(target_organization_id, array['owner', 'admin', 'operator']::public.organization_role[]) then
    raise exception 'decision_feedback_forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.opportunities opportunity where opportunity.organization_id = target_organization_id and opportunity.id = target_opportunity_id) then
    raise exception 'decision_opportunity_not_found' using errcode = '42501';
  end if;
  insert into public.decision_feedback (organization_id, opportunity_id, actor_id, feedback_kind, reason, edit_diff, correlation_id)
  values (target_organization_id, target_opportunity_id, auth.uid(), input_feedback_kind, input_reason, input_edit_diff, input_correlation_id)
  returning id into saved_id;
  return saved_id;
end;
$$;

revoke all on function public.start_decision_cycle(uuid, jsonb) from public;
revoke all on function public.persist_decision_record(uuid, jsonb) from public;
revoke all on function public.append_decision_feedback(uuid, uuid, text, text, jsonb, uuid) from public;
grant execute on function public.start_decision_cycle(uuid, jsonb) to service_role;
grant execute on function public.persist_decision_record(uuid, jsonb) to service_role;
grant execute on function public.append_decision_feedback(uuid, uuid, text, text, jsonb, uuid) to authenticated;
