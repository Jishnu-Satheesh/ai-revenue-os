begin;

create extension if not exists pgtap with schema extensions;

select extensions.no_plan();

-- Covers `20260913100000_creative_history_intake_completion.sql`: the second
-- upload for an existing design, human metadata confirmation, and the folder
-- that tried to be its own parent.

select extensions.has_function(
  'public', 'reserve_creative_item_version', array['uuid', 'jsonb'],
  'asset managers can reserve the next version of an existing design'
);
select extensions.has_function(
  'public', 'confirm_creative_item_metadata', array['uuid', 'jsonb'],
  'asset managers can confirm descriptive metadata after the bytes are validated'
);

select extensions.function_privs_are(
  'public', 'reserve_creative_item_version', array['uuid', 'jsonb'],
  'authenticated', array['EXECUTE'], 'a member reserves through the governed writer'
);
select extensions.function_privs_are(
  'public', 'reserve_creative_item_version', array['uuid', 'jsonb'],
  'service_role', array[]::text[], 'the worker cannot impersonate a human uploader'
);
select extensions.function_privs_are(
  'public', 'reserve_creative_item_version', array['uuid', 'jsonb'],
  'anon', array[]::text[], 'a signed-out request cannot reserve an upload slot'
);
select extensions.function_privs_are(
  'public', 'confirm_creative_item_metadata', array['uuid', 'jsonb'],
  'authenticated', array['EXECUTE'], 'a member confirms through the governed writer'
);
select extensions.function_privs_are(
  'public', 'confirm_creative_item_metadata', array['uuid', 'jsonb'],
  'service_role', array[]::text[], 'no worker confirms metadata on a person''s behalf'
);

select extensions.ok(
  not exists (
    select 1
    from pg_catalog.pg_proc proc
    join pg_catalog.pg_namespace space on space.oid = proc.pronamespace
    where space.nspname = 'public'
      and proc.proname in ('reserve_creative_item_version', 'confirm_creative_item_metadata')
      and (
        not proc.prosecdef
        or coalesce(array_to_string(proc.proconfig, ','), '') not like '%search_path=%'
      )
  ),
  'both new writers are security definer with an explicit search path'
);

-- ---------------------------------------------------------------------------
-- Fixtures: two tenants, one operator each, plus a viewer who may read but
-- must never reserve or confirm.
-- ---------------------------------------------------------------------------

insert into auth.users (id) values
  ('c9200000-0000-4000-8000-000000000001'::uuid),
  ('c9200000-0000-4000-8000-000000000002'::uuid),
  ('c9200000-0000-4000-8000-000000000003'::uuid);
insert into public.accounts (id, name, slug, created_by) values (
  'c92c0000-0000-4000-8000-000000000001'::uuid,
  'Creative History intake account', 'creative-history-intake-account',
  'c9200000-0000-4000-8000-000000000001'::uuid
);
insert into public.organizations (
  id, name, slug, industry, country_code, base_currency, default_timezone, created_by, account_id
) values
  ('c9200000-0000-4000-8000-000000000101'::uuid, 'Intake A', 'creative-history-intake-a',
   'testing', 'AE', 'AED', 'Asia/Dubai', 'c9200000-0000-4000-8000-000000000001'::uuid,
   'c92c0000-0000-4000-8000-000000000001'::uuid),
  ('c9200000-0000-4000-8000-000000000102'::uuid, 'Intake B', 'creative-history-intake-b',
   'testing', 'AE', 'AED', 'Asia/Dubai', 'c9200000-0000-4000-8000-000000000002'::uuid,
   'c92c0000-0000-4000-8000-000000000001'::uuid);
insert into public.organization_memberships (organization_id, user_id, role) values
  ('c9200000-0000-4000-8000-000000000101'::uuid, 'c9200000-0000-4000-8000-000000000001'::uuid, 'operator'),
  ('c9200000-0000-4000-8000-000000000102'::uuid, 'c9200000-0000-4000-8000-000000000002'::uuid, 'operator'),
  ('c9200000-0000-4000-8000-000000000101'::uuid, 'c9200000-0000-4000-8000-000000000003'::uuid, 'viewer');

create temporary table creative_history_intake_state (key text primary key, value jsonb not null);
grant select, insert, update on creative_history_intake_state to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = 'c9200000-0000-4000-8000-000000000001';

