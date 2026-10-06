begin;

create extension if not exists pgtap with schema extensions;

-- Transient definition under test -------------------------------------------
-- This suite runs inside one transaction that ends in rollback, so the CREATE
-- below never persists: it lets the suite execute the exact
-- expire_stale_market_research_runs body from migration
-- 20260924090000_expire_stale_market_research_runs.sql against the live
-- staging schema (the mandatory first call for new plpgsql) without applying
-- the migration. Keep the body byte-identical to the migration file; the
-- migration is the durable artifact, this copy is not. Fixture runs carry
-- a 400-day started_at with a 30-day sweep threshold, so the real orphaned
-- runs (days old) never match, even transiently.

create or replace function public.expire_stale_market_research_runs(
  p_older_than_seconds integer,
  p_safe_failure_code text default 'WORKER_ORPHANED'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  expired_count integer := 0;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    raise exception 'market_research_expire_forbidden' using errcode = '42501';
  end if;
  if p_older_than_seconds is null or p_older_than_seconds < 3600
    or p_safe_failure_code is null
    or p_safe_failure_code !~ '^[A-Z][A-Z0-9_]{2,80}$' then
    raise exception 'market_research_expire_invalid' using errcode = '22023';
  end if;
  -- Settle only runs whose request lease is already dead, so a live worker can
  -- never lose its run under it. Idempotent: non-running rows never match.
  update public.market_research_runs run
  set status = 'failed',
      safe_failure_code = p_safe_failure_code,
      failed_at = pg_catalog.now()
  from public.growth_intelligence_requests request
  where run.growth_intelligence_request_id = request.id
    and run.organization_id = request.organization_id
    and run.status = 'running'
    and run.started_at < pg_catalog.now() - pg_catalog.make_interval(secs => p_older_than_seconds)
    and (request.status <> 'claimed'
      or request.lease_expires_at <= pg_catalog.now()
      or request.claim_token is distinct from run.claim_token);
  get diagnostics expired_count = row_count;
  return pg_catalog.jsonb_build_object('expiredCount', expired_count, 'replayed', false);
end;
$$;

revoke all on function public.expire_stale_market_research_runs(integer, text)
  from public, anon, authenticated, service_role;
grant execute on function public.expire_stale_market_research_runs(integer, text)
  to service_role;

select extensions.plan(20);

-- Contract and grants ---------------------------------------------------------

select extensions.has_function(
  'public', 'expire_stale_market_research_runs',
  array['integer', 'text'],
  'orphaned running research runs settle through one governed sweeper'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.expire_stale_market_research_runs(integer,text)',
    'execute'
  ),
  'workers may expire stale research runs'
);
select extensions.ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'public.expire_stale_market_research_runs(integer,text)',
    'execute'
  ),
  'browser sessions cannot expire research runs directly'
);
select extensions.ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.expire_stale_market_research_runs(integer,text)',
    'execute'
  ),
  'anonymous callers cannot expire research runs'
);

-- Fixtures --------------------------------------------------------------------

insert into auth.users (id) values
  ('e6000000-0000-4000-8000-000000000001'::uuid);

insert into public.accounts (id, name, slug, created_by) values
  ('e6000000-0000-4000-8000-000000000101'::uuid, 'Expire agency', 'expire-agency', 'e6000000-0000-4000-8000-000000000001'::uuid);

insert into public.organizations (
  id, account_id, name, slug, industry, country_code, base_currency,
  default_timezone, created_by
) values
  ('e6000000-0000-4000-8000-000000000201'::uuid, 'e6000000-0000-4000-8000-000000000101'::uuid, 'Expire client', 'expire-client', 'testing', 'AE', 'AED', 'Asia/Dubai', 'e6000000-0000-4000-8000-000000000001'::uuid);

insert into public.account_memberships (
  account_id, user_id, account_role, default_organization_role
) values
  ('e6000000-0000-4000-8000-000000000101'::uuid, 'e6000000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner');

insert into public.branches (
  id, organization_id, name, slug, kind, timezone, currency, is_active
) values
  ('e6000000-0000-4000-8000-000000000301'::uuid, 'e6000000-0000-4000-8000-000000000201'::uuid, 'Expire Wharf', 'expire-wharf', 'physical', 'Asia/Dubai', 'AED', true);

insert into public.organization_market_profiles (id, organization_id, branch_id)
values ('e6000000-0000-4000-8000-000000000401'::uuid, 'e6000000-0000-4000-8000-000000000201'::uuid, 'e6000000-0000-4000-8000-000000000301'::uuid);

