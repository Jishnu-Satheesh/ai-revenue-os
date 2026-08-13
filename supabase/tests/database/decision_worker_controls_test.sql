begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(47);

insert into auth.users (id)
values ('dc4c0000-0000-4000-8000-000000000001'::uuid);

insert into public.organizations (
  id, name, slug, industry, country_code, base_currency, default_timezone, created_by
)
values
  (
    'dc4c0000-0000-4000-8000-000000000101'::uuid,
    'Decision controls one', 'decision-controls-one', 'testing', 'AE', 'AED',
    'Asia/Dubai', 'dc4c0000-0000-4000-8000-000000000001'::uuid
  ),
  (
    'dc4c0000-0000-4000-8000-000000000102'::uuid,
    'Decision controls two', 'decision-controls-two', 'testing', 'AE', 'AED',
    'Asia/Dubai', 'dc4c0000-0000-4000-8000-000000000001'::uuid
  );

insert into public.policies (
  id, organization_id, policy_type, name, mode, version, is_active
)
values (
  'dc4c0000-0000-4000-8000-000000000201'::uuid,
  'dc4c0000-0000-4000-8000-000000000101'::uuid,
  'approval', 'Decision controls', 'approval_required', 1, true
);

insert into public.playbook_definitions (
  id, organization_id, key, name, owner_scope, business_objective
)
values
  (
    'dc4c0000-0000-4000-8000-000000000401'::uuid,
    'dc4c0000-0000-4000-8000-000000000101'::uuid,
    'testing.controls_one', 'Controls one', 'organization', 'Test active tuple controls'
  ),
  (
    'dc4c0000-0000-4000-8000-000000000402'::uuid,
    'dc4c0000-0000-4000-8000-000000000102'::uuid,
    'testing.controls_two', 'Controls two', 'organization', 'Test tenant controls'
  );

insert into public.playbook_versions (
  id, organization_id, playbook_definition_id, semantic_version, hypothesis_template,
  action_definition, risk_class, primary_metric_key, measurement_window_days, is_active
)
values
  (
    'dc4c0000-0000-4000-8000-000000000501'::uuid,
    'dc4c0000-0000-4000-8000-000000000101'::uuid,
    'dc4c0000-0000-4000-8000-000000000401'::uuid,
    E'1\\x0\\x0', 'Active test hypothesis', '{"action":"active"}'::jsonb,
    1, 'testing.metric', 7, true
  ),
  (
    'dc4c0000-0000-4000-8000-000000000511'::uuid,
    'dc4c0000-0000-4000-8000-000000000101'::uuid,
    'dc4c0000-0000-4000-8000-000000000401'::uuid,
    E'2\\x0\\x0', 'Inactive test hypothesis', '{"action":"inactive"}'::jsonb,
    1, 'testing.metric', 7, false
  ),
  (
    'dc4c0000-0000-4000-8000-000000000502'::uuid,
    'dc4c0000-0000-4000-8000-000000000102'::uuid,
    'dc4c0000-0000-4000-8000-000000000402'::uuid,
    E'1\\x0\\x0', 'Other tenant hypothesis', '{"action":"other"}'::jsonb,
    1, 'testing.metric', 7, true
  );

insert into public.artifact_versions (
  id, organization_id, artifact_key, version, basis, authored_by, implementation_key
)
values
  (
    'dc4c0000-0000-4000-8000-000000000301'::uuid,
    'dc4c0000-0000-4000-8000-000000000101'::uuid,
    'ranking_weights', 'controls-ranking-v1', 'Worker controls fixture', 'test',
    'decision.ranking.evidence_value_time_v1'
  ),
  (
    'dc4c0000-0000-4000-8000-000000000302'::uuid,
    'dc4c0000-0000-4000-8000-000000000101'::uuid,
    'confidence_calibration', 'controls-confidence-v1', 'Worker controls fixture', 'test',
    'decision.confidence.computed_baseline_v1'
  ),
  (
    'dc4c0000-0000-4000-8000-000000000303'::uuid,
    'dc4c0000-0000-4000-8000-000000000101'::uuid,
    'prompt', 'controls-prompt-v1', 'Worker controls fixture', 'test', null
  ),
  (
    'dc4c0000-0000-4000-8000-000000000321'::uuid,
    'dc4c0000-0000-4000-8000-000000000102'::uuid,
    'ranking_weights', 'controls-ranking-v1', 'Other tenant fixture', 'test',
    'decision.ranking.evidence_value_time_v1'
  );

