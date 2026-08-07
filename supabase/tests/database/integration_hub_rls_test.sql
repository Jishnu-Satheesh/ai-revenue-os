begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(80);

select extensions.has_table('public', 'integration_connections', 'integration connections exist');
select extensions.has_table('public', 'integration_capability_grants', 'integration grants exist');
select extensions.has_table('public', 'integration_account_mappings', 'integration mappings exist');
select extensions.has_table('public', 'integration_data_sources', 'integration data sources exist');
select extensions.has_table('public', 'integration_ingestion_runs', 'integration runs exist');
select extensions.has_table('public', 'integration_health_checks', 'integration health checks exist');

insert into auth.users (id)
values
  ('13000000-0000-4000-8000-000000000001'::uuid),
  ('13000000-0000-4000-8000-000000000002'::uuid),
  ('13000000-0000-4000-8000-000000000003'::uuid),
  ('13000000-0000-4000-8000-000000000004'::uuid);

insert into public.organizations (
  id,
  name,
  slug,
  industry,
  country_code,
  base_currency,
  default_timezone,
  created_by
)
values
  (
    '23000000-0000-4000-8000-000000000001'::uuid,
    'Integration tenant one',
    'integration-tenant-one',
    'testing',
    'US',
    'USD',
    'UTC',
    '13000000-0000-4000-8000-000000000001'::uuid
  ),
  (
    '23000000-0000-4000-8000-000000000002'::uuid,
    'Integration tenant two',
    'integration-tenant-two',
    'testing',
    'US',
    'USD',
    'UTC',
    '13000000-0000-4000-8000-000000000002'::uuid
  );

insert into public.organization_memberships (organization_id, user_id, role)
values
  (
    '23000000-0000-4000-8000-000000000001'::uuid,
    '13000000-0000-4000-8000-000000000001'::uuid,
    'operator'
  ),
  (
    '23000000-0000-4000-8000-000000000001'::uuid,
    '13000000-0000-4000-8000-000000000003'::uuid,
    'viewer'
  ),
  (
    '23000000-0000-4000-8000-000000000002'::uuid,
    '13000000-0000-4000-8000-000000000002'::uuid,
    'operator'
  ),
  (
    '23000000-0000-4000-8000-000000000001'::uuid,
    '13000000-0000-4000-8000-000000000004'::uuid,
    'operator'
  ),
  (
    '23000000-0000-4000-8000-000000000002'::uuid,
    '13000000-0000-4000-8000-000000000004'::uuid,
    'operator'
  );

insert into public.branches (id, organization_id, name, slug, timezone, currency)
values
  (
    '33000000-0000-4000-8000-000000000001'::uuid,
    '23000000-0000-4000-8000-000000000001'::uuid,
    'Tenant one branch',
    'tenant-one-branch',
    'UTC',
    'USD'
  ),
  (
    '33000000-0000-4000-8000-000000000002'::uuid,
    '23000000-0000-4000-8000-000000000002'::uuid,
    'Tenant two branch',
    'tenant-two-branch',
    'UTC',
    'USD'
  );

insert into public.integration_connections (
  id,
  organization_id,
  provider_key,
  adapter_version,
  connection_mode,
  status,
  external_account_id,
  external_account_label,
  created_by
)
values
  (
    '43000000-0000-4000-8000-000000000001'::uuid,
    '23000000-0000-4000-8000-000000000001'::uuid,
    'google_business_profile',
    '1.0.0',
    'fixture',
    'active',
    'account-one',
    'Account one',
    '13000000-0000-4000-8000-000000000001'::uuid
  ),
  (
    '43000000-0000-4000-8000-000000000002'::uuid,
    '23000000-0000-4000-8000-000000000002'::uuid,
    'google_business_profile',
    '1.0.0',
    'fixture',
    'active',
    'account-two',
    'Account two',
    '13000000-0000-4000-8000-000000000002'::uuid
  );

insert into public.integration_capability_grants (
  id,
  organization_id,
  connection_id,
  capability_key,
  maturity,
  availability,
  derived_from_adapter_version
)
values
  (
    '53000000-0000-4000-8000-000000000001'::uuid,
    '23000000-0000-4000-8000-000000000001'::uuid,
    '43000000-0000-4000-8000-000000000001'::uuid,
    'read_reviews',
    'read-only',
    'available',
    '1.0.0'
  ),
  (
    '53000000-0000-4000-8000-000000000002'::uuid,
    '23000000-0000-4000-8000-000000000002'::uuid,
    '43000000-0000-4000-8000-000000000002'::uuid,
    'read_reviews',
    'read-only',
    'available',
    '1.0.0'
  );

