begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(12);

insert into auth.users (id)
values
  ('17000000-0000-4000-8000-000000000001'::uuid),
  ('17000000-0000-4000-8000-000000000002'::uuid);

insert into public.organizations (
  id, name, slug, industry, country_code, base_currency, default_timezone, created_by
)
values
  ('27000000-0000-4000-8000-000000000001'::uuid, 'Projection tenant one', 'projection-tenant-one', 'testing', 'US', 'USD', 'UTC', '17000000-0000-4000-8000-000000000001'::uuid),
  ('27000000-0000-4000-8000-000000000002'::uuid, 'Projection tenant two', 'projection-tenant-two', 'testing', 'US', 'USD', 'UTC', '17000000-0000-4000-8000-000000000002'::uuid);

insert into public.integration_connections (
  id, organization_id, provider_key, adapter_version, connection_mode, status,
  external_account_id, external_account_label, created_by
)
values
  ('37000000-0000-4000-8000-000000000001'::uuid, '27000000-0000-4000-8000-000000000001'::uuid, 'google_business_profile', '1', 'fixture', 'active', 'tenant-one-account', 'Tenant one account', '17000000-0000-4000-8000-000000000001'::uuid),
  ('37000000-0000-4000-8000-000000000002'::uuid, '27000000-0000-4000-8000-000000000002'::uuid, 'google_business_profile', '1', 'fixture', 'active', 'tenant-two-account', 'Tenant two account', '17000000-0000-4000-8000-000000000002'::uuid);

insert into public.integration_ingestion_runs (
  id, organization_id, connection_id, idempotency_key, status, started_at, correlation_id
)
values
  ('47000000-0000-4000-8000-000000000001'::uuid, '27000000-0000-4000-8000-000000000001'::uuid, '37000000-0000-4000-8000-000000000001'::uuid, 'projection-tenant-one-run', 'running', now(), '57000000-0000-4000-8000-000000000001'::uuid),
  ('47000000-0000-4000-8000-000000000002'::uuid, '27000000-0000-4000-8000-000000000002'::uuid, '37000000-0000-4000-8000-000000000002'::uuid, 'projection-tenant-two-run', 'running', now(), '57000000-0000-4000-8000-000000000002'::uuid);

select extensions.lives_ok(
  $$select public.project_google_business_profile_record(
    '27000000-0000-4000-8000-000000000001'::uuid,
    '47000000-0000-4000-8000-000000000001'::uuid,
    '37000000-0000-4000-8000-000000000001'::uuid,
    'google_business_profile', 'locations/shared-opaque-id', null,
    'Google Business Profile location record', null, '{}'::jsonb, 'internal', '2026-08-09T00:00:00Z'::timestamptz,
    '{"google_business_profile.location.hours":"09:00-17:00"}'::jsonb
  )$$,
  'first tenant projection succeeds'
);

select extensions.lives_ok(
  $$select public.project_google_business_profile_record(
    '27000000-0000-4000-8000-000000000002'::uuid,
    '47000000-0000-4000-8000-000000000002'::uuid,
    '37000000-0000-4000-8000-000000000002'::uuid,
    'google_business_profile', 'locations/shared-opaque-id', null,
    'Google Business Profile location record', null, '{}'::jsonb, 'internal', now(),
    '{"google_business_profile.location.hours":"10:00-18:00"}'::jsonb
  )$$,
  'second tenant projection with colliding opaque source succeeds'
);

select extensions.is(
  (select count(*) from public.memory_items
   where memory_type = 'episode' and source_record_id = 'locations/shared-opaque-id'),
  2::bigint,
  'opaque source record ids remain tenant-scoped'
);

select extensions.is(
  (select count(*) from public.memory_items
   where memory_type = 'fact_proposal'
     and organization_id in (
       '27000000-0000-4000-8000-000000000001'::uuid,
       '27000000-0000-4000-8000-000000000002'::uuid
     )
     and proposed_fact_key = 'google_business_profile.location.hours'),
  2::bigint,
  'open proposal keys remain tenant-scoped'
);

update public.memory_items
set verification_state = 'verified',
    verified_by = '17000000-0000-4000-8000-000000000001'::uuid,
    verified_at = '2026-08-09T01:00:00Z'::timestamptz
