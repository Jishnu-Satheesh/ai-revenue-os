-- Complete the worker aggregate contract without rewriting the already-applied
-- 20260813123000 migration. Decision persistence is one atomic statement and
-- artifact activation is resolved from an append-only promotion ledger.

alter table public.artifact_promotions
  drop constraint artifact_promotions_organization_id_artifact_key_key;

alter table public.artifact_promotions
  add column promotion_sequence bigint generated always as identity;

create unique index artifact_promotions_sequence_idx
  on public.artifact_promotions (promotion_sequence);
create index artifact_promotions_current_idx
  on public.artifact_promotions (organization_id, artifact_key, promotion_sequence desc);

create function private.validate_artifact_promotion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_key text;
  rollback_key text;
  previous_active_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.organization_id::text || ':' || new.artifact_key, 0)
  );

  select artifact.artifact_key
  into active_key
  from public.artifact_versions artifact
  where artifact.organization_id = new.organization_id
    and artifact.id = new.active_artifact_version_id;

  if active_key is distinct from new.artifact_key then
    raise exception 'artifact_promotion_active_key_mismatch' using errcode = '23514';
  end if;

  select promotion.active_artifact_version_id
  into previous_active_id
  from public.artifact_promotions promotion
  where promotion.organization_id = new.organization_id
    and promotion.artifact_key = new.artifact_key
  order by promotion.promotion_sequence desc
  limit 1;

  if previous_active_id is null then
    if new.rollback_artifact_version_id is not null then
      raise exception 'artifact_promotion_initial_rollback_invalid' using errcode = '23514';
    end if;
  elsif new.rollback_artifact_version_id is distinct from previous_active_id then
    raise exception 'artifact_promotion_rollback_mismatch' using errcode = '23514';
  end if;

  if new.rollback_artifact_version_id is not null then
    select artifact.artifact_key
    into rollback_key
    from public.artifact_versions artifact
    where artifact.organization_id = new.organization_id
      and artifact.id = new.rollback_artifact_version_id;

    if rollback_key is distinct from new.artifact_key then
      raise exception 'artifact_promotion_rollback_key_mismatch' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger artifact_promotions_validate_insert
before insert on public.artifact_promotions
for each row execute function private.validate_artifact_promotion();

create trigger artifact_promotions_append_only
before update or delete on public.artifact_promotions
for each row execute function private.reject_decision_ledger_mutation();

create view private.current_artifact_promotions
with (security_invoker = true)
as
select distinct on (promotion.organization_id, promotion.artifact_key)
  promotion.id,
  promotion.organization_id,
  promotion.artifact_key,
  promotion.active_artifact_version_id,
  promotion.rollback_artifact_version_id,
  promotion.promoted_at,
  promotion.promoted_by,
  promotion.promotion_sequence
from public.artifact_promotions promotion
order by promotion.organization_id, promotion.artifact_key, promotion.promotion_sequence desc;

revoke all on private.current_artifact_promotions from public, anon, authenticated;

