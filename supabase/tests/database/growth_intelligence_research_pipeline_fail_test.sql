begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(33);

-- Contract and grants ----------------------------------------------------------
-- The 8-argument overload settles run + request + pipeline atomically. The
-- legacy 6-argument overload is left untouched for already-deployed callers.

select extensions.has_function(
  'public', 'fail_market_research_pipeline',
  array['uuid', 'uuid', 'uuid', 'uuid', 'uuid', 'text', 'bigint', 'integer'],
  'a failed research run settles its bound pipeline through one governed RPC'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.fail_market_research_pipeline(uuid,uuid,uuid,uuid,uuid,text,bigint,integer)',
    'execute'
  ),
  'workers may fail a bound research pipeline'
);
select extensions.ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'public.fail_market_research_pipeline(uuid,uuid,uuid,uuid,uuid,text,bigint,integer)',
    'execute'
  ),
  'browser sessions cannot fail a research pipeline directly'
);
select extensions.ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.fail_market_research_pipeline(uuid,uuid,uuid,uuid,uuid,text,bigint,integer)',
    'execute'
  ),
  'anonymous callers cannot fail a research pipeline'
);

-- Fixtures ---------------------------------------------------------------------

insert into auth.users (id) values
  ('f1000000-0000-4000-8000-000000000001'::uuid);

insert into public.accounts (id, name, slug, created_by) values
  ('f1000000-0000-4000-8000-000000000101'::uuid, 'Pipeline fail agency', 'pipeline-fail-agency', 'f1000000-0000-4000-8000-000000000001'::uuid);

insert into public.organizations (
  id, account_id, name, slug, industry, country_code, base_currency,
  default_timezone, created_by
) values
  ('f1000000-0000-4000-8000-000000000201'::uuid, 'f1000000-0000-4000-8000-000000000101'::uuid, 'Pipeline fail client', 'pipeline-fail-client', 'testing', 'AE', 'AED', 'Asia/Dubai', 'f1000000-0000-4000-8000-000000000001'::uuid);

insert into public.account_memberships (
  account_id, user_id, account_role, default_organization_role
) values
  ('f1000000-0000-4000-8000-000000000101'::uuid, 'f1000000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner');

insert into public.branches (
  id, organization_id, name, slug, kind, timezone, currency, is_active
) values
  ('f1000000-0000-4000-8000-000000000301'::uuid, 'f1000000-0000-4000-8000-000000000201'::uuid, 'Fail Wharf', 'fail-wharf', 'physical', 'Asia/Dubai', 'AED', true),
  ('f1000000-0000-4000-8000-000000000302'::uuid, 'f1000000-0000-4000-8000-000000000201'::uuid, 'Fail Quay', 'fail-quay', 'physical', 'Asia/Dubai', 'AED', true),
  ('f1000000-0000-4000-8000-000000000303'::uuid, 'f1000000-0000-4000-8000-000000000201'::uuid, 'Fail Pier', 'fail-pier', 'physical', 'Asia/Dubai', 'AED', true),
  ('f1000000-0000-4000-8000-000000000304'::uuid, 'f1000000-0000-4000-8000-000000000201'::uuid, 'Fail Jetty', 'fail-jetty', 'physical', 'Asia/Dubai', 'AED', true),
  ('f1000000-0000-4000-8000-000000000305'::uuid, 'f1000000-0000-4000-8000-000000000201'::uuid, 'Fail Dock', 'fail-dock', 'physical', 'Asia/Dubai', 'AED', true);

insert into public.organization_market_profiles (id, organization_id, branch_id)
values ('f1000000-0000-4000-8000-000000000401'::uuid, 'f1000000-0000-4000-8000-000000000201'::uuid, 'f1000000-0000-4000-8000-000000000301'::uuid);

insert into public.organization_market_profile_versions (
  id, organization_id, market_profile_id, version, schema_version,
  profile_document, profile_digest, source_policy_digest, proposal_source,
  created_by, correlation_id
) values
  ('f1000000-0000-4000-8000-000000000402'::uuid, 'f1000000-0000-4000-8000-000000000201'::uuid, 'f1000000-0000-4000-8000-000000000401'::uuid, 1, 2,
  '{"schemaVersion":2}'::jsonb,
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'operator',
  'f1000000-0000-4000-8000-000000000001'::uuid,
  'f1000000-0000-4000-8000-000000000701'::uuid);