create temporary table decision_control_state (
  artifact_key text primary key,
  baseline_id uuid not null
);

insert into decision_control_state (artifact_key, baseline_id)
select artifact_key, active_artifact_version_id
from private.current_artifact_promotions
where organization_id = 'dc4c0000-0000-4000-8000-000000000101'::uuid;

grant select on decision_control_state to service_role;

-- Manual append-only artifact promotion -------------------------------------

select extensions.function_privs_are(
  'public', 'promote_decision_artifact', array['uuid', 'jsonb'], 'service_role',
  array['EXECUTE'], 'service role can execute manual artifact promotion'
);
select extensions.function_privs_are(
  'public', 'promote_decision_artifact', array['uuid', 'jsonb'], 'authenticated',
  array[]::text[], 'authenticated cannot execute artifact promotion'
);
select extensions.function_privs_are(
  'public', 'promote_decision_artifact', array['uuid', 'jsonb'], 'anon',
  array[]::text[], 'anonymous cannot execute artifact promotion'
);

set local role service_role;

select extensions.lives_ok(
  $$
    select public.promote_decision_artifact(
      'dc4c0000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', 'dc4c0000-0000-4000-8000-000000000101',
        'artifact_key', 'ranking_weights',
        'artifact_version_id', 'dc4c0000-0000-4000-8000-000000000301',
        'expected_current_artifact_version_id', baseline_id,
        'promoted_by', 'manual-review'
      )
    )
    from decision_control_state where artifact_key = 'ranking_weights'
  $$,
  'service role promotes a successor through the validated RPC'
);

reset role;

select extensions.is(
  (
    select count(*)::bigint from public.artifact_promotions
    where organization_id = 'dc4c0000-0000-4000-8000-000000000101'::uuid
      and artifact_key = 'ranking_weights'
  ),
  2::bigint,
  'successor promotion appends rather than replaces history'
);
select extensions.is(
  (
    select active_artifact_version_id from private.current_artifact_promotions
    where organization_id = 'dc4c0000-0000-4000-8000-000000000101'::uuid
      and artifact_key = 'ranking_weights'
  ),
  'dc4c0000-0000-4000-8000-000000000301'::uuid,
  'successor becomes the current ranking artifact'
);
select extensions.is(
  (
    select rollback_artifact_version_id from private.current_artifact_promotions
    where organization_id = 'dc4c0000-0000-4000-8000-000000000101'::uuid
      and artifact_key = 'ranking_weights'
  ),
  (select baseline_id from decision_control_state where artifact_key = 'ranking_weights'),
  'successor records the previously current version as rollback pointer'
);

set local role service_role;

select extensions.throws_ok(
  $$
    select public.promote_decision_artifact(
      'dc4c0000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', 'dc4c0000-0000-4000-8000-000000000101',
        'artifact_key', 'ranking_weights',
        'artifact_version_id', 'dc4c0000-0000-4000-8000-000000000301',
        'expected_current_artifact_version_id', baseline_id,
        'promoted_by', 'stale-worker'
      )
    ) from decision_control_state where artifact_key = 'ranking_weights'
  $$,
  '40001', null,
  'a stale expected-current version rejects concurrent promotion'
);

reset role;

select extensions.is(
  (
    select count(*)::bigint from public.artifact_promotions
    where organization_id = 'dc4c0000-0000-4000-8000-000000000101'::uuid
      and artifact_key = 'ranking_weights'
  ),
  2::bigint,
  'stale promotion leaves history unchanged'
);

set local role service_role;

