begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(60);

-- Two independent operators and tenants. Every assertion below runs inside
-- this transaction, so no user, organization, decision, or feedback survives.
insert into auth.users (id)
values
  ('db4b0000-0000-4000-8000-000000000001'::uuid),
  ('db4b0000-0000-4000-8000-000000000002'::uuid);

-- Inert account fixture: organizations.account_id is NOT NULL, but this
-- suite grants no account membership, so access still resolves purely from
-- the organization_memberships rows below -- exactly as it did before
-- accounts existed.
insert into public.accounts (id, name, slug, created_by)
values ('acc00000-0000-4000-8000-fd8cea5e456f'::uuid, 'Fixture agency', 'fixture-agency-decision-engine-behavior-test', 'db4b0000-0000-4000-8000-000000000001'::uuid);

insert into public.organizations (
  id, name, slug, industry, country_code, base_currency, default_timezone, created_by, account_id
)
values
  (
    'db4b0000-0000-4000-8000-000000000101'::uuid,
    'Decision tenant one', 'decision-tenant-one', 'testing', 'AE', 'AED', 'Asia/Dubai',
    'db4b0000-0000-4000-8000-000000000001'::uuid,
    'acc00000-0000-4000-8000-fd8cea5e456f'::uuid),
  (
    'db4b0000-0000-4000-8000-000000000102'::uuid,
    'Decision tenant two', 'decision-tenant-two', 'testing', 'AE', 'AED', 'Asia/Dubai',
    'db4b0000-0000-4000-8000-000000000002'::uuid,
    'acc00000-0000-4000-8000-fd8cea5e456f'::uuid);

insert into public.organization_memberships (organization_id, user_id, role)
values
  (
    'db4b0000-0000-4000-8000-000000000101'::uuid,
    'db4b0000-0000-4000-8000-000000000001'::uuid,
    'operator'
  ),
  (
    'db4b0000-0000-4000-8000-000000000102'::uuid,
    'db4b0000-0000-4000-8000-000000000002'::uuid,
    'operator'
  );

insert into public.policies (
  id, organization_id, policy_type, name, mode, version, is_active
)
values
  (
    'db4b0000-0000-4000-8000-000000000201'::uuid,
    'db4b0000-0000-4000-8000-000000000101'::uuid,
    'approval', 'Tenant one approval', 'approval_required', 1, true
  ),
  (
    'db4b0000-0000-4000-8000-000000000202'::uuid,
    'db4b0000-0000-4000-8000-000000000102'::uuid,
    'approval', 'Tenant two approval', 'approval_required', 1, true
  );

insert into public.playbook_definitions (
  id, organization_id, key, name, owner_scope, business_objective
)
values
  (
    'db4b0000-0000-4000-8000-000000000401'::uuid,
    'db4b0000-0000-4000-8000-000000000101'::uuid,
    'testing.tenant_one', 'Tenant one playbook', 'organization', 'Test tenant one'
  ),
  (
    'db4b0000-0000-4000-8000-000000000402'::uuid,
    'db4b0000-0000-4000-8000-000000000102'::uuid,
    'testing.tenant_two', 'Tenant two playbook', 'organization', 'Test tenant two'
  );

insert into public.playbook_versions (
  id, organization_id, playbook_definition_id, semantic_version, hypothesis_template,
  action_definition, risk_class, primary_metric_key, measurement_window_days, is_active
)
values
  (
    'db4b0000-0000-4000-8000-000000000501'::uuid,
    'db4b0000-0000-4000-8000-000000000101'::uuid,
    'db4b0000-0000-4000-8000-000000000401'::uuid,
    '1.0.0', 'Tenant one hypothesis', '{"action":"tenant_one"}'::jsonb,
    1, 'testing.metric', 7, true
  ),
  (
    'db4b0000-0000-4000-8000-000000000502'::uuid,
    'db4b0000-0000-4000-8000-000000000102'::uuid,
    'db4b0000-0000-4000-8000-000000000402'::uuid,
    '1.0.0', 'Tenant two hypothesis', '{"action":"tenant_two"}'::jsonb,
    1, 'testing.metric', 7, true
  );