update public.organization_market_profiles profile
set current_version_id = 'f1000000-0000-4000-8000-000000000402'::uuid, enabled = true
where profile.organization_id = 'f1000000-0000-4000-8000-000000000201'::uuid
  and profile.branch_id = 'f1000000-0000-4000-8000-000000000301'::uuid;

-- Live pipeline: queued pipeline with a claimed research request -------------

insert into public.growth_intelligence_research_pipelines (
  id, organization_id, branch_id, market_profile_id, market_profile_version_id,
  scope_digest, stage
) values
  ('f1000000-0000-4000-8000-000000000501'::uuid, 'f1000000-0000-4000-8000-000000000201'::uuid, 'f1000000-0000-4000-8000-000000000301'::uuid, 'f1000000-0000-4000-8000-000000000401'::uuid, 'f1000000-0000-4000-8000-000000000402'::uuid,
  'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', 'queued');

insert into public.growth_intelligence_requests (
  id, organization_id, branch_id, kind, trigger_reason, request_fingerprint,
  market_profile_version_id, source_policy_digest, research_rule_version,
  local_time_bucket, status, due_at, claim_token, lease_expires_at,
  correlation_id, pipeline_id, phase
) values
  ('f1000000-0000-4000-8000-000000000502'::uuid, 'f1000000-0000-4000-8000-000000000201'::uuid, 'f1000000-0000-4000-8000-000000000301'::uuid, 'market_research', 'profile_confirmed',
  'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  'f1000000-0000-4000-8000-000000000402'::uuid,
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'market-research@1', 'immediate', 'claimed', pg_catalog.now() - interval '1 hour',
  'f1000000-0000-4000-8000-000000000601'::uuid, pg_catalog.now() + interval '10 minutes',
  'f1000000-0000-4000-8000-000000000702'::uuid,
  'f1000000-0000-4000-8000-000000000501'::uuid, 'research');

update public.growth_intelligence_research_pipelines pipeline
set research_request_id = 'f1000000-0000-4000-8000-000000000502'::uuid
where pipeline.organization_id = 'f1000000-0000-4000-8000-000000000201'::uuid
  and pipeline.id = 'f1000000-0000-4000-8000-000000000501'::uuid;

-- Stranded pipeline: request already failed, pipeline still queued -----------

insert into public.growth_intelligence_research_pipelines (
  id, organization_id, branch_id, market_profile_id, market_profile_version_id,
  scope_digest, stage, research_request_id
) values
  ('f1000000-0000-4000-8000-000000000503'::uuid, 'f1000000-0000-4000-8000-000000000201'::uuid, 'f1000000-0000-4000-8000-000000000302'::uuid, 'f1000000-0000-4000-8000-000000000401'::uuid, 'f1000000-0000-4000-8000-000000000402'::uuid,
  'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', 'queued',
  'f1000000-0000-4000-8000-000000000504'::uuid);

insert into public.growth_intelligence_requests (
  id, organization_id, branch_id, kind, trigger_reason, request_fingerprint,
  market_profile_version_id, source_policy_digest, research_rule_version,
  local_time_bucket, status, due_at, safe_failure_code, failed_at,
  correlation_id, pipeline_id, phase
) values
  ('f1000000-0000-4000-8000-000000000504'::uuid, 'f1000000-0000-4000-8000-000000000201'::uuid, 'f1000000-0000-4000-8000-000000000302'::uuid, 'market_research', 'profile_confirmed',
  'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
  'f1000000-0000-4000-8000-000000000402'::uuid,
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'market-research@1', 'immediate', 'failed', pg_catalog.now() - interval '2 hours',
  'ADAPTER_UNAVAILABLE', pg_catalog.now() - interval '2 hours',
  'f1000000-0000-4000-8000-000000000703'::uuid,
  'f1000000-0000-4000-8000-000000000503'::uuid, 'research');

-- Guard pipeline: stays queued so fencing checks meet a live row -----------