select extensions.throws_ok(
  $$select public.promote_decision_artifact(
    'dc4c0000-0000-4000-8000-000000000101'::uuid,
    jsonb_build_object(
      'organization_id', 'dc4c0000-0000-4000-8000-000000000101',
      'artifact_key', 'ranking_weights',
      'artifact_version_id', 'dc4c0000-0000-4000-8000-000000000321',
      'expected_current_artifact_version_id', 'dc4c0000-0000-4000-8000-000000000301',
      'promoted_by', 'cross-tenant'
    )
  )$$,
  '42501', null,
  'promotion rejects a cross-organization artifact version'
);
select extensions.throws_ok(
  $$select public.promote_decision_artifact(
    'dc4c0000-0000-4000-8000-000000000101'::uuid,
    jsonb_build_object(
      'organization_id', 'dc4c0000-0000-4000-8000-000000000101',
      'artifact_key', 'ranking_weights',
      'artifact_version_id', 'dc4c0000-0000-4000-8000-000000000302',
      'expected_current_artifact_version_id', 'dc4c0000-0000-4000-8000-000000000301',
      'promoted_by', 'semantic-mismatch'
    )
  )$$,
  '42501', null,
  'promotion rejects an artifact with the wrong semantic key'
);
select extensions.throws_ok(
  $$select public.promote_decision_artifact(
    'dc4c0000-0000-4000-8000-000000000101'::uuid,
    jsonb_build_object(
      'organization_id', 'dc4c0000-0000-4000-8000-000000000101',
      'artifact_key', 'ranking_weights',
      'artifact_version_id', 'dc4c0000-0000-4000-8000-000000000301',
      'expected_current_artifact_version_id', 'dc4c0000-0000-4000-8000-000000000301',
      'promoted_by', 'unknown-field', 'optimizer_score', 1
    )
  )$$,
  '22023', null,
  'promotion rejects unknown input keys'
);
select extensions.throws_ok(
  $$select public.promote_decision_artifact(
    'dc4c0000-0000-4000-8000-000000000101'::uuid,
    jsonb_build_object(
      'organization_id', 'dc4c0000-0000-4000-8000-000000000101',
      'artifact_key', 'ranking_weights',
      'artifact_version_id', 'dc4c0000-0000-4000-8000-000000000301',
      'expected_current_artifact_version_id', null,
      'promoted_by', 'null-field'
    )
  )$$,
  '22023', null,
  'promotion rejects JSON null required fields'
);
select extensions.lives_ok(
  $$
    select public.promote_decision_artifact(
      'dc4c0000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', 'dc4c0000-0000-4000-8000-000000000101',
        'artifact_key', 'ranking_weights',
        'artifact_version_id', baseline_id,
        'expected_current_artifact_version_id', 'dc4c0000-0000-4000-8000-000000000301',
        'promoted_by', 'manual-rollback'
      )
    )
    from decision_control_state where artifact_key = 'ranking_weights'
  $$,
  'rolling back appends a new promotion entry'
);

reset role;

select extensions.is(
  (
    select count(*)::bigint from public.artifact_promotions
    where organization_id = 'dc4c0000-0000-4000-8000-000000000101'::uuid
      and artifact_key = 'ranking_weights'
  ),
  3::bigint,
  'rollback retains both earlier promotion entries'
);
select extensions.is(
  (
    select active_artifact_version_id from private.current_artifact_promotions
    where organization_id = 'dc4c0000-0000-4000-8000-000000000101'::uuid
      and artifact_key = 'ranking_weights'
  ),
  (select baseline_id from decision_control_state where artifact_key = 'ranking_weights'),
  'rollback makes the prior artifact current again'
);
select extensions.is(
  (
    select rollback_artifact_version_id from private.current_artifact_promotions
    where organization_id = 'dc4c0000-0000-4000-8000-000000000101'::uuid
      and artifact_key = 'ranking_weights'
  ),
  'dc4c0000-0000-4000-8000-000000000301'::uuid,
  'rollback entry points back to the version that was current immediately before it'
);
select extensions.throws_ok(
  $$update public.artifact_promotions set promoted_by = 'rewritten'
    where organization_id = 'dc4c0000-0000-4000-8000-000000000101'::uuid$$,
  '23514', null,
  'promotion history remains append-only'
);

-- Strict cycle creation ------------------------------------------------------

select extensions.function_privs_are(
  'public', 'start_decision_cycle', array['uuid', 'jsonb'], 'service_role',
  array[]::text[], 'service role cannot execute unfenced cycle creation'
);

reset role;

