begin;

create extension if not exists pgtap with schema extensions;

select extensions.no_plan();

insert into auth.users (id)
values ('d5c50000-0000-4000-8000-000000000001'::uuid);

insert into public.organizations (
  id, name, slug, industry, country_code, base_currency, default_timezone, created_by
)
values (
  'd5c50000-0000-4000-8000-000000000101'::uuid,
  'Campaign cycle runtime', 'campaign-cycle-runtime', 'testing', 'AE', 'AED',
  'Asia/Dubai', 'd5c50000-0000-4000-8000-000000000001'::uuid
);

insert into public.policies (
  id, organization_id, policy_type, name, mode, configuration,
  monthly_budget_minor, budget_currency, version, is_active
)
values
  (
    'd5c50000-0000-4000-8000-000000000201'::uuid,
    'd5c50000-0000-4000-8000-000000000101'::uuid,
    'access', 'Campaign access', 'approval_required',
    '{"max_active_recommendations":3}'::jsonb, null, null, 1, true
  ),
  (
    'd5c50000-0000-4000-8000-000000000202'::uuid,
    'd5c50000-0000-4000-8000-000000000101'::uuid,
    'spend', 'Campaign spend', 'approval_required', '{}'::jsonb,
    450000, 'AED', 1, true
  );

create temporary table campaign_cycle_state (
  key text primary key,
  value jsonb not null
);
grant select, insert, update on campaign_cycle_state to service_role;

create function pg_temp.campaign_selected_completion(
  claim jsonb,
  decision_context jsonb,
  operation_key text,
  digest text,
  correlation_id uuid,
  opportunity_id uuid,
  fingerprint text
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'organization_id', 'd5c50000-0000-4000-8000-000000000101',
    'idempotency_key', operation_key,
    'request_digest', digest,
    'claim_token', claim ->> 'claim_token',
    'decision_cycle_id', claim ->> 'decision_cycle_id',
    'aggregate', pg_catalog.jsonb_build_object(
      'record', pg_catalog.jsonb_build_object(
        'decisionCycleId', claim ->> 'decision_cycle_id',
        'organizationId', 'd5c50000-0000-4000-8000-000000000101',
        'correlationId', correlation_id,
        'outcome', 'action_selected',
        'reason', null,
        'needsDataKeys', pg_catalog.jsonb_build_array(),
        'selectedCandidateFingerprint', fingerprint,
        'opportunityId', opportunity_id,
        'rejectionHistogram', '{}'::jsonb,
        'screenedCount', 1,
        'scoredCount', 1,
        'inputsDigest', repeat('9', 64),
        'versionTuple', pg_catalog.jsonb_build_object(
          'policyVersionId', decision_context #>> '{access_policy,id}',
          'playbookVersionId', decision_context #>> '{playbook,version_id}',
          'rankingWeightsId', decision_context #>> '{ranking_artifact,id}',
          'confidenceCalibrationId', decision_context #>> '{confidence_artifact,id}'
        ),
        'propensity', 1,
        'isExploration', false
      ),
      'candidates', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'playbookVersionId', decision_context #>> '{playbook,version_id}',
        'candidateFingerprint', fingerprint,
        'subjectKind', 'organization',
        'subjectRef', 'd5c50000-0000-4000-8000-000000000101',
        'parameterDigest', repeat('8', 64),
        'impactLowMinor', 600000,
        'impactHighMinor', 900000,
        'confidence', 0.75,
        'executionCostMinor', 450000,
        'expectedContributionMinor', 112500,
        'currency', 'AED',
        'evidenceTier', 'computed',
        'eligibilityResult', '{"eligible":true}'::jsonb,
        'policyResult', '{"admitted":true}'::jsonb,
        'rejectionReason', null,
        'rank', 1
      )),
      'opportunity', pg_catalog.jsonb_build_object(
        'id', opportunity_id,
        'playbookVersionId', decision_context #>> '{playbook,version_id}',
        'candidateFingerprint', fingerprint,
        'title', 'Controlled campaign recommendation',
        'summary', 'A bounded recommendation used to test final admission.',
        'hypothesis', 'A governed recommendation can improve incremental profit.',
        'subjectKind', 'organization',
        'subjectRef', 'd5c50000-0000-4000-8000-000000000101',
        'evidenceBundle', '{"sourceRevisionIds":["test-revision"]}'::jsonb,
        'assumptions', '["Evidence remains current through review."]'::jsonb,
        'impactLowMinor', 600000,
        'impactHighMinor', 900000,
        'confidence', 0.75,
        'confidenceRationale', 'Controlled deterministic calibration',
        'evidenceTier', 'computed',
        'executionCostMinor', 450000,
        'expectedContributionMinor', 112500,
        'currency', 'AED',
        'timeToImpactDays', 7,
        'riskTier', 3,
        'approvalPath', 'human_approval',
        'guardrails', '[{"key":"spend.total","threshold":450000}]'::jsonb,
        'assertions', '[{"key":"policy.access.active","expectedOutcome":"true"}]'::jsonb,
        'evaluationPlan', '{"primaryMetricKey":"contribution.incremental_gross_profit"}'::jsonb,
        'expiresAt', '2027-01-01T00:00:00.000Z',
        'status', 'proposed'
      )
    )
  )