insert into public.integration_account_mappings (
  id,
  organization_id,
  connection_id,
  external_resource_id,
  external_resource_label,
  branch_id,
  status,
  created_by
)
values
  (
    '63000000-0000-4000-8000-000000000001'::uuid,
    '23000000-0000-4000-8000-000000000001'::uuid,
    '43000000-0000-4000-8000-000000000001'::uuid,
    'location-one',
    'Location one',
    '33000000-0000-4000-8000-000000000001'::uuid,
    'mapped',
    '13000000-0000-4000-8000-000000000001'::uuid
  ),
  (
    '63000000-0000-4000-8000-000000000002'::uuid,
    '23000000-0000-4000-8000-000000000002'::uuid,
    '43000000-0000-4000-8000-000000000002'::uuid,
    'location-two',
    'Location two',
    '33000000-0000-4000-8000-000000000002'::uuid,
    'mapped',
    '13000000-0000-4000-8000-000000000002'::uuid
  );

insert into public.integration_data_sources (
  id,
  organization_id,
  source_type,
  name,
  branch_id,
  status,
  created_by
)
values
  (
    '73000000-0000-4000-8000-000000000001'::uuid,
    '23000000-0000-4000-8000-000000000001'::uuid,
    'csv_import',
    'CSV source one',
    '33000000-0000-4000-8000-000000000001'::uuid,
    'ready',
    '13000000-0000-4000-8000-000000000001'::uuid
  ),
  (
    '73000000-0000-4000-8000-000000000002'::uuid,
    '23000000-0000-4000-8000-000000000002'::uuid,
    'csv_import',
    'CSV source two',
    '33000000-0000-4000-8000-000000000002'::uuid,
    'ready',
    '13000000-0000-4000-8000-000000000002'::uuid
  );

insert into public.integration_ingestion_runs (
  id,
  organization_id,
  connection_id,
  idempotency_key,
  status,
  correlation_id
)
values
  (
    '83000000-0000-4000-8000-000000000001'::uuid,
    '23000000-0000-4000-8000-000000000001'::uuid,
    '43000000-0000-4000-8000-000000000001'::uuid,
    'tenant-one-initial-sync',
    'succeeded',
    '93000000-0000-4000-8000-000000000001'::uuid
  ),
  (
    '83000000-0000-4000-8000-000000000002'::uuid,
    '23000000-0000-4000-8000-000000000002'::uuid,
    '43000000-0000-4000-8000-000000000002'::uuid,
    'tenant-two-initial-sync',
    'succeeded',
    '93000000-0000-4000-8000-000000000002'::uuid
  );

insert into public.integration_health_checks (
  id,
  organization_id,
  connection_id,
  ingestion_run_id,
  check_type,
  outcome,
  checked_at,
  correlation_id
)
values
  (
    'a3000000-0000-4000-8000-000000000001'::uuid,
    '23000000-0000-4000-8000-000000000001'::uuid,
    '43000000-0000-4000-8000-000000000001'::uuid,
    '83000000-0000-4000-8000-000000000001'::uuid,
    'sync',
    'passed',
    '2026-08-08 00:00:00+00'::timestamptz,
    '93000000-0000-4000-8000-000000000001'::uuid
  ),
  (
    'a3000000-0000-4000-8000-000000000002'::uuid,
    '23000000-0000-4000-8000-000000000002'::uuid,
    '43000000-0000-4000-8000-000000000002'::uuid,
    '83000000-0000-4000-8000-000000000002'::uuid,
    'sync',
    'passed',
    '2026-08-08 00:00:00+00'::timestamptz,
    '93000000-0000-4000-8000-000000000002'::uuid
  );

insert into storage.objects (bucket_id, name)
values
  (
    'integration-imports',
    '23000000-0000-4000-8000-000000000001/73000000-0000-4000-8000-000000000001/b3000000-0000-4000-8000-000000000001/source.csv'
  ),
  (
    'integration-imports',
    '23000000-0000-4000-8000-000000000002/73000000-0000-4000-8000-000000000002/b3000000-0000-4000-8000-000000000002/source.csv'
  );

set local role authenticated;
set local request.jwt.claim.sub = '13000000-0000-4000-8000-000000000003';

select extensions.is((select count(*) from public.integration_connections), 1::bigint, 'viewer reads only tenant connections');
select extensions.is((select count(*) from public.integration_capability_grants), 1::bigint, 'viewer reads only tenant grants');
select extensions.is((select count(*) from public.integration_account_mappings), 1::bigint, 'viewer reads only tenant mappings');
select extensions.is((select count(*) from public.integration_data_sources), 1::bigint, 'viewer reads only tenant sources');
select extensions.is((select count(*) from public.integration_ingestion_runs), 1::bigint, 'viewer reads only tenant runs');
select extensions.is((select count(*) from public.integration_health_checks), 1::bigint, 'viewer reads only tenant health checks');

