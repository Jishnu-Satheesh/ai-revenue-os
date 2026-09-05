begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(28);

insert into auth.users (id) values
  ('e1000000-0000-4000-8000-000000000001'::uuid),
  ('e1000000-0000-4000-8000-000000000003'::uuid);

insert into public.accounts (id, name, slug, created_by) values
  ('e1000000-0000-4000-8000-000000000101'::uuid, 'Draft agency', 'draft-agency', 'e1000000-0000-4000-8000-000000000001'::uuid);

insert into public.organizations (
  id, account_id, name, slug, industry, country_code, base_currency,
  default_timezone, created_by
) values
  ('e1000000-0000-4000-8000-000000000201'::uuid, 'e1000000-0000-4000-8000-000000000101'::uuid, 'Draft client', 'draft-client', 'testing', 'AE', 'AED', 'Asia/Dubai', 'e1000000-0000-4000-8000-000000000001'::uuid);

insert into public.account_memberships (
  account_id, user_id, account_role, default_organization_role
) values
  ('e1000000-0000-4000-8000-000000000101'::uuid, 'e1000000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner'),
  ('e1000000-0000-4000-8000-000000000101'::uuid, 'e1000000-0000-4000-8000-000000000003'::uuid, 'member', 'viewer');

insert into public.playbook_definitions (
  id, organization_id, key, name, owner_scope, business_objective
) values (
  'e1000000-0000-4000-8000-000000000004'::uuid,
  'e1000000-0000-4000-8000-000000000201'::uuid,
  'campaign.governed_draft', 'Governed Campaign Draft', 'core',
  'Create an internal reversible Campaign draft'
);

insert into public.playbook_versions (
  id, organization_id, playbook_definition_id, semantic_version, hypothesis_template,
  action_definition, risk_class, primary_metric_key, measurement_window_days, is_active
) values (
  'e1000000-0000-4000-8000-000000000005'::uuid,
  'e1000000-0000-4000-8000-000000000201'::uuid,
  'e1000000-0000-4000-8000-000000000004'::uuid,
  '1.0.0', 'A governed draft freezes what the operator saw.',
  '{"action_key":"campaign.governed_draft_v1"}'::jsonb,
  1, 'contribution.incremental_gross_profit', 30, true
);

insert into public.artifact_versions (
  id, organization_id, artifact_key, version, basis, authored_by, implementation_key
)
values
  (
    'e1000000-0000-4000-8000-000000000301'::uuid,
    'e1000000-0000-4000-8000-000000000201'::uuid,
    'ranking_weights', 'behavior-v1', 'Behavioral test fixture', 'test',
    'decision.ranking.evidence_value_time_v1'
  ),
  (
    'e1000000-0000-4000-8000-000000000302'::uuid,
    'e1000000-0000-4000-8000-000000000201'::uuid,
    'confidence_calibration', 'behavior-v1', 'Behavioral test fixture', 'test',
    'decision.confidence.computed_baseline_v1'
  );

insert into public.artifact_promotions (
  organization_id, artifact_key, active_artifact_version_id,
  rollback_artifact_version_id, promoted_by
)
select
  'e1000000-0000-4000-8000-000000000201'::uuid,
  promotion.artifact_key,
  case when promotion.artifact_key = 'ranking_weights'
    then 'e1000000-0000-4000-8000-000000000301'::uuid
    else 'e1000000-0000-4000-8000-000000000302'::uuid end,
  promotion.active_artifact_version_id,
  'draft-test'
from private.current_artifact_promotions promotion
where promotion.organization_id = 'e1000000-0000-4000-8000-000000000201'::uuid
  and promotion.artifact_key in ('ranking_weights', 'confidence_calibration');

insert into public.policies (
  id, organization_id, policy_type, name, mode, version, is_active
)
values (
  'e1000000-0000-4000-8000-000000000003'::uuid,
  'e1000000-0000-4000-8000-000000000201'::uuid,
  'approval', 'Decision approval', 'approval_required', 1, true
);