insert into public.artifact_versions (
  id, organization_id, artifact_key, version, basis, authored_by, implementation_key
)
values
  (
    'db4b0000-0000-4000-8000-000000000301'::uuid,
    'db4b0000-0000-4000-8000-000000000101'::uuid,
    'ranking_weights', 'behavior-v1', 'Behavioral test fixture', 'test',
    'decision.ranking.evidence_value_time_v1'
  ),
  (
    'db4b0000-0000-4000-8000-000000000302'::uuid,
    'db4b0000-0000-4000-8000-000000000101'::uuid,
    'confidence_calibration', 'behavior-v1', 'Behavioral test fixture', 'test',
    'decision.confidence.computed_baseline_v1'
  ),
  (
    'db4b0000-0000-4000-8000-000000000303'::uuid,
    'db4b0000-0000-4000-8000-000000000102'::uuid,
    'ranking_weights', 'behavior-v1', 'Behavioral test fixture', 'test',
    'decision.ranking.evidence_value_time_v1'
  ),
  (
    'db4b0000-0000-4000-8000-000000000304'::uuid,
    'db4b0000-0000-4000-8000-000000000102'::uuid,
    'confidence_calibration', 'behavior-v1', 'Behavioral test fixture', 'test',
    'decision.confidence.computed_baseline_v1'
  );

insert into public.artifact_promotions (
  organization_id, artifact_key, active_artifact_version_id,
  rollback_artifact_version_id, promoted_by
)
select
  promotion.organization_id,
  promotion.artifact_key,
  case
    when promotion.organization_id = 'db4b0000-0000-4000-8000-000000000101'::uuid
      and promotion.artifact_key = 'ranking_weights'
      then 'db4b0000-0000-4000-8000-000000000301'::uuid
    when promotion.organization_id = 'db4b0000-0000-4000-8000-000000000101'::uuid
      then 'db4b0000-0000-4000-8000-000000000302'::uuid
    when promotion.artifact_key = 'ranking_weights'
      then 'db4b0000-0000-4000-8000-000000000303'::uuid
    else 'db4b0000-0000-4000-8000-000000000304'::uuid
  end,
  promotion.active_artifact_version_id,
  'behavior-test'
from private.current_artifact_promotions promotion
where promotion.organization_id in (
    'db4b0000-0000-4000-8000-000000000101'::uuid,
    'db4b0000-0000-4000-8000-000000000102'::uuid
  )
  and promotion.artifact_key in ('ranking_weights', 'confidence_calibration');

insert into public.decision_cycles (
  id, organization_id, trigger_name, correlation_id, slot_budget, max_scored_candidates
)
values
  (
    'db4b0000-0000-4000-8000-000000000601'::uuid,
    'db4b0000-0000-4000-8000-000000000101'::uuid,
    'behavioral_test', 'db4b0000-0000-4000-8000-000000000701'::uuid, 3, 5
  ),
  (
    'db4b0000-0000-4000-8000-000000000602'::uuid,
    'db4b0000-0000-4000-8000-000000000102'::uuid,
    'behavioral_test', 'db4b0000-0000-4000-8000-000000000702'::uuid, 1, 5
  );

create temporary table decision_behavior_fixtures (
  kind text primary key,
  organization_id uuid not null,
  payload jsonb not null
);

