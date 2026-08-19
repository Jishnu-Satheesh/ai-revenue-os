-- Campaign-scoped learning proposals: the evidence loop's last arrow.
--
-- Task 22, in one migration. After a campaign settles, the evidence loop drafts
-- exactly one governed learning proposal that quotes its own evidence — the
-- exact bundle version and digest, the policy versions that authorized the
-- creative, the variant ids, the planned and realized exposure, and the settled
-- outcome — and then stops. It never promotes anything, never generalizes
-- across campaigns, and never turns an inconclusive result into a winning rule:
-- all of that is the operator's decision, recorded here as a status transition
-- and nothing more.
--
-- Two walls live here. The first is the write wall (ADR 0013): the learning
-- path's only write is a proposal row, so nothing below touches brand policy,
-- a playbook, a recipe, a threshold, or an artifact version. The second is the
-- evidence wall (ADR 0021): the proposal is drafted from one campaign's own
-- outcome, plan, variants, and approval, and the write RPC refuses any cited
-- evidence that does not belong to that campaign and that organization.

-- ---------------------------------------------------------------------------
-- The proposal record
-- ---------------------------------------------------------------------------

create table public.campaign_learning_proposals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null,
  -- The settled outcome the proposal was drafted from. Null is never legal: a
  -- proposal without a settled outcome would be a lesson with no evidence.
  outcome_id uuid not null,

  -- The exact evidence the lesson quotes. The bundle version and digest pin the
  -- generation policy inside the manifest; the policy version ids are what the
  -- approval assumed was true about platform policy when it authorized the
  -- creative; the variant ids are the creative the lesson is about.
  bundle_version_id uuid not null,
  bundle_digest text not null check (bundle_digest ~ '^[0-9a-f]{64}$'),
  policy_version_ids uuid[] not null default '{}',
  variant_ids uuid[] not null,

  -- Planned and realized exposure, quoted from the outcome and never reconciled
  -- into one number here either.
  planned_exposure_count bigint not null check (planned_exposure_count >= 0),
  realized_exposure_count bigint not null check (realized_exposure_count >= 0),

  -- The verdict and evidence tier the proposal quotes, copied from the outcome
  -- so the lesson is self-contained and can never outlive a restatement.
  verdict text not null check (
    verdict in ('validated_outcome', 'inconclusive', 'guardrail_breach', 'execution_only')
  ),
  evidence_tier text check (evidence_tier in ('computed', 'observed')),

  -- Hypothesis (from the preregistered plan) and observation (from the outcome)
  -- are two separate fields and are never merged into one narrative.
  hypothesis text not null check (char_length(hypothesis) between 1 and 4000),
  observation text not null check (char_length(observation) between 1 and 4000),

  -- The drafted lesson, the only field a model writes, and only from the
  -- computed result and the cited evidence. It passes the deterministic
  -- validators in code before it is accepted.
  proposed_lesson text not null check (char_length(proposed_lesson) between 1 and 4000),

  limitations jsonb not null default '[]' check (jsonb_typeof(limitations) = 'array'),

  -- The next test, composed deterministically from the verdict. A model never
  -- chooses a method, so it never chooses the next test either.
  suggested_next_test text not null check (char_length(suggested_next_test) between 1 and 2000),

  -- The evidence ids the proposal cites, each traceable to the campaign's own
  -- outcome, bundle version, variant, or policy version.
  evidence_links jsonb not null default '[]' check (jsonb_typeof(evidence_links) = 'array'),

  -- Null while the lesson stays campaign-local. Set only when an operator
  -- submits it as a separate reusable-recipe proposal under ADR 0013.
  target_artifact_type text check (target_artifact_type = 'reusable_recipe'),

  status text not null default 'proposed' check (
    status in ('proposed', 'dismissed', 'campaign_only', 'submitted_for_promotion')
  ),
  decided_by uuid,
  decided_at timestamptz,

  created_at timestamptz not null default now(),

  unique (organization_id, id),

  check (decided_by is null or status <> 'proposed'),
  check ((decided_by is null) = (decided_at is null)),

  foreign key (organization_id, campaign_id)
    references public.campaigns (organization_id, id) on delete cascade,
  foreign key (organization_id, outcome_id)
    references public.campaign_outcomes (organization_id, id) on delete cascade,
  foreign key (organization_id, bundle_version_id)
    references public.campaign_bundle_versions (organization_id, id) on delete cascade,
  foreign key (decided_by)
    references auth.users (id) on delete restrict
);

