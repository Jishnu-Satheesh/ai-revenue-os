begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(12);

insert into auth.users (id) values
  ('f1000000-0000-4000-8000-000000000001'::uuid);

insert into public.accounts (id, name, slug, created_by) values
  ('f1000000-0000-4000-8000-000000000101'::uuid, 'Worker agency', 'worker-agency', 'f1000000-0000-4000-8000-000000000001'::uuid);

insert into public.organizations (
  id, account_id, name, slug, industry, country_code, base_currency,
  default_timezone, created_by
) values
  ('f1000000-0000-4000-8000-000000000201'::uuid, 'f1000000-0000-4000-8000-000000000101'::uuid, 'Worker client', 'worker-client', 'testing', 'AE', 'AED', 'Asia/Dubai', 'f1000000-0000-4000-8000-000000000001'::uuid);

insert into public.account_memberships (
  account_id, user_id, account_role, default_organization_role
) values
  ('f1000000-0000-4000-8000-000000000101'::uuid, 'f1000000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner');

insert into public.playbook_definitions (
  id, organization_id, key, name, owner_scope, business_objective
) values (
  'f1000000-0000-4000-8000-000000000004'::uuid,
  'f1000000-0000-4000-8000-000000000201'::uuid,
  'campaign.governed_draft', 'Governed Campaign Draft', 'core',
  'Create an internal reversible Campaign draft'
);

insert into public.playbook_versions (
  id, organization_id, playbook_definition_id, semantic_version, hypothesis_template,
  action_definition, risk_class, primary_metric_key, measurement_window_days, is_active
) values (
  'f1000000-0000-4000-8000-000000000005'::uuid,
  'f1000000-0000-4000-8000-000000000201'::uuid,
  'f1000000-0000-4000-8000-000000000004'::uuid,
  '1.0.0', 'A governed draft freezes what the operator saw.',
  '{"action_key":"campaign.governed_draft_v1"}'::jsonb,
  1, 'contribution.incremental_gross_profit', 30, true
);

insert into public.policies (
  id, organization_id, policy_type, name, mode, version, is_active
)
values (
  'f1000000-0000-4000-8000-000000000003'::uuid,
  'f1000000-0000-4000-8000-000000000201'::uuid,
  'approval', 'Decision approval', 'approval_required', 1, true
);

insert into public.artifact_versions (
  id, organization_id, artifact_key, version, basis, authored_by, implementation_key
)
values
  (
    'f1000000-0000-4000-8000-000000000301'::uuid,
    'f1000000-0000-4000-8000-000000000201'::uuid,
    'ranking_weights', 'behavior-v1', 'Behavioral test fixture', 'test',
    'decision.ranking.evidence_value_time_v1'
  ),
  (
    'f1000000-0000-4000-8000-000000000302'::uuid,
    'f1000000-0000-4000-8000-000000000201'::uuid,
    'confidence_calibration', 'behavior-v1', 'Behavioral test fixture', 'test',
    'decision.confidence.computed_baseline_v1'
  );

insert into public.artifact_promotions (
  organization_id, artifact_key, active_artifact_version_id,
  rollback_artifact_version_id, promoted_by
)
select
  'f1000000-0000-4000-8000-000000000201'::uuid,
  promotion.artifact_key,
  case when promotion.artifact_key = 'ranking_weights'
    then 'f1000000-0000-4000-8000-000000000301'::uuid
    else 'f1000000-0000-4000-8000-000000000302'::uuid end,
  promotion.active_artifact_version_id,
  'draft-worker-test'
from private.current_artifact_promotions promotion
where promotion.organization_id = 'f1000000-0000-4000-8000-000000000201'::uuid
  and promotion.artifact_key in ('ranking_weights', 'confidence_calibration');

insert into public.decision_cycles (
  id, organization_id, trigger_name, correlation_id, slot_budget, max_scored_candidates
) values
  ('f1000000-0000-4000-8000-000000000601'::uuid,
   'f1000000-0000-4000-8000-000000000201'::uuid,
   'draft-worker-test', 'f1000000-0000-4000-8000-000000000701'::uuid, 1, 1);