insert into decision_behavior_fixtures (kind, organization_id, payload)
values
  (
    'tenant_one_selected',
    'db4b0000-0000-4000-8000-000000000101'::uuid,
    jsonb_build_object(
      'record', jsonb_build_object(
        'decisionCycleId', 'db4b0000-0000-4000-8000-000000000601',
        'organizationId', 'db4b0000-0000-4000-8000-000000000101',
        'correlationId', 'db4b0000-0000-4000-8000-000000000701',
        'outcome', 'action_selected', 'reason', null,
        'selectedCandidateFingerprint', repeat('a', 64),
        'opportunityId', 'db4b0000-0000-4000-8000-000000000801',
        'rejectionHistogram', '{"stale_inputs":1}'::jsonb,
        'screenedCount', 3, 'scoredCount', 2, 'inputsDigest', repeat('b', 64),
        'versionTuple', jsonb_build_object(
          'policyVersionId', 'db4b0000-0000-4000-8000-000000000201',
          'playbookVersionId', 'db4b0000-0000-4000-8000-000000000501',
          'rankingWeightsId', 'db4b0000-0000-4000-8000-000000000301',
          'confidenceCalibrationId', 'db4b0000-0000-4000-8000-000000000302'
        ),
        'propensity', 1, 'isExploration', false
      ),
      'candidates', jsonb_build_array(
        jsonb_build_object(
          'playbookVersionId', 'db4b0000-0000-4000-8000-000000000501',
          'candidateFingerprint', repeat('a', 64), 'subjectKind', 'branch',
          'subjectRef', 'tenant-one-branch', 'parameterDigest', repeat('b', 64),
          'impactLowMinor', 200, 'impactHighMinor', 300, 'confidence', 0.5,
          'executionCostMinor', 25, 'expectedContributionMinor', 100, 'currency', 'AED',
          'evidenceTier', 'computed', 'eligibilityResult', '{"eligible":true}'::jsonb,
          'policyResult', '{"admitted":true}'::jsonb, 'rejectionReason', null, 'rank', 1
        ),
        jsonb_build_object(
          'playbookVersionId', 'db4b0000-0000-4000-8000-000000000501',
          'candidateFingerprint', repeat('d', 64), 'subjectKind', 'branch',
          'subjectRef', 'tenant-one-branch', 'parameterDigest', repeat('e', 64),
          'impactLowMinor', 100, 'impactHighMinor', 200, 'confidence', 0.5,
          'executionCostMinor', 25, 'expectedContributionMinor', 50, 'currency', 'AED',
          'evidenceTier', 'computed', 'eligibilityResult', '{"eligible":true}'::jsonb,
          'policyResult', '{"admitted":true}'::jsonb, 'rejectionReason', null, 'rank', 2
        )
      ),
      'opportunity', jsonb_build_object(
        'id', 'db4b0000-0000-4000-8000-000000000801',
        'playbookVersionId', 'db4b0000-0000-4000-8000-000000000501',
        'candidateFingerprint', repeat('a', 64), 'title', 'Tenant one opportunity',
        'summary', 'A safe tenant-one projection.', 'hypothesis', 'The action improves the metric.',
        'subjectKind', 'branch', 'subjectRef', 'tenant-one-branch',
        'evidenceBundle', '{"sourceIds":["metric-1"]}'::jsonb,
        'assumptions', '["inventory remains available"]'::jsonb,
        'impactLowMinor', 200, 'impactHighMinor', 300, 'confidence', 0.5,
        'confidenceRationale', 'Seeded calibration', 'evidenceTier', 'computed',
        'executionCostMinor', 25, 'expectedContributionMinor', 100, 'currency', 'AED',
        'timeToImpactDays', 7, 'riskTier', 1, 'approvalPath', 'human_approval',
        'guardrails', '[]'::jsonb,
        'assertions', '[{"key":"budget_available","expectedOutcome":"pass"}]'::jsonb,
        'evaluationPlan', '{"primaryMetricKey":"testing.metric"}'::jsonb,
        'expiresAt', '2027-01-01T00:00:00.000Z', 'status', 'proposed'
      )
    )
  ),
  (
    'tenant_two_selected',
    'db4b0000-0000-4000-8000-000000000102'::uuid,
    jsonb_build_object(
      'record', jsonb_build_object(
        'decisionCycleId', 'db4b0000-0000-4000-8000-000000000602',
        'organizationId', 'db4b0000-0000-4000-8000-000000000102',
        'correlationId', 'db4b0000-0000-4000-8000-000000000702',
        'outcome', 'action_selected', 'reason', null,
        'selectedCandidateFingerprint', repeat('f', 64),
        'opportunityId', 'db4b0000-0000-4000-8000-000000000802',
        'rejectionHistogram', '{}'::jsonb,
        'screenedCount', 1, 'scoredCount', 1, 'inputsDigest', repeat('a', 64),
        'versionTuple', jsonb_build_object(
          'policyVersionId', 'db4b0000-0000-4000-8000-000000000202',
          'playbookVersionId', 'db4b0000-0000-4000-8000-000000000502',
          'rankingWeightsId', 'db4b0000-0000-4000-8000-000000000303',
          'confidenceCalibrationId', 'db4b0000-0000-4000-8000-000000000304'
        ),
        'propensity', 1, 'isExploration', false
      ),
      'candidates', jsonb_build_array(jsonb_build_object(
        'playbookVersionId', 'db4b0000-0000-4000-8000-000000000502',
        'candidateFingerprint', repeat('f', 64), 'subjectKind', 'organization',
        'subjectRef', 'tenant-two', 'parameterDigest', repeat('a', 64),
        'impactLowMinor', 80, 'impactHighMinor', 120, 'confidence', 0.5,
        'executionCostMinor', 10, 'expectedContributionMinor', 40, 'currency', 'AED',
        'evidenceTier', 'prior', 'eligibilityResult', '{"eligible":true}'::jsonb,
        'policyResult', '{"admitted":true}'::jsonb, 'rejectionReason', null, 'rank', 1
      )),
      'opportunity', jsonb_build_object(
        'id', 'db4b0000-0000-4000-8000-000000000802',
        'playbookVersionId', 'db4b0000-0000-4000-8000-000000000502',
        'candidateFingerprint', repeat('f', 64), 'title', 'Tenant two opportunity',
        'summary', 'A safe tenant-two projection.', 'hypothesis', 'The action improves the metric.',
        'subjectKind', 'organization', 'subjectRef', 'tenant-two',
        'evidenceBundle', '{"sourceIds":["prior-1"]}'::jsonb,
        'assumptions', '["operations remain stable"]'::jsonb,
        'impactLowMinor', 80, 'impactHighMinor', 120, 'confidence', 0.5,
        'confidenceRationale', 'Seeded calibration', 'evidenceTier', 'prior',
        'executionCostMinor', 10, 'expectedContributionMinor', 40, 'currency', 'AED',
        'timeToImpactDays', 14, 'riskTier', 1, 'approvalPath', 'human_approval',
        'guardrails', '[]'::jsonb,
        'assertions', '[{"key":"budget_available","expectedOutcome":"pass"}]'::jsonb,
        'evaluationPlan', '{"primaryMetricKey":"testing.metric"}'::jsonb,
        'expiresAt', '2027-01-01T00:00:00.000Z', 'status', 'proposed'
      )
    )
  );