insert into public.growth_intelligence_research_pipelines (
  id, organization_id, branch_id, market_profile_id, market_profile_version_id,
  scope_digest, stage, research_request_id
) values
  ('f1000000-0000-4000-8000-000000000505'::uuid, 'f1000000-0000-4000-8000-000000000201'::uuid, 'f1000000-0000-4000-8000-000000000303'::uuid, 'f1000000-0000-4000-8000-000000000401'::uuid, 'f1000000-0000-4000-8000-000000000402'::uuid,
  '1212121212121212121212121212121212121212121212121212121212121212', 'queued',
  'f1000000-0000-4000-8000-000000000506'::uuid);

insert into public.growth_intelligence_requests (
  id, organization_id, branch_id, kind, trigger_reason, request_fingerprint,
  market_profile_version_id, source_policy_digest, research_rule_version,
  local_time_bucket, status, due_at, claim_token, lease_expires_at,
  correlation_id, pipeline_id, phase
) values
  ('f1000000-0000-4000-8000-000000000506'::uuid, 'f1000000-0000-4000-8000-000000000201'::uuid, 'f1000000-0000-4000-8000-000000000303'::uuid, 'market_research', 'profile_confirmed',
  '3434343434343434343434343434343434343434343434343434343434343434',
  'f1000000-0000-4000-8000-000000000402'::uuid,
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'market-research@1', 'immediate', 'claimed', pg_catalog.now() - interval '1 hour',
  'f1000000-0000-4000-8000-000000000603'::uuid, pg_catalog.now() + interval '10 minutes',
  'f1000000-0000-4000-8000-000000000704'::uuid,
  'f1000000-0000-4000-8000-000000000505'::uuid, 'research');

-- Bound-run pipeline: claimed request with a running run row --------------
-- This is the canary shape: the worker began a run, then failed. The new
-- overload must settle run + request + pipeline in one call.

insert into public.growth_intelligence_research_pipelines (
  id, organization_id, branch_id, market_profile_id, market_profile_version_id,
  scope_digest, stage
) values
  ('f1000000-0000-4000-8000-000000000507'::uuid, 'f1000000-0000-4000-8000-000000000201'::uuid, 'f1000000-0000-4000-8000-000000000304'::uuid, 'f1000000-0000-4000-8000-000000000401'::uuid, 'f1000000-0000-4000-8000-000000000402'::uuid,
  '5656565656565656565656565656565656565656565656565656565656565656', 'queued');

insert into public.growth_intelligence_requests (
  id, organization_id, branch_id, kind, trigger_reason, request_fingerprint,
  market_profile_version_id, source_policy_digest, research_rule_version,
  local_time_bucket, status, due_at, claim_token, lease_expires_at,
  correlation_id, pipeline_id, phase
) values
  ('f1000000-0000-4000-8000-000000000508'::uuid, 'f1000000-0000-4000-8000-000000000201'::uuid, 'f1000000-0000-4000-8000-000000000304'::uuid, 'market_research', 'profile_confirmed',
  '7878787878787878787878787878787878787878787878787878787878787878',
  'f1000000-0000-4000-8000-000000000402'::uuid,
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'market-research@1', 'immediate', 'claimed', pg_catalog.now() - interval '1 hour',
  'f1000000-0000-4000-8000-000000000604'::uuid, pg_catalog.now() + interval '10 minutes',
  'f1000000-0000-4000-8000-000000000705'::uuid,
  'f1000000-0000-4000-8000-000000000507'::uuid, 'research');

update public.growth_intelligence_research_pipelines pipeline
set research_request_id = 'f1000000-0000-4000-8000-000000000508'::uuid
where pipeline.organization_id = 'f1000000-0000-4000-8000-000000000201'::uuid
  and pipeline.id = 'f1000000-0000-4000-8000-000000000507'::uuid;

insert into public.market_research_runs (
  id, organization_id, growth_intelligence_request_id, market_profile_version_id,
  claim_token, adapter_provider, adapter_version, run_fingerprint, query_plan_digest,
  correlation_id
) values
  ('f1000000-0000-4000-8000-000000000509'::uuid, 'f1000000-0000-4000-8000-000000000201'::uuid, 'f1000000-0000-4000-8000-000000000508'::uuid, 'f1000000-0000-4000-8000-000000000402'::uuid,
  'f1000000-0000-4000-8000-000000000604'::uuid, 'tinyfish', 'market-research@1',
  '9999999999999999999999999999999999999999999999999999999999999999',
  '8888888888888888888888888888888888888888888888888888888888888888',
  'f1000000-0000-4000-8000-000000000705'::uuid);