insert into public.decision_records (
  id, organization_id, decision_cycle_id, correlation_id, outcome, reason,
  selected_candidate_fingerprint, opportunity_id, inputs_digest, artifact_version_tuple,
  screened_count, scored_count, propensity, is_exploration,
  ranking_weights_id, confidence_calibration_id, policy_version_id,
  playbook_version_id
) values (
  'f1000000-0000-4000-8000-000000000602'::uuid,
  'f1000000-0000-4000-8000-000000000201'::uuid,
  'f1000000-0000-4000-8000-000000000601'::uuid,
  'f1000000-0000-4000-8000-000000000701'::uuid,
  'action_selected', null, repeat('b', 64),
  'f1000000-0000-4000-8000-000000000801'::uuid, repeat('c', 64),
  '{"confidence_calibration":"test-v1"}'::jsonb, 1, 1, 1, false,
  'f1000000-0000-4000-8000-000000000301'::uuid,
  'f1000000-0000-4000-8000-000000000302'::uuid,
  'f1000000-0000-4000-8000-000000000003'::uuid,
  'f1000000-0000-4000-8000-000000000005'::uuid
);

insert into public.opportunities (
  id, organization_id, decision_record_id, playbook_version_id, action_key,
  candidate_fingerprint, title, summary, hypothesis, subject_kind, subject_ref,
  evidence_bundle, assumptions, impact_low_minor, impact_high_minor, confidence,
  confidence_rationale, evidence_tier, execution_cost_minor, expected_contribution_minor,
  currency, time_to_impact_days, risk_tier, approval_path, guardrails, assertions,
  evaluation_plan, expires_at, status, created_at
) values
  (
    'f1000000-0000-4000-8000-000000000801'::uuid, 'f1000000-0000-4000-8000-000000000201'::uuid,
    'f1000000-0000-4000-8000-000000000602'::uuid, 'f1000000-0000-4000-8000-000000000005'::uuid,
    'campaign.governed_draft_v1', repeat('b', 64), 'Friday hours draft', 'A draft summary.',
    'Longer hours lift profit.', 'organization', 'worker-client',
    '{"sourceIds":["metric-1"]}'::jsonb, '["friday repeats"]'::jsonb,
    10000, 40000, 0.6, 'Computed over complete evidence.', 'computed', 5000, 10000,
    'AED', 14, 1, 'human_approval', '[]'::jsonb,
    '[{"key":"budget_available","expectedOutcome":"pass"}]'::jsonb,
    '{"primaryMetricKey":"contribution.incremental_gross_profit"}'::jsonb,
    '2027-01-01T00:00:00.000Z', 'draft_requested', pg_catalog.now()
  ),
  (
    'f1000000-0000-4000-8000-000000000802'::uuid, 'f1000000-0000-4000-8000-000000000201'::uuid,
    'f1000000-0000-4000-8000-000000000602'::uuid, 'f1000000-0000-4000-8000-000000000005'::uuid,
    'campaign.governed_draft_v1', repeat('e', 64), 'Moved draft', 'Another summary.',
    'Longer hours lift profit.', 'organization', 'worker-client',
    '{"sourceIds":["metric-1"]}'::jsonb, '["friday repeats"]'::jsonb,
    10000, 40000, 0.6, 'Computed over complete evidence.', 'computed', 5000, 10000,
    'AED', 14, 1, 'human_approval', '[]'::jsonb,
    '[{"key":"budget_available","expectedOutcome":"pass"}]'::jsonb,
    '{"primaryMetricKey":"contribution.incremental_gross_profit"}'::jsonb,
    '2027-01-01T00:00:00.000Z', 'draft_requested', pg_catalog.now()
  );

insert into public.campaign_draft_requests (
  id, organization_id, opportunity_id, opportunity_version, action_key,
  objective, audience, assertions, idempotency_key, actor_id, status,
  claim_token, lease_expires_at, attempt_count
) values
  (
    'f1000000-0000-4000-8000-000000000901'::uuid, 'f1000000-0000-4000-8000-000000000201'::uuid,
    'f1000000-0000-4000-8000-000000000801'::uuid, 1, 'campaign.governed_draft_v1',
    'Lift September gross profit from the Friday dinner rush',
    'Nearby residents ordering weekend delivery',
    '[{"key":"budget_available","expectedOutcome":"pass"}]'::jsonb,
    'draft-worker-idem-0001',
    'f1000000-0000-4000-8000-000000000001'::uuid, 'processing',
    'f1000000-0000-4000-8000-000000000009'::uuid, pg_catalog.now() + interval '5 minutes', 1
  ),
  (
    'f1000000-0000-4000-8000-000000000902'::uuid, 'f1000000-0000-4000-8000-000000000201'::uuid,
    'f1000000-0000-4000-8000-000000000802'::uuid, 1, 'campaign.governed_draft_v1',
    'Lift September gross profit from the Friday dinner rush',
    'Nearby residents ordering weekend delivery',
    '[{"key":"budget_available","expectedOutcome":"pass"}]'::jsonb,
    'draft-worker-idem-0002',
    'f1000000-0000-4000-8000-000000000001'::uuid, 'processing',
    'f1000000-0000-4000-8000-000000000009'::uuid, pg_catalog.now() + interval '5 minutes', 1
  );