grant select on decision_behavior_fixtures to service_role;

-- Worker aggregate behavior --------------------------------------------------

reset role;

select extensions.lives_ok(
  $$
    select public.persist_decision_aggregate(organization_id, payload)
    from decision_behavior_fixtures where kind = 'tenant_one_selected'
  $$,
  'the aggregate contract persists tenant one selected aggregate'
);
select extensions.lives_ok(
  $$
    select public.persist_decision_aggregate(organization_id, payload)
    from decision_behavior_fixtures where kind = 'tenant_two_selected'
  $$,
  'the aggregate contract persists tenant two selected aggregate'
);
select extensions.lives_ok(
  $$
    select public.persist_decision_aggregate(
      organization_id,
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(payload, '{record,outcome}', '"no_action"'::jsonb),
                '{record,reason}', '"policy_removed_all"'::jsonb
              ),
              '{record,selectedCandidateFingerprint}', 'null'::jsonb
            ),
            '{record,opportunityId}', 'null'::jsonb
          ),
          '{record,scoredCount}', '0'::jsonb
        ),
        '{candidates}', '[]'::jsonb
      ) || jsonb_build_object('opportunity', null)
    )
    from decision_behavior_fixtures where kind = 'tenant_one_selected'
  $$,
  'the aggregate contract persists no_action without an opportunity'
);
select extensions.lives_ok(
  $$
    select public.persist_decision_aggregate(
      organization_id,
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(payload, '{record,outcome}', '"needs_data"'::jsonb),
                '{record,reason}', '"economics_configured"'::jsonb
              ),
              '{record,selectedCandidateFingerprint}', 'null'::jsonb
            ),
            '{record,opportunityId}', 'null'::jsonb
          ),
          '{record,scoredCount}', '0'::jsonb
        ),
        '{candidates}', '[]'::jsonb
      ) || jsonb_build_object('opportunity', null)
    )
    from decision_behavior_fixtures where kind = 'tenant_one_selected'
  $$,
  'the aggregate contract persists needs_data without an opportunity'
);

reset role;
reset request.jwt.claim.sub;