$$;

select extensions.has_table(
  'private', 'decision_cycle_operations',
  'the claim ledger is private'
);
select extensions.ok(
  (
    select relrowsecurity and relforcerowsecurity
    from pg_catalog.pg_class
    where oid = 'private.decision_cycle_operations'::regclass
  ),
  'the private claim ledger enables and forces RLS'
);
select extensions.table_privs_are(
  'private', 'decision_cycle_operations', 'anon', array[]::text[],
  'anonymous has no claim-ledger table privileges'
);
select extensions.table_privs_are(
  'private', 'decision_cycle_operations', 'authenticated', array[]::text[],
  'authenticated has no claim-ledger table privileges'
);
select extensions.table_privs_are(
  'private', 'decision_cycle_operations', 'service_role', array[]::text[],
  'service role has no direct claim-ledger table privileges'
);
select extensions.hasnt_column(
  'private', 'decision_cycle_operations', 'payload',
  'the claim ledger stores no raw payload'
);
select extensions.hasnt_column(
  'private', 'decision_cycle_operations', 'evidence',
  'the claim ledger stores no evidence'
);
select extensions.hasnt_column(
  'private', 'decision_cycle_operations', 'credentials',
  'the claim ledger stores no credentials'
);
select extensions.has_index(
  'private', 'decision_cycle_operations',
  'decision_cycle_operations_result_record_idx',
  'operation result-record foreign keys have a covering index'
);
select extensions.has_index(
  'private', 'decision_cycle_operations',
  'decision_cycle_operations_result_opportunity_idx',
  'operation result-opportunity foreign keys have a covering index'
);
select extensions.has_index(
  'public', 'opportunities',
  'opportunities_active_candidate_fingerprint_idx',
  'active campaign recommendations have a database uniqueness backstop'
);

select extensions.has_column(
  'public', 'artifact_versions', 'implementation_key',
  'artifact versions pin deterministic implementations'
);
select extensions.has_column(
  'public', 'decision_records', 'needs_data_keys',
  'decision records persist named readiness gaps'
);
select extensions.has_function('public', 'claim_campaign_decision_cycle', array['uuid', 'jsonb']);
select extensions.has_function('public', 'renew_campaign_decision_cycle_claim', array['uuid', 'jsonb']);
select extensions.has_function('public', 'load_campaign_decision_context', array['uuid', 'jsonb']);
select extensions.has_function('public', 'complete_campaign_decision_cycle', array['uuid', 'jsonb']);
select extensions.has_function('public', 'fail_campaign_decision_cycle', array['uuid', 'jsonb']);
select extensions.has_function('public', 'cancel_campaign_decision_cycle', array['uuid', 'jsonb']);