update public.integration_connections set status = 'revoked';
select extensions.is(
  (select status from public.integration_connections),
  'active',
  'viewer cannot update connections'
);

select extensions.throws_ok(
  $$
    insert into public.integration_connections (
      organization_id, provider_key, adapter_version, connection_mode, status,
      external_account_id, external_account_label, created_by
    ) values (
      '23000000-0000-4000-8000-000000000001', 'viewer_provider', '1.0.0', 'fixture',
      'pending', 'viewer-account', 'Viewer account', '13000000-0000-4000-8000-000000000003'
    )
  $$,
  '42501',
  null,
  'viewer cannot create connections'
);
update public.integration_capability_grants set availability = 'disabled';
select extensions.is(
  (select availability from public.integration_capability_grants),
  'available',
  'viewer cannot update grants'
);
update public.integration_account_mappings set status = 'ignored';
select extensions.is(
  (select status from public.integration_account_mappings),
  'mapped',
  'viewer cannot update mappings'
);
update public.integration_data_sources set status = 'archived';
select extensions.is(
  (select status from public.integration_data_sources),
  'ready',
  'viewer cannot update data sources'
);
update public.integration_ingestion_runs set status = 'cancelled';
select extensions.is(
  (select status from public.integration_ingestion_runs),
  'succeeded',
  'viewer cannot update ingestion runs'
);
select extensions.throws_ok(
  $$
    insert into public.integration_health_checks (
      organization_id, connection_id, check_type, outcome, correlation_id
    ) values (
      '23000000-0000-4000-8000-000000000001',
      '43000000-0000-4000-8000-000000000001',
      'connectivity',
      'passed',
      '93000000-0000-4000-8000-000000000003'
    )
  $$,
  '42501',
  null,
  'viewer cannot append health checks'
);

select extensions.is(
  (select count(*) from storage.objects where bucket_id = 'integration-imports'),
  1::bigint,
  'viewer reads only own tenant import objects'
);
select extensions.throws_ok(
  $$
    insert into storage.objects (bucket_id, name) values (
      'integration-imports',
      '23000000-0000-4000-8000-000000000001/73000000-0000-4000-8000-000000000001/b3000000-0000-4000-8000-000000000003/viewer.csv'
    )
  $$,
  '42501',
  null,
  'viewer cannot upload integration imports'
);
update storage.objects
set name = '23000000-0000-4000-8000-000000000001/73000000-0000-4000-8000-000000000001/b3000000-0000-4000-8000-000000000003/viewer-renamed.csv'
where bucket_id = 'integration-imports';
select extensions.is(
  (
    select count(*)
    from storage.objects
    where bucket_id = 'integration-imports'
      and name = '23000000-0000-4000-8000-000000000001/73000000-0000-4000-8000-000000000001/b3000000-0000-4000-8000-000000000001/source.csv'
  ),
  1::bigint,
  'viewer cannot update integration imports'
);
delete from storage.objects where bucket_id = 'integration-imports';
select extensions.is(
  (select count(*) from storage.objects where bucket_id = 'integration-imports'),
  1::bigint,
  'viewer cannot delete integration imports'
);

set local request.jwt.claim.sub = '13000000-0000-4000-8000-000000000001';

