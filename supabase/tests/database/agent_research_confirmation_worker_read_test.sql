begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(20);

select extensions.ok(
  pg_catalog.has_column_privilege(
    'service_role', 'public.organization_market_profile_decisions', required.column_name, 'SELECT'
  ),
  'worker can read confirmation field ' || required.column_name
)
from pg_catalog.unnest(array[
  'id', 'organization_id', 'market_profile_id', 'market_profile_version_id',
  'decision', 'profile_digest', 'created_at'
]) as required(column_name);

select extensions.ok(
  not pg_catalog.has_column_privilege(
    'service_role', 'public.organization_market_profile_decisions', private_field.column_name, 'SELECT'
  ),
  'worker cannot read private decision field ' || private_field.column_name
)
from pg_catalog.unnest(array[
  'reason', 'decided_by', 'correlation_id', 'superseded_by_version_id'
]) as private_field(column_name);

select extensions.ok(
  not pg_catalog.has_table_privilege(
    'service_role', 'public.organization_market_profile_decisions', 'SELECT'
  ),
  'worker receives no table-wide decision read'
);
select extensions.ok(
  not pg_catalog.has_any_column_privilege(
    'service_role', 'public.organization_market_profile_decisions', 'INSERT,UPDATE'
  )
  and not pg_catalog.has_table_privilege(
    'service_role', 'public.organization_market_profile_decisions', 'DELETE,TRUNCATE'
  ),
  'worker receives no direct decision writes'
);
select extensions.ok(
  not pg_catalog.has_any_column_privilege(
    'anon', 'public.organization_market_profile_decisions', 'SELECT'
  ),
  'anonymous callers receive no decision read'
);
select extensions.ok(
  pg_catalog.has_table_privilege(
    'authenticated', 'public.organization_market_profile_decisions', 'SELECT'
  )
  and not pg_catalog.has_any_column_privilege(
    'authenticated', 'public.organization_market_profile_decisions', 'INSERT,UPDATE'
  )
  and not pg_catalog.has_table_privilege(
    'authenticated', 'public.organization_market_profile_decisions', 'DELETE,TRUNCATE'
  ),
  'authenticated source read and write fences remain unchanged'
);

set local role service_role;

-- LIMIT 0 exercises the exact worker projection, filters and ordering without
-- exposing source records or creating test profile/approval data on staging.
select extensions.lives_ok(
  $$select decision, profile_digest
    from public.organization_market_profile_decisions
    where organization_id = '10000000-0000-4000-8000-000000000001'::uuid
      and market_profile_id = '30000000-0000-4000-8000-000000000003'::uuid
      and market_profile_version_id = '40000000-0000-4000-8000-000000000004'::uuid
    order by created_at desc, id desc
    limit 0$$,
  'worker can execute the exact tenant/version-bound confirmation read'
);
select extensions.throws_ok(
  $$select reason from public.organization_market_profile_decisions limit 0$$,
  '42501', 'permission denied for table organization_market_profile_decisions',
  'worker cannot select a private decision note'
);
select extensions.throws_ok(
  $$insert into public.organization_market_profile_decisions (id)
    select null::uuid where false$$,
  '42501', 'permission denied for table organization_market_profile_decisions',
  'worker cannot insert a decision directly'
);
select extensions.throws_ok(
  $$update public.organization_market_profile_decisions set decision = decision where false$$,
  '42501', 'permission denied for table organization_market_profile_decisions',
  'worker cannot update a decision directly'
);
select extensions.throws_ok(
  $$delete from public.organization_market_profile_decisions where false$$,
  '42501', 'permission denied for table organization_market_profile_decisions',
  'worker cannot delete a decision directly'
);

reset role;

select * from extensions.finish();

rollback;