select extensions.function_privs_are(
  'public', 'claim_campaign_decision_cycle', array['uuid', 'jsonb'], 'service_role',
  array['EXECUTE'], 'service role may claim through the fenced RPC'
);
select extensions.function_privs_are(
  'public', 'claim_campaign_decision_cycle', array['uuid', 'jsonb'], 'authenticated',
  array[]::text[], 'authenticated may not claim a cycle'
);
select extensions.function_privs_are(
  'public', 'renew_campaign_decision_cycle_claim', array['uuid', 'jsonb'], 'service_role',
  array['EXECUTE'], 'service role may renew through the fenced RPC'
);
select extensions.function_privs_are(
  'public', 'load_campaign_decision_context', array['uuid', 'jsonb'], 'service_role',
  array['EXECUTE'], 'service role may load context through the fenced RPC'
);
select extensions.function_privs_are(
  'private', 'load_campaign_decision_context', array['uuid', 'jsonb'], 'service_role',
  array[]::text[], 'service role cannot bypass the truthful context wrapper'
);
select extensions.function_privs_are(
  'public', 'complete_campaign_decision_cycle', array['uuid', 'jsonb'], 'service_role',
  array['EXECUTE'], 'service role may complete through the fenced RPC'
);
select extensions.function_privs_are(
  'public', 'fail_campaign_decision_cycle', array['uuid', 'jsonb'], 'service_role',
  array['EXECUTE'], 'service role may fail through the fenced RPC'
);
select extensions.function_privs_are(
  'public', 'cancel_campaign_decision_cycle', array['uuid', 'jsonb'], 'service_role',
  array['EXECUTE'], 'service role may cancel through the fenced RPC'
);
select extensions.ok(
  (
    select count(*) = 6
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = any(array[
        'claim_campaign_decision_cycle',
        'renew_campaign_decision_cycle_claim',
        'load_campaign_decision_context',
        'complete_campaign_decision_cycle',
        'fail_campaign_decision_cycle',
        'cancel_campaign_decision_cycle'
      ])
      and procedure.prosecdef
      and procedure.proconfig @> array['search_path=""']
  ),
  'all worker RPCs are security definers with a fixed empty search path'
);
select extensions.function_privs_are(
  'public', 'start_decision_cycle', array['uuid', 'jsonb'], 'service_role',
  array[]::text[], 'service role lost the unfenced cycle-start path'
);
select extensions.function_privs_are(
  'public', 'persist_decision_aggregate', array['uuid', 'jsonb'], 'service_role',
  array[]::text[], 'service role lost the unfenced aggregate-write path'
);

select extensions.is(
  (
    select implementation_key
    from private.current_artifact_promotions promotion
    join public.artifact_versions artifact
      on artifact.organization_id = promotion.organization_id
     and artifact.id = promotion.active_artifact_version_id
    where promotion.organization_id = 'd5c50000-0000-4000-8000-000000000101'::uuid
      and promotion.artifact_key = 'ranking_weights'
  ),
  'decision.ranking.evidence_value_time_v1'::text,
  'future organizations receive the registered ranking implementation'
);
select extensions.is(
  (
    select implementation_key
    from private.current_artifact_promotions promotion
    join public.artifact_versions artifact
      on artifact.organization_id = promotion.organization_id
     and artifact.id = promotion.active_artifact_version_id
    where promotion.organization_id = 'd5c50000-0000-4000-8000-000000000101'::uuid
      and promotion.artifact_key = 'confidence_calibration'
  ),
  'decision.confidence.computed_baseline_v1'::text,
  'future organizations receive the registered confidence implementation'
);
select extensions.is(
  (
    select version.action_definition ->> 'action_key'
    from public.playbook_versions version
    join public.playbook_definitions definition
      on definition.organization_id = version.organization_id
     and definition.id = version.playbook_definition_id
    where definition.organization_id = 'd5c50000-0000-4000-8000-000000000101'::uuid
      and definition.key = 'campaign.meta_bundle'
      and version.is_active
  ),
  'campaign.meta_bundle_v1'::text,
  'future organizations receive the inert Campaign action definition'
);
select extensions.ok(
  (
    select version.prior is null
    from public.playbook_versions version
    join public.playbook_definitions definition
      on definition.organization_id = version.organization_id
     and definition.id = version.playbook_definition_id
    where definition.organization_id = 'd5c50000-0000-4000-8000-000000000101'::uuid
      and definition.key = 'campaign.meta_bundle'
      and version.is_active
  ),
  'the Campaign playbook has no synthetic prior'
);

select extensions.throws_ok(
  $$
    insert into public.artifact_versions (
      organization_id, artifact_key, version, basis, authored_by
    ) values (
      'd5c50000-0000-4000-8000-000000000101'::uuid,
      'ranking_weights', 'missing-implementation-v1',
      'Must be rejected because no implementation is pinned', 'test'
    )
  $$,
  '23514', null,
  'a ranking artifact cannot omit its registered implementation'
);

