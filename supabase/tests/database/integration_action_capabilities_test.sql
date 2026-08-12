begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(53);

insert into auth.users (id) values
  ('1a000000-0000-4000-8000-000000000001'::uuid),
  ('1a000000-0000-4000-8000-000000000002'::uuid),
  ('1a000000-0000-4000-8000-000000000003'::uuid);

insert into public.organizations (
  id, name, slug, industry, country_code, base_currency, default_timezone, created_by
) values
  ('2a000000-0000-4000-8000-000000000001', 'Capability tenant one', 'capability-tenant-one', 'testing', 'US', 'USD', 'UTC', '1a000000-0000-4000-8000-000000000001'),
  ('2a000000-0000-4000-8000-000000000002', 'Capability tenant two', 'capability-tenant-two', 'testing', 'US', 'USD', 'UTC', '1a000000-0000-4000-8000-000000000002');

insert into public.organization_memberships (organization_id, user_id, role) values
  ('2a000000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-000000000001', 'operator'),
  ('2a000000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-000000000003', 'viewer'),
  ('2a000000-0000-4000-8000-000000000002', '1a000000-0000-4000-8000-000000000002', 'operator');

insert into public.branches (id, organization_id, name, slug, timezone, currency) values
  ('4a000000-0000-4000-8000-000000000001', '2a000000-0000-4000-8000-000000000001', 'Capability branch one', 'capability-branch-one', 'UTC', 'USD');

create temporary table action_capability_payloads (
  name text primary key,
  payload jsonb not null
) on commit drop;

insert into action_capability_payloads values (
  'valid-blocked',
  '[
    {"capability_key":"read_google_business_profile","maturity":"read-only","availability":"blocked","reason_codes":["account_unmapped"],"restriction_codes":[],"derived_from_adapter_version":"1","derived_from_contract_version":"fixture-v1"},
    {"capability_key":"read_reviews","maturity":"read-only","availability":"blocked","reason_codes":["account_unmapped"],"restriction_codes":[],"derived_from_adapter_version":"1","derived_from_contract_version":"fixture-v1"}
  ]'::jsonb
);
insert into action_capability_payloads values (
  'valid-available',
  '[
    {"capability_key":"read_google_business_profile","maturity":"read-only","availability":"available","reason_codes":[],"restriction_codes":[],"derived_from_adapter_version":"1","derived_from_contract_version":"fixture-v1"},
    {"capability_key":"read_reviews","maturity":"read-only","availability":"available","reason_codes":[],"restriction_codes":[],"derived_from_adapter_version":"1","derived_from_contract_version":"fixture-v1"}
  ]'::jsonb
);
grant select on action_capability_payloads to authenticated;

select extensions.has_column('public', 'integration_capability_grants', 'restriction_codes', 'restriction codes are persisted');
select extensions.has_column('public', 'integration_capability_grants', 'derived_from_contract_version', 'contract version is persisted');
select extensions.has_column('public', 'integration_capability_grants', 'grant_version', 'monotonic grant version is persisted');
select extensions.has_index(
  'public',
  'integration_capability_grants',
  'integration_capability_grants_organization_capability_availability_idx',
  'organization capability availability lookup is indexed'
);

set local role authenticated;
set local request.jwt.claim.sub = '1a000000-0000-4000-8000-000000000001';

select extensions.lives_ok(
  $$
    select public.connect_fixture_integration_with_grants(
      '2a000000-0000-4000-8000-000000000001',
      '1a000000-0000-4000-8000-000000000001',
      'google_business_profile', '1', 'fixture-account-one', 'Fixture account one',
      '{}'::text[], 'capability-grants-v2:fixture-v1:valid-one',
      '3a000000-0000-4000-8000-000000000001',
      (select payload from action_capability_payloads where name = 'valid-blocked')
    )
  $$,
  'exact fixture grants are accepted'
);