insert into public.organization_market_profile_versions (
  id, organization_id, market_profile_id, version, schema_version,
  profile_document, profile_digest, source_policy_digest, proposal_source,
  created_by, correlation_id
) values
  ('e6000000-0000-4000-8000-000000000402'::uuid, 'e6000000-0000-4000-8000-000000000201'::uuid, 'e6000000-0000-4000-8000-000000000401'::uuid, 1, 2,
  '{"schemaVersion":2}'::jsonb,
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'operator',
  'e6000000-0000-4000-8000-000000000001'::uuid,
  'e6000000-0000-4000-8000-000000000701'::uuid);

update public.organization_market_profiles profile
set current_version_id = 'e6000000-0000-4000-8000-000000000402'::uuid, enabled = true
where profile.organization_id = 'e6000000-0000-4000-8000-000000000201'::uuid
  and profile.branch_id = 'e6000000-0000-4000-8000-000000000301'::uuid;

-- R1: claimed with a dead lease, run carries the live claim token (the
-- orphan shape: worker died, lease expired, dispatcher has not re-claimed).
-- R2: claimed with a live lease and matching token (a live worker: spare).
-- R3: claimed with a live lease but the run carries a stale token (the
-- request was re-claimed elsewhere: the old run is safe to settle).
-- R4: request already failed with a failed run row (idempotent: spare).
-- R5: request already failed but its run row is still running (stranded:
-- settle through the request-no-longer-claimed branch).

insert into public.growth_intelligence_requests (
  id, organization_id, branch_id, kind, trigger_reason, request_fingerprint,
  market_profile_version_id, source_policy_digest, research_rule_version,
  local_time_bucket, status, due_at, claim_token, lease_expires_at,
  correlation_id
) values
  ('e6000000-0000-4000-8000-000000000501'::uuid, 'e6000000-0000-4000-8000-000000000201'::uuid, 'e6000000-0000-4000-8000-000000000301'::uuid, 'market_research', 'profile_confirmed',
  '1111111111111111111111111111111111111111111111111111111111111111',
  'e6000000-0000-4000-8000-000000000402'::uuid,
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'market-research@1', 'immediate', 'claimed', pg_catalog.now() - interval '400 days',
  'e6000000-0000-4000-8000-000000000601'::uuid, pg_catalog.now() - interval '1 day',
  'e6000000-0000-4000-8000-000000000701'::uuid),
  ('e6000000-0000-4000-8000-000000000502'::uuid, 'e6000000-0000-4000-8000-000000000201'::uuid, 'e6000000-0000-4000-8000-000000000301'::uuid, 'market_research', 'profile_confirmed',
  '2222222222222222222222222222222222222222222222222222222222222222',
  'e6000000-0000-4000-8000-000000000402'::uuid,
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'market-research@1', 'immediate', 'claimed', pg_catalog.now() - interval '400 days',
  'e6000000-0000-4000-8000-000000000602'::uuid, pg_catalog.now() + interval '10 minutes',
  'e6000000-0000-4000-8000-000000000702'::uuid),
  ('e6000000-0000-4000-8000-000000000503'::uuid, 'e6000000-0000-4000-8000-000000000201'::uuid, 'e6000000-0000-4000-8000-000000000301'::uuid, 'market_research', 'profile_confirmed',
  '3333333333333333333333333333333333333333333333333333333333333333',
  'e6000000-0000-4000-8000-000000000402'::uuid,
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'market-research@1', 'immediate', 'claimed', pg_catalog.now() - interval '400 days',
  'e6000000-0000-4000-8000-000000000603'::uuid, pg_catalog.now() + interval '10 minutes',
  'e6000000-0000-4000-8000-000000000703'::uuid);