insert into public.decision_cycles (
  id, organization_id, trigger_name, correlation_id, slot_budget, max_scored_candidates
) values
  ('e1000000-0000-4000-8000-000000000601'::uuid,
   'e1000000-0000-4000-8000-000000000201'::uuid,
   'draft-test', 'e1000000-0000-4000-8000-000000000701'::uuid, 1, 1);

insert into public.decision_records (
  id, organization_id, decision_cycle_id, correlation_id, outcome, reason,
  selected_candidate_fingerprint, opportunity_id, inputs_digest, artifact_version_tuple,
  screened_count, scored_count, propensity, is_exploration,
  ranking_weights_id, confidence_calibration_id, policy_version_id,
  playbook_version_id
) values (
  'e1000000-0000-4000-8000-000000000602'::uuid,
  'e1000000-0000-4000-8000-000000000201'::uuid,
  'e1000000-0000-4000-8000-000000000601'::uuid,
  'e1000000-0000-4000-8000-000000000701'::uuid,
  'action_selected', null, repeat('a', 64),
  'e1000000-0000-4000-8000-000000000801'::uuid, repeat('b', 64),
  '{"confidence_calibration":"test-v1"}'::jsonb, 1, 1, 1, false,
  'e1000000-0000-4000-8000-000000000301'::uuid,
  'e1000000-0000-4000-8000-000000000302'::uuid,
  'e1000000-0000-4000-8000-000000000003'::uuid,
  'e1000000-0000-4000-8000-000000000005'::uuid
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
    'e1000000-0000-4000-8000-000000000801'::uuid, 'e1000000-0000-4000-8000-000000000201'::uuid,
    'e1000000-0000-4000-8000-000000000602'::uuid, 'e1000000-0000-4000-8000-000000000005'::uuid,
    'campaign.governed_draft_v1', repeat('a', 64), 'Friday hours draft', 'A draft summary.',
    'Longer hours lift profit.', 'organization', 'draft-client',
    '{"sourceIds":["metric-1"]}'::jsonb, '["friday repeats"]'::jsonb,
    10000, 40000, 0.6, 'Computed over complete evidence.', 'computed', 5000, 10000,
    'AED', 14, 1, 'human_approval', '[]'::jsonb,
    '[{"key":"budget_available","expectedOutcome":"pass"}]'::jsonb,
    '{"primaryMetricKey":"contribution.incremental_gross_profit"}'::jsonb,
    '2027-01-01T00:00:00.000Z', 'proposed', pg_catalog.now()
  ),
  (
    'e1000000-0000-4000-8000-000000000802'::uuid, 'e1000000-0000-4000-8000-000000000201'::uuid,
    'e1000000-0000-4000-8000-000000000602'::uuid, 'e1000000-0000-4000-8000-000000000005'::uuid,
    'campaign.governed_draft_v1', repeat('c', 64), 'Second draft', 'Another summary.',
    'Longer hours lift profit.', 'organization', 'draft-client',
    '{"sourceIds":["metric-1"]}'::jsonb, '["friday repeats"]'::jsonb,
    10000, 40000, 0.6, 'Computed over complete evidence.', 'computed', 5000, 10000,
    'AED', 14, 1, 'human_approval', '[]'::jsonb,
    '[{"key":"budget_available","expectedOutcome":"pass"}]'::jsonb,
    '{"primaryMetricKey":"contribution.incremental_gross_profit"}'::jsonb,
    '2027-01-01T00:00:00.000Z', 'proposed', pg_catalog.now()
  ),
  (
    'e1000000-0000-4000-8000-000000000803'::uuid, 'e1000000-0000-4000-8000-000000000201'::uuid,
    'e1000000-0000-4000-8000-000000000602'::uuid, 'e1000000-0000-4000-8000-000000000005'::uuid,
    'campaign.governed_draft_v1', repeat('d', 64), 'Stale draft', 'An old summary.',
    'Longer hours lift profit.', 'organization', 'draft-client',
    '{"sourceIds":["metric-1"]}'::jsonb, '["friday repeats"]'::jsonb,
    10000, 40000, 0.6, 'Computed over complete evidence.', 'computed', 5000, 10000,
    'AED', 14, 1, 'human_approval', '[]'::jsonb,
    '[{"key":"budget_available","expectedOutcome":"pass"}]'::jsonb,
    '{"primaryMetricKey":"contribution.incremental_gross_profit"}'::jsonb,
    '2020-01-01T00:00:00.000Z', 'proposed', '2019-06-01T00:00:00.000Z'
  );