select extensions.is(
  (select count(*) from public.integration_capability_grants),
  2::bigint,
  'two-tenant setup exposes only the current tenant grants'
);
select extensions.is(
  (select min(grant_version) from public.integration_capability_grants),
  1::bigint,
  'insert forces grant version one'
);
select extensions.is(
  (select count(*) from public.integration_account_mappings),
  2::bigint,
  'fixture connect seeds both deterministic resources for mapping'
);
select extensions.set_eq(
  $$ select external_resource_id from public.integration_account_mappings $$,
  $$ values ('locations/fixture-harbor-house'::text), ('locations/fixture-river-market'::text) $$,
  'fixture resource discovery is exact and deterministic'
);

set local request.jwt.claim.sub = '1a000000-0000-4000-8000-000000000003';
select extensions.throws_ok(
  $$
    select public.connect_fixture_integration_with_grants(
      '2a000000-0000-4000-8000-000000000001',
      '1a000000-0000-4000-8000-000000000003',
      'google_business_profile', '1', 'viewer-account', 'Viewer account', '{}'::text[],
      'capability-grants-v2:fixture-v1:viewer',
      '3a000000-0000-4000-8000-000000000002',
      (select payload from action_capability_payloads where name = 'valid-blocked')
    )
  $$,
  '42501', null, 'viewer cannot update governed grants'
);

set local request.jwt.claim.sub = '1a000000-0000-4000-8000-000000000001';

select extensions.throws_ok(
  $$ select public.connect_fixture_integration_with_grants(
    '2a000000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-000000000001',
    'forged_provider', '1', 'forged-1', 'Forged', '{}'::text[], 'bad-provider',
    '3a000000-0000-4000-8000-000000000003',
    (select payload from action_capability_payloads where name = 'valid-blocked')) $$,
  '23514', null, 'direct RPC rejects wrong provider'
);
select extensions.throws_ok(
  $$ select public.connect_fixture_integration_with_grants(
    '2a000000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-000000000001',
    'google_business_profile', '2', 'forged-2', 'Forged', '{}'::text[], 'bad-adapter',
    '3a000000-0000-4000-8000-000000000004',
    (select payload from action_capability_payloads where name = 'valid-blocked')) $$,
  '23514', null, 'direct RPC rejects wrong adapter'
);
select extensions.throws_ok(
  $$ select public.connect_fixture_integration_with_grants(
    '2a000000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-000000000001',
    'google_business_profile', '1', 'forged-3', 'Forged', '{}'::text[], 'bad-extra',
    '3a000000-0000-4000-8000-000000000005',
    (select pg_catalog.jsonb_agg(item || '{"effect":"read"}'::jsonb) from action_capability_payloads,
      lateral pg_catalog.jsonb_array_elements(payload) item where name = 'valid-blocked')) $$,
  '23514', null, 'direct RPC rejects an extra grant key'
);
select extensions.throws_ok(
  $$ select public.connect_fixture_integration_with_grants(
    '2a000000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-000000000001',
    'google_business_profile', '1', 'forged-4', 'Forged', '{}'::text[], 'bad-version',
    '3a000000-0000-4000-8000-000000000006',
    (select pg_catalog.jsonb_agg(item || '{"grant_version":999}'::jsonb) from action_capability_payloads,
      lateral pg_catalog.jsonb_array_elements(payload) item where name = 'valid-blocked')) $$,
  '23514', null, 'caller-supplied grant version is rejected'
);
select extensions.throws_ok(
  $$ select public.connect_fixture_integration_with_grants(
    '2a000000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-000000000001',
    'google_business_profile', '1', 'forged-5', 'Forged', '{}'::text[], 'bad-contract',
    '3a000000-0000-4000-8000-000000000007',
    (select pg_catalog.jsonb_agg(item || '{"derived_from_contract_version":"forged-v9"}'::jsonb)
      from action_capability_payloads, lateral pg_catalog.jsonb_array_elements(payload) item
      where name = 'valid-blocked')) $$,
  '23514', null, 'direct RPC rejects a forged contract version'
);
select extensions.throws_ok(
  $$ select public.connect_fixture_integration_with_grants(
    '2a000000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-000000000001',
    'google_business_profile', '1', 'forged-6', 'Forged', '{}'::text[], 'bad-restriction',
    '3a000000-0000-4000-8000-000000000008',
    (select pg_catalog.jsonb_agg(item || '{"restriction_codes":["invented"]}'::jsonb)
      from action_capability_payloads, lateral pg_catalog.jsonb_array_elements(payload) item
      where name = 'valid-blocked')) $$,
  '23514', null, 'direct RPC rejects a forged restriction'
);
select extensions.throws_ok(
  $$ select public.connect_fixture_integration_with_grants(
    '2a000000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-000000000001',
    'google_business_profile', '1', 'forged-7', 'Forged', '{}'::text[], 'bad-reason',
    '3a000000-0000-4000-8000-000000000009',
    (select pg_catalog.jsonb_agg(item || '{"reason_codes":["forged"]}'::jsonb)
      from action_capability_payloads, lateral pg_catalog.jsonb_array_elements(payload) item
      where name = 'valid-blocked')) $$,
  '23514', null, 'direct RPC rejects a forged reason'
);
select extensions.throws_ok(
  $$ select public.connect_fixture_integration_with_grants(
    '2a000000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-000000000001',
    'google_business_profile', '1', 'forged-8', 'Forged', '{}'::text[], 'bad-maturity',
    '3a000000-0000-4000-8000-000000000010',
    (select pg_catalog.jsonb_agg(item || '{"maturity":"governed-write"}'::jsonb)
      from action_capability_payloads, lateral pg_catalog.jsonb_array_elements(payload) item
      where name = 'valid-blocked')) $$,
  '23514', null, 'direct RPC rejects a forged maturity'
);
select extensions.throws_ok(
  $$ select public.connect_fixture_integration_with_grants(
    '2a000000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-000000000001',
    'google_business_profile', '1', 'forged-9', 'Forged', '{}'::text[], 'bad-count',
    '3a000000-0000-4000-8000-000000000011',
    ((select payload from action_capability_payloads where name = 'valid-blocked') - 1)) $$,
  '23514', null, 'direct RPC rejects a forged capability'
);
select extensions.is(
  (select count(*) from public.integration_connections),
  1::bigint,
  'rejected RPC payloads do not mutate connections'
);

