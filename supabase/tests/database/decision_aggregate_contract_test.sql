begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(18);

insert into auth.users (id)
values ('da4a0000-0000-4000-8000-000000000001'::uuid);

insert into public.organizations (
  id, name, slug, industry, country_code, base_currency, default_timezone, created_by
)
values (
  'da4a0000-0000-4000-8000-000000000002'::uuid,
  'Decision aggregate contract', 'decision-aggregate-contract', 'testing', 'AE', 'AED',
  'Asia/Dubai', 'da4a0000-0000-4000-8000-000000000001'::uuid
);

insert into public.policies (
  id, organization_id, policy_type, name, mode, version, is_active
)
values (
  'da4a0000-0000-4000-8000-000000000003'::uuid,
  'da4a0000-0000-4000-8000-000000000002'::uuid,
  'approval', 'Decision approval', 'approval_required', 1, true
);

insert into public.playbook_definitions (
  id, organization_id, key, name, owner_scope, business_objective
)
values (
  'da4a0000-0000-4000-8000-000000000004'::uuid,
  'da4a0000-0000-4000-8000-000000000002'::uuid,
  'testing.decision', 'Decision test', 'organization', 'Verify aggregate persistence'
);

insert into public.playbook_versions (
  id, organization_id, playbook_definition_id, semantic_version, hypothesis_template,
  action_definition, risk_class, primary_metric_key, measurement_window_days, is_active
)
values (
  'da4a0000-0000-4000-8000-000000000005'::uuid,
  'da4a0000-0000-4000-8000-000000000002'::uuid,
  'da4a0000-0000-4000-8000-000000000004'::uuid,
  E'1\\x0\\x0', 'A test action improves the registered metric.', '{"action":"testing"}'::jsonb,
  1, 'testing.metric', 7, true
);

insert into public.artifact_versions (
  id, organization_id, artifact_key, version, basis, authored_by, implementation_key
)
values
  (
    'da4a0000-0000-4000-8000-000000000006'::uuid,
    'da4a0000-0000-4000-8000-000000000002'::uuid,
    'ranking_weights', 'test-v1', 'Focused pgTAP fixture', 'test',
    'decision.ranking.evidence_value_time_v1'
  ),
  (
    'da4a0000-0000-4000-8000-000000000007'::uuid,
    'da4a0000-0000-4000-8000-000000000002'::uuid,
    'confidence_calibration', 'test-v1', 'Focused pgTAP fixture', 'test',
    'decision.confidence.computed_baseline_v1'
  );

insert into public.artifact_promotions (
  organization_id, artifact_key, active_artifact_version_id,
  rollback_artifact_version_id, promoted_by
)
select
  'da4a0000-0000-4000-8000-000000000002'::uuid,
  promotion.artifact_key,
  'da4a0000-0000-4000-8000-000000000007'::uuid,
  promotion.active_artifact_version_id,
  'focused-test'
from private.current_artifact_promotions promotion
where promotion.organization_id = 'da4a0000-0000-4000-8000-000000000002'::uuid
  and promotion.artifact_key = 'confidence_calibration';

select extensions.lives_ok(
  $$
    select public.promote_decision_artifact(
      'da4a0000-0000-4000-8000-000000000002'::uuid,
      jsonb_build_object(
        'organization_id', 'da4a0000-0000-4000-8000-000000000002',
        'artifact_key', 'ranking_weights',
        'artifact_version_id', 'da4a0000-0000-4000-8000-000000000006',
        'expected_current_artifact_version_id', promotion.active_artifact_version_id,
        'promoted_by', 'focused-test'
      )
    )
    from private.current_artifact_promotions promotion
    where promotion.organization_id = 'da4a0000-0000-4000-8000-000000000002'::uuid
      and promotion.artifact_key = 'ranking_weights'
  $$,
  'promotion appends a successor ledger row'
);
select extensions.is(
  (
    select count(*)::bigint from public.artifact_promotions
    where organization_id = 'da4a0000-0000-4000-8000-000000000002'::uuid
      and artifact_key = 'ranking_weights'
  ),
  2::bigint,
  'promotion retains the historical ledger row'
);
select extensions.is(
  (
    select active_artifact_version_id from private.current_artifact_promotions
    where organization_id = 'da4a0000-0000-4000-8000-000000000002'::uuid
      and artifact_key = 'ranking_weights'
  ),
  'da4a0000-0000-4000-8000-000000000006'::uuid,
  'current artifact resolution chooses the newest ledger row'
);
select extensions.throws_ok(
  $$
    update public.artifact_promotions
    set promoted_by = 'rewritten'
    where organization_id = 'da4a0000-0000-4000-8000-000000000002'::uuid
      and artifact_key = 'ranking_weights'
  $$,
  '23514', null,
  'promotion history cannot be updated in place'
);