insert into public.growth_intelligence_requests (
  id, organization_id, branch_id, kind, trigger_reason, request_fingerprint,
  market_profile_version_id, source_policy_digest, research_rule_version,
  local_time_bucket, status, due_at, safe_failure_code, failed_at,
  correlation_id
) values
  ('e6000000-0000-4000-8000-000000000504'::uuid, 'e6000000-0000-4000-8000-000000000201'::uuid, 'e6000000-0000-4000-8000-000000000301'::uuid, 'market_research', 'profile_confirmed',
  '4444444444444444444444444444444444444444444444444444444444444444',
  'e6000000-0000-4000-8000-000000000402'::uuid,
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'market-research@1', 'immediate', 'failed', pg_catalog.now() - interval '400 days',
  'ADAPTER_UNAVAILABLE', pg_catalog.now() - interval '400 days',
  'e6000000-0000-4000-8000-000000000704'::uuid),
  ('e6000000-0000-4000-8000-000000000505'::uuid, 'e6000000-0000-4000-8000-000000000201'::uuid, 'e6000000-0000-4000-8000-000000000301'::uuid, 'market_research', 'profile_confirmed',
  '5555555555555555555555555555555555555555555555555555555555555555',
  'e6000000-0000-4000-8000-000000000402'::uuid,
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'market-research@1', 'immediate', 'failed', pg_catalog.now() - interval '400 days',
  'EXTRACTION_UNAVAILABLE', pg_catalog.now() - interval '400 days',
  'e6000000-0000-4000-8000-000000000705'::uuid);

-- Run rows are inserted directly with an aged started_at because the run
-- mutation trigger freezes started_at after begin: no governed RPC can age a
-- run, and the sweeper exists precisely for rows no RPC can reach. The shape
-- mirrors what begin_market_research_run persists (same columns, same
-- checks), only older.

insert into public.market_research_runs (
  organization_id, growth_intelligence_request_id, market_profile_version_id,
  claim_token, adapter_provider, adapter_version, model_provider,
  model_version, run_fingerprint, query_plan_digest, correlation_id,
  started_at
) values
  ('e6000000-0000-4000-8000-000000000201'::uuid, 'e6000000-0000-4000-8000-000000000501'::uuid, 'e6000000-0000-4000-8000-000000000402'::uuid,
  'e6000000-0000-4000-8000-000000000601'::uuid, 'tinyfish', 'market-research@1', 'gemini', 'unconfigured-review-model',
  pg_catalog.repeat('e1', 32),
  pg_catalog.repeat('a1', 32),
  'e6000000-0000-4000-8000-000000000711'::uuid, pg_catalog.now() - interval '400 days'),
  ('e6000000-0000-4000-8000-000000000201'::uuid, 'e6000000-0000-4000-8000-000000000502'::uuid, 'e6000000-0000-4000-8000-000000000402'::uuid,
  'e6000000-0000-4000-8000-000000000602'::uuid, 'tinyfish', 'market-research@1', 'gemini', 'unconfigured-review-model',
  pg_catalog.repeat('e2', 32),
  pg_catalog.repeat('a2', 32),
  'e6000000-0000-4000-8000-000000000712'::uuid, pg_catalog.now() - interval '400 days'),
  ('e6000000-0000-4000-8000-000000000201'::uuid, 'e6000000-0000-4000-8000-000000000503'::uuid, 'e6000000-0000-4000-8000-000000000402'::uuid,
  'e6000000-0000-4000-8000-000000000613'::uuid, 'tinyfish', 'market-research@1', 'gemini', 'unconfigured-review-model',
  pg_catalog.repeat('e3', 32),
  pg_catalog.repeat('a3', 32),
  'e6000000-0000-4000-8000-000000000713'::uuid, pg_catalog.now() - interval '400 days'),
  ('e6000000-0000-4000-8000-000000000201'::uuid, 'e6000000-0000-4000-8000-000000000505'::uuid, 'e6000000-0000-4000-8000-000000000402'::uuid,
  'e6000000-0000-4000-8000-000000000605'::uuid, 'tinyfish', 'market-research@1', 'gemini', 'unconfigured-review-model',
  pg_catalog.repeat('e5', 32),
  pg_catalog.repeat('a5', 32),
  'e6000000-0000-4000-8000-000000000715'::uuid, pg_catalog.now() - interval '400 days');

insert into public.market_research_runs (
  organization_id, growth_intelligence_request_id, market_profile_version_id,
  claim_token, adapter_provider, adapter_version, model_provider,
  model_version, run_fingerprint, query_plan_digest, correlation_id,
  status, safe_failure_code, failed_at, started_at
) values
  ('e6000000-0000-4000-8000-000000000201'::uuid, 'e6000000-0000-4000-8000-000000000504'::uuid, 'e6000000-0000-4000-8000-000000000402'::uuid,
  'e6000000-0000-4000-8000-000000000604'::uuid, 'tinyfish', 'market-research@1', 'gemini', 'unconfigured-review-model',
  pg_catalog.repeat('e4', 32),
  pg_catalog.repeat('a4', 32),
  'e6000000-0000-4000-8000-000000000714'::uuid, 'failed', 'ORIGINAL_CODE', pg_catalog.now() - interval '400 days',
  pg_catalog.now() - interval '401 days');