select extensions.lives_ok(
  $$ update public.integration_connections set status = 'degraded' where id = '43000000-0000-4000-8000-000000000001' $$,
  'operator updates own tenant connection'
);
select extensions.throws_ok(
  $$ update public.integration_capability_grants set availability = 'disabled' where id = '53000000-0000-4000-8000-000000000001' $$,
  '42501',
  null,
  'operator cannot directly update server-managed grants'
);
select extensions.lives_ok(
  $$ update public.integration_account_mappings set status = 'ignored' where id = '63000000-0000-4000-8000-000000000001' $$,
  'operator updates own tenant mapping'
);
select extensions.lives_ok(
  $$ update public.integration_data_sources set status = 'processing' where id = '73000000-0000-4000-8000-000000000001' $$,
  'operator updates own tenant data source'
);
select extensions.lives_ok(
  $$ update public.integration_ingestion_runs set status = 'running' where id = '83000000-0000-4000-8000-000000000001' $$,
  'operator updates own tenant run'
);
select extensions.lives_ok(
  $$
    insert into public.integration_health_checks (
      organization_id, connection_id, check_type, outcome, correlation_id
    ) values (
      '23000000-0000-4000-8000-000000000001',
      '43000000-0000-4000-8000-000000000001',
      'connectivity',
      'passed',
      '93000000-0000-4000-8000-000000000004'
    )
  $$,
  'operator appends own tenant health check'
);
select extensions.lives_ok(
  $$
    insert into public.integration_connections (
      organization_id, provider_key, adapter_version, connection_mode, status,
      external_account_id, external_account_label, created_by
    ) values (
      '23000000-0000-4000-8000-000000000001',
      'operator_fixture',
      '1.0.0',
      'fixture',
      'pending',
      'operator-account',
      'Operator account',
      '13000000-0000-4000-8000-000000000001'
    )
  $$,
  'operator creates an own-tenant connection'
);
select extensions.throws_ok(
  $$
    insert into public.integration_capability_grants (
      organization_id, connection_id, capability_key, maturity, availability,
      derived_from_adapter_version
    ) values (
      '23000000-0000-4000-8000-000000000001',
      '43000000-0000-4000-8000-000000000001',
      'publish_google_business_post',
      'governed-write',
      'available',
      '1.0.0'
    )
  $$,
  '42501',
  null,
  'operator cannot directly elevate a server-managed grant'
);
select extensions.lives_ok(
  $$
    insert into public.integration_account_mappings (
      organization_id, connection_id, external_resource_id, external_resource_label,
      status, created_by
    ) values (
      '23000000-0000-4000-8000-000000000001',
      '43000000-0000-4000-8000-000000000001',
      'operator-location',
      'Operator location',
      'unmapped',
      '13000000-0000-4000-8000-000000000001'
    )
  $$,
  'operator creates an own-tenant mapping'
);
select extensions.lives_ok(
  $$
    insert into public.integration_data_sources (
      organization_id, source_type, name, status, created_by
    ) values (
      '23000000-0000-4000-8000-000000000001',
      'manual',
      'Operator source',
      'ready',
      '13000000-0000-4000-8000-000000000001'
    )
  $$,
  'operator creates an own-tenant data source'
);
select extensions.lives_ok(
  $$
    insert into public.integration_ingestion_runs (
      organization_id, connection_id, idempotency_key, status, correlation_id
    ) values (
      '23000000-0000-4000-8000-000000000001',
      '43000000-0000-4000-8000-000000000001',
      'operator-created-run',
      'queued',
      '93000000-0000-4000-8000-000000000009'
    )
  $$,
  'operator creates an own-tenant ingestion run'
);
select extensions.throws_ok(
  $$
    insert into public.integration_connections (
      organization_id, provider_key, adapter_version, connection_mode, status,
      external_account_id, external_account_label, created_by
    ) values (
      '23000000-0000-4000-8000-000000000002',
      'cross_tenant_fixture',
      '1.0.0',
      'fixture',
      'pending',
      'cross-tenant-account',
      'Cross tenant account',
      '13000000-0000-4000-8000-000000000001'
    )
  $$,
  '42501',
  null,
  'operator cannot create another tenant connection'
);
select extensions.throws_ok(
  $$
    insert into public.integration_account_mappings (
      organization_id, connection_id, external_resource_id, external_resource_label,
      status, created_by
    ) values (
      '23000000-0000-4000-8000-000000000002',
      '43000000-0000-4000-8000-000000000002',
      'cross-tenant-location',
      'Cross tenant location',
      'unmapped',
      '13000000-0000-4000-8000-000000000001'
    )
  $$,
  '42501',
  null,
  'operator cannot create another tenant mapping'
);
select extensions.throws_ok(
  $$
    insert into public.integration_data_sources (
      organization_id, source_type, name, status, created_by
    ) values (
      '23000000-0000-4000-8000-000000000002',
      'manual',
      'Cross tenant source',
      'ready',
      '13000000-0000-4000-8000-000000000001'
    )
  $$,
  '42501',
  null,
  'operator cannot create another tenant data source'
);
select extensions.throws_ok(
  $$
    insert into public.integration_ingestion_runs (
      organization_id, connection_id, idempotency_key, status, correlation_id
    ) values (
      '23000000-0000-4000-8000-000000000002',
      '43000000-0000-4000-8000-000000000002',
      'cross-tenant-run',
      'queued',
      '93000000-0000-4000-8000-000000000010'
    )
  $$,
  '42501',
  null,
  'operator cannot create another tenant ingestion run'
);
select extensions.throws_ok(
  $$ update public.integration_health_checks set outcome = 'failed' $$,
  '42501',
  null,
  'authenticated users cannot update append-only health checks'
);
select extensions.throws_ok(
  $$ delete from public.integration_health_checks $$,
  '42501',
  null,
  'authenticated users cannot delete append-only health checks'
);

