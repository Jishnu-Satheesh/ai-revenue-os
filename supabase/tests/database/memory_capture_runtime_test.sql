begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(34);

-- Spec 023 Task 03 runtime: leased claim, load, fail, complete, retry. No
-- kind is registered yet, so every fresh delivery quarantines with
-- QUARANTINE_UNREGISTERED_ADAPTER; lease, replay, obsolescence, backoff, and
-- authorization paths below are complete and exercised for real.

create or replace function pg_temp.state_of(call_sql text)
returns text language plpgsql as $$
begin
  execute call_sql;
  return 'no-error';
exception when others then
  return SQLSTATE;
end;
$$;

-- Structure ---------------------------------------------------------------------

select extensions.has_function('public', 'list_memory_capture_due_orgs', 'due dispatch is database-owned');
select extensions.has_function('public', 'claim_memory_capture_events', 'so is the claim');
select extensions.has_function('public', 'load_memory_capture_event', 'so is the load');
select extensions.has_function('public', 'fail_memory_capture_event', 'so is the failure path');
select extensions.has_function('public', 'complete_memory_capture_event', 'and the completion');
select extensions.has_function('public', 'retry_memory_capture', 'and the operator retry');
select extensions.ok(pg_catalog.has_function_privilege('service_role', 'public.claim_memory_capture_events(uuid,uuid,integer,integer)', 'execute'), 'the worker holds the claim');
select extensions.ok(not pg_catalog.has_function_privilege('authenticated', 'public.claim_memory_capture_events(uuid,uuid,integer,integer)', 'execute'), 'members never drive a projection');
select extensions.ok(pg_catalog.has_function_privilege('authenticated', 'public.retry_memory_capture(uuid,uuid,uuid,uuid)', 'execute'), 'members hold the retry');
select extensions.ok(not pg_catalog.has_function_privilege('service_role', 'public.retry_memory_capture(uuid,uuid,uuid,uuid)', 'execute'), 'the worker never retries on anyone''s behalf');
select extensions.ok(not pg_catalog.has_function_privilege('anon', 'public.claim_memory_capture_events(uuid,uuid,integer,integer)', 'execute'), 'anonymous callers hold nothing');

-- Fixtures ------------------------------------------------------------------------

insert into auth.users (id) values
  ('fb360000-0000-4000-8000-000000000001'::uuid),
  ('fb360000-0000-4000-8000-000000000004'::uuid);
insert into public.accounts (id, name, slug, created_by) values
  ('fb360000-0000-4000-8000-000000000101'::uuid, 'Runtime verifier', 'runtime-verifier', 'fb360000-0000-4000-8000-000000000001'::uuid);
insert into public.organizations (id, account_id, name, slug, industry, country_code, base_currency, default_timezone, created_by) values
  ('fb360000-0000-4000-8000-000000000201'::uuid, 'fb360000-0000-4000-8000-000000000101'::uuid, 'Runtime verifier', 'runtime-verifier', 'testing', 'AE', 'AED', 'Asia/Dubai', 'fb360000-0000-4000-8000-000000000001'::uuid);
insert into public.account_memberships (account_id, user_id, account_role, default_organization_role) values
  ('fb360000-0000-4000-8000-000000000101'::uuid, 'fb360000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner');
insert into public.organization_memberships (organization_id, user_id, role) values
  ('fb360000-0000-4000-8000-000000000201'::uuid, 'fb360000-0000-4000-8000-000000000004'::uuid, 'operator');

