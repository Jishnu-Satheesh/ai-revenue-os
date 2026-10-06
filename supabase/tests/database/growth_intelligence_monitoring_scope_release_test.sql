begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(7);

-- Forward correction for 20260914054733: the scope guard rejected the two
-- governed delete paths it was documented to allow (stale-scope reclaim
-- inside create_research_project_keyed, explicit release on archive). The
-- guard is now UPDATE-only; this suite proves the deletes flow and the
-- permission checks around them still hold.

select extensions.has_trigger(
  'public', 'growth_intelligence_monitoring_active_scopes',
  'growth_intelligence_monitoring_active_scopes_append_only',
  'the scope guard stays mounted (update-immutable; deletes governed)'
);

-- Two-account fixtures ---------------------------------------------------------

insert into auth.users (id) values
  ('f8000000-0000-4000-8000-000000000001'::uuid),
  ('f8000000-0000-4000-8000-000000000002'::uuid),
  ('f8000000-0000-4000-8000-000000000003'::uuid);

insert into public.accounts (id, name, slug, created_by) values
  ('f8000000-0000-4000-8000-000000000101'::uuid, 'Scope agency A', 'scope-agency-a', 'f8000000-0000-4000-8000-000000000001'::uuid),
  ('f8000000-0000-4000-8000-000000000102'::uuid, 'Scope agency B', 'scope-agency-b', 'f8000000-0000-4000-8000-000000000003'::uuid);

insert into public.organizations (
  id, account_id, name, slug, industry, country_code, base_currency,
  default_timezone, created_by
) values
  ('f8000000-0000-4000-8000-000000000201'::uuid, 'f8000000-0000-4000-8000-000000000101'::uuid, 'Scope client A', 'scope-client-a', 'testing', 'AE', 'AED', 'Asia/Dubai', 'f8000000-0000-4000-8000-000000000001'::uuid),
  ('f8000000-0000-4000-8000-000000000202'::uuid, 'f8000000-0000-4000-8000-000000000102'::uuid, 'Scope client B', 'scope-client-b', 'testing', 'AE', 'AED', 'Asia/Dubai', 'f8000000-0000-4000-8000-000000000003'::uuid);

insert into public.account_memberships (
  account_id, user_id, account_role, default_organization_role
) values
  ('f8000000-0000-4000-8000-000000000101'::uuid, 'f8000000-0000-4000-8000-000000000001'::uuid, 'member', 'operator'),
  ('f8000000-0000-4000-8000-000000000101'::uuid, 'f8000000-0000-4000-8000-000000000002'::uuid, 'member', 'viewer'),
  ('f8000000-0000-4000-8000-000000000102'::uuid, 'f8000000-0000-4000-8000-000000000003'::uuid, 'owner', 'owner');

insert into public.branches (
  id, organization_id, name, slug, kind, timezone, currency, is_active
) values
  ('f8000000-0000-4000-8000-000000000301'::uuid, 'f8000000-0000-4000-8000-000000000201'::uuid, 'Scope branch', 'scope-branch', 'physical', 'Asia/Dubai', 'AED', true);

-- Governed release paths ---------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'f8000000-0000-4000-8000-000000000001';

create temp table pg_temp.sr_first as
select (public.create_research_project_keyed(
  'f8000000-0000-4000-8000-000000000201'::uuid,
  'f8000000-0000-4000-8000-000000000001'::uuid,
  'f8000000-0000-4000-8000-000000000301'::uuid,
  'Marina Friday dinner',
  'What do Marina families want for Friday dinner?',
  'one-time',
  null,
  'scope-release-key-1',
  'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
) ->> 'projectId')::uuid as project_id;

select extensions.is(
  (select public.create_research_project_keyed(
    'f8000000-0000-4000-8000-000000000201'::uuid,
    'f8000000-0000-4000-8000-000000000001'::uuid,
    'f8000000-0000-4000-8000-000000000301'::uuid,
    'Marina Friday dinner',
    'What do Marina families want for Friday dinner?',
    'one-time',
    null,
    'scope-release-key-1',
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
  ) ->> 'replayed'),
  'true',
  'the keyed create under test holds its scope fingerprint'
);

select extensions.is(
  (select public.release_monitoring_active_scope(
    'f8000000-0000-4000-8000-000000000201'::uuid,
    'f8000000-0000-4000-8000-000000000001'::uuid,
    (select project_id from pg_temp.sr_first)
  ) ->> 'released'),
  '1',
  'the governed release deletes the live scope row'
);

select extensions.is(
  (select pg_catalog.count(*)::integer from public.growth_intelligence_monitoring_active_scopes
   where organization_id = 'f8000000-0000-4000-8000-000000000201'::uuid),
  0,
  'no scope fingerprint lingers after the governed release'
);

select extensions.is(
  (select public.create_research_project_keyed(
    'f8000000-0000-4000-8000-000000000201'::uuid,
    'f8000000-0000-4000-8000-000000000001'::uuid,
    'f8000000-0000-4000-8000-000000000301'::uuid,
    'Marina Friday dinner',
    'What do Marina families want for Friday dinner?',
    'one-time',
    null,
    'scope-release-key-2',
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
  ) ->> 'replayed'),
  'false',
  'a released scope researches again instead of converging on the old project'
);

reset role;

set local role authenticated;
set local request.jwt.claim.sub = 'f8000000-0000-4000-8000-000000000002';

select extensions.throws_ok(
  $$ select public.release_monitoring_active_scope(
    'f8000000-0000-4000-8000-000000000201'::uuid,
    'f8000000-0000-4000-8000-000000000002'::uuid,
    (select project_id from pg_temp.sr_first)
  ) $$,
  '42501', null,
  'viewers cannot release scope fingerprints'
);

reset role;

set local role authenticated;
set local request.jwt.claim.sub = 'f8000000-0000-4000-8000-000000000003';

select extensions.throws_ok(
  $$ select public.release_monitoring_active_scope(
    'f8000000-0000-4000-8000-000000000201'::uuid,
    'f8000000-0000-4000-8000-000000000003'::uuid,
    (select project_id from pg_temp.sr_first)
  ) $$,
  '42501', null,
  'the second tenant cannot release the first tenant scope'
);

reset role;

select * from extensions.finish();

rollback;