insert into public.decision_cycles (
  id, organization_id, trigger_name, correlation_id, slot_budget, max_scored_candidates
)
values (
  'da4a0000-0000-4000-8000-000000000008'::uuid,
  'da4a0000-0000-4000-8000-000000000002'::uuid,
  'focused_test', 'da4a0000-0000-4000-8000-000000000009'::uuid, 1, 5
);

create temporary table decision_aggregate_fixtures (kind text primary key, payload jsonb not null);

insert into decision_aggregate_fixtures (kind, payload)
values (
  'selected',
  jsonb_build_object(
    'record', jsonb_build_object(
      'decisionCycleId', 'da4a0000-0000-4000-8000-000000000008',
      'organizationId', 'da4a0000-0000-4000-8000-000000000002',
      'correlationId', 'da4a0000-0000-4000-8000-000000000009',
      'outcome', 'action_selected', 'reason', null,
      'selectedCandidateFingerprint', repeat('a', 64),
      'opportunityId', 'da4a0000-0000-4000-8000-000000000010',
      'rejectionHistogram', jsonb_build_object('stale_inputs', 2),
      'screenedCount', 1, 'scoredCount', 1, 'inputsDigest', repeat('b', 64),
      'versionTuple', jsonb_build_object(
        'policyVersionId', 'da4a0000-0000-4000-8000-000000000003',
        'playbookVersionId', 'da4a0000-0000-4000-8000-000000000005',
        'rankingWeightsId', 'da4a0000-0000-4000-8000-000000000006',
        'confidenceCalibrationId', 'da4a0000-0000-4000-8000-000000000007'
      ),
      'propensity', 1, 'isExploration', false
    ),
    'candidates', jsonb_build_array(jsonb_build_object(
      'playbookVersionId', 'da4a0000-0000-4000-8000-000000000005',
      'candidateFingerprint', repeat('a', 64), 'subjectKind', 'branch',
      'subjectRef', 'branch-1', 'parameterDigest', repeat('c', 64),
      'impactLowMinor', 100, 'impactHighMinor', 200, 'confidence', 0.5,
      'executionCostMinor', 25, 'expectedContributionMinor', 50, 'currency', 'AED',
      'evidenceTier', 'computed', 'eligibilityResult', '{"eligible":true}'::jsonb,
      'policyResult', '{"admitted":true}'::jsonb, 'rejectionReason', null, 'rank', 1
    )),
    'opportunity', jsonb_build_object(
      'id', 'da4a0000-0000-4000-8000-000000000010',
      'playbookVersionId', 'da4a0000-0000-4000-8000-000000000005',
      'candidateFingerprint', repeat('a', 64), 'title', 'Focused opportunity',
      'summary', 'Proves the aggregate write.', 'hypothesis', 'The fixture should persist.',
      'subjectKind', 'branch', 'subjectRef', 'branch-1',
      'evidenceBundle', '{"sourceIds":["metric-1"]}'::jsonb,
      'assumptions', '["inventory remains available"]'::jsonb,
      'impactLowMinor', 100, 'impactHighMinor', 200, 'confidence', 0.5,
      'confidenceRationale', 'Seeded deterministic calibration', 'evidenceTier', 'computed',
      'executionCostMinor', 25, 'expectedContributionMinor', 50, 'currency', 'AED',
      'timeToImpactDays', 7, 'riskTier', 1, 'approvalPath', 'human_approval',
      'guardrails', '[]'::jsonb,
      'assertions', '[{"key":"budget_available","expectedOutcome":"pass"}]'::jsonb,
      'evaluationPlan', '{"primaryMetricKey":"testing.metric"}'::jsonb,
      'expiresAt', '2027-01-01T00:00:00.000Z', 'status', 'proposed'
    )
  )
);

select extensions.lives_ok(
  $$
    select public.persist_decision_aggregate(
      'da4a0000-0000-4000-8000-000000000002'::uuid,
      payload
    )
    from decision_aggregate_fixtures where kind = 'selected'
  $$,
  'a complete selected aggregate persists atomically'
);