select extensions.is(
  (select count(*)::bigint from public.decision_records where organization_id = 'db4b0000-0000-4000-8000-000000000101'::uuid),
  3::bigint,
  'tenant one receives one record for every outcome'
);
select extensions.is(
  (select count(*)::bigint from public.decision_candidates where organization_id = 'db4b0000-0000-4000-8000-000000000101'::uuid),
  2::bigint,
  'the selected aggregate persists every scored candidate'
);
select extensions.is(
  (select count(*)::bigint from public.opportunities where organization_id = 'db4b0000-0000-4000-8000-000000000101'::uuid),
  1::bigint,
  'selected persists exactly one opportunity while other outcomes persist none'
);
select extensions.is(
  (
    select count(*)::bigint
    from public.opportunities opportunity
    join public.decision_records record
      on record.organization_id = opportunity.organization_id
      and record.id = opportunity.decision_record_id
    where record.outcome <> 'action_selected'
  ),
  0::bigint,
  'no_action and needs_data never own an opportunity'
);
select extensions.is(
  (select count(*)::bigint from public.decision_records where organization_id = 'db4b0000-0000-4000-8000-000000000102'::uuid),
  1::bigint,
  'tenant two receives its own selected record'
);
select extensions.is(
  (select count(*)::bigint from public.decision_candidates where organization_id = 'db4b0000-0000-4000-8000-000000000102'::uuid),
  1::bigint,
  'tenant two receives its own scored candidate'
);
select extensions.is(
  (select count(*)::bigint from public.opportunities where organization_id = 'db4b0000-0000-4000-8000-000000000102'::uuid),
  1::bigint,
  'tenant two receives exactly one opportunity'
);

reset role;

select extensions.throws_ok(
  $$
    select public.persist_decision_aggregate(
      'db4b0000-0000-4000-8000-000000000101'::uuid,
      jsonb_set(
        (select payload from decision_behavior_fixtures where kind = 'tenant_one_selected'),
        '{record,versionTuple,rankingWeightsId}',
        '"db4b0000-0000-4000-8000-000000000302"'::jsonb
      )
    )
  $$,
  '42501', null,
  'the aggregate contract rejects an artifact id with the wrong semantic key'
);
select extensions.throws_ok(
  $$
    select public.persist_decision_aggregate(
      'db4b0000-0000-4000-8000-000000000102'::uuid,
      (select payload from decision_behavior_fixtures where kind = 'tenant_one_selected')
    )
  $$,
  '22023', null,
  'the aggregate contract rejects a target and payload organization mismatch'
);

reset role;
reset request.jwt.claim.sub;

select extensions.is(
  (select count(*)::bigint from public.decision_records where organization_id = 'db4b0000-0000-4000-8000-000000000101'::uuid),
  3::bigint,
  'invalid service-role calls leave no partial decision record'
);
select extensions.is(
  (select count(*)::bigint from public.decision_candidates where organization_id = 'db4b0000-0000-4000-8000-000000000101'::uuid),
  2::bigint,
  'invalid service-role calls leave no partial candidate'
);
select extensions.is(
  (select count(*)::bigint from public.opportunities where organization_id = 'db4b0000-0000-4000-8000-000000000101'::uuid),
  1::bigint,
  'invalid service-role calls leave no partial opportunity'
);

-- Composite tenant references and immutable history -------------------------

select extensions.throws_ok(
  $$
    insert into public.decision_candidates (
      organization_id, decision_record_id, playbook_version_id, candidate_fingerprint,
      subject_kind, subject_ref, parameter_digest, impact_low_minor, impact_high_minor,
      confidence, execution_cost_minor, expected_contribution_minor, currency, evidence_tier,
      eligibility_result, policy_result, rank
    )
    select
      'db4b0000-0000-4000-8000-000000000101'::uuid,
      opportunity.decision_record_id,
      'db4b0000-0000-4000-8000-000000000502'::uuid,
      repeat('c', 64), 'organization', 'cross-tenant', repeat('c', 64),
      1, 2, 0.5, 0, 1, 'AED', 'prior', '{}'::jsonb, '{}'::jsonb, 3
    from public.opportunities opportunity
    where opportunity.id = 'db4b0000-0000-4000-8000-000000000801'::uuid
  $$,
  '23503', null,
  'composite foreign keys reject a cross-organization playbook reference'
);

