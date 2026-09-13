begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(15);

-- Time-based redaction of capture projection documents (Spec 023 §14).
-- Rights-driven erasure rides the erase path; this RPC covers age. Fixture
-- prefix fb46.

create or replace function pg_temp.state_of(call_sql text)
returns text language plpgsql as $$
begin
  execute call_sql;
  return 'no-error';
exception when others then
  return SQLSTATE;
end;
$$;

-- Structure -------------------------------------------------------------------

select extensions.has_function('public', 'redact_expired_capture_documents', 'the sweep exists');
select extensions.ok(
  pg_catalog.has_function_privilege('service_role', 'public.redact_expired_capture_documents(uuid,integer)', 'execute'),
  'the worker holds the sweep');
select extensions.ok(
  not pg_catalog.has_function_privilege('authenticated', 'public.redact_expired_capture_documents(uuid,integer)', 'execute'),
  'members never sweep on anyone''s behalf');
select extensions.ok(
  not pg_catalog.has_function_privilege('anon', 'public.redact_expired_capture_documents(uuid,integer)', 'execute'),
  'anonymous callers hold nothing');

-- Fixtures --------------------------------------------------------------------

insert into auth.users (id) values
  ('fb460000-0000-4000-8000-000000000001'::uuid),
  ('fb460000-0000-4000-8000-000000000002'::uuid);
insert into public.accounts (id, name, slug, created_by) values
  ('fb460000-0000-4000-8000-000000000101'::uuid, 'Sweep A', 'sweep-a', 'fb460000-0000-4000-8000-000000000001'::uuid),
  ('fb460000-0000-4000-8000-000000000102'::uuid, 'Sweep B', 'sweep-b', 'fb460000-0000-4000-8000-000000000002'::uuid);
insert into public.organizations (id, account_id, name, slug, industry, country_code, base_currency, default_timezone, created_by) values
  ('fb460000-0000-4000-8000-000000000201'::uuid, 'fb460000-0000-4000-8000-000000000101'::uuid, 'Sweep A', 'sweep-a', 'testing', 'AE', 'AED', 'Asia/Dubai', 'fb460000-0000-4000-8000-000000000001'::uuid),
  ('fb460000-0000-4000-8000-000000000202'::uuid, 'fb460000-0000-4000-8000-000000000102'::uuid, 'Sweep B', 'sweep-b', 'testing', 'AE', 'AED', 'Asia/Dubai', 'fb460000-0000-4000-8000-000000000002'::uuid);
insert into public.account_memberships (account_id, user_id, account_role, default_organization_role) values
  ('fb460000-0000-4000-8000-000000000101'::uuid, 'fb460000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner'),
  ('fb460000-0000-4000-8000-000000000102'::uuid, 'fb460000-0000-4000-8000-000000000002'::uuid, 'owner', 'owner');
insert into public.organization_memberships (organization_id, user_id, role) values
  ('fb460000-0000-4000-8000-000000000201'::uuid, 'fb460000-0000-4000-8000-000000000001'::uuid, 'owner'),
  ('fb460000-0000-4000-8000-000000000202'::uuid, 'fb460000-0000-4000-8000-000000000002'::uuid, 'owner');