select extensions.is(
  (select count(*)::bigint from public.decision_records where organization_id = 'da4a0000-0000-4000-8000-000000000002'::uuid),
  1::bigint,
  'the selected aggregate writes one record'
);
select extensions.is(
  (select count(*)::bigint from public.decision_candidates where organization_id = 'da4a0000-0000-4000-8000-000000000002'::uuid),
  1::bigint,
  'the selected aggregate writes every scored candidate'
);
select extensions.is(
  (select count(*)::bigint from public.opportunities where organization_id = 'da4a0000-0000-4000-8000-000000000002'::uuid),
  1::bigint,
  'the selected aggregate writes exactly one opportunity'
);
select extensions.is(
  (
    select row(rejection_histogram, screened_count, scored_count, inputs_digest)::text
    from public.decision_records
    where organization_id = 'da4a0000-0000-4000-8000-000000000002'::uuid
  ),
  row('{"stale_inputs": 2}'::jsonb, 1, 1, repeat('b', 64))::text,
  'record values map to the intended columns'
);
select extensions.is(
  (
    select row(impact_low_minor, impact_high_minor, confidence, execution_cost_minor,
      expected_contribution_minor, currency, rank)::text
    from public.decision_candidates
    where organization_id = 'da4a0000-0000-4000-8000-000000000002'::uuid
  ),
  row(100::bigint, 200::bigint, 0.5000::numeric(5,4), 25::bigint, 50::bigint, 'AED', 1)::text,
  'candidate values map to the intended columns'
);

select extensions.lives_ok(
  $$
    select public.persist_decision_aggregate(
      'da4a0000-0000-4000-8000-000000000002'::uuid,
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                (select payload from decision_aggregate_fixtures where kind = 'selected'),
                '{record,outcome}', '"no_action"'::jsonb
              ),
              '{record,reason}', '"policy_removed_all"'::jsonb
            ),
            '{record,selectedCandidateFingerprint}', 'null'::jsonb
          ),
          '{record,opportunityId}', 'null'::jsonb
        ),
        '{opportunity}', 'null'::jsonb
      )
    )
  $$,
  'a no_action aggregate persists without an opportunity'
);
select extensions.is(
  (select count(*)::bigint from public.opportunities where organization_id = 'da4a0000-0000-4000-8000-000000000002'::uuid),
  1::bigint,
  'no_action does not add an opportunity'
);

select extensions.throws_ok(
  $$
    select public.persist_decision_aggregate(
      'da4a0000-0000-4000-8000-000000000002'::uuid,
      jsonb_set(
        (select payload from decision_aggregate_fixtures where kind = 'selected'),
        '{candidates,0,modelScore}', '0.99'::jsonb
      )
    )
  $$,
  '22023', null,
  'an unknown candidate field rejects the aggregate'
);
select extensions.throws_ok(
  $$
    select public.persist_decision_aggregate(
      'da4a0000-0000-4000-8000-000000000002'::uuid,
      jsonb_set(
        (select payload from decision_aggregate_fixtures where kind = 'selected'),
        '{record,versionTuple,rankingWeightsId}',
        '"da4a0000-0000-4000-8000-000000000007"'::jsonb
      )
    )
  $$,
  '42501', null,
  'an artifact id with the wrong semantic key rejects the aggregate'
);

select extensions.throws_ok(
  $$
    select public.persist_decision_aggregate(
      'da4a0000-0000-4000-8000-000000000002'::uuid,
      jsonb_set(
        (select payload from decision_aggregate_fixtures where kind = 'selected'),
        '{record,opportunityId}', '"da4a0000-0000-4000-8000-000000000011"'::jsonb
      )
    )
  $$,
  '22023', null,
  'a mismatched opportunity id rejects the aggregate'
);
select extensions.is(
  (select count(*)::bigint from public.decision_records where organization_id = 'da4a0000-0000-4000-8000-000000000002'::uuid),
  2::bigint,
  'a rejected aggregate leaves no partial record'
);
select extensions.is(
  (select count(*)::bigint from public.decision_candidates where organization_id = 'da4a0000-0000-4000-8000-000000000002'::uuid),
  2::bigint,
  'a rejected aggregate leaves no partial candidate'
);
select extensions.is(
  (select count(*)::bigint from public.opportunities where organization_id = 'da4a0000-0000-4000-8000-000000000002'::uuid),
  1::bigint,
  'a rejected aggregate leaves no partial opportunity'
);

select * from extensions.finish();

rollback;