select extensions.throws_ok(
  $$ select public.replace_integration_mappings_with_grants(
    '2a000000-0000-4000-8000-000000000001',
    (select id from public.integration_connections where external_account_id = 'fixture-account-one'),
    '1a000000-0000-4000-8000-000000000001', '3a000000-0000-4000-8000-000000000012',
    'mapping-extra-key', '[]'::jsonb,
    (select pg_catalog.jsonb_agg(item || '{"effect":"read"}'::jsonb)
      from action_capability_payloads, lateral pg_catalog.jsonb_array_elements(payload) item
      where name = 'valid-blocked')) $$,
  '23514', null, 'mapping RPC rejects an extra grant key'
);
select extensions.throws_ok(
  $$ select public.replace_integration_mappings_with_grants(
    '2a000000-0000-4000-8000-000000000001',
    (select id from public.integration_connections where external_account_id = 'fixture-account-one'),
    '1a000000-0000-4000-8000-000000000001', '3a000000-0000-4000-8000-000000000013',
    'mapping-grant-version', '[]'::jsonb,
    (select pg_catalog.jsonb_agg(item || '{"grant_version":2}'::jsonb)
      from action_capability_payloads, lateral pg_catalog.jsonb_array_elements(payload) item
      where name = 'valid-blocked')) $$,
  '23514', null, 'mapping RPC rejects a caller grant version'
);
select extensions.throws_ok(
  $$ select public.replace_integration_mappings_with_grants(
    '2a000000-0000-4000-8000-000000000001',
    (select id from public.integration_connections where external_account_id = 'fixture-account-one'),
    '1a000000-0000-4000-8000-000000000001', '3a000000-0000-4000-8000-000000000014',
    'mapping-contract-version', '[]'::jsonb,
    (select pg_catalog.jsonb_agg(item || '{"derived_from_contract_version":"forged"}'::jsonb)
      from action_capability_payloads, lateral pg_catalog.jsonb_array_elements(payload) item
      where name = 'valid-blocked')) $$,
  '23514', null, 'mapping RPC rejects a forged contract version'
);
select extensions.throws_ok(
  $$ select public.replace_integration_mappings_with_grants(
    '2a000000-0000-4000-8000-000000000001',
    (select id from public.integration_connections where external_account_id = 'fixture-account-one'),
    '1a000000-0000-4000-8000-000000000001', '3a000000-0000-4000-8000-000000000015',
    'mapping-reason', '[]'::jsonb,
    (select pg_catalog.jsonb_agg(item || '{"reason_codes":["forged"]}'::jsonb)
      from action_capability_payloads, lateral pg_catalog.jsonb_array_elements(payload) item
      where name = 'valid-blocked')) $$,
  '23514', null, 'mapping RPC rejects a forged reason'
);
select extensions.throws_ok(
  $$ select public.replace_integration_mappings_with_grants(
    '2a000000-0000-4000-8000-000000000001',
    (select id from public.integration_connections where external_account_id = 'fixture-account-one'),
    '1a000000-0000-4000-8000-000000000001', '3a000000-0000-4000-8000-000000000016',
    'mapping-count', '[]'::jsonb,
    ((select payload from action_capability_payloads where name = 'valid-blocked') - 1)) $$,
  '23514', null, 'mapping RPC rejects a missing grant'
);
select extensions.throws_ok(
  $$ select public.replace_integration_mappings_with_grants(
    '2a000000-0000-4000-8000-000000000001',
    (select id from public.integration_connections where external_account_id = 'fixture-account-one'),
    '1a000000-0000-4000-8000-000000000001', '3a000000-0000-4000-8000-000000000017',
    'mapping-object-extra',
    '[
      {"external_resource_id":"locations/fixture-harbor-house","external_resource_label":"Harbor House","branch_id":null,"status":"unmapped","effect":"read"},
      {"external_resource_id":"locations/fixture-river-market","external_resource_label":"River Market","branch_id":null,"status":"unmapped"}
    ]'::jsonb,
    (select payload from action_capability_payloads where name = 'valid-blocked')) $$,
  '23514', null, 'mapping RPC rejects an extra mapping key'
);
select extensions.throws_ok(
  $$ select public.replace_integration_mappings_with_grants(
    '2a000000-0000-4000-8000-000000000001',
    (select id from public.integration_connections where external_account_id = 'fixture-account-one'),
    '1a000000-0000-4000-8000-000000000001', '3a000000-0000-4000-8000-000000000018',
    'mapping-over-limit',
    (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'external_resource_id', 'location-' || item,
      'external_resource_label', 'Location ' || item,
      'branch_id', null,
      'status', 'unmapped'
    )) from pg_catalog.generate_series(1, 101) item),
    (select payload from action_capability_payloads where name = 'valid-blocked')) $$,
  '23514', null, 'mapping RPC rejects more than one hundred mappings'
);
select extensions.throws_ok(
  $$ select public.replace_integration_mappings_with_grants(
    '2a000000-0000-4000-8000-000000000001',
    (select id from public.integration_connections where external_account_id = 'fixture-account-one'),
    '1a000000-0000-4000-8000-000000000001', '3a000000-0000-4000-8000-000000000019',
    'mapping-duplicate-resource',
    '[
      {"external_resource_id":"locations/fixture-harbor-house","external_resource_label":"Harbor House","branch_id":null,"status":"unmapped"},
      {"external_resource_id":"locations/fixture-harbor-house","external_resource_label":"Harbor House duplicate","branch_id":null,"status":"unmapped"}
    ]'::jsonb,
    (select payload from action_capability_payloads where name = 'valid-blocked')) $$,
  '23514', null, 'mapping RPC rejects duplicate resource identifiers'
);
select extensions.throws_ok(
  $$ select public.replace_integration_mappings_with_grants(
    '2a000000-0000-4000-8000-000000000001',
    (select id from public.integration_connections where external_account_id = 'fixture-account-one'),
    '1a000000-0000-4000-8000-000000000001', '3a000000-0000-4000-8000-000000000022',
    'mapping-unknown-resource',
    '[
      {"external_resource_id":"locations/not-a-fixture","external_resource_label":"Unknown","branch_id":null,"status":"unmapped"},
      {"external_resource_id":"locations/fixture-river-market","external_resource_label":"River Market","branch_id":null,"status":"unmapped"}
    ]'::jsonb,
    (select payload from action_capability_payloads where name = 'valid-blocked')) $$,
  '23514', null, 'mapping RPC rejects an unknown fixture resource'
);
select extensions.throws_ok(
  $$ select public.replace_integration_mappings_with_grants(
    '2a000000-0000-4000-8000-000000000001',
    (select id from public.integration_connections where external_account_id = 'fixture-account-one'),
    '1a000000-0000-4000-8000-000000000001', '3a000000-0000-4000-8000-000000000024',
    'mapping-forged-label',
    '[
      {"external_resource_id":"locations/fixture-harbor-house","external_resource_label":"Forged Harbor","branch_id":null,"status":"unmapped"},
      {"external_resource_id":"locations/fixture-river-market","external_resource_label":"River Market","branch_id":null,"status":"unmapped"}
    ]'::jsonb,
    (select payload from action_capability_payloads where name = 'valid-blocked')) $$,
  '23514', null, 'mapping RPC rejects a forged fixture resource label'
);
select extensions.throws_ok(
  $$ select public.replace_integration_mappings_with_grants(
    '2a000000-0000-4000-8000-000000000001',
    (select id from public.integration_connections where external_account_id = 'fixture-account-one'),
    '1a000000-0000-4000-8000-000000000001', '3a000000-0000-4000-8000-000000000025',
    'mapping-missing-resource',
    '[{"external_resource_id":"locations/fixture-harbor-house","external_resource_label":"Harbor House","branch_id":null,"status":"unmapped"}]'::jsonb,
    (select payload from action_capability_payloads where name = 'valid-blocked')) $$,
  '23514', null, 'mapping RPC rejects a missing deterministic fixture resource'
);
select extensions.throws_ok(
  $$ select public.replace_integration_mappings_with_grants(
    '2a000000-0000-4000-8000-000000000001',
    (select id from public.integration_connections where external_account_id = 'fixture-account-one'),
    '1a000000-0000-4000-8000-000000000001', '3a000000-0000-4000-8000-000000000026',
    'mapping-non-object',
    '["not-an-object", {"external_resource_id":"locations/fixture-river-market","external_resource_label":"River Market","branch_id":null,"status":"unmapped"}]'::jsonb,
    (select payload from action_capability_payloads where name = 'valid-blocked')) $$,
  '23514', null, 'mapping RPC rejects a non-object mapping entry'
);
select extensions.is(
  (select count(*) from public.integration_account_mappings),
  2::bigint,
  'rejected mapping RPC payloads leave mappings unchanged'
);