insert into public.channel_analysis_runs (
  id, organization_id, window_start, window_end, period_grain, window_timezone,
  registry_version, detector_versions, metric_versions, input_digest, status,
  completed_at, result_digest, correlation_id
) values
  ('fb460000-0000-4000-8000-000000000601'::uuid, 'fb460000-0000-4000-8000-000000000201'::uuid,
   date '2026-01-01', date '2026-01-05', 'day', 'Asia/Dubai', 1, '[{}]'::jsonb, '[]'::jsonb,
   '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'completed', now(),
   'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'fb460000-0000-4000-8000-000000000901'),
  ('fb460000-0000-4000-8000-000000000602'::uuid, 'fb460000-0000-4000-8000-000000000202'::uuid,
   date '2026-01-01', date '2026-01-05', 'day', 'Asia/Dubai', 1, '[{}]'::jsonb, '[]'::jsonb,
   '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'completed', now(),
   'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'fb460000-0000-4000-8000-000000000902');

insert into public.channel_findings (
  id, organization_id, analysis_run_id, detector_key, detector_version, kind, code,
  severity, priority, quality_state, calculation_digest
) values
  ('fb460000-0000-4000-8000-000000000701'::uuid, 'fb460000-0000-4000-8000-000000000201'::uuid,
   'fb460000-0000-4000-8000-000000000601'::uuid, 'revenue.period_movement', 1, 'finding',
   'REVENUE_DROPPED_VS_PRIOR_PERIOD', 'medium', 50, 'complete',
   'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
  ('fb460000-0000-4000-8000-000000000702'::uuid, 'fb460000-0000-4000-8000-000000000202'::uuid,
   'fb460000-0000-4000-8000-000000000602'::uuid, 'revenue.period_movement', 1, 'finding',
   'REVENUE_DROPPED_VS_PRIOR_PERIOD', 'medium', 50, 'complete',
   'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

insert into public.memory_capture_events (
  id, organization_id, source_kind, channel_finding_id, source_revision, source_digest,
  correlation_id, projection_document, retain_until, created_at
) values
  -- Old, no stricter date: redacted by the 90-day default.
  ('fb460000-0000-4000-8000-000000000801'::uuid, 'fb460000-0000-4000-8000-000000000201'::uuid,
   'channel_finding', 'fb460000-0000-4000-8000-000000000701', 1,
   'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
   'fb460000-0000-4000-8000-000000000911', '{"note": "old"}'::jsonb, null,
   pg_catalog.now() - pg_catalog.make_interval(days => 100)),
  -- Old, but a future retain_until keeps it.
  ('fb460000-0000-4000-8000-000000000802'::uuid, 'fb460000-0000-4000-8000-000000000201'::uuid,
   'channel_finding', 'fb460000-0000-4000-8000-000000000701', 2,
   'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
   'fb460000-0000-4000-8000-000000000912', '{"note": "held"}'::jsonb,
   pg_catalog.now() + pg_catalog.make_interval(days => 30),
   pg_catalog.now() - pg_catalog.make_interval(days => 100)),
  -- Fresh: kept.
  ('fb460000-0000-4000-8000-000000000803'::uuid, 'fb460000-0000-4000-8000-000000000201'::uuid,
   'channel_finding', 'fb460000-0000-4000-8000-000000000701', 3,
   'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
   'fb460000-0000-4000-8000-000000000913', '{"note": "fresh"}'::jsonb, null, pg_catalog.now()),
  -- Already empty: not counted again.
  ('fb460000-0000-4000-8000-000000000804'::uuid, 'fb460000-0000-4000-8000-000000000201'::uuid,
   'channel_finding', 'fb460000-0000-4000-8000-000000000701', 4,
   'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
   'fb460000-0000-4000-8000-000000000914', '{}'::jsonb, null,
   pg_catalog.now() - pg_catalog.make_interval(days => 100)),
  -- Another tenant, old: never touched by this org's sweep.
  ('fb460000-0000-4000-8000-000000000805'::uuid, 'fb460000-0000-4000-8000-000000000202'::uuid,
   'channel_finding', 'fb460000-0000-4000-8000-000000000702', 1,
   'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
   'fb460000-0000-4000-8000-000000000915', '{"note": "outsider"}'::jsonb, null,
   pg_catalog.now() - pg_catalog.make_interval(days => 100));

-- Sweep -----------------------------------------------------------------------

select extensions.is(
  (public.redact_expired_capture_documents('fb460000-0000-4000-8000-000000000201'::uuid, 100)
    ->> 'redacted'),
  '1', 'exactly the default-expired document is redacted');

select extensions.is(
  (select e.projection_document::text from public.memory_capture_events e
   where e.id = 'fb460000-0000-4000-8000-000000000801'::uuid),
  '{}', 'redaction empties the document');
select extensions.is(
  (select e.source_digest from public.memory_capture_events e
   where e.id = 'fb460000-0000-4000-8000-000000000801'::uuid),
  'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  'identifiers and digests survive redaction');
select extensions.is(
  (select e.projection_document::text from public.memory_capture_events e
   where e.id = 'fb460000-0000-4000-8000-000000000802'::uuid),
  '{"note": "held"}', 'a future retain_until keeps its document');
select extensions.is(
  (select e.projection_document::text from public.memory_capture_events e
   where e.id = 'fb460000-0000-4000-8000-000000000803'::uuid),
  '{"note": "fresh"}', 'a fresh document is kept');
select extensions.is(
  (select e.projection_document::text from public.memory_capture_events e
   where e.id = 'fb460000-0000-4000-8000-000000000805'::uuid),
  '{"note": "outsider"}', 'another tenant is never touched');

select extensions.is(
  (public.redact_expired_capture_documents('fb460000-0000-4000-8000-000000000201'::uuid, 100)
    ->> 'redacted'),
  '0', 'a second sweep finds nothing new');

select extensions.is(
  (public.redact_expired_capture_documents('fb460000-0000-4000-8000-000000000201'::uuid, 5000)
    ->> 'redacted'),
  '0', 'an oversized limit clamps instead of failing');

select extensions.is(
  pg_temp.state_of($$ select public.redact_expired_capture_documents(null, 100) $$),
  '22023', 'a null organization is refused');
select extensions.is(
  pg_temp.state_of($$ select public.redact_expired_capture_documents('fb460000-0000-4000-8000-000000000201'::uuid, 0) $$),
  '22023', 'a non-positive limit is refused');

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'fb460000-0000-4000-8000-000000000001';

select extensions.is(
  pg_temp.state_of(
    $$ select public.redact_expired_capture_documents('fb460000-0000-4000-8000-000000000201'::uuid, 100) $$),
  '42501', 'members never sweep, even their own organization');

reset role;

select * from extensions.finish();

rollback;
