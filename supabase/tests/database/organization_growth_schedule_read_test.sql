begin;

create extension if not exists pgtap with schema extensions;

select extensions.no_plan();

-- Covers `20260918130000_organization_growth_schedule_read.sql`.
--
-- Like a receptionist who confirms a booking date without opening the safe:
-- the nightly worker (service_role) holds no SELECT on the frozen
-- projection table, and this service-only RPC answers only the question
-- publication needs — which schedule origins sit behind active or upcoming
-- rows. No amounts, points, scopes, digests or source identities travel.
-- The suite is rollback-wrapped. Synthetic identifiers only.
--
-- GATE: this suite runs against hosted staging via `pnpm db:test` (Task 8
-- gate). A clean migration apply is not execution evidence for the new
-- function: the function must be called at least once here before the
-- worker wiring is considered done.

-- Fixtures ---------------------------------------------------------------------

insert into auth.users (id) values
  ('b2000000-0000-4000-8000-000000000001'::uuid);

insert into public.accounts (id, name, slug, created_by) values
  ('b2000000-0000-4000-8000-000000000011'::uuid, 'Schedule agency', 'schedule-agency', 'b2000000-0000-4000-8000-000000000001'::uuid);

insert into public.organizations (
  id, account_id, name, slug, industry, country_code, base_currency,
  default_timezone, created_by
) values
  ('b2000000-0000-4000-8000-000000000021'::uuid, 'b2000000-0000-4000-8000-000000000011'::uuid, 'Schedule client', 'schedule-client', 'testing', 'AE', 'AED', 'Asia/Dubai', 'b2000000-0000-4000-8000-000000000001'::uuid);

insert into public.organization_memberships (organization_id, user_id, role) values
  ('b2000000-0000-4000-8000-000000000021'::uuid, 'b2000000-0000-4000-8000-000000000001'::uuid, 'owner');

-- Direct owner insert: the schedule RPC never parses the frozen document,
-- so setup needs only the identity and period columns it actually reads.
insert into public.organization_growth_projections (
  organization_id, schedule_origin_date, cycle_index, horizon_months,
  period_start, period_end_exclusive, issued_at, source_cutoff_date,
  timezone, currency, metric_key, scope_digest, input_digest,
  document_version, method_version,
  requires_growth_read, requires_campaign_read, frozen_document
) values
  ('b2000000-0000-4000-8000-000000000021'::uuid, '2030-01-01', 0, 1,
   '2030-01-01', '2030-02-01', '2029-12-31T20:00:00Z', '2029-12-31',
   'Asia/Dubai', 'AED', 'revenue.gross', repeat('a', 64), repeat('b', 64),
   1, 'even_pace_v1', false, false, '{}'::jsonb),
  ('b2000000-0000-4000-8000-000000000021'::uuid, '2030-01-01', 0, 3,
   '2030-01-01', '2030-04-01', '2029-12-31T20:00:00Z', '2029-12-31',
   'Asia/Dubai', 'AED', 'revenue.gross', repeat('a', 64), repeat('b', 64),
   1, 'even_pace_v1', false, false, '{}'::jsonb),
  -- A finished cycle on a retired origin: invisible to the schedule read.
  -- cycle_index 1: the identity key is (organization, horizon, cycle), so a
  -- second cycle-0 row would abort the suite on the unique constraint.
  ('b2000000-0000-4000-8000-000000000021'::uuid, '2029-06-01', 1, 1,
   '2029-06-01', '2029-07-01', '2029-05-31T20:00:00Z', '2029-05-31',
   'Asia/Dubai', 'AED', 'revenue.gross', repeat('a', 64), repeat('b', 64),
   1, 'even_pace_v1', false, false, '{}'::jsonb);

-- Contract: the schedule RPC -----------------------------------------------------

select extensions.has_function(
  'public', 'read_organization_growth_schedule',
  array['uuid', 'date'],
  'the schedule RPC exists');
select extensions.is(
  (select prosecdef from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'read_organization_growth_schedule'),
  true,
  'the RPC runs as definer behind revoked execute');
select extensions.ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.read_organization_growth_schedule(uuid, date)',
    'EXECUTE'),
  'only the worker role may execute the RPC');
select extensions.ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'public.read_organization_growth_schedule(uuid, date)',
    'EXECUTE'),
  'members cannot execute the RPC, owner included');
select extensions.ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.read_organization_growth_schedule(uuid, date)',
    'EXECUTE'),
  'anonymous callers cannot execute the RPC');
select extensions.ok(
  not pg_catalog.has_table_privilege(
    'service_role', 'public.organization_growth_projections', 'SELECT'),
  'the Task-2 revocation stands: the worker still holds no direct SELECT');

-- Behavior: origins only -----------------------------------------------------------

set local role service_role;

select extensions.results_eq(
  $_$select * from public.read_organization_growth_schedule(
    'b2000000-0000-4000-8000-000000000021'::uuid,
    '2030-01-15'::date)$_$,
  $$values ('2030-01-01'::date)$$,
  'the worker reads the single live origin; the retired origin stays hidden');

select extensions.is_empty(
  $_$select * from public.read_organization_growth_schedule(
    'b2000000-0000-4000-8000-000000000099'::uuid,
    '2030-01-15'::date)$_$,
  'an unknown organization reads as an empty schedule, never an error');

select extensions.is_empty(
  $_$select * from public.read_organization_growth_schedule(
    'b2000000-0000-4000-8000-000000000021'::uuid,
    '2031-01-01'::date)$_$,
  'past every period end the schedule reads empty: no backfill signal');

reset role;

set local role authenticated;
set local request.jwt.claim.sub = 'b2000000-0000-4000-8000-000000000001';

select extensions.throws_ok(
  $_$select * from public.read_organization_growth_schedule(
    'b2000000-0000-4000-8000-000000000021'::uuid,
    '2030-01-15'::date)$_$,
  '42501', null,
  'every authenticated role is denied the RPC');

reset role;

select extensions.finish();

rollback;