select extensions.lives_ok(
  $$ select public.replace_integration_mappings_with_grants(
    '2a000000-0000-4000-8000-000000000001',
    (select id from public.integration_connections where external_account_id = 'fixture-account-one'),
    '1a000000-0000-4000-8000-000000000001', '3a000000-0000-4000-8000-000000000020',
    'mapping-valid-fixture-resources',
    '[
      {"external_resource_id":"locations/fixture-harbor-house","external_resource_label":"Harbor House","branch_id":"4a000000-0000-4000-8000-000000000001","status":"mapped"},
      {"external_resource_id":"locations/fixture-river-market","external_resource_label":"River Market","branch_id":null,"status":"unmapped"}
    ]'::jsonb,
    (select payload from action_capability_payloads where name = 'valid-available')) $$,
  'an operator can map a seeded fixture resource'
);
select extensions.is(
  (select count(*) from public.integration_account_mappings where status = 'mapped'),
  1::bigint,
  'one seeded fixture resource is mapped'
);
select extensions.is(
  (select count(*) from public.integration_capability_grants where availability = 'available'),
  2::bigint,
  'mapping recomputation makes both fixture read grants available'
);
select extensions.lives_ok(
  $$ select public.connect_fixture_integration_with_grants(
    '2a000000-0000-4000-8000-000000000001',
    '1a000000-0000-4000-8000-000000000001',
    'google_business_profile', '1', 'fixture-account-one', 'Fixture account one',
    '{}'::text[], 'capability-grants-v2:fixture-v1:reconnect-mapped',
    '3a000000-0000-4000-8000-000000000021',
    (select payload from action_capability_payloads where name = 'valid-available')) $$,
  'reconnecting a mapped fixture account accepts mapped availability'
);
select extensions.is(
  (select count(*) from public.integration_account_mappings where status = 'mapped'),
  1::bigint,
  'reconnect preserves the mapping-derived row state'
);
select extensions.is(
  (select count(*) from public.integration_capability_grants where availability = 'available'),
  2::bigint,
  'reconnect preserves mapping-derived grant availability'
);