-- Guards ----------------------------------------------------------------------

select extensions.throws_ok(
  $$
  select public.create_campaign_draft_from_request(
    'f1000000-0000-4000-8000-000000000201'::uuid,
    'f1000000-0000-4000-8000-000000000901'::uuid,
    'f1000000-0000-4000-8000-000000000009'::uuid,
    'short'
  )
  $$,
  '22023', null,
  'a short worker idempotency key is refused'
);

select extensions.throws_ok(
  $$
  select public.create_campaign_draft_from_request(
    'f1000000-0000-4000-8000-000000000201'::uuid,
    'f1000000-0000-4000-8000-000000000099'::uuid,
    'f1000000-0000-4000-8000-000000000009'::uuid,
    'draft-worker-idem-0099xxxxxxxx'
  )
  $$,
  'P0002', null,
  'a missing request reads exactly like a missing one'
);

select extensions.throws_ok(
  $$
  select public.create_campaign_draft_from_request(
    'f1000000-0000-4000-8000-000000000201'::uuid,
    'f1000000-0000-4000-8000-000000000901'::uuid,
    'f1000000-0000-4000-8000-000000000099'::uuid,
    'draft-worker-idem-0099xxxxxxxx'
  )
  $$,
  '42501', null,
  'a stale fencing token creates nothing'
);

select extensions.throws_ok(
  $$
  select public.create_campaign_draft_from_request(
    'f1000000-0000-4000-8000-000000000099'::uuid,
    'f1000000-0000-4000-8000-000000000901'::uuid,
    'f1000000-0000-4000-8000-000000000009'::uuid,
    'draft-worker-idem-0099xxxxxxxx'
  )
  $$,
  'P0002', null,
  'a cross-tenant request id reads exactly like a missing one'
);

-- A prerequisite that moved under the worker is permanent, never a draft of
-- stale evidence.
update public.opportunities set version = 2
where id = 'f1000000-0000-4000-8000-000000000802'::uuid;

select extensions.throws_ok(
  $$
  select public.create_campaign_draft_from_request(
    'f1000000-0000-4000-8000-000000000201'::uuid,
    'f1000000-0000-4000-8000-000000000902'::uuid,
    'f1000000-0000-4000-8000-000000000009'::uuid,
    'draft-worker-idem-0002xxxxxxxx'
  )
  $$,
  '22023', null,
  'a changed opportunity version fails the draft permanently'
);

-- Happy path -------------------------------------------------------------------

select extensions.is(
  public.create_campaign_draft_from_request(
    'f1000000-0000-4000-8000-000000000201'::uuid,
    'f1000000-0000-4000-8000-000000000901'::uuid,
    'f1000000-0000-4000-8000-000000000009'::uuid,
    'draft-worker-idem-0001xxxxxxxx'
  ) ->> 'status',
  'created',
  'the worker drafts exactly one campaign with its frozen snapshot'
);

select extensions.is(
  (select state from public.campaigns where opportunity_id = 'f1000000-0000-4000-8000-000000000801'::uuid),
  'draft'::text,
  'the created campaign is a draft, never an approved version'
);

select extensions.is(
  (select action_key from public.campaign_source_snapshots snapshot
   join public.campaigns campaign
     on campaign.organization_id = snapshot.organization_id
     and campaign.id = snapshot.campaign_id
   where campaign.opportunity_id = 'f1000000-0000-4000-8000-000000000801'::uuid),
  'campaign.governed_draft_v1'::text,
  'the snapshot freezes the governed action identity'
);

select extensions.is(
  (select status from public.campaign_draft_requests where id = 'f1000000-0000-4000-8000-000000000901'::uuid),
  'completed'::text,
  'completion lands on the request in the same transaction'
);

select extensions.is(
  (select status from public.opportunities where id = 'f1000000-0000-4000-8000-000000000801'::uuid),
  'draft_created'::text,
  'the opportunity transitions with its campaign link'
);

select extensions.is(
  public.create_campaign_draft_from_request(
    'f1000000-0000-4000-8000-000000000201'::uuid,
    'f1000000-0000-4000-8000-000000000901'::uuid,
    'f1000000-0000-4000-8000-000000000009'::uuid,
    'draft-worker-idem-0001xxxxxxxx'
  ) ->> 'status',
  'replayed',
  'exact redelivery returns the same campaign instead of another'
);

select extensions.is(
  (select pg_catalog.count(*)::integer from public.campaigns
   where opportunity_id = 'f1000000-0000-4000-8000-000000000801'::uuid),
  1,
  'redelivery never duplicates the campaign'
);

select * from extensions.finish();

rollback;
