begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(44);

-- Spec 023 Task B: capture-dispatch cursor plus reconcile power. The cursor
-- migration is pending review and NOT applied on shared staging yet, so every
-- call to a new function goes through pg_temp.state_of (a missing function
-- reports a failure code instead of aborting the script) while every value
-- assertion reads a long-lived table that exists already. The three Channel
-- enqueue helpers ARE live (Task A pushed).
--
-- NOTE on roles: direct calls below run as the migration owner unless stated,
-- the way a nested definer call would. service_role privilege is proven with
-- pg_temp.priv_of catalog lookups AND with real wrapper calls under
-- `set local role service_role`: the wrappers are public, so the worker role
-- executes the exact path the reconcile task will take post-push. No
-- private-schema calls appear anywhere: nothing needs schema USAGE, and none
-- is granted.

create or replace function pg_temp.state_of(call_sql text)
returns text language plpgsql as $$
begin
  execute call_sql;
  return 'no-error';
exception when others then
  return SQLSTATE;
end;
$$;

create or replace function pg_temp.priv_of(p_role text, p_sig text)
returns text language plpgsql as $$
begin
  if pg_catalog.has_function_privilege(p_role, p_sig, 'execute') then
    return 'true';
  end if;
  return 'false';
exception when others then
  return 'missing';
end;
$$;

-- The rotation column rides the pending migration, so a raw select would
-- abort the whole suite pre-push (undefined_column, uncatchable in plain
-- SQL). This accessor reports NULL instead; post-push it reads the value.
create or replace function pg_temp.rotation_of(p_org uuid)
returns text language plpgsql as $$
declare
  v_cursor uuid;
begin
  execute 'select reconcile_org_cursor from public.memory_integration_settings where organization_id = $1'
    using p_org into v_cursor;
  return v_cursor::text;
exception when undefined_column then
  return null;
end;
$$;

-- Structure ---------------------------------------------------------------------

select extensions.has_function(
  'public', 'update_memory_capture_cursor', 'cursor writes are database-owned');
select extensions.is(
  pg_temp.priv_of('service_role', 'public.update_memory_capture_cursor(uuid,text,text,uuid)'),
  'true', 'the worker holds the cursor path');
select extensions.is(
  pg_temp.priv_of('authenticated', 'public.update_memory_capture_cursor(uuid,text,text,uuid)'),
  'false', 'members never move a reconcile cursor');
select extensions.is(
  pg_temp.priv_of('anon', 'public.update_memory_capture_cursor(uuid,text,text,uuid)'),
  'false', 'anonymous callers hold nothing');
select extensions.is(
  pg_temp.priv_of('service_role', 'private.enqueue_memory_channel_findings(uuid,uuid)'),
  'true', 'reconcile may replay the findings helper');
select extensions.is(
  pg_temp.priv_of('service_role', 'private.enqueue_memory_channel_recommendations(uuid,uuid)'),
  'true', 'and the recommendations helper');
select extensions.is(
  pg_temp.priv_of('service_role', 'private.enqueue_memory_channel_decision(uuid,uuid)'),
  'true', 'and the decision helper');

-- Fixtures ------------------------------------------------------------------------

insert into auth.users (id) values
  ('fb380000-0000-4000-8000-000000000001'::uuid),
  ('fb380000-0000-4000-8000-000000000004'::uuid);
insert into public.accounts (id, name, slug, created_by) values
  ('fb380000-0000-4000-8000-000000000101'::uuid, 'Cursor verifier', 'cursor-verifier', 'fb380000-0000-4000-8000-000000000001'::uuid);
insert into public.organizations (id, account_id, name, slug, industry, country_code, base_currency, default_timezone, created_by) values
  ('fb380000-0000-4000-8000-000000000201'::uuid, 'fb380000-0000-4000-8000-000000000101'::uuid, 'Cursor verifier', 'cursor-verifier', 'testing', 'AE', 'AED', 'Asia/Dubai', 'fb380000-0000-4000-8000-000000000001'::uuid),
  ('fb380000-0000-4000-8000-000000000202'::uuid, 'fb380000-0000-4000-8000-000000000101'::uuid, 'Cursor verifier plain', 'cursor-verifier-plain', 'testing', 'AE', 'AED', 'Asia/Dubai', 'fb380000-0000-4000-8000-000000000001'::uuid);
insert into public.account_memberships (account_id, user_id, account_role, default_organization_role) values
  ('fb380000-0000-4000-8000-000000000101'::uuid, 'fb380000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner');
