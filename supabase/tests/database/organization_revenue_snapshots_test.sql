begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(10);

-- Nightly revenue snapshots: one stored answer per organization per day.
-- Members read their own organization's rows; nobody reads another's; no
-- client can write; the worker's service-role path bypasses RLS by design
-- and is verified by the worker's own tests, not here.

insert into auth.users (id) values
  ('f9000000-0000-4000-8000-000000000001'::uuid),
  ('f9000000-0000-4000-8000-000000000002'::uuid);

insert into public.accounts (id, name, slug, created_by) values
  ('f9000000-0000-4000-8000-000000000101'::uuid, 'Snapshot agency A', 'snapshot-agency-a', 'f9000000-0000-4000-8000-000000000001'::uuid),
  ('f9000000-0000-4000-8000-000000000102'::uuid, 'Snapshot agency B', 'snapshot-agency-b', 'f9000000-0000-4000-8000-000000000002'::uuid);

insert into public.organizations (
  id, account_id, name, slug, industry, country_code, base_currency,
  default_timezone, created_by
) values
  ('f9000000-0000-4000-8000-000000000201'::uuid, 'f9000000-0000-4000-8000-000000000101'::uuid, 'Snapshot client A', 'snapshot-client-a', 'testing', 'AE', 'AED', 'Asia/Dubai', 'f9000000-0000-4000-8000-000000000001'::uuid),
  ('f9000000-0000-4000-8000-000000000202'::uuid, 'f9000000-0000-4000-8000-000000000102'::uuid, 'Snapshot client B', 'snapshot-client-b', 'testing', 'AE', 'AED', 'Asia/Dubai', 'f9000000-0000-4000-8000-000000000002'::uuid);

insert into public.account_memberships (
  account_id, user_id, account_role, default_organization_role
) values
  ('f9000000-0000-4000-8000-000000000101'::uuid, 'f9000000-0000-4000-8000-000000000001'::uuid, 'member', 'operator'),
  ('f9000000-0000-4000-8000-000000000102'::uuid, 'f9000000-0000-4000-8000-000000000002'::uuid, 'owner', 'owner');

select extensions.has_table('public', 'organization_revenue_snapshots', 'the snapshot table exists');
select extensions.has_pk('public', 'organization_revenue_snapshots', 'snapshots carry a primary key');
select extensions.col_is_unique(
  'public',
  'organization_revenue_snapshots',
  ARRAY['organization_id', 'snapshot_date'],
  'one row per organization per day'
);
select extensions.is(
  (
    select count(*)
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'organization_revenue_snapshots'
      and relation.relrowsecurity
      and relation.relforcerowsecurity
  ),
  1::bigint,
  'row level security is enabled and forced on snapshots'
);
select extensions.has_index(
  'public',
  'organization_revenue_snapshots',
  'organization_revenue_snapshots_org_day_idx',
  'the org-day lookup is indexed'
);

-- Worker-shaped write through the bypass role ----------------------------------

set local role service_role;

insert into public.organization_revenue_snapshots (
  organization_id, snapshot_date, scenario_input, ai_note, input_digest
) values
  ('f9000000-0000-4000-8000-000000000201'::uuid, '2026-09-16',
   '{"organizationId": "f9000000-0000-4000-8000-000000000201"}'::jsonb, null, 'digest-a'),
  ('f9000000-0000-4000-8000-000000000202'::uuid, '2026-09-16',
   '{"organizationId": "f9000000-0000-4000-8000-000000000202"}'::jsonb, null, 'digest-b');

select extensions.is(
  (select count(*)::bigint from public.organization_revenue_snapshots),
  2::bigint,
  'the worker path stores both organizations'
);

select extensions.throws_ok(
  $$ insert into public.organization_revenue_snapshots (
    organization_id, snapshot_date, scenario_input, ai_note, input_digest
  ) values (
    'f9000000-0000-4000-8000-000000000201'::uuid, '2026-09-16',
    '{}'::jsonb, null, 'digest-dup'
  )   $$,
  '23505', null,
  'the org-day key rejects a second snapshot for the same day'
);

reset role;

-- Member reads -------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'f9000000-0000-4000-8000-000000000001';

select extensions.is(
  (select count(*)::bigint from public.organization_revenue_snapshots),
  1::bigint,
  'a member reads exactly their own organization row'
);

select extensions.is(
  (select organization_id from public.organization_revenue_snapshots),
  'f9000000-0000-4000-8000-000000000201'::uuid,
  'the visible row belongs to their organization'
);

select extensions.throws_ok(
  $$ insert into public.organization_revenue_snapshots (
    organization_id, snapshot_date, scenario_input, ai_note, input_digest
  ) values (
    'f9000000-0000-4000-8000-000000000201'::uuid, '2026-09-15',
    '{}'::jsonb, null, 'digest-client'
  )   $$,
  '42501', null,
  'no client write policy exists, so inserts fail closed'
);

reset role;

select extensions.finish();

rollback;
