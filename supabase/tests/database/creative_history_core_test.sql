begin;

create extension if not exists pgtap with schema extensions;

select extensions.no_plan();

-- The corrected visual-history model is deliberately separate from the legacy
-- brand-asset and creative_asset_reviews tables. Those remain readable for old
-- receipts; a new run must not need to reinterpret them.
select extensions.has_table('public', 'creative_folders', 'Creative History folders exist');
select extensions.has_table('public', 'creative_items', 'Creative History items exist');
select extensions.has_table('public', 'creative_item_versions', 'immutable creative versions exist');
select extensions.has_table('public', 'creative_item_reviews', 'append-only design reviews exist');
select extensions.has_table(
  'public', 'creative_item_performance_evidence', 'qualified performance evidence exists'
);

select extensions.has_function(
  'public', 'create_creative_folder', array['uuid', 'jsonb'],
  'asset managers can create a governed folder'
);
select extensions.has_function(
  'public', 'create_creative_item', array['uuid', 'jsonb'],
  'asset managers can create a governed item'
);
select extensions.has_function(
  'public', 'finalize_creative_item_version', array['uuid', 'jsonb'],
  'asset managers can finalize an immutable uploaded version'
);
select extensions.has_function(
  'public', 'record_creative_item_review', array['uuid', 'jsonb'],
  'reviewers can record a design verdict'
);
select extensions.has_function(
  'public', 'archive_creative_item', array['uuid', 'jsonb'],
  'asset managers can archive without deleting history'
);
select extensions.has_function(
  'public', 'backfill_studio_renders_to_creative_history', array['uuid', 'boolean'],
  'only the service worker can run the dormant Studio backfill'
);

select extensions.ok(
  exists (
    select 1 from storage.buckets
    where id = 'creative-assets' and public = false
  ),
  'Creative History has a separate private image bucket'
);
select extensions.ok(
  exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'members read creative history objects'
  ) and exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'operators upload creative history objects'
  ),
  'Creative History storage policies tenant-fence reads and uploads'
);

select extensions.ok(
  (
    select bool_and(relrowsecurity and relforcerowsecurity)
    from pg_catalog.pg_class
    where oid in (
      'public.creative_folders'::regclass,
      'public.creative_items'::regclass,
      'public.creative_item_versions'::regclass,
      'public.creative_item_reviews'::regclass,
      'public.creative_item_performance_evidence'::regclass
    )
  ),
  'every Creative History table has forced tenant RLS'
);

select extensions.ok(
  not exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in (
        'creative_folders', 'creative_items', 'creative_item_versions',
        'creative_item_reviews', 'creative_item_performance_evidence'
      )
      and grantee in ('anon', 'authenticated')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ),
  'browser roles have no direct Creative History write grant'
);

select extensions.function_privs_are(
  'public', 'create_creative_item', array['uuid', 'jsonb'],
  'authenticated', array['EXECUTE'], 'asset managers use the governed item writer'
);
select extensions.function_privs_are(
  'public', 'create_creative_item', array['uuid', 'jsonb'],
  'service_role', array[]::text[], 'the worker cannot impersonate a human item creator'
);
select extensions.function_privs_are(
  'public', 'backfill_studio_renders_to_creative_history', array['uuid', 'boolean'],
  'service_role', array['EXECUTE'], 'only the service worker may run Studio backfill'
);
select extensions.function_privs_are(
  'public', 'backfill_studio_renders_to_creative_history', array['uuid', 'boolean'],
  'authenticated', array[]::text[], 'a browser session cannot run Studio backfill'
);

select extensions.ok(
  not exists (
    select 1
    from pg_catalog.pg_proc proc
    join pg_catalog.pg_namespace space on space.oid = proc.pronamespace
    where space.nspname = 'public'
      and proc.proname in (
        'create_creative_folder', 'create_creative_item', 'finalize_creative_item_version',
        'record_creative_item_review', 'archive_creative_item',
        'backfill_studio_renders_to_creative_history'
      )
      and (
        not proc.prosecdef
        or coalesce(array_to_string(proc.proconfig, ','), '') not like '%search_path=%'
      )
  ),
  'all Creative History writers are security definer with an explicit search path'
);