select extensions.lives_ok(
  $$
    insert into storage.objects (bucket_id, name) values (
      'integration-imports',
      '23000000-0000-4000-8000-000000000001/73000000-0000-4000-8000-000000000001/b3000000-0000-4000-8000-000000000004/operator.csv'
    )
  $$,
  'operator uploads into own tenant path'
);
select extensions.throws_ok(
  $$
    insert into storage.objects (bucket_id, name) values (
      'integration-imports',
      '23000000-0000-4000-8000-000000000002/73000000-0000-4000-8000-000000000002/b3000000-0000-4000-8000-000000000005/cross-tenant.csv'
    )
  $$,
  '42501',
  null,
  'operator cannot upload into another tenant path'
);
select extensions.throws_ok(
  $$
    insert into storage.objects (bucket_id, name) values (
      'integration-imports',
      '23000000-0000-4000-8000-000000000001/73000000-0000-4000-8000-000000000001/b3000000-0000-4000-8000-000000000005/extra/nested.csv'
    )
  $$,
  '42501',
  null,
  'operator cannot upload an over-nested import path'
);
select extensions.throws_ok(
  $$
    insert into storage.objects (bucket_id, name) values (
      'integration-imports',
      '23000000-0000-4000-8000-000000000001/73000000-0000-4000-8000-000000000002/b3000000-0000-4000-8000-000000000005/mismatched.csv'
    )
  $$,
  '42501',
  null,
  'operator cannot upload to a mismatched data-source path'
);
select extensions.lives_ok(
  $$
    update storage.objects
    set name = '23000000-0000-4000-8000-000000000001/73000000-0000-4000-8000-000000000001/b3000000-0000-4000-8000-000000000004/operator-renamed.csv'
    where bucket_id = 'integration-imports'
      and name like '%/operator.csv'
  $$,
  'operator updates an own-tenant import path'
);
select extensions.lives_ok(
  $$
    delete from storage.objects
    where bucket_id = 'integration-imports'
      and name like '%/operator-renamed.csv'
  $$,
  'operator deletes an own-tenant import object'
);
select extensions.throws_ok(
  $$
    update public.integration_data_sources
    set storage_path = '23000000-0000-4000-8000-000000000001/73000000-0000-4000-8000-000000000002/b3000000-0000-4000-8000-000000000006/mismatched.csv'
    where id = '73000000-0000-4000-8000-000000000001'
  $$,
  '23514',
  null,
  'stored CSV path must match its data-source identity'
);
select extensions.throws_ok(
  $$
    update public.integration_data_sources
    set storage_path = '23000000-0000-4000-8000-000000000001/73000000-0000-4000-8000-000000000001/b3000000-0000-4000-8000-000000000006/extra/nested.csv'
    where id = '73000000-0000-4000-8000-000000000001'
  $$,
  '23514',
  null,
  'stored CSV path must contain exactly four segments'
);

update public.integration_connections
set status = 'revoked'
where organization_id = '23000000-0000-4000-8000-000000000002';
update public.integration_capability_grants
set availability = 'disabled'
where organization_id = '23000000-0000-4000-8000-000000000002';
update public.integration_account_mappings
set status = 'ignored'
where organization_id = '23000000-0000-4000-8000-000000000002';
update public.integration_data_sources
set status = 'archived'
where organization_id = '23000000-0000-4000-8000-000000000002';
update public.integration_ingestion_runs
set status = 'cancelled'
where organization_id = '23000000-0000-4000-8000-000000000002';

select extensions.throws_ok(
  $$
    insert into public.integration_health_checks (
      organization_id, connection_id, check_type, outcome, correlation_id
    ) values (
      '23000000-0000-4000-8000-000000000002',
      '43000000-0000-4000-8000-000000000002',
      'connectivity',
      'failed',
      '93000000-0000-4000-8000-000000000008'
    )
  $$,
  '42501',
  null,
  'operator cannot append another tenant health check'
);

set local request.jwt.claim.sub = '13000000-0000-4000-8000-000000000004';

select extensions.throws_ok(
  $$
    update public.integration_capability_grants
    set organization_id = '23000000-0000-4000-8000-000000000002',
        connection_id = '43000000-0000-4000-8000-000000000002'
    where id = '53000000-0000-4000-8000-000000000001'
  $$,
  '42501',
  null,
  'dual-tenant operator cannot move a server-managed grant'
);
select extensions.throws_ok(
  $$
    update public.integration_account_mappings
    set organization_id = '23000000-0000-4000-8000-000000000002',
        connection_id = '43000000-0000-4000-8000-000000000002',
        branch_id = '33000000-0000-4000-8000-000000000002'
    where id = '63000000-0000-4000-8000-000000000001'
  $$,
  '42501',
  null,
  'dual-tenant operator cannot move a mapping'
);
select extensions.throws_ok(
  $$
    update public.integration_data_sources
    set organization_id = '23000000-0000-4000-8000-000000000002',
        branch_id = '33000000-0000-4000-8000-000000000002'
    where id = '73000000-0000-4000-8000-000000000001'
  $$,
  '42501',
  null,
  'dual-tenant operator cannot move a data source'
);
select extensions.throws_ok(
  $$
    update public.integration_ingestion_runs
    set organization_id = '23000000-0000-4000-8000-000000000002',
        connection_id = '43000000-0000-4000-8000-000000000002'
    where id = '83000000-0000-4000-8000-000000000001'
  $$,
  '42501',
  null,
  'dual-tenant operator cannot move an ingestion run'
);