delete from public.business_profiles
where organization_id = 'd5c50000-0000-4000-8000-000000000101'::uuid;

insert into public.business_profiles (organization_id, updated_by, updated_at)
values (
  'd5c50000-0000-4000-8000-000000000101'::uuid,
  'd5c50000-0000-4000-8000-000000000001'::uuid,
  '2026-08-10T06:00:00.000Z'::timestamptz
);

insert into public.channel_economics_entries (
  id, organization_id, grain, period_start, period_end, period_timezone,
  gross_revenue_minor, transaction_count, currency, margin_source,
  completeness_grade, contribution_margin_minor, computed_at
)
values (
  'd5c50000-0000-4000-8000-000000000203'::uuid,
  'd5c50000-0000-4000-8000-000000000101'::uuid,
  'period', '2026-08-12T00:00:00.000Z', '2026-08-13T00:00:00.000Z', 'Asia/Dubai',
  1000000, 10, 'AED', 'derived', 'complete', 600000,
  '2026-08-13T06:00:00.000Z'
);

set local role service_role;

insert into campaign_cycle_state (key, value)
select 'first_claim', public.claim_campaign_decision_cycle(
  'd5c50000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', 'd5c50000-0000-4000-8000-000000000101',
    'correlation_id', 'd5c50000-0000-4000-8000-000000000301',
    'idempotency_key', 'campaign-cycle-first',
    'request_digest', repeat('a', 64),
    'trigger_type', 'manual'
  )
);

select extensions.is(
  (select value ->> 'status' from campaign_cycle_state where key = 'first_claim'),
  'acquired'::text,
  'the first business operation acquires a live claim'
);
select extensions.ok(
  (select value ?& array['decision_cycle_id', 'claim_token', 'lease_expires_at']
   from campaign_cycle_state where key = 'first_claim'),
  'an acquired claim returns only the required lease identifiers'
);

select extensions.throws_ok(
  $$
    select public.claim_campaign_decision_cycle(
      'd5c50000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', 'd5c50000-0000-4000-8000-000000000101',
        'correlation_id', 'd5c50000-0000-4000-8000-000000000301',
        'idempotency_key', 'campaign-cycle-first',
        'request_digest', repeat('b', 64),
        'trigger_type', 'manual'
      )
    )
  $$,
  '22023', null,
  'reusing a business key with a different normalized digest fails closed'
);
select extensions.throws_ok(
  $$
    select public.claim_campaign_decision_cycle(
      'd5c50000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', 'd5c50000-0000-4000-8000-000000000101',
        'correlation_id', 'd5c50000-0000-4000-8000-000000000301',
        'idempotency_key', 'campaign-cycle-unknown-key',
        'request_digest', repeat('c', 64),
        'trigger_type', 'manual',
        'payload', jsonb_build_object('secret', 'must-not-pass')
      )
    )
  $$,
  '22023', null,
  'claim rejects unknown JSON keys before writing anything'
);

select extensions.lives_ok(
  $$
    select public.renew_campaign_decision_cycle_claim(
      'd5c50000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', 'd5c50000-0000-4000-8000-000000000101',
        'idempotency_key', 'campaign-cycle-first',
        'request_digest', repeat('a', 64),
        'claim_token', value ->> 'claim_token',
        'decision_cycle_id', value ->> 'decision_cycle_id'
      )
    )
    from campaign_cycle_state where key = 'first_claim'
  $$,
  'the live claimant can renew its five-minute lease'
);

insert into campaign_cycle_state (key, value)
select 'context', public.load_campaign_decision_context(
  'd5c50000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', 'd5c50000-0000-4000-8000-000000000101',
    'idempotency_key', 'campaign-cycle-first',
    'request_digest', repeat('a', 64),
    'claim_token', value ->> 'claim_token',
    'decision_cycle_id', value ->> 'decision_cycle_id'
  )
)
from campaign_cycle_state where key = 'first_claim';