select extensions.throws_ok(
  $$update public.decision_records set reason = 'rewritten' where organization_id = 'db4b0000-0000-4000-8000-000000000101'::uuid$$,
  '23514', null,
  'decision record history rejects update'
);
select extensions.throws_ok(
  $$delete from public.decision_records where organization_id = 'db4b0000-0000-4000-8000-000000000101'::uuid$$,
  '23514', null,
  'decision record history rejects delete'
);
select extensions.throws_ok(
  $$update public.decision_candidates set rank = rank + 1 where organization_id = 'db4b0000-0000-4000-8000-000000000101'::uuid$$,
  '23514', null,
  'candidate history rejects update'
);
select extensions.throws_ok(
  $$delete from public.decision_candidates where organization_id = 'db4b0000-0000-4000-8000-000000000101'::uuid$$,
  '23514', null,
  'candidate history rejects delete'
);
select extensions.throws_ok(
  $$update public.artifact_versions set basis = 'rewritten' where id = 'db4b0000-0000-4000-8000-000000000301'::uuid$$,
  '23514', null,
  'artifact version history rejects update'
);
select extensions.throws_ok(
  $$delete from public.artifact_versions where id = 'db4b0000-0000-4000-8000-000000000301'::uuid$$,
  '23514', null,
  'artifact version history rejects delete'
);
select extensions.throws_ok(
  $$update public.artifact_promotions set promoted_by = 'rewritten' where organization_id = 'db4b0000-0000-4000-8000-000000000101'::uuid$$,
  '23514', null,
  'promotion history rejects update'
);
select extensions.throws_ok(
  $$delete from public.artifact_promotions where organization_id = 'db4b0000-0000-4000-8000-000000000101'::uuid$$,
  '23514', null,
  'promotion history rejects delete'
);

-- Authenticated feed read ----------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'db4b0000-0000-4000-8000-000000000001';

select extensions.lives_ok(
  $$
    select
      id, organization_id, decision_record_id, playbook_version_id, title, summary,
      evidence_tier, impact_low_minor, impact_high_minor, execution_cost_minor,
      expected_contribution_minor, currency, time_to_impact_days, status, expires_at
    from public.opportunities
  $$,
  'an authenticated member can read the intended opportunity projection'
);
select extensions.is(
  (select count(*)::bigint from public.opportunities where organization_id = 'db4b0000-0000-4000-8000-000000000101'::uuid),
  1::bigint,
  'an authenticated member sees its same-organization opportunity'
);
select extensions.is(
  (select count(*)::bigint from public.opportunities where organization_id = 'db4b0000-0000-4000-8000-000000000102'::uuid),
  0::bigint,
  'cross-organization opportunity rows are invisible'
);
select extensions.throws_ok(
  $$select evidence_bundle from public.opportunities$$,
  '42501', null,
  'authenticated feed reads cannot expose the evidence bundle outside the projection'
);

reset role;
reset request.jwt.claim.sub;

-- Authenticated feedback -----------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'db4b0000-0000-4000-8000-000000000001';

select extensions.lives_ok(
  $$
    select public.append_decision_feedback(
      'db4b0000-0000-4000-8000-000000000101'::uuid,
      'db4b0000-0000-4000-8000-000000000801'::uuid,
      'approved', 'Approved by the tenant-one operator', null,
      'db4b0000-0000-4000-8000-000000000901'::uuid
    )
  $$,
  'an authorized operator appends feedback through the public RPC'
);

reset role;
reset request.jwt.claim.sub;

select extensions.is(
  (select count(*)::bigint from public.decision_feedback where organization_id = 'db4b0000-0000-4000-8000-000000000101'::uuid),
  1::bigint,
  'authorized feedback writes exactly one row'
);
select extensions.is(
  (
    select actor_id from public.decision_feedback
    where organization_id = 'db4b0000-0000-4000-8000-000000000101'::uuid
  ),
  'db4b0000-0000-4000-8000-000000000001'::uuid,
  'feedback actor identity is bound to auth.uid()'
);
select extensions.is(
  (select count(*)::bigint from public.decision_feedback where organization_id = 'db4b0000-0000-4000-8000-000000000102'::uuid),
  0::bigint,
  'the other tenant starts with no feedback'
);

set local role authenticated;
set local request.jwt.claim.sub = 'db4b0000-0000-4000-8000-000000000001';

select extensions.throws_ok(
  $$
    select public.append_decision_feedback(
      'db4b0000-0000-4000-8000-000000000102'::uuid,
      'db4b0000-0000-4000-8000-000000000802'::uuid,
      'approved', 'Cross tenant', null,
      'db4b0000-0000-4000-8000-000000000902'::uuid
    )
  $$,
  '42501', null,
  'a non-member cannot append cross-organization feedback'
);