-- Run reads go through definer-owned helpers, mirroring the pipeline-fail
-- suite: the runs table carries no table grant for the test roles.

create or replace function pg_temp.expire_run_status(p_request_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select status from public.market_research_runs
  where growth_intelligence_request_id = p_request_id
  order by created_at desc, id desc limit 1;
$$;

create or replace function pg_temp.expire_run_code(p_request_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select safe_failure_code from public.market_research_runs
  where growth_intelligence_request_id = p_request_id
  order by created_at desc, id desc limit 1;
$$;

create or replace function pg_temp.expire_run_failed_at(p_request_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select failed_at from public.market_research_runs
  where growth_intelligence_request_id = p_request_id
  order by created_at desc, id desc limit 1;
$$;

-- Behavior --------------------------------------------------------------------

set local role service_role;

-- 30 days: far above the 1-hour floor, far below the 400-day fixtures, and
-- far above the days-old real orphans, which therefore never match.

select extensions.is(
  (select public.expire_stale_market_research_runs(2592000, 'WORKER_ORPHANED') ->> 'expiredCount'),
  '3',
  'dead-lease, stale-token, and stranded runs expire in one sweep'
);

select extensions.is(
  pg_temp.expire_run_status('e6000000-0000-4000-8000-000000000501'::uuid),
  'failed',
  'the dead-lease orphan leaves running'
);

select extensions.is(
  pg_temp.expire_run_code('e6000000-0000-4000-8000-000000000501'::uuid),
  'WORKER_ORPHANED',
  'the dead-lease orphan carries the sweeper safe code'
);

select extensions.ok(
  (select pg_temp.expire_run_failed_at('e6000000-0000-4000-8000-000000000501'::uuid) is not null),
  'the dead-lease orphan records when it was settled'
);

select extensions.is(
  pg_temp.expire_run_status('e6000000-0000-4000-8000-000000000502'::uuid),
  'running',
  'a run under a live lease with a matching token is spared'
);

select extensions.is(
  pg_temp.expire_run_status('e6000000-0000-4000-8000-000000000503'::uuid),
  'failed',
  'a run whose request was re-claimed under a new token expires'
);

select extensions.is(
  pg_temp.expire_run_status('e6000000-0000-4000-8000-000000000505'::uuid),
  'failed',
  'a stranded run under an already-failed request expires'
);

select extensions.is(
  pg_temp.expire_run_code('e6000000-0000-4000-8000-000000000505'::uuid),
  'WORKER_ORPHANED',
  'the explicit safe code travels onto every settled row'
);

select extensions.is(
  pg_temp.expire_run_status('e6000000-0000-4000-8000-000000000504'::uuid),
  'failed',
  'an already-failed run stays failed'
);

select extensions.is(
  pg_temp.expire_run_code('e6000000-0000-4000-8000-000000000504'::uuid),
  'ORIGINAL_CODE',
  'the sweeper never rewrites a terminal row'
);

select extensions.is(
  (select public.expire_stale_market_research_runs(2592000) ->> 'expiredCount'),
  '0',
  'a second sweep with the default code settles nothing'
);

select extensions.throws_ok(
  $$ select public.expire_stale_market_research_runs(null, 'WORKER_ORPHANED') $$,
  '22023', null,
  'a missing age floor is rejected at the boundary'
);

select extensions.throws_ok(
  $$ select public.expire_stale_market_research_runs(60, 'WORKER_ORPHANED') $$,
  '22023', null,
  'an age floor below one hour is rejected at the boundary'
);

select extensions.throws_ok(
  $$ select public.expire_stale_market_research_runs(2592000, null) $$,
  '22023', null,
  'a missing safe code is rejected at the boundary'
);

select extensions.throws_ok(
  $$ select public.expire_stale_market_research_runs(2592000, 'worker_orphaned') $$,
  '22023', null,
  'a malformed safe code is rejected at the boundary'
);

reset role;

set local role authenticated;
set local request.jwt.claim.sub = 'e6000000-0000-4000-8000-000000000001';

select extensions.throws_ok(
  $$ select public.expire_stale_market_research_runs(2592000, 'WORKER_ORPHANED') $$,
  '42501', null,
  'browser sessions cannot expire research runs even as owners'
);

reset role;

select extensions.finish();

rollback;
