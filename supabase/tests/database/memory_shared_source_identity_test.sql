begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(10);

-- Spec 023 Task 02 source identity: composite tenant keys everywhere, exactly
-- one typed source per kind, one intent per source revision. Source tables
-- needed no changes: every backing table already carries (organization_id, id).

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

select extensions.ok(
  exists (select 1 from pg_catalog.pg_indexes
          where indexname = 'memory_capture_events_channel_finding_revision'),
  'one intent per finding revision');
select extensions.ok(
  exists (select 1 from pg_catalog.pg_indexes
          where indexname = 'memory_capture_events_projected_item'),
  'one projection per completed event');
select extensions.ok(
  exists (select 1 from pg_catalog.pg_constraint where conname = 'memory_capture_events_channel_finding_fk'),
  'finding links ride a composite tenant key');
select extensions.ok(
  exists (select 1 from pg_catalog.pg_constraint
          where conrelid = 'public.channel_findings'::pg_catalog.regclass
            and pg_catalog.array_length(conkey, 1) = 2),
  'the finding side already keys on organization plus id');

-- Fixtures ------------------------------------------------------------------------

insert into auth.users (id) values
  ('fb350000-0000-4000-8000-000000000001'::uuid),
  ('fb350000-0000-4000-8000-000000000002'::uuid);
insert into public.accounts (id, name, slug, created_by) values
  ('fb350000-0000-4000-8000-000000000101'::uuid, 'Identity verifier', 'identity-verifier', 'fb350000-0000-4000-8000-000000000001'::uuid),
  ('fb350000-0000-4000-8000-000000000102'::uuid, 'Identity outsider', 'identity-outsider', 'fb350000-0000-4000-8000-000000000002'::uuid);
insert into public.organizations (id, account_id, name, slug, industry, country_code, base_currency, default_timezone, created_by) values
  ('fb350000-0000-4000-8000-000000000201'::uuid, 'fb350000-0000-4000-8000-000000000101'::uuid, 'Identity verifier', 'identity-verifier', 'testing', 'AE', 'AED', 'Asia/Dubai', 'fb350000-0000-4000-8000-000000000001'::uuid),
  ('fb350000-0000-4000-8000-000000000202'::uuid, 'fb350000-0000-4000-8000-000000000102'::uuid, 'Identity outsider', 'identity-outsider', 'testing', 'AE', 'AED', 'Asia/Dubai', 'fb350000-0000-4000-8000-000000000002'::uuid);
insert into public.account_memberships (account_id, user_id, account_role, default_organization_role) values
  ('fb350000-0000-4000-8000-000000000101'::uuid, 'fb350000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner'),
  ('fb350000-0000-4000-8000-000000000102'::uuid, 'fb350000-0000-4000-8000-000000000002'::uuid, 'owner', 'owner');

insert into public.channel_analysis_runs (
  id, organization_id, window_start, window_end, period_grain, window_timezone,
  registry_version, detector_versions, metric_versions, input_digest, status,
  completed_at, result_digest, correlation_id
) values
  ('fb350000-0000-4000-8000-000000000601'::uuid, 'fb350000-0000-4000-8000-000000000201'::uuid,
   date '2026-01-01', date '2026-01-05', 'day', 'Asia/Dubai', 1, '[{}]'::jsonb, '[]'::jsonb,
   '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'completed', now(), 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'fb350000-0000-4000-8000-000000000911'),
  ('fb350000-0000-4000-8000-000000000602'::uuid, 'fb350000-0000-4000-8000-000000000202'::uuid,
   date '2026-01-01', date '2026-01-05', 'day', 'Asia/Dubai', 1, '[{}]'::jsonb, '[]'::jsonb,
   '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'completed', now(), 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'fb350000-0000-4000-8000-000000000912');

insert into public.channel_findings (
  id, organization_id, analysis_run_id, detector_key, detector_version, kind, code,
  severity, priority, quality_state, calculation_digest
) values
  ('fb350000-0000-4000-8000-000000000701'::uuid, 'fb350000-0000-4000-8000-000000000201'::uuid,
   'fb350000-0000-4000-8000-000000000601'::uuid, 'revenue.period_movement', 1, 'finding',
   'REVENUE_DROPPED_VS_PRIOR_PERIOD', 'medium', 50, 'complete',
   'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
  ('fb350000-0000-4000-8000-000000000702'::uuid, 'fb350000-0000-4000-8000-000000000202'::uuid,
   'fb350000-0000-4000-8000-000000000602'::uuid, 'revenue.period_movement', 1, 'finding',
   'REVENUE_DROPPED_VS_PRIOR_PERIOD', 'medium', 50, 'complete',
   'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');

-- Identity --------------------------------------------------------------------------

select extensions.lives_ok(
  $$ insert into public.memory_capture_events (
       id, organization_id, source_kind, channel_finding_id, source_revision, source_digest, correlation_id
     ) values (
       'fb350000-0000-4000-8000-000000000801', 'fb350000-0000-4000-8000-000000000201',
       'channel_finding', 'fb350000-0000-4000-8000-000000000701', 1,
       'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
       'fb350000-0000-4000-8000-000000000901') $$,
  'a well-keyed capture intent lands');

select extensions.is(
  pg_temp.state_of($$ insert into public.memory_capture_events (
       id, organization_id, source_kind, channel_finding_id, source_revision, source_digest, correlation_id
     ) values (
       'fb350000-0000-4000-8000-000000000802', 'fb350000-0000-4000-8000-000000000201',
       'channel_finding', 'fb350000-0000-4000-8000-000000000701', 1,
       'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
       'fb350000-0000-4000-8000-000000000902') $$),
  '23505', 'the same source revision cannot queue twice');

select extensions.is(
  pg_temp.state_of($$ insert into public.memory_capture_events (
       id, organization_id, source_kind, channel_finding_id, source_revision, source_digest, correlation_id
     ) values (
       'fb350000-0000-4000-8000-000000000803', 'fb350000-0000-4000-8000-000000000202',
       'channel_finding', 'fb350000-0000-4000-8000-000000000701', 1,
       'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
       'fb350000-0000-4000-8000-000000000903') $$),
  '23503', 'a finding of another tenant cannot back this organization''s intent');

select extensions.is(
  pg_temp.state_of($$ insert into public.memory_capture_events (
       id, organization_id, source_kind, channel_finding_id, source_revision, source_digest, correlation_id
     ) values (
       'fb350000-0000-4000-8000-000000000804', 'fb350000-0000-4000-8000-000000000201',
       'channel_finding', 'fb350000-0000-4000-8000-000000000799', 1,
       'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
       'fb350000-0000-4000-8000-000000000904') $$),
  '23503', 'an invented source resolves nowhere');

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'fb350000-0000-4000-8000-000000000002';

select extensions.is(
  pg_temp.state_of($$ select count(*) from public.memory_capture_events
   where organization_id = 'fb350000-0000-4000-8000-000000000201' $$),
  '42501', 'another organization''s member cannot even read these intents');

select extensions.is(
  pg_temp.state_of($$ insert into public.memory_capture_events (
       id, organization_id, source_kind, channel_finding_id, source_revision, source_digest, correlation_id
     ) values (
       'fb350000-0000-4000-8000-000000000805', 'fb350000-0000-4000-8000-000000000201',
       'channel_finding', 'fb350000-0000-4000-8000-000000000701', 2,
       'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
       'fb350000-0000-4000-8000-000000000905') $$),
  '42501', 'no browser session writes the queue directly');

select * from extensions.finish();

rollback;