insert into public.channel_analysis_runs (
  id, organization_id, window_start, window_end, period_grain, window_timezone,
  registry_version, detector_versions, metric_versions, input_digest, status,
  completed_at, result_digest, correlation_id
) values
  ('fb360000-0000-4000-8000-000000000601'::uuid, 'fb360000-0000-4000-8000-000000000201'::uuid,
   date '2026-01-01', date '2026-01-05', 'day', 'Asia/Dubai', 1, '[{}]'::jsonb, '[]'::jsonb,
   '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'completed', now(), 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'fb360000-0000-4000-8000-000000000911');

insert into public.channel_findings (
  id, organization_id, analysis_run_id, detector_key, detector_version, kind, code,
  severity, priority, quality_state, calculation_digest
) values
  ('fb360000-0000-4000-8000-000000000701'::uuid, 'fb360000-0000-4000-8000-000000000201'::uuid,
   'fb360000-0000-4000-8000-000000000601'::uuid, 'revenue.period_movement', 1, 'finding',
   'REVENUE_DROPPED_VS_PRIOR_PERIOD', 'medium', 50, 'complete',
   'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

insert into public.memory_items (id, organization_id, memory_type, title, origin) values
  ('fb360000-0000-4000-8000-000000000501'::uuid, 'fb360000-0000-4000-8000-000000000201'::uuid,
   'episode', 'Settled projection', 'system_generated');

insert into public.memory_capture_events (
  id, organization_id, source_kind, channel_finding_id, source_revision, source_digest, correlation_id
) values
  ('fb360000-0000-4000-8000-000000000801'::uuid, 'fb360000-0000-4000-8000-000000000201'::uuid,
   'channel_finding', 'fb360000-0000-4000-8000-000000000701', 1,
   'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
   'fb360000-0000-4000-8000-000000000901'),
  ('fb360000-0000-4000-8000-000000000802'::uuid, 'fb360000-0000-4000-8000-000000000201'::uuid,
   'channel_finding', 'fb360000-0000-4000-8000-000000000701', 2,
   'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
   'fb360000-0000-4000-8000-000000000902'),
  ('fb360000-0000-4000-8000-000000000803'::uuid, 'fb360000-0000-4000-8000-000000000201'::uuid,
   'channel_finding', 'fb360000-0000-4000-8000-000000000701', 3,
   'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
   'fb360000-0000-4000-8000-000000000903'),
  ('fb360000-0000-4000-8000-000000000804'::uuid, 'fb360000-0000-4000-8000-000000000201'::uuid,
   'channel_finding', 'fb360000-0000-4000-8000-000000000701', 4,
   'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
   'fb360000-0000-4000-8000-000000000904');

-- Leases ------------------------------------------------------------------------------

reset role;
set local role service_role;

select extensions.is(
  (select public.list_memory_capture_due_orgs(100) ->> 'organizationIds'),
  '["fb360000-0000-4000-8000-000000000201"]', 'due work advertises its organization');

select extensions.is(
  (select public.claim_memory_capture_events('fb360000-0000-4000-8000-000000000201', 'fb360000-0000-4000-8000-000000000a01', 25, 120) ->> 'captureIds'),
  '["fb360000-0000-4000-8000-000000000801", "fb360000-0000-4000-8000-000000000802", "fb360000-0000-4000-8000-000000000803", "fb360000-0000-4000-8000-000000000804"]',
  'one claim takes the whole due batch');

select extensions.is(
  (select public.claim_memory_capture_events('fb360000-0000-4000-8000-000000000201', 'fb360000-0000-4000-8000-000000000a02', 25, 120) ->> 'captureIds'),
  '[]', 'a second claimer finds nothing while leases hold');

select extensions.is(
  pg_temp.state_of($$ select public.load_memory_capture_event('fb360000-0000-4000-8000-000000000201', 'fb360000-0000-4000-8000-000000000801', 'fb360000-0000-4000-8000-000000000a02') $$),
  '42501', 'a stale token reads nothing');

select extensions.is(
  (select public.load_memory_capture_event('fb360000-0000-4000-8000-000000000201', 'fb360000-0000-4000-8000-000000000801', 'fb360000-0000-4000-8000-000000000a01') ->> 'sourceKind'),
  'channel_finding', 'the lease holder reads its typed document');

select extensions.is(
  pg_temp.state_of($$ select public.claim_memory_capture_events('fb360000-0000-4000-8000-000000000201', 'fb360000-0000-4000-8000-000000000a03', 26, 120) $$),
  '23514', 'an oversized batch is refused');

-- Failure and backoff ----------------------------------------------------------------------

select extensions.is(
  (select public.fail_memory_capture_event('fb360000-0000-4000-8000-000000000201', 'fb360000-0000-4000-8000-000000000801', 'fb360000-0000-4000-8000-000000000a01', 'TRANSIENT_DB') ->> 'status'),
  'pending', 'a transient failure requeues');
select extensions.ok(
  (select next_attempt_at > now() from public.memory_capture_events where id = 'fb360000-0000-4000-8000-000000000801'),
  'with its next attempt in the future');

select extensions.is(
  pg_temp.state_of($$ select public.fail_memory_capture_event('fb360000-0000-4000-8000-000000000201', 'fb360000-0000-4000-8000-000000000802', 'fb360000-0000-4000-8000-000000000a01', 'MADE_UP_CODE') $$),
  '23514', 'an unknown code is refused, never retried blindly');

select extensions.is(
  (select public.fail_memory_capture_event('fb360000-0000-4000-8000-000000000201', 'fb360000-0000-4000-8000-000000000803', 'fb360000-0000-4000-8000-000000000a01', 'QUARANTINE_RIGHTS_DENIED') ->> 'status'),
  'quarantined', 'a rights denial parks for an operator');

-- Completion -------------------------------------------------------------------------------

-- The registry check comes after flags: enable capture so the quarantine path is reached.
insert into public.memory_integration_settings (organization_id, capture_enabled) values
  ('fb360000-0000-4000-8000-000000000201'::uuid, true);

select extensions.is(
  (select public.complete_memory_capture_event('fb360000-0000-4000-8000-000000000201', 'fb360000-0000-4000-8000-000000000804', 'fb360000-0000-4000-8000-000000000a01') ->> 'status'),
  'quarantined', 'an unregistered kind quarantines instead of projecting');

select extensions.is(
  pg_temp.state_of($$ select public.complete_memory_capture_event('fb360000-0000-4000-8000-000000000201', 'fb360000-0000-4000-8000-000000000804', 'fb360000-0000-4000-8000-000000000a01') $$),
  '42501', 'a released lease completes nothing further');

-- A receipt lost after commit replays to the same projection, never a second item.
insert into public.memory_capture_events (
  id, organization_id, source_kind, channel_finding_id, source_revision, source_digest,
  correlation_id, status, completed_at, projected_item_id
) values (
  'fb360000-0000-4000-8000-000000000805', 'fb360000-0000-4000-8000-000000000201',
  'channel_finding', 'fb360000-0000-4000-8000-000000000701', 5,
  '1111111111111111111111111111111111111111111111111111111111111111',
  'fb360000-0000-4000-8000-000000000905', 'completed', now(),
  'fb360000-0000-4000-8000-000000000501');

select extensions.is(
  (select public.complete_memory_capture_event('fb360000-0000-4000-8000-000000000201', 'fb360000-0000-4000-8000-000000000805', 'fb360000-0000-4000-8000-000000000a09') ->> 'status'),
  'replayed', 'a completed delivery replays');
select extensions.is(
  (select public.complete_memory_capture_event('fb360000-0000-4000-8000-000000000201', 'fb360000-0000-4000-8000-000000000805', 'fb360000-0000-4000-8000-000000000a09') ->> 'projectedItemId'),
  'fb360000-0000-4000-8000-000000000501', 'to the same projected item');

-- An organization that never enabled capture ends deliveries as obsolete, not projected.
delete from public.memory_integration_settings
where organization_id = 'fb360000-0000-4000-8000-000000000201';
update public.memory_capture_events set next_attempt_at = now()
where id = 'fb360000-0000-4000-8000-000000000801';
select extensions.is(
  (select public.claim_memory_capture_events('fb360000-0000-4000-8000-000000000201', 'fb360000-0000-4000-8000-000000000a04', 25, 120) ->> 'captureIds'),
  '["fb360000-0000-4000-8000-000000000801"]', 'the requeued event claims again');
select extensions.is(
  (select public.complete_memory_capture_event('fb360000-0000-4000-8000-000000000201', 'fb360000-0000-4000-8000-000000000801', 'fb360000-0000-4000-8000-000000000a04') ->> 'status'),
  'obsolete', 'without an enabled capture setting');

-- Attempts are counted in Postgres: the fifth failure is terminal.
update public.memory_capture_events set attempt_count = 5
where id = 'fb360000-0000-4000-8000-000000000802';
select extensions.is(
  (select public.fail_memory_capture_event('fb360000-0000-4000-8000-000000000201', 'fb360000-0000-4000-8000-000000000802', 'fb360000-0000-4000-8000-000000000a01', 'TRANSIENT_DB') ->> 'status'),
  'failed', 'the fifth transient failure ends the event');
select extensions.is(
  (select safe_failure_code from public.memory_capture_events where id = 'fb360000-0000-4000-8000-000000000802'),
  'ATTEMPTS_EXHAUSTED', 'under its honest code');

select extensions.is(
  pg_temp.state_of($$ select public.claim_memory_capture_events('fb360000-0000-4000-8000-000000000201', 'fb360000-0000-4000-8000-000000000a05', 25, 10) $$),
  '23514', 'a too-short lease is refused');

-- Operator retry ------------------------------------------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'fb360000-0000-4000-8000-000000000004';

select extensions.is(
  pg_temp.state_of($$ select public.retry_memory_capture('fb360000-0000-4000-8000-000000000201', 'fb360000-0000-4000-8000-000000000004', 'fb360000-0000-4000-8000-000000000802', 'fb360000-0000-4000-8000-000000000906') $$),
  '42501', 'an operator cannot retry a capture');

set local request.jwt.claim.sub = 'fb360000-0000-4000-8000-000000000001';

select extensions.is(
  (select public.retry_memory_capture('fb360000-0000-4000-8000-000000000201', 'fb360000-0000-4000-8000-000000000001', 'fb360000-0000-4000-8000-000000000802', 'fb360000-0000-4000-8000-000000000907') ->> 'status'),
  'pending', 'the owner requeues the failed event');
select extensions.is(
  (select count(*)::integer from public.audit_events
   where organization_id = 'fb360000-0000-4000-8000-000000000201' and event_name = 'memory.capture_retried'),
  1, 'the retry is audited');
select extensions.is(
  pg_temp.state_of($$ select public.retry_memory_capture('fb360000-0000-4000-8000-000000000201', 'fb360000-0000-4000-8000-000000000001', 'fb360000-0000-4000-8000-000000000802', 'fb360000-0000-4000-8000-000000000908') $$),
  '23505', 'a pending event is not retryable');

select * from extensions.finish();

rollback;