-- Pre-failed run: run row already failed, pipeline still queued -------------
-- A duplicate delivery with identical code + costs replays; different costs
-- conflict instead of rewriting the terminal run.

insert into public.growth_intelligence_research_pipelines (
  id, organization_id, branch_id, market_profile_id, market_profile_version_id,
  scope_digest, stage
) values
  ('f1000000-0000-4000-8000-000000000510'::uuid, 'f1000000-0000-4000-8000-000000000201'::uuid, 'f1000000-0000-4000-8000-000000000305'::uuid, 'f1000000-0000-4000-8000-000000000401'::uuid, 'f1000000-0000-4000-8000-000000000402'::uuid,
  'abababababababababababababababababababababababababababababababab', 'queued');

insert into public.growth_intelligence_requests (
  id, organization_id, branch_id, kind, trigger_reason, request_fingerprint,
  market_profile_version_id, source_policy_digest, research_rule_version,
  local_time_bucket, status, due_at, claim_token, lease_expires_at,
  correlation_id, pipeline_id, phase
) values
  ('f1000000-0000-4000-8000-000000000511'::uuid, 'f1000000-0000-4000-8000-000000000201'::uuid, 'f1000000-0000-4000-8000-000000000305'::uuid, 'market_research', 'profile_confirmed',
  'cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd',
  'f1000000-0000-4000-8000-000000000402'::uuid,
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'market-research@1', 'immediate', 'claimed', pg_catalog.now() - interval '1 hour',
  'f1000000-0000-4000-8000-000000000605'::uuid, pg_catalog.now() + interval '10 minutes',
  'f1000000-0000-4000-8000-000000000706'::uuid,
  'f1000000-0000-4000-8000-000000000510'::uuid, 'research');

update public.growth_intelligence_research_pipelines pipeline
set research_request_id = 'f1000000-0000-4000-8000-000000000511'::uuid
where pipeline.organization_id = 'f1000000-0000-4000-8000-000000000201'::uuid
  and pipeline.id = 'f1000000-0000-4000-8000-000000000510'::uuid;

insert into public.market_research_runs (
  id, organization_id, growth_intelligence_request_id, market_profile_version_id,
  claim_token, adapter_provider, adapter_version, run_fingerprint, query_plan_digest,
  correlation_id, status, safe_failure_code, adapter_cost_micros_usd, adapter_latency_ms,
  failed_at
) values
  ('f1000000-0000-4000-8000-000000000512'::uuid, 'f1000000-0000-4000-8000-000000000201'::uuid, 'f1000000-0000-4000-8000-000000000511'::uuid, 'f1000000-0000-4000-8000-000000000402'::uuid,
  'f1000000-0000-4000-8000-000000000605'::uuid, 'tinyfish', 'market-research@1',
  '7777777777777777777777777777777777777777777777777777777777777777',
  '6666666666666666666666666666666666666666666666666666666666666666',
  'f1000000-0000-4000-8000-000000000706'::uuid, 'failed', 'ADAPTER_UNAVAILABLE',
  100::bigint, 50::integer, pg_catalog.now() - interval '30 minutes');

-- Live failure moves request and pipeline together ----------------------------

set local role service_role;

select extensions.is(
  (select public.fail_market_research_pipeline(
    'f1000000-0000-4000-8000-000000000201'::uuid,
    'f1000000-0000-4000-8000-000000000501'::uuid,
    'f1000000-0000-4000-8000-000000000502'::uuid,
    'f1000000-0000-4000-8000-000000000601'::uuid,
    null,
    'EXTRACTION_UNAVAILABLE',
    0::bigint,
    0::integer
  ) ->> 'pipelineStage'),
  'research_failed',
  'a live worker failure lands the bound pipeline in research_failed'
);

select extensions.is(
  (select stage from public.growth_intelligence_research_pipelines
   where organization_id = 'f1000000-0000-4000-8000-000000000201'::uuid
     and id = 'f1000000-0000-4000-8000-000000000501'::uuid),
  'research_failed',
  'the pipeline row leaves queued on failure'
);