-- Member admission ------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'e1000000-0000-4000-8000-000000000001';

select extensions.is(
  public.request_campaign_draft_from_opportunity(
    'e1000000-0000-4000-8000-000000000201'::uuid,
    'e1000000-0000-4000-8000-000000000001'::uuid,
    'e1000000-0000-4000-8000-000000000801'::uuid,
    1, 'campaign.governed_draft_v1',
    'Lift September gross profit from the Friday dinner rush',
    'Nearby residents ordering weekend delivery',
    '[{"key":"budget_available","expectedOutcome":"pass"}]'::jsonb,
    'draft-request-operator-0001',
    'e1000000-0000-4000-8000-000000000006'::uuid
  ) ->> 'status',
  'created',
  'a first admission creates exactly one durable request'
);

select extensions.is(
  (select status from public.opportunities where id = 'e1000000-0000-4000-8000-000000000801'::uuid),
  'draft_requested'::text,
  'admission moves the opportunity to draft_requested'
);

select extensions.is(
  public.request_campaign_draft_from_opportunity(
    'e1000000-0000-4000-8000-000000000201'::uuid,
    'e1000000-0000-4000-8000-000000000001'::uuid,
    'e1000000-0000-4000-8000-000000000801'::uuid,
    1, 'campaign.governed_draft_v1',
    'Lift September gross profit from the Friday dinner rush',
    'Nearby residents ordering weekend delivery',
    '[{"key":"budget_available","expectedOutcome":"pass"}]'::jsonb,
    'draft-request-operator-0001',
    'e1000000-0000-4000-8000-000000000006'::uuid
  ) ->> 'status',
  'replayed',
  'a repeated admission replays the same request instead of a second one'
);

select extensions.is(
  (select pg_catalog.count(*)::integer from public.campaign_draft_requests
   where organization_id = 'e1000000-0000-4000-8000-000000000201'::uuid
     and opportunity_id = 'e1000000-0000-4000-8000-000000000801'::uuid),
  1,
  'replay never inserts a second row for one organization and opportunity'
);

select extensions.throws_ok(
  $$
  select public.request_campaign_draft_from_opportunity(
    'e1000000-0000-4000-8000-000000000201'::uuid,
    'e1000000-0000-4000-8000-000000000001'::uuid,
    'e1000000-0000-4000-8000-000000000802'::uuid,
    99, 'campaign.governed_draft_v1',
    'Lift September gross profit from the Friday dinner rush',
    'Nearby residents ordering weekend delivery',
    '[{"key":"budget_available","expectedOutcome":"pass"}]'::jsonb,
    'draft-request-operator-0002',
    'e1000000-0000-4000-8000-000000000006'::uuid
  )
  $$,
  '22023', null,
  'a stale opportunity version is refused'
);

select extensions.throws_ok(
  $$
  select public.request_campaign_draft_from_opportunity(
    'e1000000-0000-4000-8000-000000000201'::uuid,
    'e1000000-0000-4000-8000-000000000001'::uuid,
    'e1000000-0000-4000-8000-000000000802'::uuid,
    1, 'campaign.meta_bundle_v1',
    'Lift September gross profit from the Friday dinner rush',
    'Nearby residents ordering weekend delivery',
    '[{"key":"budget_available","expectedOutcome":"pass"}]'::jsonb,
    'draft-request-operator-0003',
    'e1000000-0000-4000-8000-000000000006'::uuid
  )
  $$,
  '22023', null,
  'an invented action key is refused before any write'
);