reset role;

select extensions.throws_ok(
  $$
    update public.integration_account_mappings
    set organization_id = '23000000-0000-4000-8000-000000000002',
        connection_id = '43000000-0000-4000-8000-000000000002',
        branch_id = '33000000-0000-4000-8000-000000000002'
    where id = '63000000-0000-4000-8000-000000000001'
  $$,
  '23514',
  null,
  'database guard rejects privileged mapping tenant moves'
);
select extensions.throws_ok(
  $$
    update public.integration_data_sources
    set created_by = '13000000-0000-4000-8000-000000000002'
    where id = '73000000-0000-4000-8000-000000000001'
  $$,
  '23514',
  null,
  'database guard rejects privileged provenance reassignment'
);
select extensions.throws_ok(
  $$
    insert into public.integration_capability_grants (
      organization_id, connection_id, capability_key, maturity, availability,
      derived_from_adapter_version
    ) values (
      '23000000-0000-4000-8000-000000000001',
      '43000000-0000-4000-8000-000000000001',
      'publish_google_business_post',
      'governed-write',
      'available',
      '1.0.0'
    )
  $$,
  '23514',
  null,
  'available capability maturity is limited to V1-safe levels'
);
insert into public.integration_connections (
  id,
  organization_id,
  provider_key,
  adapter_version,
  connection_mode,
  status,
  external_account_id,
  external_account_label,
  created_by
)
values (
  '43000000-0000-4000-8000-000000000003',
  '23000000-0000-4000-8000-000000000001',
  'disconnected_fixture',
  '1.0.0',
  'fixture',
  'disconnected',
  'disconnected-account',
  'Disconnected account',
  '13000000-0000-4000-8000-000000000001'
);
select extensions.throws_ok(
  $$
    insert into public.integration_capability_grants (
      organization_id, connection_id, capability_key, maturity, availability,
      derived_from_adapter_version
    ) values (
      '23000000-0000-4000-8000-000000000001',
      '43000000-0000-4000-8000-000000000003',
      'read_reviews',
      'read-only',
      'available',
      '1.0.0'
    )
  $$,
  '23514',
  null,
  'disconnected connections cannot receive available grants'
);
update public.integration_connections
set status = 'revoked'
where id = '43000000-0000-4000-8000-000000000001';
select extensions.is(
  (
    select availability
    from public.integration_capability_grants
    where id = '53000000-0000-4000-8000-000000000001'
  ),
  'disabled',
  'revoking a connection disables its available grants'
);

select extensions.is(
  (
    select count(*)
    from (
      select 1 from public.integration_connections
      where organization_id = '23000000-0000-4000-8000-000000000002' and status = 'active'
      union all
      select 1 from public.integration_capability_grants
      where organization_id = '23000000-0000-4000-8000-000000000002' and availability = 'available'
      union all
      select 1 from public.integration_account_mappings
      where organization_id = '23000000-0000-4000-8000-000000000002' and status = 'mapped'
      union all
      select 1 from public.integration_data_sources
      where organization_id = '23000000-0000-4000-8000-000000000002' and status = 'ready'
      union all
      select 1 from public.integration_ingestion_runs
      where organization_id = '23000000-0000-4000-8000-000000000002' and status = 'succeeded'
    ) unchanged_rows
  ),
  5::bigint,
  'operator cannot update another tenant through RLS'
);