select extensions.is(
  (select (value #>> '{access_policy,max_active_recommendations}')::integer
   from campaign_cycle_state where key = 'context'),
  3,
  'context resolves the access-policy recommendation ceiling without a default'
);
select extensions.is(
  (select value #>> '{ranking_artifact,implementation_key}'
   from campaign_cycle_state where key = 'context'),
  'decision.ranking.evidence_value_time_v1'::text,
  'context pins the registered ranking implementation'
);
select extensions.is(
  (select value #>> '{confidence_artifact,implementation_key}'
   from campaign_cycle_state where key = 'context'),
  'decision.confidence.computed_baseline_v1'::text,
  'context pins the registered confidence implementation'
);
select extensions.ok(
  (select not (value #> '{evidence}') ? 'impact_evidence'
   from campaign_cycle_state where key = 'context'),
  'production context does not invent controlled impact evidence'
);
select extensions.is(
  (select value #>> '{evidence,inputs_observed_at}'
   from campaign_cycle_state where key = 'context'),
  '2026-08-10T06:00:00+00:00'::text,
  'context freshness uses the oldest required input rather than the newest one'
);
select extensions.is(
  (select (value #>> '{evidence,measurement_plan_registered}')::boolean
   from campaign_cycle_state where key = 'context'),
  false,
  'an active playbook is not reported as a governed measurement plan'
);

insert into campaign_cycle_state (key, value)
select 'completion', public.complete_campaign_decision_cycle(
  'd5c50000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', 'd5c50000-0000-4000-8000-000000000101',
    'idempotency_key', 'campaign-cycle-first',
    'request_digest', repeat('a', 64),
    'claim_token', claim.value ->> 'claim_token',
    'decision_cycle_id', claim.value ->> 'decision_cycle_id',
    'aggregate', jsonb_build_object(
      'record', jsonb_build_object(
        'decisionCycleId', claim.value ->> 'decision_cycle_id',
        'organizationId', 'd5c50000-0000-4000-8000-000000000101',
        'correlationId', 'd5c50000-0000-4000-8000-000000000301',
        'outcome', 'no_action',
        'reason', 'slot_budget_exhausted',
        'needsDataKeys', jsonb_build_array(),
        'selectedCandidateFingerprint', null,
        'opportunityId', null,
        'rejectionHistogram', '{}'::jsonb,
        'screenedCount', 0,
        'scoredCount', 0,
        'inputsDigest', repeat('d', 64),
        'versionTuple', jsonb_build_object(
          'policyVersionId', context.value #>> '{access_policy,id}',
          'playbookVersionId', context.value #>> '{playbook,version_id}',
          'rankingWeightsId', context.value #>> '{ranking_artifact,id}',
          'confidenceCalibrationId', context.value #>> '{confidence_artifact,id}'
        ),
        'propensity', 1,
        'isExploration', false
      ),
      'candidates', jsonb_build_array(),
      'opportunity', null
    )
  )
)
from campaign_cycle_state claim
cross join campaign_cycle_state context
where claim.key = 'first_claim' and context.key = 'context';

select extensions.ok(
  (select value ? 'decision_record_id' and value -> 'opportunity_id' = 'null'::jsonb
   from campaign_cycle_state where key = 'completion'),
  'claim-aware completion persists one non-selected aggregate atomically'
);

insert into campaign_cycle_state (key, value)
select 'completed_replay', public.claim_campaign_decision_cycle(
  'd5c50000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', 'd5c50000-0000-4000-8000-000000000101',
    'correlation_id', 'd5c50000-0000-4000-8000-000000000301',
    'idempotency_key', 'campaign-cycle-first',
    'request_digest', repeat('a', 64),
    'trigger_type', 'manual'
  )
);
select extensions.is(
  (select value ->> 'status' from campaign_cycle_state where key = 'completed_replay'),
  'completed'::text,
  'a completed replay returns stored identifiers without another write'
);

insert into campaign_cycle_state (key, value)
select 'cancelled', public.cancel_campaign_decision_cycle(
  'd5c50000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', 'd5c50000-0000-4000-8000-000000000101',
    'correlation_id', 'd5c50000-0000-4000-8000-000000000302',
    'idempotency_key', 'campaign-cycle-cancelled',
    'request_digest', repeat('e', 64),
    'trigger_type', 'scheduled'
  )
);
select extensions.is(
  (select value ->> 'status' from campaign_cycle_state where key = 'cancelled'),
  'cancelled'::text,
  'cancellation is authoritative even before a worker claims the operation'
);
select extensions.is(
  public.claim_campaign_decision_cycle(
    'd5c50000-0000-4000-8000-000000000101'::uuid,
    jsonb_build_object(
      'organization_id', 'd5c50000-0000-4000-8000-000000000101',
      'correlation_id', 'd5c50000-0000-4000-8000-000000000302',
      'idempotency_key', 'campaign-cycle-cancelled',
      'request_digest', repeat('e', 64),
      'trigger_type', 'scheduled'
    )
  ) ->> 'status',
  'cancelled'::text,
  'a later retry cannot revive a cancelled business operation'
);