insert into creative_history_intake_state (key, value)
select 'item', public.create_creative_item(
  'c9200000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', 'c9200000-0000-4000-8000-000000000101', 'label', 'Eid poster 2025',
    'creative_type', 'poster', 'source_kind', 'historical_upload',
    'rights', jsonb_build_object('status', 'owned'),
    'storage_path', 'c9200000-0000-4000-8000-000000000101/creative-history/intent-one/source'
  )
);

-- Reserving a second version ------------------------------------------------

insert into creative_history_intake_state (key, value)
select 'second', public.reserve_creative_item_version(
  'c9200000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', 'c9200000-0000-4000-8000-000000000101',
    'item_id', (select value ->> 'item_id' from creative_history_intake_state where key = 'item'),
    'storage_path', 'c9200000-0000-4000-8000-000000000101/creative-history/intent-two/source'
  )
);

select extensions.is(
  (select (value ->> 'version')::integer from creative_history_intake_state where key = 'second'),
  2, 'the second reservation takes the next version number'
);
select extensions.isnt(
  (select value ->> 'version_id' from creative_history_intake_state where key = 'second'),
  (select value ->> 'version_id' from creative_history_intake_state where key = 'item'),
  'a second upload never overwrites the first version'
);
select extensions.is(
  (select count(*)::bigint from public.creative_item_versions
   where organization_id = 'c9200000-0000-4000-8000-000000000101'::uuid and is_usable),
  0::bigint, 'a reserved version is not usable until its bytes are finalized'
);
select extensions.is(
  (select current_version_id from public.creative_items
   where organization_id = 'c9200000-0000-4000-8000-000000000101'::uuid
     and id = (select (value ->> 'item_id')::uuid from creative_history_intake_state where key = 'item')),
  (select (value ->> 'version_id')::uuid from creative_history_intake_state where key = 'item'),
  'a reservation does not promote unvalidated bytes to the current design'
);

select extensions.throws_ok(
  $$ select public.reserve_creative_item_version(
    'c9200000-0000-4000-8000-000000000101'::uuid,
    jsonb_build_object(
      'organization_id', 'c9200000-0000-4000-8000-000000000101',
      'item_id', (select value ->> 'item_id' from creative_history_intake_state where key = 'item'),
      'storage_path', 'c9200000-0000-4000-8000-000000000102/creative-history/stolen/source'
    )
  ) $$,
  '22023', 'creative_item_version_reserve_invalid',
  'a tenant cannot reserve a path inside another tenant''s folder'
);

select extensions.throws_ok(
  $$ select public.reserve_creative_item_version(
    'c9200000-0000-4000-8000-000000000102'::uuid,
    jsonb_build_object(
      'organization_id', 'c9200000-0000-4000-8000-000000000102',
      'item_id', (select value ->> 'item_id' from creative_history_intake_state where key = 'item'),
      'storage_path', 'c9200000-0000-4000-8000-000000000102/creative-history/intent-three/source'
    )
  ) $$,
  '42501', 'creative_item_version_reserve_forbidden',
  'a member of one organization cannot reserve inside another'
);

-- Metadata confirmation -----------------------------------------------------

select extensions.ok(
  (select confirmed_metadata is null from public.creative_items
   where organization_id = 'c9200000-0000-4000-8000-000000000101'::uuid
     and id = (select (value ->> 'item_id')::uuid from creative_history_intake_state where key = 'item')),
  'a newly created design starts with no confirmed metadata'
);

select public.confirm_creative_item_metadata(
  'c9200000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', 'c9200000-0000-4000-8000-000000000101',
    'item_id', (select value ->> 'item_id' from creative_history_intake_state where key = 'item'),
    'proposed_metadata', jsonb_build_object('subjectTags', jsonb_build_array('biryani'))
  )
);
select extensions.ok(
  (select confirmed_metadata is null and proposed_metadata is not null
   from public.creative_items
   where organization_id = 'c9200000-0000-4000-8000-000000000101'::uuid
     and id = (select (value ->> 'item_id')::uuid from creative_history_intake_state where key = 'item')),
  'a model proposal never becomes a human confirmation'
);

select public.confirm_creative_item_metadata(
  'c9200000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', 'c9200000-0000-4000-8000-000000000101',
    'item_id', (select value ->> 'item_id' from creative_history_intake_state where key = 'item'),
    'confirmed_metadata', jsonb_build_object('subjectTags', jsonb_build_array('biryani'))
  )
);
select extensions.ok(
  (select confirmed_metadata is not null and proposed_metadata is not null
   from public.creative_items
   where organization_id = 'c9200000-0000-4000-8000-000000000101'::uuid
     and id = (select (value ->> 'item_id')::uuid from creative_history_intake_state where key = 'item')),
  'confirming keeps the proposal alongside it, so the two stay distinguishable'
);