select extensions.throws_ok(
  $$
    insert into public.integration_connections (
      organization_id, provider_key, adapter_version, connection_mode, status,
      external_account_id, external_account_label, created_by
    ) values (
      '23000000-0000-4000-8000-000000000001', 'google_business_profile', '1.0.0',
      'fixture', 'active', 'account-one', 'Duplicate account',
      '13000000-0000-4000-8000-000000000001'
    )
  $$,
  '23505',
  null,
  'provider accounts are unique within a tenant'
);
select extensions.throws_ok(
  $$
    insert into public.integration_ingestion_runs (
      organization_id, connection_id, idempotency_key, status, correlation_id
    ) values (
      '23000000-0000-4000-8000-000000000001',
      '43000000-0000-4000-8000-000000000001',
      'tenant-one-initial-sync',
      'queued',
      '93000000-0000-4000-8000-000000000005'
    )
  $$,
  '23505',
  null,
  'idempotency keys are unique within a tenant'
);
select extensions.throws_ok(
  $$
    insert into public.integration_ingestion_runs (
      organization_id, idempotency_key, status, correlation_id
    ) values (
      '23000000-0000-4000-8000-000000000001',
      'tenant-one-no-source',
      'queued',
      '93000000-0000-4000-8000-000000000006'
    )
  $$,
  '23514',
  null,
  'ingestion runs require one source'
);
select extensions.throws_ok(
  $$
    insert into public.integration_ingestion_runs (
      organization_id, connection_id, data_source_id, idempotency_key, status, correlation_id
    ) values (
      '23000000-0000-4000-8000-000000000001',
      '43000000-0000-4000-8000-000000000001',
      '73000000-0000-4000-8000-000000000001',
      'tenant-one-two-sources',
      'queued',
      '93000000-0000-4000-8000-000000000007'
    )
  $$,
  '23514',
  null,
  'ingestion runs reject two sources'
);
select extensions.throws_ok(
  $$
    insert into public.integration_account_mappings (
      organization_id, connection_id, external_resource_id, external_resource_label,
      branch_id, status, created_by
    ) values (
      '23000000-0000-4000-8000-000000000001',
      '43000000-0000-4000-8000-000000000002',
      'cross-tenant-connection',
      'Cross tenant connection',
      null,
      'unmapped',
      '13000000-0000-4000-8000-000000000001'
    )
  $$,
  '23503',
  null,
  'mapping connection must belong to the same tenant'
);
select extensions.throws_ok(
  $$
    insert into public.integration_account_mappings (
      organization_id, connection_id, external_resource_id, external_resource_label,
      branch_id, status, created_by
    ) values (
      '23000000-0000-4000-8000-000000000001',
      '43000000-0000-4000-8000-000000000001',
      'cross-tenant-branch',
      'Cross tenant branch',
      '33000000-0000-4000-8000-000000000002',
      'mapped',
      '13000000-0000-4000-8000-000000000001'
    )
  $$,
  '23503',
  null,
  'mapping branch must belong to the same tenant'
);
select extensions.throws_ok(
  $$
    insert into public.integration_capability_grants (
      organization_id, connection_id, capability_key, maturity, availability,
      derived_from_adapter_version
    ) values (
      '23000000-0000-4000-8000-000000000001',
      '43000000-0000-4000-8000-000000000001',
      'read_reviews',
      'read-only',
      'available',
      '1.0.0'
    )
  $$,
  '23505',
  null,
  'capability grants are unique by tenant connection and capability'
);
select extensions.throws_ok(
  $$
    insert into public.integration_account_mappings (
      organization_id, connection_id, external_resource_id, external_resource_label,
      status, created_by
    ) values (
      '23000000-0000-4000-8000-000000000001',
      '43000000-0000-4000-8000-000000000001',
      'location-one',
      'Duplicate location',
      'unmapped',
      '13000000-0000-4000-8000-000000000001'
    )
  $$,
  '23505',
  null,
  'account mappings are unique by tenant connection and resource'
);
select extensions.throws_ok(
  $$
    insert into public.integration_data_sources (
      organization_id, source_type, name, branch_id, status, created_by
    ) values (
      '23000000-0000-4000-8000-000000000001',
      'manual',
      'Cross tenant source',
      '33000000-0000-4000-8000-000000000002',
      'ready',
      '13000000-0000-4000-8000-000000000001'
    )
  $$,
  '23503',
  null,
  'data source branch must belong to the same tenant'
);