reset role;

select extensions.throws_ok(
  $$ insert into public.integration_capability_grants (
    organization_id, connection_id, capability_key, maturity, availability,
    derived_from_adapter_version, derived_from_contract_version
  ) values (
    '2a000000-0000-4000-8000-000000000002',
    (select id from public.integration_connections
     where organization_id = '2a000000-0000-4000-8000-000000000001'
       and external_account_id = 'fixture-account-one'),
    'read_reviews', 'read-only', 'blocked', '1', 'fixture-v1'
  ) $$,
  '23503', null, 'composite ownership rejects a foreign connection'
);

update public.integration_capability_grants
set availability = 'available', reason_codes = '{}'
where organization_id = '2a000000-0000-4000-8000-000000000001'
  and connection_id = (
    select id from public.integration_connections
    where organization_id = '2a000000-0000-4000-8000-000000000001'
      and external_account_id = 'fixture-account-one'
  ) and capability_key = 'read_reviews';
select extensions.is(
  (select grant_version from public.integration_capability_grants
   where organization_id = '2a000000-0000-4000-8000-000000000001'
     and connection_id = (select id from public.integration_connections
       where organization_id = '2a000000-0000-4000-8000-000000000001'
         and external_account_id = 'fixture-account-one')
     and capability_key = 'read_reviews'),
  2::bigint,
  'grant version increases monotonically'
);
update public.integration_capability_grants
set availability = availability
where organization_id = '2a000000-0000-4000-8000-000000000001'
  and connection_id = (select id from public.integration_connections
    where organization_id = '2a000000-0000-4000-8000-000000000001'
      and external_account_id = 'fixture-account-one')
  and capability_key = 'read_reviews';