select extensions.lives_ok(
  $$select public.start_decision_cycle(
    'dc4c0000-0000-4000-8000-000000000101'::uuid,
    '{
      "id":"dc4c0000-0000-4000-8000-000000000601",
      "organization_id":"dc4c0000-0000-4000-8000-000000000101",
      "trigger_name":"scheduled evaluation",
      "correlation_id":"dc4c0000-0000-4000-8000-000000000701",
      "slot_budget":10,
      "max_scored_candidates":500
    }'::jsonb
  )$$,
  'the legacy cycle contract still validates a strictly shaped bounded cycle'
);

reset role;

select extensions.is(
  (
    select row(trigger_name, correlation_id, slot_budget, max_scored_candidates)::text
    from public.decision_cycles
    where id = 'dc4c0000-0000-4000-8000-000000000601'::uuid
  ),
  row(
    'scheduled evaluation',
    'dc4c0000-0000-4000-8000-000000000701'::uuid,
    10,
    500
  )::text,
  'cycle input maps to the intended columns'
);

reset role;

select extensions.throws_ok(
  $$select public.start_decision_cycle(
    'dc4c0000-0000-4000-8000-000000000101'::uuid,
    '{"organization_id":"dc4c0000-0000-4000-8000-000000000101","trigger_name":"unknown","correlation_id":"dc4c0000-0000-4000-8000-000000000702","slot_budget":1,"max_scored_candidates":1,"unknown":true}'::jsonb
  )$$,
  '22023', null,
  'cycle creation rejects unknown keys'
);
select extensions.throws_ok(
  $$select public.start_decision_cycle(
    'dc4c0000-0000-4000-8000-000000000101'::uuid,
    '{"id":null,"organization_id":"dc4c0000-0000-4000-8000-000000000101","trigger_name":"null id","correlation_id":"dc4c0000-0000-4000-8000-000000000703","slot_budget":1,"max_scored_candidates":1}'::jsonb
  )$$,
  '22023', null,
  'cycle creation rejects a JSON null optional id'
);
select extensions.throws_ok(
  $$select public.start_decision_cycle(
    'dc4c0000-0000-4000-8000-000000000101'::uuid,
    jsonb_build_object('organization_id','dc4c0000-0000-4000-8000-000000000101','trigger_name',repeat('x',161),'correlation_id','dc4c0000-0000-4000-8000-000000000704','slot_budget',1,'max_scored_candidates',1)
  )$$,
  '22023', null,
  'cycle creation rejects an oversized trigger name'
);
select extensions.throws_ok(
  $$select public.start_decision_cycle(
    'dc4c0000-0000-4000-8000-000000000101'::uuid,
    '{"organization_id":"dc4c0000-0000-4000-8000-000000000101","trigger_name":"negative","correlation_id":"dc4c0000-0000-4000-8000-000000000705","slot_budget":-1,"max_scored_candidates":1}'::jsonb
  )$$,
  '22023', null,
  'cycle creation rejects a negative slot budget'
);
select extensions.throws_ok(
  $$select public.start_decision_cycle(
    'dc4c0000-0000-4000-8000-000000000101'::uuid,
    '{"organization_id":"dc4c0000-0000-4000-8000-000000000101","trigger_name":"too many slots","correlation_id":"dc4c0000-0000-4000-8000-000000000706","slot_budget":101,"max_scored_candidates":1}'::jsonb
  )$$,
  '22023', null,
  'cycle creation enforces the operational slot-budget ceiling'
);
select extensions.throws_ok(
  $$select public.start_decision_cycle(
    'dc4c0000-0000-4000-8000-000000000101'::uuid,
    '{"organization_id":"dc4c0000-0000-4000-8000-000000000101","trigger_name":"too many candidates","correlation_id":"dc4c0000-0000-4000-8000-000000000707","slot_budget":1,"max_scored_candidates":501}'::jsonb
  )$$,
  '22023', null,
  'cycle creation enforces the aggregate candidate ceiling'
);
select extensions.throws_ok(
  $$select public.start_decision_cycle(
    'dc4c0000-0000-4000-8000-000000000102'::uuid,
    '{"organization_id":"dc4c0000-0000-4000-8000-000000000101","trigger_name":"wrong tenant","correlation_id":"dc4c0000-0000-4000-8000-000000000708","slot_budget":1,"max_scored_candidates":1}'::jsonb
  )$$,
  '42501', null,
  'cycle creation rejects a target-organization mismatch'
);

reset role;