select extensions.is(
  (
    select count(*)
    from unnest(array[
      'integration_connections',
      'integration_capability_grants',
      'integration_account_mappings',
      'integration_data_sources',
      'integration_ingestion_runs',
      'integration_health_checks'
    ]) as relation_name
    where has_table_privilege('anon', 'public.' || relation_name, 'SELECT')
       or has_table_privilege('anon', 'public.' || relation_name, 'INSERT')
       or has_table_privilege('anon', 'public.' || relation_name, 'UPDATE')
       or has_table_privilege('anon', 'public.' || relation_name, 'DELETE')
  ),
  0::bigint,
  'anonymous callers have zero integration table privileges'
);
select extensions.is(
  has_column_privilege(
    'authenticated',
    'public.integration_connections',
    'credential_reference',
    'SELECT'
  ),
  false,
  'authenticated callers cannot read opaque credential references'
);
select extensions.is(
  has_column_privilege(
    'authenticated',
    'public.integration_connections',
    'credential_reference',
    'INSERT'
  ),
  false,
  'authenticated callers cannot insert opaque credential references'
);
select extensions.is(
  has_column_privilege(
    'authenticated',
    'public.integration_connections',
    'credential_reference',
    'UPDATE'
  ),
  false,
  'authenticated callers cannot update opaque credential references'
);
select extensions.is(
  has_table_privilege('authenticated', 'public.integration_capability_grants', 'INSERT'),
  false,
  'authenticated callers cannot directly insert capability grants'
);
select extensions.is(
  has_table_privilege('authenticated', 'public.integration_capability_grants', 'UPDATE'),
  false,
  'authenticated callers cannot directly update capability grants'
);
select extensions.is(
  (
    select count(*)
    from (
      values
        ('integration_connections', 'id'),
        ('integration_connections', 'created_at'),
        ('integration_connections', 'updated_at'),
        ('integration_account_mappings', 'id'),
        ('integration_account_mappings', 'created_at'),
        ('integration_account_mappings', 'updated_at'),
        ('integration_data_sources', 'id'),
        ('integration_data_sources', 'created_at'),
        ('integration_data_sources', 'updated_at'),
        ('integration_ingestion_runs', 'id'),
        ('integration_ingestion_runs', 'created_at'),
        ('integration_ingestion_runs', 'updated_at'),
        ('integration_health_checks', 'id'),
        ('integration_health_checks', 'checked_at')
    ) as denied_insert_column(relation_name, column_name)
    where has_column_privilege(
      'authenticated',
      'public.' || relation_name,
      column_name,
      'INSERT'
    )
  ),
  0::bigint,
  'authenticated inserts cannot assign database-owned identity timestamps'
);
select extensions.is(
  (
    select count(*)
    from (
      values
        ('integration_connections', 'organization_id'),
        ('integration_connections', 'id'),
        ('integration_connections', 'provider_key'),
        ('integration_connections', 'external_account_id'),
        ('integration_connections', 'created_by'),
        ('integration_connections', 'created_at'),
        ('integration_account_mappings', 'organization_id'),
        ('integration_account_mappings', 'id'),
        ('integration_account_mappings', 'connection_id'),
        ('integration_account_mappings', 'external_resource_id'),
        ('integration_account_mappings', 'created_by'),
        ('integration_account_mappings', 'created_at'),
        ('integration_data_sources', 'organization_id'),
        ('integration_data_sources', 'id'),
        ('integration_data_sources', 'source_type'),
        ('integration_data_sources', 'created_by'),
        ('integration_data_sources', 'created_at'),
        ('integration_ingestion_runs', 'organization_id'),
        ('integration_ingestion_runs', 'id'),
        ('integration_ingestion_runs', 'connection_id'),
        ('integration_ingestion_runs', 'data_source_id'),
        ('integration_ingestion_runs', 'idempotency_key'),
        ('integration_ingestion_runs', 'correlation_id'),
        ('integration_ingestion_runs', 'created_at')
    ) as immutable_update_column(relation_name, column_name)
    where has_column_privilege(
      'authenticated',
      'public.' || relation_name,
      column_name,
      'UPDATE'
    )
  ),
  0::bigint,
  'authenticated updates cannot reassign tenant source or provenance identity'
);
select extensions.is(
  (
    select count(*)
    from unnest(array[
      'integration_connections',
      'integration_capability_grants',
      'integration_account_mappings',
      'integration_data_sources',
      'integration_ingestion_runs',
      'integration_health_checks'
    ]) relation_name
    where has_table_privilege('authenticated', 'public.' || relation_name, 'DELETE')
  ),
  0::bigint,
  'authenticated callers cannot delete integration history tables'
);
select extensions.is(
  (
    select count(*)
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = any(array[
        'integration_connections',
        'integration_capability_grants',
        'integration_account_mappings',
        'integration_data_sources',
        'integration_ingestion_runs',
        'integration_health_checks'
      ])
      and relation.relrowsecurity
      and relation.relforcerowsecurity
  ),
  6::bigint,
  'all integration tables enable and force RLS'
);
select extensions.is(
  (
    select count(*)
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.contype = 'f'
      and constraint_record.conrelid = any(array[
        'public.integration_connections'::regclass,
        'public.integration_capability_grants'::regclass,
        'public.integration_account_mappings'::regclass,
        'public.integration_data_sources'::regclass,
        'public.integration_ingestion_runs'::regclass,
        'public.integration_health_checks'::regclass
      ])
      and not exists (
        select 1
        from pg_catalog.pg_index index_record
        where index_record.indrelid = constraint_record.conrelid
          and index_record.indisvalid
          and index_record.indisready
          and index_record.indexprs is null
          and index_record.indpred is null
          and constraint_record.conkey = (
            select array_agg(index_attribute order by ordinal_position)
            from unnest(index_record.indkey::smallint[])
              with ordinality as indexed_column(index_attribute, ordinal_position)
            where ordinal_position <= cardinality(constraint_record.conkey)
          )
      )
  ),
  0::bigint,
  'every integration foreign key has a supporting index'
);
select extensions.is(
  (
    select count(*)
    from storage.buckets
    where id = 'integration-imports'
      and not public
      and file_size_limit = 10485760
      and allowed_mime_types = array['text/csv']::text[]
  ),
  1::bigint,
  'integration imports bucket is private and CSV constrained'
);

select * from extensions.finish();

rollback;