select extensions.is(
  (select grant_version from public.integration_capability_grants
   where organization_id = '2a000000-0000-4000-8000-000000000001'
     and connection_id = (select id from public.integration_connections
       where organization_id = '2a000000-0000-4000-8000-000000000001'
         and external_account_id = 'fixture-account-one')
     and capability_key = 'read_reviews'),
  2::bigint,
  'no-op recompute preserves grant version'
);
update public.integration_capability_grants
set grant_version = 999
where organization_id = '2a000000-0000-4000-8000-000000000001'
  and connection_id = (select id from public.integration_connections
    where organization_id = '2a000000-0000-4000-8000-000000000001'
      and external_account_id = 'fixture-account-one')
  and capability_key = 'read_reviews';
select extensions.is(
  (select grant_version from public.integration_capability_grants
   where organization_id = '2a000000-0000-4000-8000-000000000001'
     and connection_id = (select id from public.integration_connections
       where organization_id = '2a000000-0000-4000-8000-000000000001'
         and external_account_id = 'fixture-account-one')
     and capability_key = 'read_reviews'),
  2::bigint,
  'caller version cannot win'
);
update public.integration_capability_grants
set derived_from_contract_version = 'fixture-v2'
where organization_id = '2a000000-0000-4000-8000-000000000001'
  and connection_id = (select id from public.integration_connections
    where organization_id = '2a000000-0000-4000-8000-000000000001'
      and external_account_id = 'fixture-account-one')
  and capability_key = 'read_reviews';