select extensions.throws_ok(
  $$
  select public.request_campaign_draft_from_opportunity(
    'e1000000-0000-4000-8000-000000000201'::uuid,
    'e1000000-0000-4000-8000-000000000001'::uuid,
    'e1000000-0000-4000-8000-000000000802'::uuid,
    1, 'campaign.governed_draft_v1',
    'Lift September gross profit from the Friday dinner rush',
    'Nearby residents ordering weekend delivery',
    '[{"key":"invented_assertion","expectedOutcome":"pass"}]'::jsonb,
    'draft-request-operator-0004',
    'e1000000-0000-4000-8000-000000000006'::uuid
  )
  $$,
  '22023', null,
  'an assertion the opportunity never made is refused'
);

select extensions.throws_ok(
  $$
  select public.request_campaign_draft_from_opportunity(
    'e1000000-0000-4000-8000-000000000201'::uuid,
    'e1000000-0000-4000-8000-000000000001'::uuid,
    'e1000000-0000-4000-8000-000000000803'::uuid,
    1, 'campaign.governed_draft_v1',
    'Lift September gross profit from the Friday dinner rush',
    'Nearby residents ordering weekend delivery',
    '[{"key":"budget_available","expectedOutcome":"pass"}]'::jsonb,
    'draft-request-operator-0005',
    'e1000000-0000-4000-8000-000000000006'::uuid
  )
  $$,
  '22023', null,
  'an expired opportunity is refused'
);

select extensions.throws_ok(
  $$
  select public.request_campaign_draft_from_opportunity(
    'e1000000-0000-4000-8000-000000000201'::uuid,
    'e1000000-0000-4000-8000-000000000001'::uuid,
    'e1000000-0000-4000-8000-000000000802'::uuid,
    1, 'campaign.governed_draft_v1',
    'Lift September gross profit from the Friday dinner rush',
    'Nearby residents ordering weekend delivery',
    '[{"key":"budget_available","expectedOutcome":"pass"}]'::jsonb,
    'short',
    'e1000000-0000-4000-8000-000000000006'::uuid
  )
  $$,
  '22023', null,
  'a short idempotency key is refused'
);

set local request.jwt.claim.sub = 'e1000000-0000-4000-8000-000000000003';

select extensions.throws_ok(
  $$
  select public.request_campaign_draft_from_opportunity(
    'e1000000-0000-4000-8000-000000000201'::uuid,
    'e1000000-0000-4000-8000-000000000003'::uuid,
    'e1000000-0000-4000-8000-000000000802'::uuid,
    1, 'campaign.governed_draft_v1',
    'Lift September gross profit from the Friday dinner rush',
    'Nearby residents ordering weekend delivery',
    '[{"key":"budget_available","expectedOutcome":"pass"}]'::jsonb,
    'draft-request-viewer-0001',
    'e1000000-0000-4000-8000-000000000006'::uuid
  )
  $$,
  '42501', null,
  'a viewer reads the workspace but records no draft request'
);

select extensions.throws_ok(
  $$
  select public.request_campaign_draft_from_opportunity(
    'e1000000-0000-4000-8000-000000000201'::uuid,
    'e1000000-0000-4000-8000-000000000003'::uuid,
    'e1000000-0000-4000-8000-000000000802'::uuid,
    1, 'campaign.governed_draft_v1',
    'Lift September gross profit from the Friday dinner rush',
    'Nearby residents ordering weekend delivery',
    '[{"key":"budget_available","expectedOutcome":"pass"}]'::jsonb,
    'draft-request-attacker-0001',
    'e1000000-0000-4000-8000-000000000006'::uuid
  )
  $$,
  '42501', null,
  'an actor cannot spend another member''s session'
);

set local request.jwt.claim.sub = 'e1000000-0000-4000-8000-000000000001';