select extensions.throws_ok(
  $$ select public.confirm_creative_item_metadata(
    'c9200000-0000-4000-8000-000000000101'::uuid,
    jsonb_build_object(
      'organization_id', 'c9200000-0000-4000-8000-000000000101',
      'item_id', (select value ->> 'item_id' from creative_history_intake_state where key = 'item')
    )
  ) $$,
  '22023', 'creative_item_metadata_invalid', 'a confirmation that changes nothing is refused'
);

-- Permission separation -----------------------------------------------------

reset request.jwt.claim.sub;
set local request.jwt.claim.sub = 'c9200000-0000-4000-8000-000000000003';

select extensions.throws_ok(
  $$ select public.reserve_creative_item_version(
    'c9200000-0000-4000-8000-000000000101'::uuid,
    jsonb_build_object(
      'organization_id', 'c9200000-0000-4000-8000-000000000101',
      'item_id', (select value ->> 'item_id' from creative_history_intake_state where key = 'item'),
      'storage_path', 'c9200000-0000-4000-8000-000000000101/creative-history/viewer/source'
    )
  ) $$,
  '42501', 'creative_item_version_reserve_forbidden',
  'a viewer who may read the library cannot add a file to it'
);
select extensions.throws_ok(
  $$ select public.confirm_creative_item_metadata(
    'c9200000-0000-4000-8000-000000000101'::uuid,
    jsonb_build_object(
      'organization_id', 'c9200000-0000-4000-8000-000000000101',
      'item_id', (select value ->> 'item_id' from creative_history_intake_state where key = 'item'),
      'confirmed_metadata', jsonb_build_object('subjectTags', jsonb_build_array('viewer'))
    )
  ) $$,
  '42501', 'creative_item_metadata_forbidden',
  'a viewer cannot confirm what a design is a picture of'
);

-- Archive closes both doors -------------------------------------------------

reset request.jwt.claim.sub;
set local request.jwt.claim.sub = 'c9200000-0000-4000-8000-000000000001';

select public.archive_creative_item(
  'c9200000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', 'c9200000-0000-4000-8000-000000000101',
    'item_id', (select value ->> 'item_id' from creative_history_intake_state where key = 'item')
  )
);
select extensions.throws_ok(
  $$ select public.reserve_creative_item_version(
    'c9200000-0000-4000-8000-000000000101'::uuid,
    jsonb_build_object(
      'organization_id', 'c9200000-0000-4000-8000-000000000101',
      'item_id', (select value ->> 'item_id' from creative_history_intake_state where key = 'item'),
      'storage_path', 'c9200000-0000-4000-8000-000000000101/creative-history/after-archive/source'
    )
  ) $$,
  '42501', 'creative_item_not_found_or_archived',
  'an archived design accepts no further uploads'
);
select extensions.is(
  (select count(*)::bigint from public.creative_item_versions
   where organization_id = 'c9200000-0000-4000-8000-000000000101'::uuid),
  2::bigint, 'archiving preserves every version already recorded'
);

-- Folder cycles -------------------------------------------------------------

insert into creative_history_intake_state (key, value)
select 'folder', public.create_creative_folder(
  'c9200000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object('organization_id', 'c9200000-0000-4000-8000-000000000101', 'name', 'Ramadan')
);

reset role;
select extensions.throws_ok(
  format(
    $$ insert into public.creative_folders (id, organization_id, parent_folder_id, name)
       values (%L::uuid, 'c9200000-0000-4000-8000-000000000101'::uuid, %L::uuid, 'Self parent') $$,
    'c9200000-0000-4000-8000-000000000201',
    'c9200000-0000-4000-8000-000000000201'
  ),
  '23514', 'creative_folder_cycle', 'a folder cannot be its own parent'
);

select extensions.throws_ok(
  format(
    $$ update public.creative_folders set parent_folder_id = %L::uuid where id = %L::uuid $$,
    (select value ->> 'folder_id' from creative_history_intake_state where key = 'folder'),
    (select value ->> 'folder_id' from creative_history_intake_state where key = 'folder')
  ),
  '23514', 'creative_folder_cycle', 'an existing folder cannot be repointed at itself'
);

select extensions.finish();

rollback;