where organization_id = '27000000-0000-4000-8000-000000000001'::uuid
  and memory_type = 'episode'
  and source_record_id = 'locations/shared-opaque-id';

select extensions.lives_ok(
  $$select public.project_google_business_profile_record(
    '27000000-0000-4000-8000-000000000001'::uuid,
    '47000000-0000-4000-8000-000000000001'::uuid,
    '37000000-0000-4000-8000-000000000001'::uuid,
    'google_business_profile', 'locations/shared-opaque-id', null,
    'Google Business Profile location record', null, '{}'::jsonb, 'internal', '2026-08-09T00:00:00Z'::timestamptz,
    '{"google_business_profile.location.hours":"09:00-17:00"}'::jsonb
  )$$,
  'identical provider resync replays through atomic conflicts'
);

select extensions.is(
  (select verification_state = 'verified'
          and verified_by = '17000000-0000-4000-8000-000000000001'::uuid
          and verified_at = '2026-08-09T01:00:00Z'::timestamptz
   from public.memory_items
   where organization_id = '27000000-0000-4000-8000-000000000001'::uuid
     and memory_type = 'episode' and source_record_id = 'locations/shared-opaque-id'),
  true,
  'identical provider content preserves human verification'
);

update public.memory_items
set embedding = (
      '[' || pg_catalog.array_to_string(pg_catalog.array_fill(0::real, array[1536]), ',') || ']'
    )::extensions.vector,
    embedding_model = 'test-model',
    embedding_status = 'ready',
    embedding_updated_at = '2026-08-09T02:00:00Z'::timestamptz
where organization_id = '27000000-0000-4000-8000-000000000001'::uuid
  and memory_type = 'episode'
  and source_record_id = 'locations/shared-opaque-id';

select extensions.lives_ok(
  $$select public.project_google_business_profile_record(
    '27000000-0000-4000-8000-000000000001'::uuid,
    '47000000-0000-4000-8000-000000000001'::uuid,
    '37000000-0000-4000-8000-000000000001'::uuid,
    'google_business_profile', 'locations/shared-opaque-id', null,
    'Google Business Profile location record', null, '{}'::jsonb, 'internal', '2026-08-10T00:00:00Z'::timestamptz,
    '{"google_business_profile.location.hours":"11:00-19:00"}'::jsonb
  )$$,
  'changed provider resync updates atomically'
);

select extensions.is(
  (select verification_state = 'unverified'
          and verified_by is null and verified_at is null and rejection_reason is null
   from public.memory_items
   where organization_id = '27000000-0000-4000-8000-000000000001'::uuid
     and memory_type = 'episode' and source_record_id = 'locations/shared-opaque-id'),
  true,
  'changed provider content clears human verification'
);

select extensions.is(
  (select embedding is null
          and embedding_model is null
          and embedding_status = 'pending'
          and embedding_updated_at is null
   from public.memory_items
   where organization_id = '27000000-0000-4000-8000-000000000001'::uuid
     and memory_type = 'episode' and source_record_id = 'locations/shared-opaque-id'),
  true,
  'changed projection clears a ready embedding for reprocessing'
);

select extensions.is(
  (select count(*) from public.memory_items
   where organization_id = '27000000-0000-4000-8000-000000000001'::uuid
     and memory_type = 'episode' and source_record_id = 'locations/shared-opaque-id'),
  1::bigint,
  'same tenant source record uses one episode'
);

select extensions.is(
  (select count(*) from public.memory_items
   where organization_id = '27000000-0000-4000-8000-000000000001'::uuid
     and memory_type = 'fact_proposal'
     and proposed_fact_key = 'google_business_profile.location.hours'
     and proposed_branch_id is null),
  1::bigint,
  'same tenant open proposal uses one null-branch proposal'
);

select extensions.throws_ok(
  $$select public.project_google_business_profile_record(
    '27000000-0000-4000-8000-000000000001'::uuid,
    '47000000-0000-4000-8000-000000000001'::uuid,
    '37000000-0000-4000-8000-000000000002'::uuid,
    'google_business_profile', 'locations/cross-tenant', null,
    'Google Business Profile location record', null, '{}'::jsonb, 'internal', now(),
    '{"google_business_profile.location.hours":"09:00-17:00"}'::jsonb
  )$$,
  '23503', null,
  'a mismatched tenant connection cannot project'
);

select * from extensions.finish();

rollback;