select extensions.throws_ok(
  $$
  select public.request_campaign_draft_from_opportunity(
    'e1000000-0000-4000-8000-000000000201'::uuid,
    'e1000000-0000-4000-8000-000000000001'::uuid,
    'f1000000-0000-4000-8000-000000000801'::uuid,
    1, 'campaign.governed_draft_v1',
    'Lift September gross profit from the Friday dinner rush',
    'Nearby residents ordering weekend delivery',
    '[{"key":"budget_available","expectedOutcome":"pass"}]'::jsonb,
    'draft-request-stranger-0001',
    'e1000000-0000-4000-8000-000000000006'::uuid
  )
  $$,
  'P0002', null,
  'an opportunity outside the tenant reads exactly like a missing one'
);

reset role;

-- Worker claim, failure, and completion ---------------------------------------

select extensions.is(
  public.claim_campaign_draft_request(
    'e1000000-0000-4000-8000-000000000201'::uuid,
    (select id from public.campaign_draft_requests
     where opportunity_id = 'e1000000-0000-4000-8000-000000000801'::uuid),
    'e1000000-0000-4000-8000-000000000009'::uuid,
    300
  ) ->> 'status',
  'processing',
  'a pending request is claimed into processing under a fencing token'
);

select extensions.throws_ok(
  $$
  select public.claim_campaign_draft_request(
    'e1000000-0000-4000-8000-000000000201'::uuid,
    (select id from public.campaign_draft_requests
     where opportunity_id = 'e1000000-0000-4000-8000-000000000801'::uuid),
    'e1000000-0000-4000-8000-000000000009'::uuid,
    300
  )
  $$,
  '22023', null,
  'a claimed request cannot be claimed again'
);

select extensions.throws_ok(
  $$
  select public.fail_campaign_draft_request(
    'e1000000-0000-4000-8000-000000000201'::uuid,
    (select id from public.campaign_draft_requests
     where opportunity_id = 'e1000000-0000-4000-8000-000000000801'::uuid),
    'e1000000-0000-4000-8000-000000000099'::uuid,
    true, 'worker_crashed'
  )
  $$,
  '42501', null,
  'a stale fencing token fails nothing'
);

select extensions.is(
  public.fail_campaign_draft_request(
    'e1000000-0000-4000-8000-000000000201'::uuid,
    (select id from public.campaign_draft_requests
     where opportunity_id = 'e1000000-0000-4000-8000-000000000801'::uuid),
    'e1000000-0000-4000-8000-000000000009'::uuid,
    true, 'worker_crashed'
  ) ->> 'status',
  'retryable_failed',
  'a retryable failure is recorded on the request'
);

select extensions.is(
  (select status from public.opportunities where id = 'e1000000-0000-4000-8000-000000000801'::uuid),
  'draft_requested'::text,
  'a failed worker never pretends the opportunity returned to proposed'
);

set local role authenticated;
set local request.jwt.claim.sub = 'e1000000-0000-4000-8000-000000000001';

select extensions.is(
  public.request_campaign_draft_from_opportunity(
    'e1000000-0000-4000-8000-000000000201'::uuid,
    'e1000000-0000-4000-8000-000000000001'::uuid,
    'e1000000-0000-4000-8000-000000000801'::uuid,
    1, 'campaign.governed_draft_v1',
    'Lift September gross profit from the Friday dinner rush',
    'Nearby residents ordering weekend delivery',
    '[{"key":"budget_available","expectedOutcome":"pass"}]'::jsonb,
    'draft-request-operator-0007',
    'e1000000-0000-4000-8000-000000000006'::uuid
  ) ->> 'draftRequestStatus',
  'pending',
  'asking again explicitly requeues a retryable request'
);

reset role;

select extensions.is(
  public.claim_campaign_draft_request(
    'e1000000-0000-4000-8000-000000000201'::uuid,
    (select id from public.campaign_draft_requests
     where opportunity_id = 'e1000000-0000-4000-8000-000000000801'::uuid),
    'e1000000-0000-4000-8000-000000000010'::uuid,
    300
  ) ->> 'status',
  'processing',
  'a requeued request claims fresh under a new fencing token'
);