select extensions.is(
  (
    select count(*)::bigint from public.decision_cycles
    where organization_id = 'dc4c0000-0000-4000-8000-000000000101'::uuid
  ),
  1::bigint,
  'invalid cycle inputs leave no partial rows'
);

set local role authenticated;
select extensions.throws_ok(
  $$select public.start_decision_cycle(null, '{}'::jsonb)$$,
  '42501', null,
  'authenticated cannot start cycles'
);
select extensions.throws_ok(
  $$select public.promote_decision_artifact(null, '{}'::jsonb)$$,
  '42501', null,
  'authenticated cannot promote artifacts'
);
reset role;

set local role anon;
select extensions.throws_ok(
  $$select public.start_decision_cycle(null, '{}'::jsonb)$$,
  '42501', null,
  'anonymous cannot start cycles'
);
select extensions.throws_ok(
  $$select public.promote_decision_artifact(null, '{}'::jsonb)$$,
  '42501', null,
  'anonymous cannot promote artifacts'
);
reset role;

-- Only currently-in-force tuple members may be recorded ---------------------

create temporary table decision_control_aggregates (kind text primary key, payload jsonb not null);

insert into decision_control_aggregates (kind, payload)
select
  'current',
  jsonb_build_object(
    'record', jsonb_build_object(
      'decisionCycleId', 'dc4c0000-0000-4000-8000-000000000601',
      'organizationId', 'dc4c0000-0000-4000-8000-000000000101',
      'correlationId', 'dc4c0000-0000-4000-8000-000000000701',
      'outcome', 'no_action', 'reason', 'policy_removed_all',
      'selectedCandidateFingerprint', null, 'opportunityId', null,
      'rejectionHistogram', '{}'::jsonb, 'screenedCount', 0, 'scoredCount', 0,
      'inputsDigest', repeat('a',64),
      'versionTuple', jsonb_build_object(
        'policyVersionId', 'dc4c0000-0000-4000-8000-000000000201',
        'playbookVersionId', 'dc4c0000-0000-4000-8000-000000000501',
        'rankingWeightsId', ranking.baseline_id,
        'confidenceCalibrationId', confidence.baseline_id
      ),
      'propensity', 1, 'isExploration', false
    ),
    'candidates', '[]'::jsonb,
    'opportunity', null
  )
from decision_control_state ranking
cross join decision_control_state confidence
where ranking.artifact_key = 'ranking_weights'
  and confidence.artifact_key = 'confidence_calibration';

grant select on decision_control_aggregates to service_role;

reset role;

select extensions.lives_ok(
  $$select public.persist_decision_aggregate(
    'dc4c0000-0000-4000-8000-000000000101'::uuid,
    payload
  ) from decision_control_aggregates where kind = 'current'$$,
  'an aggregate accepts the currently active playbook and artifacts'
);
select extensions.throws_ok(
  $$select public.persist_decision_aggregate(
    'dc4c0000-0000-4000-8000-000000000101'::uuid,
    jsonb_set(payload, '{record,versionTuple,playbookVersionId}', '"dc4c0000-0000-4000-8000-000000000511"'::jsonb)
  ) from decision_control_aggregates where kind = 'current'$$,
  '42501', null,
  'an inactive playbook version is rejected'
);
select extensions.throws_ok(
  $$select public.persist_decision_aggregate(
    'dc4c0000-0000-4000-8000-000000000101'::uuid,
    jsonb_set(payload, '{record,versionTuple,rankingWeightsId}', '"dc4c0000-0000-4000-8000-000000000301"'::jsonb)
  ) from decision_control_aggregates where kind = 'current'$$,
  '42501', null,
  'an unpromoted ranking artifact is rejected'
);
select extensions.throws_ok(
  $$select public.persist_decision_aggregate(
    'dc4c0000-0000-4000-8000-000000000101'::uuid,
    jsonb_set(payload, '{record,versionTuple,confidenceCalibrationId}', '"dc4c0000-0000-4000-8000-000000000302"'::jsonb)
  ) from decision_control_aggregates where kind = 'current'$$,
  '42501', null,
  'an unpromoted confidence artifact is rejected'
);

reset role;