select extensions.ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.creative_item_versions'::regclass
      and contype = 'f'
      and pg_catalog.pg_get_constraintdef(oid) like '%campaign_poster_renders%'
  ),
  'a Studio-linked version is tenant-bound to its source poster render'
);
select extensions.ok(
  exists (
    select 1
    from pg_catalog.pg_index index_definition
    where index_definition.indrelid = 'public.creative_item_versions'::regclass
      and index_definition.indisunique
      and pg_catalog.pg_get_indexdef(index_definition.indexrelid) like '%source_poster_render_id%'
  ),
  'a Studio render can be linked to Creative History only once per tenant'
);
select extensions.ok(
  exists (
    select 1
    from pg_catalog.pg_constraint constraint_definition
    where constraint_definition.conrelid = 'public.creative_items'::regclass
      and constraint_definition.conname = 'creative_items_current_version_fkey'
      and pg_catalog.pg_get_constraintdef(constraint_definition.oid) like '%ON DELETE SET NULL%'
  ) and exists (
    select 1
    from pg_catalog.pg_constraint constraint_definition
    where constraint_definition.conrelid = 'public.creative_item_versions'::regclass
      and constraint_definition.conname = 'creative_item_versions_item_fkey'
      and pg_catalog.pg_get_constraintdef(constraint_definition.oid) like '%ON DELETE CASCADE%'
  ),
  'item and version ownership can cascade without a circular delete restriction'
);

-- ---------------------------------------------------------------------------
-- Governed writer behavior: operator A may finalize only its own stored bytes,
-- and nobody can attach a review until those immutable bytes exist.
-- ---------------------------------------------------------------------------

insert into auth.users (id) values
  ('c9100000-0000-4000-8000-000000000001'::uuid),
  ('c9100000-0000-4000-8000-000000000002'::uuid);
insert into public.accounts (id, name, slug, created_by) values (
  'c91c0000-0000-4000-8000-000000000001'::uuid,
  'Creative History fixture account', 'creative-history-fixture-account',
  'c9100000-0000-4000-8000-000000000001'::uuid
);
insert into public.organizations (
  id, name, slug, industry, country_code, base_currency, default_timezone, created_by, account_id
) values
  ('c9100000-0000-4000-8000-000000000101'::uuid, 'Creative History A', 'creative-history-a',
   'testing', 'AE', 'AED', 'Asia/Dubai', 'c9100000-0000-4000-8000-000000000001'::uuid,
   'c91c0000-0000-4000-8000-000000000001'::uuid),
  ('c9100000-0000-4000-8000-000000000102'::uuid, 'Creative History B', 'creative-history-b',
   'testing', 'AE', 'AED', 'Asia/Dubai', 'c9100000-0000-4000-8000-000000000002'::uuid,
   'c91c0000-0000-4000-8000-000000000001'::uuid);
insert into public.organization_memberships (organization_id, user_id, role) values
  ('c9100000-0000-4000-8000-000000000101'::uuid, 'c9100000-0000-4000-8000-000000000001'::uuid, 'operator'),
  ('c9100000-0000-4000-8000-000000000102'::uuid, 'c9100000-0000-4000-8000-000000000002'::uuid, 'operator');

create temporary table creative_history_state (key text primary key, value jsonb not null);
grant select, insert, update on creative_history_state to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = 'c9100000-0000-4000-8000-000000000001';

select extensions.throws_ok(
  $$ select public.create_creative_item(
    'c9100000-0000-4000-8000-000000000101'::uuid,
    jsonb_build_object(
      'organization_id', 'c9100000-0000-4000-8000-000000000101', 'label', 'Foreign prefix',
      'creative_type', 'poster', 'source_kind', 'historical_upload',
      'rights', jsonb_build_object('status', 'owned'),
      'storage_path', 'c9100000-0000-4000-8000-000000000102/creative-history/foreign.png'
    )
  ) $$,
  '22023', 'creative_item_invalid', 'a tenant cannot reserve another tenant''s storage key'
);