insert into campaign_cycle_state (key, value)
select 'needs_claim', public.claim_campaign_decision_cycle(
  'd5c50000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', 'd5c50000-0000-4000-8000-000000000101',
    'correlation_id', 'd5c50000-0000-4000-8000-000000000303',
    'idempotency_key', 'campaign-cycle-needs-data',
    'request_digest', repeat('f', 64),
    'trigger_type', 'integration_sync_completed'
  )
);

insert into campaign_cycle_state (key, value)
select 'needs_context', public.load_campaign_decision_context(
  'd5c50000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', 'd5c50000-0000-4000-8000-000000000101',
    'idempotency_key', 'campaign-cycle-needs-data',
    'request_digest', repeat('f', 64),
    'claim_token', value ->> 'claim_token',
    'decision_cycle_id', value ->> 'decision_cycle_id'
  )
)
from campaign_cycle_state where key = 'needs_claim';

insert into campaign_cycle_state (key, value)
select 'needs_completion', public.complete_campaign_decision_cycle(
  'd5c50000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', 'd5c50000-0000-4000-8000-000000000101',
    'idempotency_key', 'campaign-cycle-needs-data',
    'request_digest', repeat('f', 64),
    'claim_token', claim.value ->> 'claim_token',
    'decision_cycle_id', claim.value ->> 'decision_cycle_id',
    'aggregate', jsonb_build_object(
      'record', jsonb_build_object(
        'decisionCycleId', claim.value ->> 'decision_cycle_id',
        'organizationId', 'd5c50000-0000-4000-8000-000000000101',
        'correlationId', 'd5c50000-0000-4000-8000-000000000303',
        'outcome', 'needs_data',
        'reason', 'campaign_evidence_missing',
        'needsDataKeys', jsonb_build_array(
          'impact.range', 'capability.advertise_meta_ads'
        ),
        'selectedCandidateFingerprint', null,
        'opportunityId', null,
        'rejectionHistogram', '{}'::jsonb,
        'screenedCount', 0,
        'scoredCount', 0,
        'inputsDigest', repeat('1', 64),
        'versionTuple', jsonb_build_object(
          'policyVersionId', context.value #>> '{access_policy,id}',
          'playbookVersionId', context.value #>> '{playbook,version_id}',
          'rankingWeightsId', context.value #>> '{ranking_artifact,id}',
          'confidenceCalibrationId', context.value #>> '{confidence_artifact,id}'
        ),
        'propensity', 1,
        'isExploration', false
      ),
      'candidates', jsonb_build_array(),
      'opportunity', null
    )
  )
)
from campaign_cycle_state claim
cross join campaign_cycle_state context
where claim.key = 'needs_claim' and context.key = 'needs_context';

reset role;

select extensions.is(
  (
    select record.needs_data_keys
    from public.decision_records record
    where record.id = (
      select (value ->> 'decision_record_id')::uuid
      from campaign_cycle_state where key = 'needs_completion'
    )
  ),
  array['impact.range', 'capability.advertise_meta_ads']::text[],
  'claim-aware completion persists the exact bounded readiness keys'
);

update public.policies
set configuration = '{"max_active_recommendations":1}'::jsonb
where id = 'd5c50000-0000-4000-8000-000000000201'::uuid;

set local role service_role;

insert into campaign_cycle_state (key, value)
select state_key, public.claim_campaign_decision_cycle(
  'd5c50000-0000-4000-8000-000000000101'::uuid,
  pg_catalog.jsonb_build_object(
    'organization_id', 'd5c50000-0000-4000-8000-000000000101',
    'correlation_id', correlation_id,
    'idempotency_key', operation_key,
    'request_digest', digest,
    'trigger_type', 'scheduled'
  )
)
from (values
  ('capacity_claim_a', 'd5c50000-0000-4000-8000-000000000311'::uuid,
    'campaign-cycle-capacity-a', repeat('3', 64)),
  ('capacity_claim_b', 'd5c50000-0000-4000-8000-000000000312'::uuid,
    'campaign-cycle-capacity-b', repeat('4', 64))
) input(state_key, correlation_id, operation_key, digest);