select extensions.is(
  public.complete_campaign_draft_request(
    'e1000000-0000-4000-8000-000000000201'::uuid,
    (select id from public.campaign_draft_requests
     where opportunity_id = 'e1000000-0000-4000-8000-000000000801'::uuid),
    'e1000000-0000-4000-8000-000000000010'::uuid,
    'e1000000-0000-4000-8000-000000000011'::uuid
  ) ->> 'status',
  'completed',
  'claiming and completing links the draft atomically'
);

select extensions.is(
  (select campaign_id from public.campaign_draft_requests
   where opportunity_id = 'e1000000-0000-4000-8000-000000000801'::uuid),
  'e1000000-0000-4000-8000-000000000011'::uuid,
  'completion stores the linked campaign'
);

select extensions.is(
  (select status from public.opportunities where id = 'e1000000-0000-4000-8000-000000000801'::uuid),
  'draft_created'::text,
  'completion moves the opportunity to draft_created with its link'
);

-- Member cancellation ----------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'e1000000-0000-4000-8000-000000000001';

select extensions.is(
  public.request_campaign_draft_from_opportunity(
    'e1000000-0000-4000-8000-000000000201'::uuid,
    'e1000000-0000-4000-8000-000000000001'::uuid,
    'e1000000-0000-4000-8000-000000000802'::uuid,
    1, 'campaign.governed_draft_v1',
    'Lift September gross profit from the Friday dinner rush',
    'Nearby residents ordering weekend delivery',
    '[{"key":"budget_available","expectedOutcome":"pass"}]'::jsonb,
    'draft-request-operator-0008',
    'e1000000-0000-4000-8000-000000000006'::uuid
  ) ->> 'status',
  'created',
  'a second opportunity admits its own request'
);

select extensions.is(
  public.cancel_campaign_draft_request(
    'e1000000-0000-4000-8000-000000000201'::uuid,
    'e1000000-0000-4000-8000-000000000001'::uuid,
    (select id from public.campaign_draft_requests
     where opportunity_id = 'e1000000-0000-4000-8000-000000000802'::uuid)
  ) ->> 'status',
  'cancelled',
  'a pending request cancels cleanly'
);

select extensions.throws_ok(
  $$
  select public.cancel_campaign_draft_request(
    'e1000000-0000-4000-8000-000000000201'::uuid,
    'e1000000-0000-4000-8000-000000000001'::uuid,
    (select id from public.campaign_draft_requests
     where opportunity_id = 'e1000000-0000-4000-8000-000000000802'::uuid)
  )
  $$,
  '22023', null,
  'a cancelled request cannot cancel again'
);

select extensions.throws_ok(
  $$
  select public.cancel_campaign_draft_request(
    'e1000000-0000-4000-8000-000000000201'::uuid,
    'e1000000-0000-4000-8000-000000000001'::uuid,
    'f1000000-0000-4000-8000-000000000802'::uuid
  )
  $$,
  'P0002', null,
  'cancelling a stranger''s request reads exactly like a missing one'
);

-- Grants -----------------------------------------------------------------------

reset role;

set local role authenticated;

select extensions.throws_ok(
  $$select public.claim_campaign_draft_request(
    'e1000000-0000-4000-8000-000000000201'::uuid,
    'e1000000-0000-4000-8000-000000000802'::uuid,
    'e1000000-0000-4000-8000-000000000009'::uuid,
    300
  )$$,
  '42501', null,
  'members cannot execute the worker claim path'
);

reset role;

set local role anon;

select extensions.throws_ok(
  $$select public.request_campaign_draft_from_opportunity(
    'e1000000-0000-4000-8000-000000000201'::uuid,
    'e1000000-0000-4000-8000-000000000001'::uuid,
    'e1000000-0000-4000-8000-000000000802'::uuid,
    1, 'campaign.governed_draft_v1',
    'Lift September gross profit from the Friday dinner rush',
    'Nearby residents ordering weekend delivery',
    '[{"key":"budget_available","expectedOutcome":"pass"}]'::jsonb,
    'draft-request-anon-0001xx',
    'e1000000-0000-4000-8000-000000000006'::uuid
  )$$,
  '42501', null,
  'anonymous callers reach no draft path'
);

reset role;

select * from extensions.finish();

rollback;