insert into public.organization_memberships (organization_id, user_id, role) values
  ('fb380000-0000-4000-8000-000000000201'::uuid, 'fb380000-0000-4000-8000-000000000004'::uuid, 'operator');

insert into public.channel_analysis_runs (
  id, organization_id, window_start, window_end, period_grain, window_timezone,
  registry_version, detector_versions, metric_versions, input_digest, status,
  completed_at, result_digest, correlation_id
) values
  ('fb380000-0000-4000-8000-000000000601'::uuid, 'fb380000-0000-4000-8000-000000000201'::uuid,
   date '2026-01-01', date '2026-01-05', 'day', 'Asia/Dubai', 1, '[{}]'::jsonb, '[]'::jsonb,
   '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'completed', now(), 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'fb380000-0000-4000-8000-000000000911');

insert into public.channel_findings (
  id, organization_id, analysis_run_id, detector_key, detector_version, kind, code,
  severity, priority, quality_state, calculation_digest
) values
  ('fb380000-0000-4000-8000-000000000701'::uuid, 'fb380000-0000-4000-8000-000000000201'::uuid,
   'fb380000-0000-4000-8000-000000000601'::uuid, 'revenue.period_movement', 1, 'finding',
   'REVENUE_DROPPED_VS_PRIOR_PERIOD', 'medium', 50, 'complete',
   'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

-- A second completed run with its own finding, reserved for the public
-- wrapper proof: the private helper already enqueued run 601 above, and the
-- helpers skip existing (finding, revision) pairs, so replaying 601 through
-- the wrapper would return 0 and prove nothing about insertion.

insert into public.channel_analysis_runs (
  id, organization_id, window_start, window_end, period_grain, window_timezone,
  registry_version, detector_versions, metric_versions, input_digest, status,
  completed_at, result_digest, correlation_id
) values
  ('fb380000-0000-4000-8000-000000000602'::uuid, 'fb380000-0000-4000-8000-000000000201'::uuid,
   date '2026-02-01', date '2026-02-05', 'day', 'Asia/Dubai', 1, '[{}]'::jsonb, '[]'::jsonb,
   'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'completed', now(), 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', 'fb380000-0000-4000-8000-000000000912');

insert into public.channel_findings (
  id, organization_id, analysis_run_id, detector_key, detector_version, kind, code,
  severity, priority, quality_state, calculation_digest
) values
  ('fb380000-0000-4000-8000-000000000702'::uuid, 'fb380000-0000-4000-8000-000000000201'::uuid,
   'fb380000-0000-4000-8000-000000000602'::uuid, 'revenue.period_movement', 1, 'finding',
   'REVENUE_DROPPED_VS_PRIOR_PERIOD', 'medium', 50, 'complete',
   'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd');

-- The owner enables capture with a distinctive flag mix so the cursor writes
-- below can prove they flip nothing.

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'fb380000-0000-4000-8000-000000000001';

select extensions.is(
  (select public.update_memory_integration_settings('fb380000-0000-4000-8000-000000000201', 'fb380000-0000-4000-8000-000000000001', true, true, false, false, false, false, 'shared-context-v1', 'fb380000-0000-4000-8000-000000000901') ->> 'captureEnabled'),
  'true', 'the owner enables capture for the reconcile org');

-- Cursor writes ---------------------------------------------------------------------

reset role;
set local role service_role;

select extensions.is(
  pg_temp.state_of($$ select public.update_memory_capture_cursor('fb380000-0000-4000-8000-000000000201', 'channel', 'f|2026-09-11T00:00:00.000Z', 'fb380000-0000-4000-8000-000000000921') $$),
  'no-error', 'the channel cursor write succeeds');
select extensions.is(
  (select channel_cursor from public.memory_integration_settings where organization_id = 'fb380000-0000-4000-8000-000000000201'),
  'f|2026-09-11T00:00:00.000Z', 'the channel cursor round-trips');

select extensions.is(
  pg_temp.state_of($$ select public.update_memory_capture_cursor('fb380000-0000-4000-8000-000000000201', 'growth', 'f|2026-09-11T00:00:00.000Z', 'fb380000-0000-4000-8000-000000000922') $$),
  'no-error', 'the growth cursor write succeeds');
select extensions.is(
  (select channel_cursor || ',' || growth_cursor || ',' || coalesce(campaign_cursor, '-')
   from public.memory_integration_settings where organization_id = 'fb380000-0000-4000-8000-000000000201'),
  'f|2026-09-11T00:00:00.000Z,f|2026-09-11T00:00:00.000Z,-', 'each adapter writes only its own column');

select extensions.is(
  pg_temp.state_of($$ select public.update_memory_capture_cursor('fb380000-0000-4000-8000-000000000201', 'campaign', 'f|2026-09-10T00:00:00.000Z', 'fb380000-0000-4000-8000-000000000923') $$),
  'no-error', 'the campaign cursor write succeeds');
select extensions.is(
  (select campaign_cursor from public.memory_integration_settings where organization_id = 'fb380000-0000-4000-8000-000000000201'),
  'f|2026-09-10T00:00:00.000Z', 'the campaign cursor round-trips');

select extensions.is(
  (select capture_enabled::text || '/' || channel_context_enabled::text || '/' || growth_context_enabled::text || '/' || context_policy_version
   from public.memory_integration_settings where organization_id = 'fb380000-0000-4000-8000-000000000201'),
  'true/true/false/shared-context-v1', 'cursor progress never flips a flag');

-- An organization with no settings row yet gets a disabled-defaults row: the
-- cursor lands and capture stays off.

select extensions.is(
  pg_temp.state_of($$ select public.update_memory_capture_cursor('fb380000-0000-4000-8000-000000000202', 'channel', 'f|2026-09-11T00:00:00.000Z', 'fb380000-0000-4000-8000-000000000924') $$),
  'no-error', 'a cursor write creates the missing settings row');
select extensions.is(
  (select capture_enabled::text || '/' || channel_cursor
   from public.memory_integration_settings where organization_id = 'fb380000-0000-4000-8000-000000000202'),
  'false/f|2026-09-11T00:00:00.000Z', 'the created row stays disabled-defaults');

-- Refusals ----------------------------------------------------------------------------

select extensions.is(
  pg_temp.state_of($$ select public.update_memory_capture_cursor('fb380000-0000-4000-8000-000000000201', 'channel_finding', 'f|2026-09-11T00:00:00.000Z', 'fb380000-0000-4000-8000-000000000925') $$),
  '23514', 'a source kind is not an adapter');
select extensions.is(
  pg_temp.state_of($$ select public.update_memory_capture_cursor('fb380000-0000-4000-8000-000000000201', 'CHANNEL', 'f|2026-09-11T00:00:00.000Z', 'fb380000-0000-4000-8000-000000000926') $$),
  '23514', 'the adapter vocabulary is exact');
select extensions.is(
  pg_temp.state_of($$ select public.update_memory_capture_cursor('fb380000-0000-4000-8000-000000000201', 'channel', '', 'fb380000-0000-4000-8000-000000000927') $$),
  '23514', 'an empty cursor is refused');
select extensions.is(
  pg_temp.state_of($$ select public.update_memory_capture_cursor('fb380000-0000-4000-8000-000000000201', 'channel', repeat('x', 201), 'fb380000-0000-4000-8000-000000000928') $$),
  '23514', 'an overlong cursor is refused');

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'fb380000-0000-4000-8000-000000000004';

select extensions.is(
  pg_temp.state_of($$ select public.update_memory_capture_cursor('fb380000-0000-4000-8000-000000000201', 'channel', 'f|2026-09-11T00:00:00.000Z', 'fb380000-0000-4000-8000-000000000929') $$),
  '42501', 'a member cannot move a reconcile cursor');

reset role;
set local role anon;

select extensions.is(
  pg_temp.state_of($$ select public.update_memory_capture_cursor('fb380000-0000-4000-8000-000000000201', 'channel', 'f|2026-09-11T00:00:00.000Z', 'fb380000-0000-4000-8000-000000000930') $$),
  '42501', 'an anonymous caller cannot either');

-- Grant proof: the live findings helper runs for real -------------------------------
--
-- This runs as the migration owner (revoked tables are readable that way);
-- the service_role execute grant itself is proven by assertions 5-7 above.

reset role;

select extensions.is(
  private.enqueue_memory_channel_findings(
    'fb380000-0000-4000-8000-000000000201', 'fb380000-0000-4000-8000-000000000601')::text,
  '1', 'the findings helper enqueues the completed run for real');

-- Service-only wrappers ---------------------------------------------------------------
--
-- All three run below as service_role: the wrappers are public, so these are
-- the worker's exact post-push call paths, not owner-bypassed approximations.

select extensions.has_function(
  'public', 'reconcile_memory_channel_findings', 'the findings wrapper exists');
select extensions.has_function(
  'public', 'reconcile_memory_channel_recommendations', 'the recommendations wrapper exists');
select extensions.has_function(
  'public', 'reconcile_memory_channel_decision', 'the decision wrapper exists');
select extensions.is(
  pg_temp.priv_of('service_role', 'public.reconcile_memory_channel_findings(uuid,uuid)'),
  'true', 'the worker holds the findings wrapper');
select extensions.is(
  pg_temp.priv_of('service_role', 'public.reconcile_memory_channel_recommendations(uuid,uuid)'),
  'true', 'the worker holds the recommendations wrapper');
select extensions.is(
  pg_temp.priv_of('service_role', 'public.reconcile_memory_channel_decision(uuid,uuid)'),
  'true', 'the worker holds the decision wrapper');
select extensions.is(
  pg_temp.priv_of('authenticated', 'public.reconcile_memory_channel_findings(uuid,uuid)'),
  'false', 'members hold no findings wrapper');
select extensions.is(
  pg_temp.priv_of('authenticated', 'public.reconcile_memory_channel_recommendations(uuid,uuid)'),
  'false', 'no recommendations wrapper either');
select extensions.is(
  pg_temp.priv_of('authenticated', 'public.reconcile_memory_channel_decision(uuid,uuid)'),
  'false', 'and no decision wrapper');
select extensions.is(
  pg_temp.priv_of('anon', 'public.reconcile_memory_channel_findings(uuid,uuid)'),
  'false', 'anonymous callers hold no findings wrapper');
select extensions.is(
  pg_temp.priv_of('anon', 'public.reconcile_memory_channel_recommendations(uuid,uuid)'),
  'false', 'no recommendations wrapper either');
select extensions.is(
  pg_temp.priv_of('anon', 'public.reconcile_memory_channel_decision(uuid,uuid)'),
  'false', 'and no decision wrapper');

reset role;
set local role service_role;

select extensions.is(
  pg_temp.state_of($$ select public.reconcile_memory_channel_findings('fb380000-0000-4000-8000-000000000201', 'fb380000-0000-4000-8000-000000000602') $$),
  'no-error', 'the worker replays the findings helper through its wrapper');
select extensions.is(
  (select count(*)::integer from public.memory_capture_events where organization_id = 'fb380000-0000-4000-8000-000000000201' and channel_finding_id = 'fb380000-0000-4000-8000-000000000702'),
  1, 'the wrapper enqueue lands exactly one event');

select extensions.is(
  pg_temp.state_of($$ select public.reconcile_memory_channel_recommendations('fb380000-0000-4000-8000-000000000201', 'fb380000-0000-4000-8000-000000000601') $$),
  'no-error', 'the recommendations wrapper runs (no recs on the run, no events)');
select extensions.is(
  pg_temp.state_of($$ select public.reconcile_memory_channel_decision('fb380000-0000-4000-8000-000000000201', 'fb380000-0000-4000-8000-000000000d01') $$),
  'no-error', 'the decision wrapper runs (unknown decision, no event)');

-- Rotation cursor -----------------------------------------------------------------------
--
-- The worker marks each fully-reconciled org with its own id; the next scan
-- resumes after the freshest marker with wrap-around.

select extensions.is(
  pg_temp.state_of($$ select public.update_memory_reconcile_org_cursor('fb380000-0000-4000-8000-000000000201', 'fb380000-0000-4000-8000-000000000941') $$),
  'no-error', 'the rotation marker write succeeds');
select extensions.is(
  pg_temp.rotation_of('fb380000-0000-4000-8000-000000000201'),
  'fb380000-0000-4000-8000-000000000201', 'the rotation marker round-trips');

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'fb380000-0000-4000-8000-000000000004';

select extensions.is(
  pg_temp.state_of($$ select public.update_memory_reconcile_org_cursor('fb380000-0000-4000-8000-000000000201', 'fb380000-0000-4000-8000-000000000942') $$),
  '42501', 'a member cannot move the rotation marker');

reset role;
set local role anon;

select extensions.is(
  pg_temp.state_of($$ select public.update_memory_reconcile_org_cursor('fb380000-0000-4000-8000-000000000201', 'fb380000-0000-4000-8000-000000000943') $$),
  '42501', 'an anonymous caller cannot either');

select * from extensions.finish();

rollback;