select extensions.is(
  (
    select count(*)::bigint from public.decision_records
    where organization_id = 'dc4c0000-0000-4000-8000-000000000101'::uuid
  ),
  1::bigint,
  'inactive and historical tuple failures write no partial records'
);
select extensions.is(
  (
    select count(*)::bigint from public.decision_candidates
    where organization_id = 'dc4c0000-0000-4000-8000-000000000101'::uuid
  ),
  0::bigint,
  'inactive and historical tuple failures write no candidates'
);
select extensions.is(
  (
    select count(*)::bigint from public.opportunities
    where organization_id = 'dc4c0000-0000-4000-8000-000000000101'::uuid
  ),
  0::bigint,
  'inactive and historical tuple failures write no opportunities'
);

set local role service_role;

select extensions.lives_ok(
  $$
    select public.promote_decision_artifact(
      'dc4c0000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', 'dc4c0000-0000-4000-8000-000000000101',
        'artifact_key', 'ranking_weights',
        'artifact_version_id', 'dc4c0000-0000-4000-8000-000000000301',
        'expected_current_artifact_version_id', baseline_id,
        'promoted_by', 'manual-review'
      )
    ) from decision_control_state where artifact_key = 'ranking_weights'
  $$,
  'a reviewed ranking artifact can be promoted again after rollback'
);

reset role;

select extensions.lives_ok(
  $$select public.persist_decision_aggregate(
    'dc4c0000-0000-4000-8000-000000000101'::uuid,
    jsonb_set(payload, '{record,versionTuple,rankingWeightsId}', '"dc4c0000-0000-4000-8000-000000000301"'::jsonb)
  ) from decision_control_aggregates where kind = 'current'$$,
  'an aggregate accepts a newly promoted current artifact'
);
select extensions.lives_ok(
  $$
    select public.persist_decision_aggregate(
      'dc4c0000-0000-4000-8000-000000000101'::uuid,
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(payload, '{record,versionTuple,rankingWeightsId}', '"dc4c0000-0000-4000-8000-000000000301"'::jsonb),
            '{record,versionTuple,promptVersionId}', to_jsonb(prompt.baseline_id::text)
          ),
          '{record,versionTuple,modelId}', to_jsonb(model.baseline_id::text)
        ),
        '{record,versionTuple,judgeVersionId}', to_jsonb(judge.baseline_id::text)
      )
    )
    from decision_control_aggregates aggregate
    cross join decision_control_state prompt
    cross join decision_control_state model
    cross join decision_control_state judge
    where aggregate.kind = 'current'
      and prompt.artifact_key = 'prompt'
      and model.artifact_key = 'model'
      and judge.artifact_key = 'judge'
  $$,
  'an aggregate accepts supplied prompt model and judge only when each is current'
);
select extensions.throws_ok(
  $$
    select public.persist_decision_aggregate(
      'dc4c0000-0000-4000-8000-000000000101'::uuid,
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(payload, '{record,versionTuple,rankingWeightsId}', '"dc4c0000-0000-4000-8000-000000000301"'::jsonb),
            '{record,versionTuple,promptVersionId}', '"dc4c0000-0000-4000-8000-000000000303"'::jsonb
          ),
          '{record,versionTuple,modelId}', to_jsonb(model.baseline_id::text)
        ),
        '{record,versionTuple,judgeVersionId}', to_jsonb(judge.baseline_id::text)
      )
    )
    from decision_control_aggregates aggregate
    cross join decision_control_state model
    cross join decision_control_state judge
    where aggregate.kind = 'current'
      and model.artifact_key = 'model'
      and judge.artifact_key = 'judge'
  $$,
  '42501', null,
  'an unpromoted optional prompt artifact is rejected atomically'
);

reset role;

select extensions.is(
  (
    select count(*)::bigint from public.decision_records
    where organization_id = 'dc4c0000-0000-4000-8000-000000000101'::uuid
  ),
  3::bigint,
  'only aggregates with currently-in-force tuples persist'
);
select extensions.is(
  (
    select count(*)::bigint from public.decision_candidates
    where organization_id = 'dc4c0000-0000-4000-8000-000000000101'::uuid
  ),
  0::bigint,
  'tuple rejection remains atomic for candidates'
);
select extensions.is(
  (
    select count(*)::bigint from public.opportunities
    where organization_id = 'dc4c0000-0000-4000-8000-000000000101'::uuid
  ),
  0::bigint,
  'tuple rejection remains atomic for opportunities'
);

select * from extensions.finish();

rollback;