select extensions.is(
  (select safe_failure_code from public.growth_intelligence_research_pipelines
   where organization_id = 'f1000000-0000-4000-8000-000000000201'::uuid
     and id = 'f1000000-0000-4000-8000-000000000501'::uuid),
  'EXTRACTION_UNAVAILABLE',
  'the pipeline carries the worker safe code for the workspace'
);

select extensions.is(
  (select status from public.growth_intelligence_requests
   where organization_id = 'f1000000-0000-4000-8000-000000000201'::uuid
     and id = 'f1000000-0000-4000-8000-000000000502'::uuid),
  'failed',
  'the request fails in the same call'
);

select extensions.is(
  (select count(*)::integer from public.audit_events
   where organization_id = 'f1000000-0000-4000-8000-000000000201'::uuid
     and event_name = 'growth_intelligence.research_failed'
     and entity_id = 'f1000000-0000-4000-8000-000000000501'::uuid),
  1,
  'one research_failed audit event names the pipeline'
);

-- Redelivery replays identically ------------------------------------------------

select extensions.is(
  (select public.fail_market_research_pipeline(
    'f1000000-0000-4000-8000-000000000201'::uuid,
    'f1000000-0000-4000-8000-000000000501'::uuid,
    'f1000000-0000-4000-8000-000000000502'::uuid,
    'f1000000-0000-4000-8000-000000000601'::uuid,
    null,
    'EXTRACTION_UNAVAILABLE',
    0::bigint,
    0::integer
  ) ->> 'replayed'),
  'true',
  'a redelivered failure replays instead of double-settling'
);

select extensions.is(
  (select count(*)::integer from public.audit_events
   where organization_id = 'f1000000-0000-4000-8000-000000000201'::uuid
     and event_name = 'growth_intelligence.research_failed'
     and entity_id = 'f1000000-0000-4000-8000-000000000501'::uuid),
  1,
  'replay writes no second audit event'
);

-- Stranded repair: already-failed request, queued pipeline --------------------

select extensions.is(
  (select public.fail_market_research_pipeline(
    'f1000000-0000-4000-8000-000000000201'::uuid,
    'f1000000-0000-4000-8000-000000000503'::uuid,
    'f1000000-0000-4000-8000-000000000504'::uuid,
    'f1000000-0000-4000-8000-000000000602'::uuid,
    null,
    'ADAPTER_UNAVAILABLE',
    0::bigint,
    0::integer
  ) ->> 'pipelineStage'),
  'research_failed',
  'a stranded queued pipeline repairs to research_failed with its request code'
);

select extensions.is(
  (select safe_failure_code from public.growth_intelligence_research_pipelines
   where organization_id = 'f1000000-0000-4000-8000-000000000201'::uuid
     and id = 'f1000000-0000-4000-8000-000000000503'::uuid),
  'ADAPTER_UNAVAILABLE',
  'the repaired pipeline carries the request safe code'
);

-- Bound-run failure settles run + request + pipeline in one call ----------

select extensions.is(
  (select public.fail_market_research_pipeline(
    'f1000000-0000-4000-8000-000000000201'::uuid,
    'f1000000-0000-4000-8000-000000000507'::uuid,
    'f1000000-0000-4000-8000-000000000508'::uuid,
    'f1000000-0000-4000-8000-000000000604'::uuid,
    'f1000000-0000-4000-8000-000000000509'::uuid,
    'ADAPTER_UNAVAILABLE',
    1500::bigint,
    275::integer
  ) ->> 'pipelineStage'),
  'research_failed',
  'a bound run failure lands its pipeline in research_failed'
);

select extensions.is(
  (select status from public.market_research_runs
   where organization_id = 'f1000000-0000-4000-8000-000000000201'::uuid
     and id = 'f1000000-0000-4000-8000-000000000509'::uuid),
  'failed',
  'the run row leaves running on bound failure'
);

select extensions.is(
  (select safe_failure_code from public.market_research_runs
   where organization_id = 'f1000000-0000-4000-8000-000000000201'::uuid
     and id = 'f1000000-0000-4000-8000-000000000509'::uuid),
  'ADAPTER_UNAVAILABLE',
  'the run row carries the worker safe code'
);