select extensions.lives_ok(
  $$
    select public.complete_campaign_decision_cycle(
      'd5c50000-0000-4000-8000-000000000101'::uuid,
      pg_temp.campaign_selected_completion(
        claim.value,
        context.value,
        'campaign-cycle-capacity-a',
        repeat('3', 64),
        'd5c50000-0000-4000-8000-000000000311'::uuid,
        'd5c50000-0000-4000-8000-000000000411'::uuid,
        repeat('3', 64)
      )
    )
    from campaign_cycle_state claim
    cross join campaign_cycle_state context
    where claim.key = 'capacity_claim_a' and context.key = 'context'
  $$,
  'the first claimant may consume the final active recommendation slot'
);

select extensions.throws_ok(
  $$
    select public.complete_campaign_decision_cycle(
      'd5c50000-0000-4000-8000-000000000101'::uuid,
      pg_temp.campaign_selected_completion(
        claim.value,
        context.value,
        'campaign-cycle-capacity-b',
        repeat('4', 64),
        'd5c50000-0000-4000-8000-000000000312'::uuid,
        'd5c50000-0000-4000-8000-000000000412'::uuid,
        repeat('4', 64)
      )
    )
    from campaign_cycle_state claim
    cross join campaign_cycle_state context
    where claim.key = 'capacity_claim_b' and context.key = 'context'
  $$,
  '40001', 'campaign_decision_capacity_exhausted',
  'completion rechecks capacity after overlapping claims observed the final slot'
);

reset role;

select extensions.is(
  (
    select pg_catalog.count(*)::bigint
    from public.opportunities
    where organization_id = 'd5c50000-0000-4000-8000-000000000101'::uuid
      and status in ('proposed', 'awaiting_approval', 'approved')
  ),
  1::bigint,
  'capacity contention leaves exactly one active recommendation'
);

update public.policies
set configuration = '{"max_active_recommendations":3}'::jsonb
where id = 'd5c50000-0000-4000-8000-000000000201'::uuid;

set local role service_role;

insert into campaign_cycle_state (key, value)
select state_key, public.claim_campaign_decision_cycle(
  'd5c50000-0000-4000-8000-000000000101'::uuid,
  pg_catalog.jsonb_build_object(
    'organization_id', 'd5c50000-0000-4000-8000-000000000101',
    'correlation_id', correlation_id,
    'idempotency_key', operation_key,
    'request_digest', digest,
    'trigger_type', 'scheduled'
  )
)
from (values
  ('duplicate_claim_a', 'd5c50000-0000-4000-8000-000000000313'::uuid,
    'campaign-cycle-duplicate-a', repeat('5', 64)),
  ('duplicate_claim_b', 'd5c50000-0000-4000-8000-000000000314'::uuid,
    'campaign-cycle-duplicate-b', repeat('6', 64))
) input(state_key, correlation_id, operation_key, digest);

select extensions.lives_ok(
  $$
    select public.complete_campaign_decision_cycle(
      'd5c50000-0000-4000-8000-000000000101'::uuid,
      pg_temp.campaign_selected_completion(
        claim.value,
        context.value,
        'campaign-cycle-duplicate-a',
        repeat('5', 64),
        'd5c50000-0000-4000-8000-000000000313'::uuid,
        'd5c50000-0000-4000-8000-000000000413'::uuid,
        repeat('5', 64)
      )
    )
    from campaign_cycle_state claim
    cross join campaign_cycle_state context
    where claim.key = 'duplicate_claim_a' and context.key = 'context'
  $$,
  'the first claimant may persist a new active candidate fingerprint'
);

select extensions.throws_ok(
  $$
    select public.complete_campaign_decision_cycle(
      'd5c50000-0000-4000-8000-000000000101'::uuid,
      pg_temp.campaign_selected_completion(
        claim.value,
        context.value,
        'campaign-cycle-duplicate-b',
        repeat('6', 64),
        'd5c50000-0000-4000-8000-000000000314'::uuid,
        'd5c50000-0000-4000-8000-000000000414'::uuid,
        repeat('5', 64)
      )
    )
    from campaign_cycle_state claim
    cross join campaign_cycle_state context
    where claim.key = 'duplicate_claim_b' and context.key = 'context'
  $$,
  '23505', 'campaign_decision_active_duplicate',
  'completion rejects an active duplicate after overlapping claims'
);