reset role;
reset request.jwt.claim.sub;

select extensions.is(
  (select count(*)::bigint from public.decision_feedback where organization_id = 'db4b0000-0000-4000-8000-000000000102'::uuid),
  0::bigint,
  'rejected cross-organization feedback leaves zero rows'
);

set local role authenticated;
set local request.jwt.claim.sub = 'db4b0000-0000-4000-8000-000000000001';

select extensions.throws_ok(
  $$
    select public.append_decision_feedback(
      target_organization_id => 'db4b0000-0000-4000-8000-000000000101'::uuid,
      target_opportunity_id => 'db4b0000-0000-4000-8000-000000000801'::uuid,
      input_feedback_kind => 'approved', input_reason => 'Unknown key',
      input_edit_diff => null,
      input_correlation_id => 'db4b0000-0000-4000-8000-000000000903'::uuid,
      unknown_feedback_key => 'not allowed'
    )
  $$,
  '42883', null,
  'an unknown feedback key is rejected at the public function boundary'
);
select extensions.throws_ok(
  $$
    select public.append_decision_feedback(
      'db4b0000-0000-4000-8000-000000000101'::uuid,
      'db4b0000-0000-4000-8000-000000000801'::uuid,
      'rejected', repeat('x', 501), null,
      'db4b0000-0000-4000-8000-000000000904'::uuid
    )
  $$,
  '23514', null,
  'feedback reason length is bounded at the public RPC boundary'
);
select extensions.throws_ok(
  $$
    select public.append_decision_feedback(
      'db4b0000-0000-4000-8000-000000000101'::uuid,
      'db4b0000-0000-4000-8000-000000000801'::uuid,
      'edited', 'Unknown diff field', '{"providerPayload":"not allowed"}'::jsonb,
      'db4b0000-0000-4000-8000-000000000905'::uuid
    )
  $$,
  '23514', null,
  'unknown edit-diff fields are rejected at the public RPC boundary'
);
select extensions.throws_ok(
  $$
    select public.append_decision_feedback(
      'db4b0000-0000-4000-8000-000000000101'::uuid,
      'db4b0000-0000-4000-8000-000000000801'::uuid,
      'edited', 'Oversized diff', jsonb_build_object('title', repeat('x', 241)),
      'db4b0000-0000-4000-8000-000000000906'::uuid
    )
  $$,
  '23514', null,
  'edit-diff values are bounded at the public RPC boundary'
);

reset role;
reset request.jwt.claim.sub;

select extensions.is(
  (select count(*)::bigint from public.decision_feedback where organization_id = 'db4b0000-0000-4000-8000-000000000101'::uuid),
  1::bigint,
  'invalid feedback calls leave no partial rows'
);

select extensions.throws_ok(
  $$update public.decision_feedback set reason = 'rewritten' where organization_id = 'db4b0000-0000-4000-8000-000000000101'::uuid$$,
  '23514', null,
  'feedback history rejects update'
);
select extensions.throws_ok(
  $$delete from public.decision_feedback where organization_id = 'db4b0000-0000-4000-8000-000000000101'::uuid$$,
  '23514', null,
  'feedback history rejects delete'
);

-- Anonymous and authenticated worker boundaries -----------------------------

set local role anon;

select extensions.throws_ok(
  $$select id from public.opportunities$$,
  '42501', null,
  'anonymous callers cannot read the opportunity ledger'
);
select extensions.throws_ok(
  $$select public.persist_decision_aggregate(null, '{}'::jsonb)$$,
  '42501', null,
  'anonymous callers cannot execute aggregate persistence'
);
select extensions.throws_ok(
  $$select public.start_decision_cycle(null, '{}'::jsonb)$$,
  '42501', null,
  'anonymous callers cannot start decision cycles'
);

reset role;
reset request.jwt.claim.sub;

set local role authenticated;
set local request.jwt.claim.sub = 'db4b0000-0000-4000-8000-000000000001';