select extensions.is(
  (select adapter_cost_micros_usd from public.market_research_runs
   where organization_id = 'f1000000-0000-4000-8000-000000000201'::uuid
     and id = 'f1000000-0000-4000-8000-000000000509'::uuid),
  1500::bigint,
  'the run row carries the measured adapter cost'
);

select extensions.is(
  (select adapter_latency_ms from public.market_research_runs
   where organization_id = 'f1000000-0000-4000-8000-000000000201'::uuid
     and id = 'f1000000-0000-4000-8000-000000000509'::uuid),
  275::integer,
  'the run row carries the measured adapter latency'
);

select extensions.is(
  (select status from public.growth_intelligence_requests
   where organization_id = 'f1000000-0000-4000-8000-000000000201'::uuid
     and id = 'f1000000-0000-4000-8000-000000000508'::uuid),
  'failed',
  'the bound request fails in the same call'
);

select extensions.is(
  (select count(*)::integer from public.audit_events
   where organization_id = 'f1000000-0000-4000-8000-000000000201'::uuid
     and event_name = 'growth_intelligence.research_failed'
     and entity_id = 'f1000000-0000-4000-8000-000000000507'::uuid),
  1,
  'one research_failed audit event names the bound pipeline'
);

select extensions.is(
  (select public.fail_market_research_pipeline(
    'f1000000-0000-4000-8000-000000000201'::uuid,
    'f1000000-0000-4000-8000-000000000507'::uuid,
    'f1000000-0000-4000-8000-000000000508'::uuid,
    'f1000000-0000-4000-8000-000000000604'::uuid,
    'f1000000-0000-4000-8000-000000000509'::uuid,
    'ADAPTER_UNAVAILABLE',
    1500::bigint,
    275::integer
  ) ->> 'replayed'),
  'true',
  'a redelivered bound failure replays instead of double-settling'
);

select extensions.is(
  (select count(*)::integer from public.audit_events
   where organization_id = 'f1000000-0000-4000-8000-000000000201'::uuid
     and event_name = 'growth_intelligence.research_failed'
     and entity_id = 'f1000000-0000-4000-8000-000000000507'::uuid),
  1,
  'bound replay writes no second audit event'
);

select extensions.throws_ok(
  $$ select public.fail_market_research_pipeline(
    'f1000000-0000-4000-8000-000000000201'::uuid,
    'f1000000-0000-4000-8000-000000000510'::uuid,
    'f1000000-0000-4000-8000-000000000511'::uuid,
    'f1000000-0000-4000-8000-000000000605'::uuid,
    'f1000000-0000-4000-8000-000000000512'::uuid,
    'ADAPTER_UNAVAILABLE',
    101::bigint,
    50::integer
  ) $$,
  '23505', null,
  'a terminal run with different costs conflicts instead of rewriting'
);

select extensions.is(
  (select public.fail_market_research_pipeline(
    'f1000000-0000-4000-8000-000000000201'::uuid,
    'f1000000-0000-4000-8000-000000000510'::uuid,
    'f1000000-0000-4000-8000-000000000511'::uuid,
    'f1000000-0000-4000-8000-000000000605'::uuid,
    'f1000000-0000-4000-8000-000000000512'::uuid,
    'ADAPTER_UNAVAILABLE',
    100::bigint,
    50::integer
  ) ->> 'pipelineStage'),
  'research_failed',
  'an already-failed run with identical costs still lands its queued pipeline'
);

select extensions.is(
  (select public.fail_market_research_pipeline(
    'f1000000-0000-4000-8000-000000000201'::uuid,
    'f1000000-0000-4000-8000-000000000510'::uuid,
    'f1000000-0000-4000-8000-000000000511'::uuid,
    'f1000000-0000-4000-8000-000000000605'::uuid,
    'f1000000-0000-4000-8000-000000000512'::uuid,
    'ADAPTER_UNAVAILABLE',
    100::bigint,
    50::integer
  ) ->> 'replayed'),
  'true',
  'a redelivered pre-failed run replays instead of double-settling'
);