select extensions.is(
  (select grant_version from public.integration_capability_grants
   where organization_id = '2a000000-0000-4000-8000-000000000001'
     and connection_id = (select id from public.integration_connections
       where organization_id = '2a000000-0000-4000-8000-000000000001'
         and external_account_id = 'fixture-account-one')
     and capability_key = 'read_reviews'),
  3::bigint,
  'contract version change increments once'
);
update public.integration_connections set status = 'revoked'
where organization_id = '2a000000-0000-4000-8000-000000000001'
  and external_account_id = 'fixture-account-one';
select extensions.is(
  (select availability from public.integration_capability_grants
   where organization_id = '2a000000-0000-4000-8000-000000000001'
     and connection_id = (select id from public.integration_connections
       where organization_id = '2a000000-0000-4000-8000-000000000001'
         and external_account_id = 'fixture-account-one')
     and capability_key = 'read_reviews'),
  'disabled',
  'inactive connection disables grants'
);
select extensions.is(
  (select grant_version from public.integration_capability_grants
   where organization_id = '2a000000-0000-4000-8000-000000000001'
     and connection_id = (select id from public.integration_connections
       where organization_id = '2a000000-0000-4000-8000-000000000001'
         and external_account_id = 'fixture-account-one')
     and capability_key = 'read_reviews'),
  4::bigint,
  'inactive disablement increments once'
);
select extensions.ok(
  (select 'connection_revoked' = any(reason_codes)
   from public.integration_capability_grants
   where organization_id = '2a000000-0000-4000-8000-000000000001'
     and connection_id = (select id from public.integration_connections
       where organization_id = '2a000000-0000-4000-8000-000000000001'
         and external_account_id = 'fixture-account-one')
     and capability_key = 'read_reviews'),
  'inactive disablement appends a stable connection reason'
);

set local role authenticated;
set local request.jwt.claim.sub = '1a000000-0000-4000-8000-000000000002';
select extensions.is(
  (select count(*) from public.integration_capability_grants),
  0::bigint,
  'second tenant cannot read first tenant grants'
);
select extensions.is(
  (select count(*) from public.integration_account_mappings),
  0::bigint,
  'second tenant cannot read seeded or mapped fixture resources'
);
select extensions.lives_ok(
  $$ select public.connect_fixture_integration_with_grants(
    '2a000000-0000-4000-8000-000000000002',
    '1a000000-0000-4000-8000-000000000002',
    'google_business_profile', '1', 'fixture-account-two', 'Fixture account two',
    '{}'::text[], 'capability-grants-v2:fixture-v1:tenant-two',
    '3a000000-0000-4000-8000-000000000023',
    (select payload from action_capability_payloads where name = 'valid-blocked')) $$,
  'second tenant can seed its own exact fixture resources'
);
select extensions.is(
  (select count(*) from public.integration_account_mappings),
  2::bigint,
  'second tenant sees only its two seeded resources'
);
select extensions.lives_ok(
  $$ select public.connect_fixture_integration_with_grants(
    '2a000000-0000-4000-8000-000000000002',
    '1a000000-0000-4000-8000-000000000002',
    'google_business_profile', '1', 'fixture-account-two', 'Fixture account two',
    '{}'::text[], 'capability-grants-v2:fixture-v1:tenant-two',
    '3a000000-0000-4000-8000-000000000023',
    (select payload from action_capability_payloads where name = 'valid-blocked')) $$,
  'fixture resource seeding replays idempotently'
);
select extensions.is(
  (select count(*) from public.integration_account_mappings),
  2::bigint,
  'idempotent replay does not duplicate fixture resources'
);

select * from extensions.finish();
rollback;