create index campaign_learning_proposals_campaign_idx
  on public.campaign_learning_proposals (organization_id, campaign_id, created_at desc);
create index campaign_learning_proposals_outcome_idx
  on public.campaign_learning_proposals (organization_id, outcome_id);

-- One live (undecided) proposal per campaign. A decided proposal is history and
-- stays on record; a second live proposal while one is undecided is refused by
-- this index and re-checked in the write RPC.
create unique index campaign_learning_proposals_one_live_per_campaign_idx
  on public.campaign_learning_proposals (organization_id, campaign_id)
  where status = 'proposed';

alter table public.campaign_learning_proposals enable row level security;
alter table public.campaign_learning_proposals force row level security;

revoke all on public.campaign_learning_proposals from anon, authenticated;
grant select on public.campaign_learning_proposals to authenticated;

create policy campaign_learning_proposals_member_read
  on public.campaign_learning_proposals
  for select to authenticated
  using (private.is_organization_member(organization_id));

comment on table public.campaign_learning_proposals is
  'One governed learning proposal per campaign, drafted by the evidence loop from the campaign''s own settled outcome and decided by an operator. Hypothesis and observation are separate fields; promotion is a separate governed decision.';

-- Append-only, with exactly one legal edit: the operator's decision. A proposal
-- may move from `proposed` to a terminal status with an actor and time; every
-- other column, and every other edit, is refused.
create function private.prevent_campaign_learning_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if TG_OP = 'DELETE' then
    raise exception 'campaign_learning_proposal_is_append_only' using errcode = '23514';
  end if;

  if old.status <> 'proposed'
    or new.status not in ('dismissed', 'campaign_only', 'submitted_for_promotion')
  then
    raise exception 'campaign_learning_proposal_is_append_only' using errcode = '23514';
  end if;

  if new.decided_by is null or new.decided_at is null then
    raise exception 'campaign_learning_decision_missing_actor' using errcode = '23514';
  end if;

  if (new.status = 'submitted_for_promotion') <> (new.target_artifact_type = 'reusable_recipe') then
    raise exception 'campaign_learning_target_artifact_mismatch' using errcode = '23514';
  end if;

  -- Only the decision columns may differ from the drafted proposal.
  if pg_catalog.to_jsonb(new) - 'status' - 'target_artifact_type' - 'decided_by' - 'decided_at'
    is distinct from pg_catalog.to_jsonb(old) - 'status' - 'target_artifact_type' - 'decided_by' - 'decided_at' then
    raise exception 'campaign_learning_proposal_is_append_only' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger campaign_learning_proposals_append_only
  before update or delete on public.campaign_learning_proposals
  for each row execute function private.prevent_campaign_learning_mutation();

-- ---------------------------------------------------------------------------
-- The context a worker reads before drafting a lesson
-- ---------------------------------------------------------------------------