create function private.decision_json_has_exact(
  value jsonb,
  allowed_keys text[],
  required_keys text[]
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select private.decision_json_has_only(value, allowed_keys)
    and (select pg_catalog.bool_and(value ? required_key) from unnest(required_keys) required_key);
$$;

create function private.decision_json_is_text(value jsonb, minimum_length integer, maximum_length integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(value) = 'string'
    and char_length(value #>> '{}') between minimum_length and maximum_length;
$$;

create function private.decision_json_is_uuid(value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(value) = 'string'
    and (value #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
$$;

create function private.decision_json_is_integer(value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(value) = 'number'
    and (value #>> '{}')::numeric = pg_catalog.trunc((value #>> '{}')::numeric);
$$;

create function private.decision_json_is_bounded_object(
  value jsonb,
  maximum_keys integer,
  maximum_bytes integer,
  require_non_empty boolean default false
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(value) = 'object'
    and (select count(*) from jsonb_object_keys(value)) <= maximum_keys
    and octet_length(value::text) <= maximum_bytes
    and (not require_non_empty or value <> '{}'::jsonb);
$$;

revoke all on function private.validate_artifact_promotion() from public, anon, authenticated;
revoke all on function private.decision_json_has_exact(jsonb, text[], text[]) from public, anon, authenticated;
revoke all on function private.decision_json_is_text(jsonb, integer, integer) from public, anon, authenticated;
revoke all on function private.decision_json_is_uuid(jsonb) from public, anon, authenticated;
revoke all on function private.decision_json_is_integer(jsonb) from public, anon, authenticated;
revoke all on function private.decision_json_is_bounded_object(jsonb, integer, integer, boolean) from public, anon, authenticated;

alter table public.decision_records
  drop constraint decision_records_artifact_version_tuple_check;
alter table public.decision_records
  add constraint decision_records_artifact_version_tuple_object_check
  check (jsonb_typeof(artifact_version_tuple) = 'object');
alter table public.decision_records
  drop constraint decision_records_playbook_required;
alter table public.decision_records
  add constraint decision_records_playbook_required
  check (
    playbook_version_id is not null
    or (outcome = 'no_action' and reason = 'no_active_playbook')
    or (outcome = 'needs_data' and scored_count = 0)
  );

create or replace function public.persist_decision_aggregate(
  target_organization_id uuid,
  input_aggregate jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  record_input jsonb;
  tuple_input jsonb;
  opportunity_input jsonb;
  candidate_input jsonb;
  assertion_input jsonb;
  array_input jsonb;
  histogram_value jsonb;
  record_id uuid := gen_random_uuid();
  candidate_count integer;
  selected_count integer := 0;
  selected_candidate jsonb;
  seen_fingerprints text[] := '{}';
begin
  if target_organization_id is null
    or not private.decision_json_has_exact(
      input_aggregate,
      array['record', 'candidates', 'opportunity'],
      array['record', 'candidates', 'opportunity']
    )
    or jsonb_typeof(input_aggregate -> 'candidates') <> 'array'
  then
    raise exception 'decision_aggregate_invalid' using errcode = '22023';
  end if;

  record_input := input_aggregate -> 'record';
  tuple_input := record_input -> 'versionTuple';
  opportunity_input := input_aggregate -> 'opportunity';
  candidate_count := jsonb_array_length(input_aggregate -> 'candidates');

  if not private.decision_json_has_exact(
    record_input,
    array[
      'decisionCycleId', 'organizationId', 'correlationId', 'outcome', 'reason',
      'selectedCandidateFingerprint', 'opportunityId', 'rejectionHistogram',
      'screenedCount', 'scoredCount', 'inputsDigest', 'versionTuple', 'propensity',
      'isExploration'
    ],
    array[
      'decisionCycleId', 'organizationId', 'correlationId', 'outcome', 'reason',
      'selectedCandidateFingerprint', 'opportunityId', 'rejectionHistogram',
      'screenedCount', 'scoredCount', 'inputsDigest', 'versionTuple', 'propensity',
      'isExploration'
    ]
  )
    or not private.decision_json_is_uuid(record_input -> 'decisionCycleId')
    or not private.decision_json_is_uuid(record_input -> 'organizationId')
    or not private.decision_json_is_uuid(record_input -> 'correlationId')
    or record_input ->> 'organizationId' is distinct from target_organization_id::text
    or record_input ->> 'outcome' not in ('action_selected', 'no_action', 'needs_data')
    or not private.decision_json_is_integer(record_input -> 'screenedCount')
    or not private.decision_json_is_integer(record_input -> 'scoredCount')
    or (record_input ->> 'screenedCount')::integer < 0
    or (record_input ->> 'scoredCount')::integer < 0
    or (record_input ->> 'scoredCount')::integer > (record_input ->> 'screenedCount')::integer
    or (record_input ->> 'scoredCount')::integer <> candidate_count
    or candidate_count > 500
    or not private.decision_json_is_text(record_input -> 'inputsDigest', 64, 64)
    or (record_input ->> 'inputsDigest') !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(record_input -> 'rejectionHistogram') <> 'object'
    or jsonb_typeof(record_input -> 'propensity') <> 'number'
    or (record_input ->> 'propensity')::numeric <> 1
    or record_input -> 'isExploration' <> 'false'::jsonb
  then
    raise exception 'decision_record_invalid' using errcode = '22023';
  end if;

  for histogram_value in select value from jsonb_each(record_input -> 'rejectionHistogram')
  loop
    if not private.decision_json_is_integer(histogram_value)
      or (histogram_value #>> '{}')::integer < 0
    then
      raise exception 'decision_rejection_histogram_invalid' using errcode = '22023';
    end if;
  end loop;

  if record_input ->> 'outcome' = 'action_selected' then
    if record_input -> 'reason' <> 'null'::jsonb
      or not private.decision_json_is_text(record_input -> 'selectedCandidateFingerprint', 64, 64)
      or (record_input ->> 'selectedCandidateFingerprint') !~ '^[0-9a-f]{64}$'
      or not private.decision_json_is_uuid(record_input -> 'opportunityId')
      or opportunity_input = 'null'::jsonb
    then
      raise exception 'decision_selected_shape_invalid' using errcode = '22023';
    end if;
  elsif not private.decision_json_is_text(record_input -> 'reason', 1, 200)
    or record_input -> 'selectedCandidateFingerprint' <> 'null'::jsonb
    or record_input -> 'opportunityId' <> 'null'::jsonb
    or opportunity_input <> 'null'::jsonb
  then
    raise exception 'decision_non_selected_shape_invalid' using errcode = '22023';
  end if;

  if not private.decision_json_has_exact(
    tuple_input,
    array[
      'policyVersionId', 'playbookVersionId', 'promptVersionId', 'rankingWeightsId',
      'modelId', 'judgeVersionId', 'confidenceCalibrationId'
    ],
    array['policyVersionId', 'rankingWeightsId', 'confidenceCalibrationId']
  )
    or not private.decision_json_is_uuid(tuple_input -> 'policyVersionId')
    or not private.decision_json_is_uuid(tuple_input -> 'rankingWeightsId')
    or not private.decision_json_is_uuid(tuple_input -> 'confidenceCalibrationId')
    or ((tuple_input ? 'promptVersionId') <> (tuple_input ? 'modelId'))
    or (tuple_input ? 'playbookVersionId' and not private.decision_json_is_uuid(tuple_input -> 'playbookVersionId'))
    or (tuple_input ? 'promptVersionId' and not private.decision_json_is_uuid(tuple_input -> 'promptVersionId'))
    or (tuple_input ? 'modelId' and not private.decision_json_is_uuid(tuple_input -> 'modelId'))
    or (tuple_input ? 'judgeVersionId' and not private.decision_json_is_uuid(tuple_input -> 'judgeVersionId'))
  then
    raise exception 'decision_tuple_invalid' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.decision_cycles cycle
    where cycle.organization_id = target_organization_id
      and cycle.id = (record_input ->> 'decisionCycleId')::uuid
      and cycle.correlation_id = (record_input ->> 'correlationId')::uuid
  ) then
    raise exception 'decision_cycle_not_found' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.policies policy
    where policy.organization_id = target_organization_id
      and policy.id = (tuple_input ->> 'policyVersionId')::uuid
      and policy.is_active
  ) then
    raise exception 'decision_policy_version_invalid' using errcode = '42501';
  end if;

  if tuple_input ? 'playbookVersionId' and not exists (
    select 1
    from public.playbook_versions playbook
    where playbook.organization_id = target_organization_id
      and playbook.id = (tuple_input ->> 'playbookVersionId')::uuid
  ) then
    raise exception 'decision_playbook_version_invalid' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.artifact_versions artifact
    where artifact.organization_id = target_organization_id
      and artifact.id = (tuple_input ->> 'rankingWeightsId')::uuid
      and artifact.artifact_key = 'ranking_weights'
  ) or not exists (
    select 1 from public.artifact_versions artifact
    where artifact.organization_id = target_organization_id
      and artifact.id = (tuple_input ->> 'confidenceCalibrationId')::uuid
      and artifact.artifact_key = 'confidence_calibration'
  ) then
    raise exception 'decision_artifact_semantic_mismatch' using errcode = '42501';
  end if;

  if tuple_input ? 'promptVersionId' and not exists (
    select 1 from public.artifact_versions artifact
    where artifact.organization_id = target_organization_id
      and artifact.id = (tuple_input ->> 'promptVersionId')::uuid
      and artifact.artifact_key = 'prompt'
  ) then raise exception 'decision_prompt_version_invalid' using errcode = '42501'; end if;

  if tuple_input ? 'modelId' and not exists (
    select 1 from public.artifact_versions artifact
    where artifact.organization_id = target_organization_id
      and artifact.id = (tuple_input ->> 'modelId')::uuid
      and artifact.artifact_key = 'model'
  ) then raise exception 'decision_model_version_invalid' using errcode = '42501'; end if;

  if tuple_input ? 'judgeVersionId' and not exists (
    select 1 from public.artifact_versions artifact
    where artifact.organization_id = target_organization_id
      and artifact.id = (tuple_input ->> 'judgeVersionId')::uuid
      and artifact.artifact_key = 'judge'
  ) then raise exception 'decision_judge_version_invalid' using errcode = '42501'; end if;

  for candidate_input in select value from jsonb_array_elements(input_aggregate -> 'candidates')
  loop
    if not private.decision_json_has_exact(
      candidate_input,
      array[
        'playbookVersionId', 'candidateFingerprint', 'subjectKind', 'subjectRef',
        'parameterDigest', 'impactLowMinor', 'impactHighMinor', 'confidence',
        'executionCostMinor', 'expectedContributionMinor', 'currency', 'evidenceTier',
        'eligibilityResult', 'policyResult', 'rejectionReason', 'rank'
      ],
      array[
        'playbookVersionId', 'candidateFingerprint', 'subjectKind', 'subjectRef',
        'parameterDigest', 'impactLowMinor', 'impactHighMinor', 'confidence',
        'executionCostMinor', 'expectedContributionMinor', 'currency', 'evidenceTier',
        'eligibilityResult', 'policyResult', 'rejectionReason', 'rank'
      ]
    )
      or not private.decision_json_is_uuid(candidate_input -> 'playbookVersionId')
      or not private.decision_json_is_text(candidate_input -> 'candidateFingerprint', 64, 64)
      or (candidate_input ->> 'candidateFingerprint') !~ '^[0-9a-f]{64}$'
      or not private.decision_json_is_text(candidate_input -> 'subjectKind', 1, 120)
      or (candidate_input ->> 'subjectKind') !~ '^[a-z][a-z0-9_.-]{0,119}$'
      or not private.decision_json_is_text(candidate_input -> 'subjectRef', 1, 200)
      or not private.decision_json_is_text(candidate_input -> 'parameterDigest', 64, 64)
      or (candidate_input ->> 'parameterDigest') !~ '^[0-9a-f]{64}$'
      or not private.decision_json_is_integer(candidate_input -> 'impactLowMinor')
      or not private.decision_json_is_integer(candidate_input -> 'impactHighMinor')
      or (candidate_input ->> 'impactHighMinor')::numeric < (candidate_input ->> 'impactLowMinor')::numeric
      or jsonb_typeof(candidate_input -> 'confidence') <> 'number'
      or (candidate_input ->> 'confidence')::numeric not between 0 and 1
      or not private.decision_json_is_integer(candidate_input -> 'executionCostMinor')
      or not private.decision_json_is_integer(candidate_input -> 'expectedContributionMinor')
      or not private.decision_json_is_text(candidate_input -> 'currency', 3, 3)
      or (candidate_input ->> 'currency') !~ '^[A-Z]{3}$'
      or candidate_input ->> 'evidenceTier' not in ('computed', 'observed', 'prior')
      or not private.decision_json_is_bounded_object(candidate_input -> 'eligibilityResult', 100, 20000)
      or not private.decision_json_is_bounded_object(candidate_input -> 'policyResult', 100, 20000)
      or not (
        candidate_input -> 'rejectionReason' = 'null'::jsonb
        or private.decision_json_is_text(candidate_input -> 'rejectionReason', 1, 240)
      )
      or not private.decision_json_is_integer(candidate_input -> 'rank')
      or (candidate_input ->> 'rank')::integer <= 0
      or not (tuple_input ? 'playbookVersionId')
      or candidate_input ->> 'playbookVersionId' is distinct from tuple_input ->> 'playbookVersionId'
      or not exists (
        select 1 from public.subject_kinds subject_kind
        where subject_kind.key = candidate_input ->> 'subjectKind'
      )
    then
      raise exception 'decision_candidate_invalid' using errcode = '22023';
    end if;

    if candidate_input ->> 'candidateFingerprint' = any(seen_fingerprints) then
      raise exception 'decision_candidate_duplicate' using errcode = '22023';
    end if;
    seen_fingerprints := array_append(seen_fingerprints, candidate_input ->> 'candidateFingerprint');

    if candidate_input ->> 'candidateFingerprint' = record_input ->> 'selectedCandidateFingerprint' then
      selected_count := selected_count + 1;
      selected_candidate := candidate_input;
    end if;
  end loop;

  if candidate_count > 0 and not (tuple_input ? 'playbookVersionId') then
    raise exception 'decision_playbook_required_for_candidates' using errcode = '22023';
  end if;

  if not (tuple_input ? 'playbookVersionId')
    and not (
      record_input ->> 'outcome' = 'no_action'
      and record_input ->> 'reason' = 'no_active_playbook'
    )
    and not (
      record_input ->> 'outcome' = 'needs_data'
      and candidate_count = 0
    )
  then
    raise exception 'decision_playbook_version_required' using errcode = '22023';
  end if;

  if record_input ->> 'outcome' = 'action_selected' and selected_count <> 1 then
    raise exception 'decision_selected_candidate_mismatch' using errcode = '22023';
  end if;

  if record_input ->> 'outcome' = 'action_selected' then
    if not private.decision_json_has_exact(
      opportunity_input,
      array[
        'id', 'playbookVersionId', 'candidateFingerprint', 'title', 'summary', 'hypothesis',
        'subjectKind', 'subjectRef', 'evidenceBundle', 'assumptions', 'impactLowMinor',
        'impactHighMinor', 'confidence', 'confidenceRationale', 'evidenceTier',
        'executionCostMinor', 'expectedContributionMinor', 'currency', 'timeToImpactDays',
        'riskTier', 'approvalPath', 'guardrails', 'assertions', 'evaluationPlan', 'expiresAt',
        'status'
      ],
      array[
        'id', 'playbookVersionId', 'candidateFingerprint', 'title', 'summary', 'hypothesis',
        'subjectKind', 'subjectRef', 'evidenceBundle', 'assumptions', 'impactLowMinor',
        'impactHighMinor', 'confidence', 'confidenceRationale', 'evidenceTier',
        'executionCostMinor', 'expectedContributionMinor', 'currency', 'timeToImpactDays',
        'riskTier', 'approvalPath', 'guardrails', 'assertions', 'evaluationPlan', 'expiresAt',
        'status'
      ]
    )
      or not private.decision_json_is_uuid(opportunity_input -> 'id')
      or opportunity_input ->> 'id' is distinct from record_input ->> 'opportunityId'
      or opportunity_input ->> 'playbookVersionId' is distinct from selected_candidate ->> 'playbookVersionId'
      or opportunity_input ->> 'candidateFingerprint' is distinct from selected_candidate ->> 'candidateFingerprint'
      or opportunity_input ->> 'subjectKind' is distinct from selected_candidate ->> 'subjectKind'
      or opportunity_input ->> 'subjectRef' is distinct from selected_candidate ->> 'subjectRef'
      or opportunity_input -> 'impactLowMinor' is distinct from selected_candidate -> 'impactLowMinor'
      or opportunity_input -> 'impactHighMinor' is distinct from selected_candidate -> 'impactHighMinor'
      or opportunity_input -> 'confidence' is distinct from selected_candidate -> 'confidence'
      or opportunity_input -> 'executionCostMinor' is distinct from selected_candidate -> 'executionCostMinor'
      or opportunity_input -> 'expectedContributionMinor' is distinct from selected_candidate -> 'expectedContributionMinor'
      or opportunity_input ->> 'currency' is distinct from selected_candidate ->> 'currency'
      or opportunity_input ->> 'evidenceTier' is distinct from selected_candidate ->> 'evidenceTier'
      or not private.decision_json_is_text(opportunity_input -> 'title', 1, 240)
      or not private.decision_json_is_text(opportunity_input -> 'summary', 1, 4000)
      or not private.decision_json_is_text(opportunity_input -> 'hypothesis', 1, 4000)
      or not private.decision_json_is_bounded_object(opportunity_input -> 'evidenceBundle', 100, 20000, true)
      or jsonb_typeof(opportunity_input -> 'assumptions') <> 'array'
      or jsonb_array_length(opportunity_input -> 'assumptions') > 50
      or not private.decision_json_is_text(opportunity_input -> 'confidenceRationale', 1, 2000)
      or not private.decision_json_is_integer(opportunity_input -> 'timeToImpactDays')
      or (opportunity_input ->> 'timeToImpactDays')::integer < 0
      or not private.decision_json_is_integer(opportunity_input -> 'riskTier')
      or (opportunity_input ->> 'riskTier')::integer not between 0 and 3
      or opportunity_input ->> 'approvalPath' not in ('automatic', 'human_approval')
      or jsonb_typeof(opportunity_input -> 'guardrails') <> 'array'
      or jsonb_array_length(opportunity_input -> 'guardrails') > 50
      or jsonb_typeof(opportunity_input -> 'assertions') <> 'array'
      or jsonb_array_length(opportunity_input -> 'assertions') not between 1 and 50
      or not private.decision_json_is_bounded_object(opportunity_input -> 'evaluationPlan', 100, 20000, true)
      or not private.decision_json_is_text(opportunity_input -> 'expiresAt', 1, 80)
      or opportunity_input ->> 'status' not in (
        'proposed', 'awaiting_approval', 'approved', 'rejected', 'snoozed', 'expired'
      )
    then
      raise exception 'decision_opportunity_invalid' using errcode = '22023';
    end if;

    for array_input in select value from jsonb_array_elements(opportunity_input -> 'assumptions')
    loop
      if not private.decision_json_is_text(array_input, 1, 500) then
        raise exception 'decision_opportunity_assumption_invalid' using errcode = '22023';
      end if;
    end loop;

    for array_input in select value from jsonb_array_elements(opportunity_input -> 'guardrails')
    loop
      if not private.decision_json_is_bounded_object(array_input, 100, 20000) then
        raise exception 'decision_opportunity_guardrail_invalid' using errcode = '22023';
      end if;
    end loop;

    for assertion_input in select value from jsonb_array_elements(opportunity_input -> 'assertions')
    loop
      if not private.decision_json_has_exact(
        assertion_input,
        array['key', 'expectedOutcome'],
        array['key', 'expectedOutcome']
      )
        or not private.decision_json_is_text(assertion_input -> 'key', 1, 120)
        or not private.decision_json_is_text(assertion_input -> 'expectedOutcome', 1, 200)
      then
        raise exception 'decision_opportunity_assertion_invalid' using errcode = '22023';
      end if;
    end loop;
  end if;

  insert into public.decision_records (
    id, organization_id, decision_cycle_id, correlation_id, outcome, reason,
    selected_candidate_fingerprint, opportunity_id, rejection_histogram, screened_count,
    scored_count, inputs_digest, artifact_version_tuple, policy_version_id,
    playbook_version_id, prompt_version_id, ranking_weights_id, model_id, judge_version_id,
    confidence_calibration_id, propensity, is_exploration
  ) values (
    record_id,
    target_organization_id,
    (record_input ->> 'decisionCycleId')::uuid,
    (record_input ->> 'correlationId')::uuid,
    record_input ->> 'outcome',
    record_input ->> 'reason',
    record_input ->> 'selectedCandidateFingerprint',
    (record_input ->> 'opportunityId')::uuid,
    record_input -> 'rejectionHistogram',
    (record_input ->> 'screenedCount')::integer,
    (record_input ->> 'scoredCount')::integer,
    record_input ->> 'inputsDigest',
    tuple_input,
    (tuple_input ->> 'policyVersionId')::uuid,
    (tuple_input ->> 'playbookVersionId')::uuid,
    (tuple_input ->> 'promptVersionId')::uuid,
    (tuple_input ->> 'rankingWeightsId')::uuid,
    (tuple_input ->> 'modelId')::uuid,
    (tuple_input ->> 'judgeVersionId')::uuid,
    (tuple_input ->> 'confidenceCalibrationId')::uuid,
    (record_input ->> 'propensity')::numeric,
    (record_input ->> 'isExploration')::boolean
  );

  for candidate_input in select value from jsonb_array_elements(input_aggregate -> 'candidates')
  loop
    insert into public.decision_candidates (
      organization_id, decision_record_id, playbook_version_id, candidate_fingerprint,
      subject_kind, subject_ref, parameter_digest, impact_low_minor, impact_high_minor,
      confidence, execution_cost_minor, expected_contribution_minor, currency, evidence_tier,
      eligibility_result, policy_result, rejection_reason, rank
    ) values (
      target_organization_id,
      record_id,
      (candidate_input ->> 'playbookVersionId')::uuid,
      candidate_input ->> 'candidateFingerprint',
      candidate_input ->> 'subjectKind',
      candidate_input ->> 'subjectRef',
      candidate_input ->> 'parameterDigest',
      (candidate_input ->> 'impactLowMinor')::bigint,
      (candidate_input ->> 'impactHighMinor')::bigint,
      (candidate_input ->> 'confidence')::numeric,
      (candidate_input ->> 'executionCostMinor')::bigint,
      (candidate_input ->> 'expectedContributionMinor')::bigint,
      candidate_input ->> 'currency',
      candidate_input ->> 'evidenceTier',
      candidate_input -> 'eligibilityResult',
      candidate_input -> 'policyResult',
      candidate_input ->> 'rejectionReason',
      (candidate_input ->> 'rank')::integer
    );
  end loop;

  if opportunity_input <> 'null'::jsonb then
    insert into public.opportunities (
      id, organization_id, decision_record_id, playbook_version_id, candidate_fingerprint,
      title, summary, hypothesis, subject_kind, subject_ref, evidence_bundle, assumptions,
      impact_low_minor, impact_high_minor, confidence, confidence_rationale, evidence_tier,
      execution_cost_minor, expected_contribution_minor, currency, time_to_impact_days,
      risk_tier, approval_path, guardrails, assertions, evaluation_plan, expires_at, status
    ) values (
      (opportunity_input ->> 'id')::uuid,
      target_organization_id,
      record_id,
      (opportunity_input ->> 'playbookVersionId')::uuid,
      opportunity_input ->> 'candidateFingerprint',
      opportunity_input ->> 'title',
      opportunity_input ->> 'summary',
      opportunity_input ->> 'hypothesis',
      opportunity_input ->> 'subjectKind',
      opportunity_input ->> 'subjectRef',
      opportunity_input -> 'evidenceBundle',
      opportunity_input -> 'assumptions',
      (opportunity_input ->> 'impactLowMinor')::bigint,
      (opportunity_input ->> 'impactHighMinor')::bigint,
      (opportunity_input ->> 'confidence')::numeric,
      opportunity_input ->> 'confidenceRationale',
      opportunity_input ->> 'evidenceTier',
      (opportunity_input ->> 'executionCostMinor')::bigint,
      (opportunity_input ->> 'expectedContributionMinor')::bigint,
      opportunity_input ->> 'currency',
      (opportunity_input ->> 'timeToImpactDays')::integer,
      (opportunity_input ->> 'riskTier')::smallint,
      opportunity_input ->> 'approvalPath',
      opportunity_input -> 'guardrails',
      opportunity_input -> 'assertions',
      opportunity_input -> 'evaluationPlan',
      (opportunity_input ->> 'expiresAt')::timestamptz,
      opportunity_input ->> 'status'
    );
  end if;

  return record_id;
end;
$$;

revoke all on function public.persist_decision_record(uuid, jsonb) from service_role;
revoke all on function public.persist_decision_aggregate(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.persist_decision_aggregate(uuid, jsonb) to service_role;