select extensions.throws_ok(
  $$ select public.create_creative_item(
    'c9100000-0000-4000-8000-000000000101'::uuid,
    jsonb_build_object(
      'organization_id', 'c9100000-0000-4000-8000-000000000101', 'label', 'Empty rights',
      'creative_type', 'poster', 'source_kind', 'historical_upload', 'rights', '{}'::jsonb,
      'storage_path', 'c9100000-0000-4000-8000-000000000101/creative-history/empty-rights.png'
    )
  ) $$,
  '23514', null, 'rights status is required even when the JSON value is an object'
);

insert into creative_history_state (key, value)
select 'item', public.create_creative_item(
  'c9100000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', 'c9100000-0000-4000-8000-000000000101', 'label', 'Approved poster',
    'creative_type', 'poster', 'source_kind', 'historical_upload',
    'rights', jsonb_build_object('status', 'owned'),
    'storage_path', 'c9100000-0000-4000-8000-000000000101/creative-history/approved.png'
  )
);

select extensions.throws_ok(
  $$ select public.record_creative_item_review(
    'c9100000-0000-4000-8000-000000000101'::uuid,
    jsonb_build_object('organization_id', 'c9100000-0000-4000-8000-000000000101',
      'creative_item_version_id', (select value ->> 'version_id' from creative_history_state where key = 'item'),
      'verdict', 'approved', 'reason_codes', '[]'::jsonb)
  ) $$,
  '42501', 'creative_item_review_version_not_finalized', 'a human cannot review bytes before finalization'
);

reset role;
insert into storage.objects (bucket_id, name, metadata) values (
  'creative-assets', 'c9100000-0000-4000-8000-000000000101/creative-history/approved.png',
  jsonb_build_object('size', 1000, 'mimetype', 'image/png')
);
set local role authenticated;

select public.finalize_creative_item_version(
  'c9100000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object('organization_id', 'c9100000-0000-4000-8000-000000000101',
    'version_id', (select value ->> 'version_id' from creative_history_state where key = 'item'),
    'content_hash', repeat('a', 64), 'mime_type', 'image/png', 'byte_size', 1000,
    'width_px', 800, 'height_px', 800)
);

reset role;
select extensions.throws_ok(
  $$ update public.creative_item_versions set width_px = 801
     where id = (select (value ->> 'version_id')::uuid from creative_history_state where key = 'item') $$,
  '23514', 'creative_item_version_is_immutable', 'finalized bytes cannot be altered after review becomes possible'
);

set local role authenticated;
select extensions.throws_ok(
  $$ select public.create_creative_item(
    'c9100000-0000-4000-8000-000000000101'::uuid,
    jsonb_build_object('organization_id', 'c9100000-0000-4000-8000-000000000101', 'label', 'Studio bypass',
      'creative_type', 'poster', 'source_kind', 'studio_render', 'rights', jsonb_build_object('status', 'owned'),
      'source_poster_render_id', gen_random_uuid())
  ) $$,
  '22023', 'creative_item_invalid', 'only the controlled backfill can create a Studio-linked item'
);

select public.record_creative_item_review(
  'c9100000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object('organization_id', 'c9100000-0000-4000-8000-000000000101',
    'creative_item_version_id', (select value ->> 'version_id' from creative_history_state where key = 'item'),
    'verdict', 'approved', 'reason_codes', '[]'::jsonb)
);

reset request.jwt.claim.sub;
reset role;
select extensions.throws_ok(
  $$ update public.creative_item_reviews set note = 'mutated'
     where creative_item_version_id = (
       select (value ->> 'version_id')::uuid from creative_history_state where key = 'item'
     ) $$,
  '23514', 'creative_item_review_is_append_only', 'a recorded review cannot be altered'
);

delete from public.organizations
where id = 'c9100000-0000-4000-8000-000000000101'::uuid;
select extensions.is(
  (select count(*)::bigint from public.creative_items
   where organization_id = 'c9100000-0000-4000-8000-000000000101'::uuid),
  0::bigint, 'a populated organization can cascade-delete Creative History records'
);

select extensions.finish();

rollback;