create function public.read_campaign_learning_context(
  target_organization_id uuid,
  target_campaign_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  outcome_row public.campaign_outcomes;
  version_row public.campaign_bundle_versions;
  plan_row public.campaign_measurement_plans;
  approval_policy_ids uuid[] := '{}';
  variant_ids uuid[] := '{}';
begin
  -- The campaign's own current settled outcome, and nothing else. A campaign
  -- with no settled outcome has no lesson to propose, by construction.
  select outcome.* into outcome_row
  from public.campaign_outcomes outcome
  where outcome.organization_id = target_organization_id
    and outcome.campaign_id = target_campaign_id
    and outcome.superseded_by_id is null
  order by outcome.settled_at desc
  limit 1;

  if not found then
    raise exception 'campaign_has_no_settled_outcome' using errcode = '22023';
  end if;

  select version.* into version_row
  from public.campaign_bundle_versions version
  where version.organization_id = target_organization_id
    and version.id = outcome_row.bundle_version_id;

  if not found then
    raise exception 'campaign_learning_version_missing' using errcode = '22023';
  end if;

  select plan.* into plan_row
  from public.campaign_measurement_plans plan
  where plan.organization_id = target_organization_id
    and plan.bundle_version_id = outcome_row.bundle_version_id;

  if not found then
    raise exception 'campaign_measurement_plan_missing' using errcode = '22023';
  end if;

  -- The policy versions the approval assumed were in force when it authorized
  -- this exact bundle version. Copied, never invented.
  select approval.policy_version_ids into approval_policy_ids
  from public.campaign_approvals approval
  where approval.organization_id = target_organization_id
    and approval.bundle_version_id = outcome_row.bundle_version_id
  order by approval.approved_at desc
  limit 1;

  -- The variants produced under this version, which is what the lesson is about.
  select coalesce(pg_catalog.array_agg(variant.id), '{}'::uuid[]) into variant_ids
  from public.campaign_creative_variants variant
  where variant.organization_id = target_organization_id
    and variant.bundle_version_id = outcome_row.bundle_version_id;

  return pg_catalog.jsonb_build_object(
    'outcome_id', outcome_row.id,
    'bundle_version_id', outcome_row.bundle_version_id,
    'bundle_digest', version_row.digest,
    'policy_version_ids', pg_catalog.to_jsonb(approval_policy_ids),
    'variant_ids', pg_catalog.to_jsonb(variant_ids),
    'planned_exposure_count', outcome_row.planned_exposure_count,
    'realized_exposure_count', outcome_row.realized_exposure_count,
    'verdict', outcome_row.verdict,
    'evidence_tier', outcome_row.evidence_tier,
    'primary_metric_key', plan_row.primary_metric_key,
    'attribution_method', plan_row.attribution_method,
    'outcome_window_days', plan_row.outcome_window_days,
    'settlement_delay_days', plan_row.settlement_delay_days,
    'baseline_source', plan_row.baseline_source,
    'baseline_lookback_days', plan_row.baseline_lookback_days,
    'estimate_minor', outcome_row.estimate_minor,
    'estimate_currency', outcome_row.estimate_currency,
    'limitations', outcome_row.limitations,
    'settled_at', outcome_row.settled_at
  );
end;
$$;

revoke all on function public.read_campaign_learning_context(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.read_campaign_learning_context(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Writing the proposal
-- ---------------------------------------------------------------------------

create function public.propose_campaign_learning(
  target_organization_id uuid,
  input_proposal jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  outcome_row public.campaign_outcomes;
  version_row public.campaign_bundle_versions;
  approval_policy_ids uuid[] := '{}';
  supplied_variant_ids uuid[];
  current_row public.campaign_learning_proposals;
  new_proposal_id uuid := pg_catalog.gen_random_uuid();
  link record;
  link_id uuid;
  link_kind text;
  incoming_value jsonb;
  existing_value jsonb;
begin
  if target_organization_id is null
    or input_proposal ->> 'organization_id' is distinct from target_organization_id::text
  then
    raise exception 'campaign_learning_organization_mismatch' using errcode = '42501';
  end if;

  -- The proposal is drafted from one campaign's own settled outcome, and only
  -- from a settled outcome: no settlement, no proposal.
  select outcome.* into outcome_row
  from public.campaign_outcomes outcome
  where outcome.organization_id = target_organization_id
    and outcome.campaign_id = (input_proposal ->> 'campaign_id')::uuid
    and outcome.superseded_by_id is null;

  if not found then
    raise exception 'campaign_has_no_settled_outcome' using errcode = '22023';
  end if;

  select version.* into version_row
  from public.campaign_bundle_versions version
  where version.organization_id = target_organization_id
    and version.id = outcome_row.bundle_version_id;

  select approval.policy_version_ids into approval_policy_ids
  from public.campaign_approvals approval
  where approval.organization_id = target_organization_id
    and approval.bundle_version_id = outcome_row.bundle_version_id
  order by approval.approved_at desc
  limit 1;

  supplied_variant_ids := coalesce(
    (select pg_catalog.array_agg((value #>> '{}')::uuid)
     from pg_catalog.jsonb_array_elements(input_proposal -> 'variant_ids')),
    '{}'::uuid[]
  );

  -- Every cited variant must be one of this campaign's own variants for the
  -- executed version. A variant from another campaign or another tenant fails
  -- here, before anything is written.
  if exists (
    select 1 from pg_catalog.unnest(supplied_variant_ids) as supplied(variant_id)
    where not exists (
      select 1 from public.campaign_creative_variants variant
      where variant.organization_id = target_organization_id
        and variant.bundle_version_id = outcome_row.bundle_version_id
        and variant.id = supplied.variant_id
    )
  ) then
    raise exception 'campaign_learning_variant_not_in_campaign' using errcode = '22023';
  end if;

  -- Every cited evidence link must resolve to the campaign's own outcome,
  -- bundle version, a cited variant, or one of the approval's policy versions.
  for link in
    select value from pg_catalog.jsonb_array_elements(
      coalesce(input_proposal -> 'evidence_links', '[]'::jsonb)
    )
  loop
    link_kind := link.value ->> 'kind';
    link_id := (link.value ->> 'id')::uuid;

    if link_kind = 'outcome' then
      if link_id is distinct from outcome_row.id then
        raise exception 'campaign_learning_evidence_not_in_campaign' using errcode = '22023';
      end if;
    elsif link_kind = 'bundle_version' then
      if link_id is distinct from outcome_row.bundle_version_id then
        raise exception 'campaign_learning_evidence_not_in_campaign' using errcode = '22023';
      end if;
    elsif link_kind = 'variant' then
      if not (link_id = any (supplied_variant_ids)) then
        raise exception 'campaign_learning_evidence_not_in_campaign' using errcode = '22023';
      end if;
    elsif link_kind = 'policy' then
      if not (link_id = any (approval_policy_ids)) then
        raise exception 'campaign_learning_evidence_not_in_campaign' using errcode = '22023';
      end if;
    else
      raise exception 'campaign_learning_unknown_evidence_kind' using errcode = '22023';
    end if;
  end loop;

  -- Exactly one live proposal per campaign. A byte-identical replay is
  -- idempotent; anything else must wait for the operator to decide the current
  -- proposal first.
  select proposal.* into current_row
  from public.campaign_learning_proposals proposal
  where proposal.organization_id = target_organization_id
    and proposal.campaign_id = (input_proposal ->> 'campaign_id')::uuid
    and proposal.status = 'proposed';

  if current_row.id is not null then
    incoming_value := pg_catalog.jsonb_build_object(
      'hypothesis', input_proposal ->> 'hypothesis',
      'observation', input_proposal ->> 'observation',
      'proposed_lesson', input_proposal ->> 'proposed_lesson',
      'suggested_next_test', input_proposal ->> 'suggested_next_test',
      'variant_ids', pg_catalog.to_jsonb(supplied_variant_ids),
      'evidence_links', coalesce(input_proposal -> 'evidence_links', '[]'::jsonb)
    );
    existing_value := pg_catalog.jsonb_build_object(
      'hypothesis', current_row.hypothesis,
      'observation', current_row.observation,
      'proposed_lesson', current_row.proposed_lesson,
      'suggested_next_test', current_row.suggested_next_test,
      'variant_ids', pg_catalog.to_jsonb(current_row.variant_ids),
      'evidence_links', current_row.evidence_links
    );

    if existing_value is not distinct from incoming_value then
      return pg_catalog.jsonb_build_object('outcome', 'unchanged', 'proposal_id', current_row.id);
    end if;

    raise exception 'campaign_learning_already_proposed' using errcode = '22023';
  end if;

  insert into public.campaign_learning_proposals (
    id, organization_id, campaign_id, outcome_id, bundle_version_id, bundle_digest,
    policy_version_ids, variant_ids, planned_exposure_count, realized_exposure_count,
    verdict, evidence_tier, hypothesis, observation, proposed_lesson,
    limitations, suggested_next_test, evidence_links
  ) values (
    new_proposal_id, target_organization_id,
    (input_proposal ->> 'campaign_id')::uuid,
    outcome_row.id,
    outcome_row.bundle_version_id,
    version_row.digest,
    approval_policy_ids,
    supplied_variant_ids,
    outcome_row.planned_exposure_count,
    outcome_row.realized_exposure_count,
    outcome_row.verdict,
    outcome_row.evidence_tier,
    input_proposal ->> 'hypothesis',
    input_proposal ->> 'observation',
    input_proposal ->> 'proposed_lesson',
    outcome_row.limitations,
    input_proposal ->> 'suggested_next_test',
    coalesce(input_proposal -> 'evidence_links', '[]'::jsonb)
  );

  return pg_catalog.jsonb_build_object('outcome', 'proposed', 'proposal_id', new_proposal_id);
end;
$$;

revoke all on function public.propose_campaign_learning(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.propose_campaign_learning(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- The operator's decision
-- ---------------------------------------------------------------------------

create function public.decide_campaign_learning_proposal(
  target_organization_id uuid,
  input_decision jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  proposal public.campaign_learning_proposals;
  decision text := input_decision ->> 'decision';
  new_status text;
begin
  if target_organization_id is null
    or input_decision ->> 'organization_id' is distinct from target_organization_id::text
  then
    raise exception 'campaign_learning_organization_mismatch' using errcode = '42501';
  end if;

  -- Recording a decision is a human act. The role is re-checked here, never
  -- trusted from the route in front of it.
  if auth.uid() is null or not private.has_organization_role(
    target_organization_id,
    array['owner', 'admin', 'operator']::public.organization_role[]
  ) then
    raise exception 'campaign_learning_decision_forbidden' using errcode = '42501';
  end if;

  new_status := case decision
    when 'dismiss' then 'dismissed'
    when 'keep_campaign_only' then 'campaign_only'
    when 'submit_for_promotion' then 'submitted_for_promotion'
    else null
  end;

  if new_status is null then
    raise exception 'campaign_learning_unknown_decision' using errcode = '22023';
  end if;

  select p.* into proposal
  from public.campaign_learning_proposals p
  where p.organization_id = target_organization_id
    and p.id = (input_decision ->> 'proposal_id')::uuid
  for update;

  if not found then
    raise exception 'campaign_learning_proposal_not_found' using errcode = '42501';
  end if;

  if proposal.status <> 'proposed' then
    raise exception 'campaign_learning_already_decided' using errcode = '22023';
  end if;

  -- The decision sets the status, the target artifact type (only when submitted
  -- for promotion), and the actor and time. It promotes nothing and mutates the
  -- source campaign not at all.
  update public.campaign_learning_proposals
  set status = new_status,
      target_artifact_type = case when new_status = 'submitted_for_promotion'
                                  then 'reusable_recipe' else null end,
      decided_by = auth.uid(),
      decided_at = pg_catalog.now()
  where organization_id = target_organization_id and id = proposal.id;

  return pg_catalog.jsonb_build_object(
    'outcome', 'decided',
    'proposal_id', proposal.id,
    'status', new_status
  );
end;
$$;

revoke all on function public.decide_campaign_learning_proposal(uuid, jsonb)
  from public, anon;
grant execute on function public.decide_campaign_learning_proposal(uuid, jsonb) to authenticated;