select extensions.throws_ok(
  $$select public.persist_decision_aggregate(null, '{}'::jsonb)$$,
  '42501', null,
  'authenticated callers cannot execute aggregate persistence'
);
select extensions.throws_ok(
  $$select public.start_decision_cycle(null, '{}'::jsonb)$$,
  '42501', null,
  'authenticated callers cannot start decision cycles'
);
select extensions.throws_ok(
  $$select public.persist_decision_record(null, '{}'::jsonb)$$,
  '42501', null,
  'authenticated callers cannot execute obsolete record persistence'
);
select extensions.throws_ok(
  $$insert into public.decision_records default values$$,
  '42501', null,
  'authenticated callers cannot directly insert ledger records'
);

reset role;
reset request.jwt.claim.sub;

-- Catalog-level least privilege ---------------------------------------------

select extensions.is(
  (
    select count(*)::bigint
    from information_schema.role_table_grants
    where grantee = 'anon'
      and table_schema = 'public'
      and table_name in (
        'playbook_definitions', 'playbook_versions', 'artifact_versions',
        'artifact_promotions', 'decision_cycles', 'decision_records',
        'decision_candidates', 'decision_feedback', 'candidate_suppressions',
        'opportunities'
      )
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ),
  0::bigint,
  'anonymous callers hold no direct ledger write privileges'
);
select extensions.is(
  (
    select count(*)::bigint
    from information_schema.role_table_grants
    where grantee = 'authenticated'
      and table_schema = 'public'
      and table_name in (
        'playbook_definitions', 'playbook_versions', 'artifact_versions',
        'artifact_promotions', 'decision_cycles', 'decision_records',
        'decision_candidates', 'decision_feedback', 'candidate_suppressions',
        'opportunities'
      )
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ),
  0::bigint,
  'authenticated callers hold no direct ledger write privileges'
);
select extensions.is(
  (
    select count(*)::bigint
    from information_schema.role_table_grants
    where grantee = 'service_role'
      and table_schema = 'public'
      and table_name in (
        'playbook_definitions', 'playbook_versions', 'artifact_versions',
        'artifact_promotions', 'decision_cycles', 'decision_records',
        'decision_candidates', 'decision_feedback', 'candidate_suppressions',
        'opportunities'
      )
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ),
  0::bigint,
  'service role must use the intended worker RPCs rather than direct ledger writes'
);
select extensions.is(
  (
    select array_agg(column_name::text order by column_name)
    from information_schema.column_privileges
    where grantee = 'authenticated'
      and table_schema = 'public'
      and table_name = 'opportunities'
      and privilege_type = 'SELECT'
  ),
  array[
    'currency', 'decision_record_id', 'evidence_tier', 'execution_cost_minor',
    'expected_contribution_minor', 'expires_at', 'id', 'impact_high_minor',
    'impact_low_minor', 'organization_id', 'playbook_version_id', 'status',
    'summary', 'time_to_impact_days', 'title'
  ]::text[],
  'authenticated opportunity reads are limited to the intended feed projection'
);

select extensions.function_privs_are(
  'public', 'persist_decision_aggregate', array['uuid', 'jsonb'], 'service_role',
  array[]::text[], 'service role cannot execute unfenced aggregate persistence'
);
select extensions.function_privs_are(
  'public', 'start_decision_cycle', array['uuid', 'jsonb'], 'service_role',
  array[]::text[], 'service role cannot execute unfenced cycle creation'
);
select extensions.function_privs_are(
  'public', 'persist_decision_record', array['uuid', 'jsonb'], 'service_role',
  array[]::text[], 'service role cannot execute obsolete record persistence'
);
select extensions.function_privs_are(
  'public', 'persist_decision_aggregate', array['uuid', 'jsonb'], 'authenticated',
  array[]::text[], 'authenticated has no aggregate persistence privilege'
);
select extensions.function_privs_are(
  'public', 'persist_decision_aggregate', array['uuid', 'jsonb'], 'anon',
  array[]::text[], 'anonymous has no aggregate persistence privilege'
);
select extensions.function_privs_are(
  'public', 'append_decision_feedback',
  array['uuid', 'uuid', 'text', 'text', 'jsonb', 'uuid'], 'authenticated',
  array['EXECUTE'], 'authenticated can execute only the constrained feedback RPC'
);
select extensions.function_privs_are(
  'public', 'append_decision_feedback',
  array['uuid', 'uuid', 'text', 'text', 'jsonb', 'uuid'], 'anon',
  array[]::text[], 'anonymous cannot execute feedback persistence'
);

select * from extensions.finish();

rollback;