select extensions.is(
  (select count(*)::integer from public.audit_events
   where organization_id = 'f1000000-0000-4000-8000-000000000201'::uuid
     and event_name = 'growth_intelligence.research_failed'
     and entity_id = 'f1000000-0000-4000-8000-000000000510'::uuid),
  1,
  'pre-failed replay writes exactly one audit event'
);

select extensions.throws_ok(
  $$ select public.fail_market_research_pipeline(
    'f1000000-0000-4000-8000-000000000201'::uuid,
    'f1000000-0000-4000-8000-000000000507'::uuid,
    'f1000000-0000-4000-8000-000000000508'::uuid,
    'f1000000-0000-4000-8000-000000000604'::uuid,
    'f1000000-0000-4000-8000-000000000509'::uuid,
    'ADAPTER_UNAVAILABLE',
    50000001::bigint,
    275::integer
  ) $$,
  '22023', null,
  'adapter cost above the governed bound is rejected at the boundary'
);

select extensions.throws_ok(
  $$ select public.fail_market_research_pipeline(
    'f1000000-0000-4000-8000-000000000201'::uuid,
    'f1000000-0000-4000-8000-000000000507'::uuid,
    'f1000000-0000-4000-8000-000000000508'::uuid,
    'f1000000-0000-4000-8000-000000000604'::uuid,
    'f1000000-0000-4000-8000-000000000509'::uuid,
    'ADAPTER_UNAVAILABLE',
    1500::bigint,
    600001::integer
  ) $$,
  '22023', null,
  'adapter latency above the governed bound is rejected at the boundary'
);

-- Guards -----------------------------------------------------------------------

select extensions.is(
  (select public.fail_market_research_pipeline(
    'f1000000-0000-4000-8000-000000000201'::uuid,
    'f1000000-0000-4000-8000-000000000501'::uuid,
    'f1000000-0000-4000-8000-000000000502'::uuid,
    'f1000000-0000-4000-8000-000000000601'::uuid,
    null,
    'ADAPTER_UNAVAILABLE',
    0::bigint,
    0::integer
  ) ->> 'replayed'),
  'true',
  'a different code on a terminal pipeline replays the first outcome instead of rewriting it'
);

select extensions.is(
  (select safe_failure_code from public.growth_intelligence_research_pipelines
   where organization_id = 'f1000000-0000-4000-8000-000000000201'::uuid
     and id = 'f1000000-0000-4000-8000-000000000501'::uuid),
  'EXTRACTION_UNAVAILABLE',
  'the first terminal code stands'
);

select extensions.throws_ok(
  $$ select public.fail_market_research_pipeline(
    'f1000000-0000-4000-8000-000000000201'::uuid,
    'f1000000-0000-4000-8000-000000000505'::uuid,
    'f1000000-0000-4000-8000-000000000502'::uuid,
    'f1000000-0000-4000-8000-000000000601'::uuid,
    null,
    'EXTRACTION_UNAVAILABLE',
    0::bigint,
    0::integer
  ) $$,
  '42501', null,
  'a request from another pipeline cannot fail this one'
);

select extensions.throws_ok(
  $$ select public.fail_market_research_pipeline(
    'f1000000-0000-4000-8000-000000000201'::uuid,
    'f1000000-0000-4000-8000-000000000503'::uuid,
    'f1000000-0000-4000-8000-000000000504'::uuid,
    'f1000000-0000-4000-8000-000000000602'::uuid,
    null,
    'not a code',
    0::bigint,
    0::integer
  ) $$,
  '22023', null,
  'a malformed safe code is rejected at the boundary'
);

reset role;

set local role authenticated;
set local request.jwt.claim.sub = 'f1000000-0000-4000-8000-000000000001';

select extensions.throws_ok(
  $$ select public.fail_market_research_pipeline(
    'f1000000-0000-4000-8000-000000000201'::uuid,
    'f1000000-0000-4000-8000-000000000503'::uuid,
    'f1000000-0000-4000-8000-000000000504'::uuid,
    'f1000000-0000-4000-8000-000000000602'::uuid,
    null,
    'ADAPTER_UNAVAILABLE',
    0::bigint,
    0::integer
  ) $$,
  '42501', null,
  'browser sessions cannot fail pipelines even as owners'
);

reset role;

select extensions.finish();

rollback;