reset role;

select extensions.is(
  (
    select pg_catalog.count(*)::bigint
    from public.opportunities
    where organization_id = 'd5c50000-0000-4000-8000-000000000101'::uuid
      and candidate_fingerprint = repeat('5', 64)
      and status in ('proposed', 'awaiting_approval', 'approved')
  ),
  1::bigint,
  'duplicate contention leaves exactly one active recommendation per fingerprint'
);

set local role service_role;

insert into campaign_cycle_state (key, value)
select 'reclaim_first', public.claim_campaign_decision_cycle(
  'd5c50000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', 'd5c50000-0000-4000-8000-000000000101',
    'correlation_id', 'd5c50000-0000-4000-8000-000000000304',
    'idempotency_key', 'campaign-cycle-reclaim',
    'request_digest', repeat('2', 64),
    'trigger_type', 'scheduled'
  )
);

reset role;

update private.decision_cycle_operations
set lease_expires_at = now() - interval '1 second'
where organization_id = 'd5c50000-0000-4000-8000-000000000101'::uuid
  and idempotency_key = 'campaign-cycle-reclaim';

set local role service_role;

insert into campaign_cycle_state (key, value)
select 'reclaim_second', public.claim_campaign_decision_cycle(
  'd5c50000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', 'd5c50000-0000-4000-8000-000000000101',
    'correlation_id', 'd5c50000-0000-4000-8000-000000000304',
    'idempotency_key', 'campaign-cycle-reclaim',
    'request_digest', repeat('2', 64),
    'trigger_type', 'scheduled'
  )
);

select extensions.is(
  (select value ->> 'status' from campaign_cycle_state where key = 'reclaim_second'),
  'reclaimed'::text,
  'an expired lease is reclaimed without a second cycle'
);
select extensions.isnt(
  (select value ->> 'claim_token' from campaign_cycle_state where key = 'reclaim_second'),
  (select value ->> 'claim_token' from campaign_cycle_state where key = 'reclaim_first'),
  'reclaim rotates the opaque fencing token'
);
select extensions.throws_ok(
  $$
    select public.renew_campaign_decision_cycle_claim(
      'd5c50000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', 'd5c50000-0000-4000-8000-000000000101',
        'idempotency_key', 'campaign-cycle-reclaim',
        'request_digest', repeat('2', 64),
        'claim_token', value ->> 'claim_token',
        'decision_cycle_id', value ->> 'decision_cycle_id'
      )
    )
    from campaign_cycle_state where key = 'reclaim_first'
  $$,
  '40001', null,
  'the replacement token fences the stale worker before any write'
);

reset role;

select extensions.is(
  (
    select count(*)::bigint
    from private.decision_cycle_operations
    where organization_id = 'd5c50000-0000-4000-8000-000000000101'::uuid
      and idempotency_key = 'campaign-cycle-first'
  ),
  1::bigint,
  'one business operation key maps to one authoritative ledger row'
);
select extensions.ok(
  (
    select retention_until >= created_at + interval '400 days'
    from private.decision_cycle_operations
    where organization_id = 'd5c50000-0000-4000-8000-000000000101'::uuid
      and idempotency_key = 'campaign-cycle-first'
  ),
  'operation history has a four-hundred-day retention floor'
);
select extensions.is(
  (
    select needs_data_keys
    from public.decision_records
    where id = (
      select (value ->> 'decision_record_id')::uuid
      from campaign_cycle_state where key = 'completion'
    )
  ),
  array[]::text[],
  'non-needs-data decisions persist an empty readiness list'
);
select extensions.ok(
  not exists (
    select 1
    from public.audit_events
    where organization_id = 'd5c50000-0000-4000-8000-000000000101'::uuid
      and event_name like 'decision.cycle_operation_%'
      and (
        payload ?| array['payload', 'evidence', 'credentials', 'request_digest', 'claim_token']
        or payload::text ilike '%must-not-pass%'
      )
  ),
  'operation audit rows contain identifiers and normalized state only'
);

select * from extensions.finish();
rollback;
