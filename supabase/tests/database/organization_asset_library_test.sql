begin;

create extension if not exists pgtap with schema extensions;

select extensions.no_plan();

-- ---------------------------------------------------------------------------
-- Structure, catalogue seeds, grants, and forced RLS
-- ---------------------------------------------------------------------------

select extensions.has_table(
  'public', 'creative_review_reasons', 'the review-reason registry exists'
);
select extensions.has_table(
  'public', 'creative_asset_reviews', 'the append-only review ledger exists'
);
select extensions.has_table(
  'public', 'organization_subject_profiles', 'organization subjects exist'
);

select extensions.has_column(
  'public', 'organization_brand_assets', 'conditioning_roles',
  'brand assets declare how a model may use them'
);
select extensions.has_column(
  'public', 'organization_brand_assets', 'tags', 'brand assets carry Unicode tags'
);
select extensions.has_column(
  'public', 'organization_brand_assets', 'scripts',
  'typography references declare their scripts'
);
select extensions.has_column(
  'public', 'organization_brand_assets', 'ownership',
  'brand assets distinguish owned work from third-party references'
);
select extensions.has_column(
  'public', 'organization_brand_assets', 'archived_at', 'brand assets archive in place'
);

select extensions.has_column(
  'public', 'campaign_source_snapshots', 'reference_slots',
  'the immutable brief declaration can carry proposed reference slots'
);
select extensions.has_column(
  'public', 'campaign_source_snapshots', 'negative_rules',
  'the immutable brief declaration can carry proposed negative rules'
);
select extensions.has_column(
  'public', 'campaign_source_snapshots', 'resolver_version',
  'the immutable brief declaration can carry a proposed resolver version'
);
select extensions.has_column(
  'public', 'campaign_source_snapshots', 'resolution_outcome',
  'the immutable brief declaration can carry a proposed resolution outcome'
);
select extensions.has_column(
  'public', 'campaign_source_snapshots', 'subject_profile_id',
  'the confirmed subject identity is pinned'
);
select extensions.has_column(
  'public', 'campaign_source_snapshots', 'subject_description',
  'the exact confirmed description is copied into the snapshot'
);
select extensions.has_column(
  'public', 'campaign_source_snapshots', 'avoid_reference_version_ids',
  'negative reference versions remain separate from positive sources'
);
select extensions.has_column(
  'public', 'campaign_source_snapshots', 'blueprint',
  'the validated art-direction blueprint is pinned'
);
select extensions.has_column(
  'public', 'campaign_source_snapshots', 'plan_model_id',
  'the reasoning model is pinned'
);
select extensions.has_column(
  'public', 'campaign_source_snapshots', 'creative_direction',
  'the operator creative direction is pinned'
);

select extensions.has_column(
  'public', 'campaign_generation_runs', 'reference_slots',
  'each run records the positive reference slots it actually sent'
);
select extensions.has_column(
  'public', 'campaign_generation_runs', 'avoid_reference_version_ids',
  'each run records its negative references separately'
);
select extensions.has_column(
  'public', 'campaign_generation_runs', 'negative_rules',
  'each run records the negative rules in force'
);
select extensions.has_column(
  'public', 'campaign_generation_runs', 'resolver_version',
  'each run records the resolver version it used'
);
select extensions.has_column(
  'public', 'campaign_generation_runs', 'resolution_outcome',
  'each run records its realized resolution outcome'
);
select extensions.has_column(
  'public', 'campaign_generation_runs', 'blueprint',
  'each run records the parsed blueprint it actually used'
);
select extensions.has_column(
  'public', 'campaign_generation_runs', 'plan_model_id',
  'each run records the model that wrote its blueprint'
);

select extensions.has_function(
  'public', 'record_creative_asset_review', array['uuid', 'jsonb'],
  'the governed review writer exists'
);
select extensions.has_function(
  'public', 'upsert_subject_profile', array['uuid', 'jsonb'],
  'the governed subject writer exists'
);
select extensions.has_function(
  'public', 'confirm_subject_profile', array['uuid', 'jsonb'],
  'confirmation is a distinct write'
);
select extensions.has_function(
  'public', 'read_reference_candidates', array['uuid'],
  'the tenant-scoped candidate reader exists'
);
select extensions.has_function(
  'public', 'update_brand_asset_metadata', array['uuid', 'jsonb'],
  'brand-asset classification and archival have a governed writer'
);
select extensions.has_function(
  'public', 'pin_campaign_generation_run_reference_context', array['uuid', 'jsonb'],
  'the run-scoped reference receipt writer exists'
);

select extensions.is(
  (
    select count(*)::bigint
    from public.creative_review_reasons
    where owner_scope = 'core'
  ),
  11::bigint,
  'all eleven core review reasons are seeded'
);
select extensions.is(
  (
    select count(*)::bigint
    from public.creative_review_reasons
    where owner_scope = 'pack' and pack_slug = 'restaurant'
  ),
  4::bigint,
  'all four Restaurant Pack review reasons are seeded'
);
select extensions.is(
  (
    select count(*)::bigint
    from public.permissions
    where key in ('asset.read', 'asset.manage', 'asset.review', 'subject.manage')
      and scope = 'organization'
  ),
  4::bigint,
  'the four organization permissions are seeded'
);

select extensions.ok(
  not exists (
    select 1
    from public.organization_role_permissions
    where organization_role = 'viewer'
      and permission_key in ('asset.manage', 'asset.review', 'subject.manage')
  ) and exists (
    select 1
    from public.organization_role_permissions
    where organization_role = 'viewer' and permission_key = 'asset.read'
  ),
  'a viewer may read the library and may not change it'
);
select extensions.ok(
  not exists (
    select required.permission_key
    from unnest(array['asset.read', 'asset.manage', 'asset.review', 'subject.manage'])
      as required(permission_key)
    except
    select permission_key
    from public.organization_role_permissions
    where organization_role = 'operator'
  ),
  'an operator holds every day-to-day asset and subject permission'
);

select extensions.is(
  (
    select count(*)::bigint
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in (
        'creative_review_reasons', 'creative_asset_reviews', 'organization_subject_profiles'
      )
      and grantee in ('authenticated', 'anon')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ),
  0::bigint,
  'browser roles hold no direct write grant on any new table'
);

select extensions.ok(
  (
    select relrowsecurity and relforcerowsecurity
    from pg_catalog.pg_class
    where oid = 'public.creative_review_reasons'::regclass
  ),
  'the reason registry has forced RLS'
);
select extensions.ok(
  (
    select relrowsecurity and relforcerowsecurity
    from pg_catalog.pg_class
    where oid = 'public.creative_asset_reviews'::regclass
  ),
  'the review ledger has forced RLS'
);
select extensions.ok(
  (
    select relrowsecurity and relforcerowsecurity
    from pg_catalog.pg_class
    where oid = 'public.organization_subject_profiles'::regclass
  ),
  'subject profiles have forced RLS'
);

select extensions.function_privs_are(
  'public', 'record_creative_asset_review', array['uuid', 'jsonb'],
  'authenticated', array['EXECUTE'], 'authenticated may use the governed review writer'
);
select extensions.function_privs_are(
  'public', 'record_creative_asset_review', array['uuid', 'jsonb'],
  'service_role', array[]::text[], 'the worker role cannot impersonate a human reviewer'
);
select extensions.function_privs_are(
  'public', 'update_brand_asset_metadata', array['uuid', 'jsonb'],
  'authenticated', array['EXECUTE'], 'authenticated may use the governed metadata writer'
);
select extensions.function_privs_are(
  'public', 'update_brand_asset_metadata', array['uuid', 'jsonb'],
  'service_role', array[]::text[], 'the worker role cannot classify or archive human assets'
);
select extensions.function_privs_are(
  'public', 'upsert_subject_profile', array['uuid', 'jsonb'],
  'authenticated', array['EXECUTE'], 'authenticated may use the governed subject writer'
);
select extensions.function_privs_are(
  'public', 'confirm_subject_profile', array['uuid', 'jsonb'],
  'service_role', array[]::text[], 'the worker role cannot confirm a subject'
);
select extensions.function_privs_are(
  'public', 'read_reference_candidates', array['uuid'],
  'service_role', array['EXECUTE'], 'the worker may read a tenant-scoped reference set'
);
select extensions.function_privs_are(
  'public', 'pin_campaign_generation_run_reference_context', array['uuid', 'jsonb'],
  'authenticated', array[]::text[], 'a browser session cannot write a worker receipt'
);
select extensions.function_privs_are(
  'public', 'pin_campaign_generation_run_reference_context', array['uuid', 'jsonb'],
  'service_role', array['EXECUTE'], 'only the worker role may write a run receipt'
);
select extensions.ok(
  (
    select procedure.prosecdef
      and procedure.proconfig @> array['search_path=""']
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'pin_campaign_generation_run_reference_context'
      and procedure.proargtypes = '2950 3802'::pg_catalog.oidvector
  ),
  'the receipt writer is a security definer with an empty search path'
);
select extensions.ok(
  (
    select procedure.prosecdef
      and procedure.proconfig @> array['search_path=""']
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'update_brand_asset_metadata'
      and procedure.proargtypes = '2950 3802'::pg_catalog.oidvector
  ),
  'the metadata writer is a security definer with an empty search path'
);

-- ---------------------------------------------------------------------------
-- Two-tenant fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id)
values
  ('a5100000-0000-4000-8000-000000000001'::uuid),
  ('a5100000-0000-4000-8000-000000000002'::uuid),
  ('a5100000-0000-4000-8000-000000000003'::uuid);

insert into public.accounts (id, name, slug, created_by)
values (
  'a5c00000-0000-4000-8000-000000000001'::uuid,
  'Asset library fixture agency',
  'asset-library-fixture-agency',
  'a5100000-0000-4000-8000-000000000001'::uuid
);

insert into public.organizations (
  id, name, slug, industry, country_code, base_currency, default_timezone, created_by, account_id
)
values
  (
    'a5100000-0000-4000-8000-000000000101'::uuid,
    'Asset tenant A', 'asset-tenant-a', 'testing', 'AE', 'AED', 'Asia/Dubai',
    'a5100000-0000-4000-8000-000000000001'::uuid,
    'a5c00000-0000-4000-8000-000000000001'::uuid
  ),
  (
    'a5100000-0000-4000-8000-000000000102'::uuid,
    'Asset tenant B', 'asset-tenant-b', 'testing', 'AE', 'AED', 'Asia/Dubai',
    'a5100000-0000-4000-8000-000000000002'::uuid,
    'a5c00000-0000-4000-8000-000000000001'::uuid
  );

insert into public.organization_memberships (organization_id, user_id, role)
values
  (
    'a5100000-0000-4000-8000-000000000101'::uuid,
    'a5100000-0000-4000-8000-000000000001'::uuid,
    'operator'
  ),
  (
    'a5100000-0000-4000-8000-000000000101'::uuid,
    'a5100000-0000-4000-8000-000000000003'::uuid,
    'viewer'
  ),
  (
    'a5100000-0000-4000-8000-000000000102'::uuid,
    'a5100000-0000-4000-8000-000000000002'::uuid,
    'operator'
  );

insert into public.organization_brand_assets (
  id, organization_id, label, asset_role, conditioning_roles, tags, scripts, created_by
)
values
  (
    'a5100000-0000-4000-8000-000000000201'::uuid,
    'a5100000-0000-4000-8000-000000000101'::uuid,
    'Meen curry', 'product', array['subject'],
    array[pg_catalog.repeat('അ', 24), 'عرض'], '{}',
    'a5100000-0000-4000-8000-000000000001'::uuid
  ),
  (
    'a5100000-0000-4000-8000-000000000202'::uuid,
    'a5100000-0000-4000-8000-000000000102'::uuid,
    'Foreign dish', 'product', array['subject'], array['foreign'], '{}',
    'a5100000-0000-4000-8000-000000000002'::uuid
  ),
  (
    'a5100000-0000-4000-8000-000000000203'::uuid,
    'a5100000-0000-4000-8000-000000000101'::uuid,
    'Rejected style', 'other', array['avoid'], array['dark'], '{}',
    'a5100000-0000-4000-8000-000000000001'::uuid
  );

update public.organization_brand_assets
set ownership = 'owned'
where id = 'a5100000-0000-4000-8000-000000000201'::uuid;

insert into public.organization_brand_asset_versions (
  id, organization_id, brand_asset_id, version, storage_path, content_hash,
  mime_type, byte_size, width_px, height_px, is_usable
)
values
  (
    'a5100000-0000-4000-8000-000000000301'::uuid,
    'a5100000-0000-4000-8000-000000000101'::uuid,
    'a5100000-0000-4000-8000-000000000201'::uuid,
    1, 'a/subject/source', pg_catalog.repeat('a', 64), 'image/png', 1000, 800, 800, true
  ),
  (
    'a5100000-0000-4000-8000-000000000302'::uuid,
    'a5100000-0000-4000-8000-000000000102'::uuid,
    'a5100000-0000-4000-8000-000000000202'::uuid,
    1, 'b/subject/source', pg_catalog.repeat('b', 64), 'image/png', 1000, 800, 800, true
  ),
  (
    'a5100000-0000-4000-8000-000000000303'::uuid,
    'a5100000-0000-4000-8000-000000000101'::uuid,
    'a5100000-0000-4000-8000-000000000203'::uuid,
    1, 'a/rejected/source', pg_catalog.repeat('c', 64), 'image/png', 1000, 800, 800, true
  );

-- The constraint counts characters rather than UTF-8 bytes. Twenty-four
-- Malayalam characters and an Arabic tag both survive unchanged.
select extensions.is(
  (
    select tags
    from public.organization_brand_assets
    where id = 'a5100000-0000-4000-8000-000000000201'::uuid
  ),
  array[pg_catalog.repeat('അ', 24), 'عرض']::text[],
  'Unicode tags round-trip and a 24-character Malayalam tag is accepted'
);

select extensions.throws_ok(
  $$
    insert into public.organization_brand_assets (
      organization_id, label, asset_role, conditioning_roles, tags, scripts, created_by
    ) values (
      'a5100000-0000-4000-8000-000000000101'::uuid,
      'Too long', 'other', array['palette'], array[repeat('അ', 61)], '{}',
      'a5100000-0000-4000-8000-000000000001'::uuid
    )
  $$,
  '23514', null,
  'a tag longer than sixty characters is refused by character count'
);

select extensions.throws_ok(
  $$
    insert into public.organization_brand_assets (
      organization_id, label, asset_role, conditioning_roles, tags, scripts, created_by
    ) values (
      'a5100000-0000-4000-8000-000000000101'::uuid,
      'Typography missing script', 'other', array['typography'], '{}', '{}',
      'a5100000-0000-4000-8000-000000000001'::uuid
    )
  $$,
  '23514', null,
  'a typography reference must declare at least one script'
);

select extensions.throws_ok(
  $$
    insert into public.organization_brand_assets (
      organization_id, label, asset_role, conditioning_roles, tags, scripts, created_by
    ) values (
      'a5100000-0000-4000-8000-000000000101'::uuid,
      'Script without typography', 'other', array['palette'], '{}', array['Latn'],
      'a5100000-0000-4000-8000-000000000001'::uuid
    )
  $$,
  '23514', null,
  'scripts are empty unless the asset is a typography reference'
);

select extensions.throws_ok(
  $$
    insert into public.organization_brand_assets (
      organization_id, label, asset_role, conditioning_roles, tags, scripts, created_by
    ) values (
      'a5100000-0000-4000-8000-000000000101'::uuid,
      'Unknown role', 'other', array['invent_subject'], '{}', '{}',
      'a5100000-0000-4000-8000-000000000001'::uuid
    )
  $$,
  '23514', null,
  'an unknown conditioning role is refused'
);

select extensions.is(
  (
    select ownership
    from public.organization_brand_assets
    where id = 'a5100000-0000-4000-8000-000000000202'::uuid
  ),
  'third_party'::text,
  'third-party ownership is the safe default'
);

select extensions.throws_ok(
  $$
    insert into public.organization_brand_assets (
      organization_id, label, asset_role, conditioning_roles, tags, scripts, ownership, created_by
    ) values (
      'a5100000-0000-4000-8000-000000000101'::uuid,
      'Unknown ownership', 'other', array['palette'], '{}', '{}', 'licensed',
      'a5100000-0000-4000-8000-000000000001'::uuid
    )
  $$,
  '23514', null,
  'an unknown ownership value is refused'
);

-- A real campaign asset in tenant B proves the polymorphic review writer does
-- not merely reject an unknown UUID; it rejects an existing foreign subject.
insert into public.campaign_briefs (id, organization_id, objective, audience, created_by)
values (
  'a5100000-0000-4000-8000-000000000402'::uuid,
  'a5100000-0000-4000-8000-000000000102'::uuid,
  'Foreign objective', 'Foreign audience',
  'a5100000-0000-4000-8000-000000000002'::uuid
);

insert into public.campaigns (id, organization_id, title, source_kind, brief_id, created_by)
values (
  'a5100000-0000-4000-8000-000000000502'::uuid,
  'a5100000-0000-4000-8000-000000000102'::uuid,
  'Foreign campaign', 'manual_brief',
  'a5100000-0000-4000-8000-000000000402'::uuid,
  'a5100000-0000-4000-8000-000000000002'::uuid
);

insert into public.campaign_source_snapshots (
  id, organization_id, campaign_id, facts, assertions
)
values (
  'a5100000-0000-4000-8000-000000000602'::uuid,
  'a5100000-0000-4000-8000-000000000102'::uuid,
  'a5100000-0000-4000-8000-000000000502'::uuid,
  '{}'::jsonb, '[]'::jsonb
);

insert into public.campaign_bundle_versions (
  id, organization_id, campaign_id, version, source_snapshot_id, manifest, digest,
  generation_profile, execution_mode
)
values (
  'a5100000-0000-4000-8000-000000000702'::uuid,
  'a5100000-0000-4000-8000-000000000102'::uuid,
  'a5100000-0000-4000-8000-000000000502'::uuid,
  1,
  'a5100000-0000-4000-8000-000000000602'::uuid,
  jsonb_build_object(
    'schemaVersion', 2,
    'campaignId', 'a5100000-0000-4000-8000-000000000502',
    'version', 1,
    'generationProfile', 'brand_guided',
    'executionMode', 'best_effort',
    'generationPolicy', jsonb_build_object(
      'maxVariantsPerDirection', 1,
      'maxVariantsTotal', 1,
      'policyExpiresAt', '2026-12-01T00:00:00.000Z',
      'lockedOfferRef', null,
      'lockedAssertionKeys', '[]'::jsonb
    ),
    'directions', jsonb_build_array(1),
    'actions', '[]'::jsonb,
    'assets', '[]'::jsonb
  ),
  pg_catalog.repeat('d', 64), 'brand_guided', 'best_effort'
);

insert into public.campaign_assets (
  id, organization_id, bundle_version_id, asset_key, storage_path, content_hash,
  mime_type, width_px, height_px, truth_class, provenance, alt_text
)
values (
  'a5100000-0000-4000-8000-000000000802'::uuid,
  'a5100000-0000-4000-8000-000000000102'::uuid,
  'a5100000-0000-4000-8000-000000000702'::uuid,
  'a5100000-0000-4000-8000-000000000902'::uuid,
  'campaigns/foreign/asset.png', pg_catalog.repeat('e', 64),
  'image/png', 800, 800, 'synthetic_generated', '{}'::jsonb, 'Foreign generated asset'
);

create temporary table asset_library_state (key text primary key, value jsonb not null);
grant select, insert, update on asset_library_state to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Subject profiles and reviews through governed RPCs
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'a5100000-0000-4000-8000-000000000001';

insert into asset_library_state (key, value)
select 'classified_reservation', public.create_brand_asset_version(
  'a5100000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', 'a5100000-0000-4000-8000-000000000101',
    'brand_asset_id', null,
    'label', 'Malayalam wordmark',
    'asset_role', 'logo',
    'conditioning_roles', jsonb_build_array('brand_mark', 'typography'),
    'tags', jsonb_build_array('Café', 'മലയാളം'),
    'scripts', jsonb_build_array('Latn', 'Mlym'),
    'ownership', 'owned'
  )
);

insert into asset_library_state (key, value)
select 'legacy_reservation', public.create_brand_asset_version(
  'a5100000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', 'a5100000-0000-4000-8000-000000000101',
    'brand_asset_id', null,
    'label', 'Legacy unclassified upload',
    'asset_role', 'other'
  )
);

select extensions.ok(
  (
    select conditioning_roles = '{}'::text[]
      and tags = '{}'::text[]
      and scripts = '{}'::text[]
      and ownership = 'third_party'
    from public.organization_brand_assets
    where id = (
      select (value ->> 'brand_asset_id')::uuid
      from asset_library_state where key = 'legacy_reservation'
    )
  ),
  'the existing upload route may still reserve a new asset without classification'
);

select extensions.ok(
  (
    select conditioning_roles = array['brand_mark', 'typography']::text[]
      and tags = array['Café', 'മലയാളം']::text[]
      and scripts = array['Latn', 'Mlym']::text[]
      and ownership = 'owned'
    from public.organization_brand_assets
    where id = (
      select (value ->> 'brand_asset_id')::uuid
      from asset_library_state where key = 'classified_reservation'
    )
  ),
  'a new reference reserves its normalized classification atomically'
);

select public.finalize_brand_asset_version(
  'a5100000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'version_id', (
      select value ->> 'version_id'
      from asset_library_state where key = 'classified_reservation'
    ),
    'content_hash', pg_catalog.repeat('f', 64),
    'mime_type', 'image/png',
    'byte_size', 1000,
    'width_px', 800,
    'height_px', 800
  )
);

select extensions.ok(
  exists (
    select 1
    from public.audit_events event
    where event.organization_id = 'a5100000-0000-4000-8000-000000000101'::uuid
      and event.event_name = 'asset.version_added'
      and event.entity_id = (
        select (value ->> 'version_id')::uuid
        from asset_library_state where key = 'classified_reservation'
      )
      and event.actor_id = 'a5100000-0000-4000-8000-000000000001'::uuid
  ),
  'finalizing validated bytes emits the identifier-only version-added audit event'
);

insert into asset_library_state (key, value)
select 'classified_metadata', public.update_brand_asset_metadata(
  'a5100000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', 'a5100000-0000-4000-8000-000000000101',
    'brand_asset_id', (
      select value ->> 'brand_asset_id'
      from asset_library_state where key = 'classified_reservation'
    ),
    'conditioning_roles', jsonb_build_array('typography'),
    'tags', jsonb_build_array('Café', 'عرض'),
    'scripts', jsonb_build_array('Latn', 'Arab'),
    'archived', true
  )
);

select extensions.ok(
  (
    select asset.tags = array['Café', 'عرض']::text[]
      and asset.archived_at is not null
      and state.value ->> 'archived_at' is not null
    from public.organization_brand_assets asset
    join asset_library_state state on state.key = 'classified_metadata'
    where asset.id = (
      select (value ->> 'brand_asset_id')::uuid
      from asset_library_state where key = 'classified_reservation'
    )
  ),
  'the metadata writer normalizes tags and archives without deleting the asset'
);

select extensions.ok(
  exists (
    select 1
    from public.audit_events event
    where event.organization_id = 'a5100000-0000-4000-8000-000000000101'::uuid
      and event.event_name = 'asset.archived'
      and event.entity_id = (
        select (value ->> 'brand_asset_id')::uuid
        from asset_library_state where key = 'classified_reservation'
      )
      and event.actor_id = 'a5100000-0000-4000-8000-000000000001'::uuid
  ),
  'archival emits the identifier-only asset-archived audit event'
);

select public.update_brand_asset_metadata(
  'a5100000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', 'a5100000-0000-4000-8000-000000000101',
    'brand_asset_id', (
      select value ->> 'brand_asset_id'
      from asset_library_state where key = 'classified_reservation'
    ),
    'archived', false
  )
);

select extensions.ok(
  (
    select archived_at is null
    from public.organization_brand_assets
    where id = (
      select (value ->> 'brand_asset_id')::uuid
      from asset_library_state where key = 'classified_reservation'
    )
  ),
  'an archived asset can be restored without rewriting its versions'
);

select extensions.ok(
  exists (
    select 1
    from public.audit_events event
    where event.organization_id = 'a5100000-0000-4000-8000-000000000101'::uuid
      and event.event_name = 'asset.updated'
      and event.entity_id = (
        select (value ->> 'brand_asset_id')::uuid
        from asset_library_state where key = 'classified_reservation'
      )
      and event.actor_id = 'a5100000-0000-4000-8000-000000000001'::uuid
  ),
  'restoring an asset emits the declared identifier-only asset-updated event'
);

select extensions.throws_ok(
  $$
    select public.create_brand_asset_version(
      'a5100000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', 'a5100000-0000-4000-8000-000000000101',
        'brand_asset_id', null,
        'label', 'Empty classification',
        'asset_role', 'product',
        'conditioning_roles', '[]'::jsonb,
        'tags', '[]'::jsonb,
        'scripts', '[]'::jsonb,
        'ownership', 'owned'
      )
    )
  $$,
  '23514', 'brand_asset_classification_required',
  'a supplied classification must declare at least one conditioning role'
);

select extensions.throws_ok(
  $$
    select public.create_brand_asset_version(
      'a5100000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', 'a5100000-0000-4000-8000-000000000101',
        'brand_asset_id', null,
        'label', 'Duplicate tags',
        'asset_role', 'product',
        'conditioning_roles', jsonb_build_array('subject'),
        'tags', jsonb_build_array('Café', 'Café'),
        'scripts', '[]'::jsonb,
        'ownership', 'owned'
      )
    )
  $$,
  '23514', 'brand_asset_tags_duplicate',
  'normalized case-folded tags cannot be duplicated'
);

select extensions.throws_ok(
  $$
    select public.create_brand_asset_version(
      'a5100000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', 'a5100000-0000-4000-8000-000000000101',
        'brand_asset_id', (
          select value ->> 'brand_asset_id'
          from asset_library_state where key = 'classified_reservation'
        ),
        'conditioning_roles', jsonb_build_array('subject')
      )
    )
  $$,
  '23514', 'brand_asset_existing_classification_forbidden',
  'reserving another version cannot rewrite an existing asset classification'
);

select extensions.throws_ok(
  $$
    select public.update_brand_asset_metadata(
      'a5100000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', 'a5100000-0000-4000-8000-000000000101',
        'brand_asset_id', 'a5100000-0000-4000-8000-000000000202',
        'archived', true
      )
    )
  $$,
  '42501', 'brand_asset_metadata_not_found',
  'the metadata writer refuses an existing asset from another tenant'
);

insert into asset_library_state (key, value)
select 'subject', public.upsert_subject_profile(
  'a5100000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', 'a5100000-0000-4000-8000-000000000101',
    'name', 'Meen curry',
    'slug', 'meen-curry',
    'description',
      'Kingfish steaks in brick-red tamarind coconut gravy, served in a red clay pot.',
    'tags', jsonb_build_array('മീൻ കറി', 'fish curry'),
    'names_by_script', jsonb_build_object('Mlym', 'മീൻ കറി', 'Arab', 'كاري السمك'),
    'must_not_appear', jsonb_build_array('naan', 'human faces'),
    'illustrated_style', false
  )
);

select extensions.is(
  (
    select state
    from public.organization_subject_profiles
    where id = (
      select (value ->> 'subject_profile_id')::uuid
      from asset_library_state where key = 'subject'
    )
  ),
  'draft'::text,
  'upserting a subject creates an unconfirmed draft'
);

insert into asset_library_state (key, value)
select 'confirmation', public.confirm_subject_profile(
  'a5100000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', 'a5100000-0000-4000-8000-000000000101',
    'subject_profile_id', (
      select value ->> 'subject_profile_id' from asset_library_state where key = 'subject'
    )
  )
);

select extensions.ok(
  (
    select state = 'confirmed'
      and confirmed_by = 'a5100000-0000-4000-8000-000000000001'::uuid
      and names_by_script ->> 'Mlym' = 'മീൻ കറി'
    from public.organization_subject_profiles
    where id = (
      select (value ->> 'subject_profile_id')::uuid
      from asset_library_state where key = 'subject'
    )
  ),
  'confirmation records the human and preserves multilingual names'
);

insert into asset_library_state (key, value)
select 'approved_review', public.record_creative_asset_review(
  'a5100000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', 'a5100000-0000-4000-8000-000000000101',
    'subject_kind', 'brand_asset_version',
    'subject_id', 'a5100000-0000-4000-8000-000000000301',
    'verdict', 'approved',
    'reason_codes', '[]'::jsonb
  )
);

insert into asset_library_state (key, value)
select 'rejected_review', public.record_creative_asset_review(
  'a5100000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', 'a5100000-0000-4000-8000-000000000101',
    'subject_kind', 'brand_asset_version',
    'subject_id', 'a5100000-0000-4000-8000-000000000303',
    'verdict', 'rejected',
    'reason_codes', jsonb_build_array('wrong_style', 'people_shown'),
    'note', 'Keep the next one focused on the dish.'
  )
);

select extensions.throws_ok(
  $$
    select public.record_creative_asset_review(
      'a5100000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', 'a5100000-0000-4000-8000-000000000101',
        'subject_kind', 'brand_asset_version',
        'subject_id', 'a5100000-0000-4000-8000-000000000302',
        'verdict', 'approved',
        'reason_codes', '[]'::jsonb
      )
    )
  $$,
  '42501', 'creative_asset_review_subject_not_found',
  'the review writer refuses an existing brand-asset version from another tenant'
);

select extensions.throws_ok(
  $$
    select public.record_creative_asset_review(
      'a5100000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', 'a5100000-0000-4000-8000-000000000101',
        'subject_kind', 'campaign_asset',
        'subject_id', 'a5100000-0000-4000-8000-000000000802',
        'verdict', 'approved',
        'reason_codes', '[]'::jsonb
      )
    )
  $$,
  '42501', 'creative_asset_review_subject_not_found',
  'the review writer refuses an existing campaign asset from another tenant'
);

select extensions.throws_ok(
  $$
    select public.record_creative_asset_review(
      'a5100000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', 'a5100000-0000-4000-8000-000000000101',
        'subject_kind', 'brand_asset_version',
        'subject_id', 'a5100000-0000-4000-8000-000000000301',
        'verdict', 'rejected',
        'reason_codes', '[]'::jsonb
      )
    )
  $$,
  '23514', null,
  'a rejection without a reason is refused'
);

insert into asset_library_state (key, value)
select 'candidates', public.read_reference_candidates(
  'a5100000-0000-4000-8000-000000000101'::uuid
);

select extensions.ok(
  exists (
    select 1
    from asset_library_state state,
      lateral jsonb_array_elements(state.value -> 'candidates') candidate
    where state.key = 'candidates'
      and candidate ->> 'brand_asset_version_id'
        = 'a5100000-0000-4000-8000-000000000301'
      and candidate ->> 'ownership' = 'owned'
      and candidate ->> 'current_verdict' = 'approved'
  ) and exists (
    select 1
    from asset_library_state state,
      lateral jsonb_array_elements(state.value -> 'candidates') candidate
    where state.key = 'candidates'
      and candidate ->> 'brand_asset_version_id'
        = 'a5100000-0000-4000-8000-000000000303'
      and candidate ->> 'current_verdict' = 'rejected'
      and candidate -> 'current_reason_codes'
        = jsonb_build_array('wrong_style', 'people_shown')
      and candidate ->> 'current_reviewed_at' is not null
  ) and not exists (
    select 1
    from asset_library_state state,
      lateral jsonb_array_elements(state.value -> 'candidates') candidate
    where state.key = 'candidates'
      and candidate ->> 'brand_asset_version_id'
        = 'a5100000-0000-4000-8000-000000000302'
  ),
  'candidate reads include approved and rejected local versions with routing evidence and exclude foreign versions'
);

select extensions.ok(
  exists (
    select 1
    from asset_library_state state,
      lateral jsonb_array_elements(state.value -> 'rejected_reasons') reason
    where state.key = 'candidates' and reason ->> 'code' = 'people_shown'
  ),
  'the governed reason registry remains available for deterministic negative rules'
);

reset role;

select extensions.throws_ok(
  $$
    insert into public.creative_asset_reviews (
      organization_id, subject_kind, subject_id, verdict, reason_codes, reviewed_by
    ) values (
      'a5100000-0000-4000-8000-000000000101'::uuid,
      'brand_asset_version', 'a5100000-0000-4000-8000-000000000301'::uuid,
      'rejected', array['not_registered'],
      'a5100000-0000-4000-8000-000000000001'::uuid
    )
  $$,
  '23503', 'creative_review_reason_not_found',
  'an unknown reason code is refused by the referential guard'
);

select extensions.throws_ok(
  format(
    'update public.creative_asset_reviews set note = %L where id = %L',
    'rewritten',
    (
      select value ->> 'review_id'
      from asset_library_state where key = 'approved_review'
    )
  ),
  '23514', 'creative_asset_review_is_append_only',
  'a review cannot be updated'
);
select extensions.throws_ok(
  format(
    'delete from public.creative_asset_reviews where id = %L',
    (
      select value ->> 'review_id'
      from asset_library_state where key = 'approved_review'
    )
  ),
  '23514', 'creative_asset_review_is_append_only',
  'a review cannot be deleted'
);

select extensions.throws_ok(
  $$
    insert into public.organization_subject_profiles (
      organization_id, name, slug, description, state, created_by
    ) values (
      'a5100000-0000-4000-8000-000000000101'::uuid,
      'Unconfirmed', 'unconfirmed', null, 'confirmed',
      'a5100000-0000-4000-8000-000000000001'::uuid
    )
  $$,
  '23514', null,
  'a confirmed profile without a description and confirmer is refused'
);

-- ---------------------------------------------------------------------------
-- RLS and permission behavior
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'a5100000-0000-4000-8000-000000000003';

select extensions.is(
  (select count(*)::bigint from public.organization_subject_profiles),
  1::bigint,
  'a viewer sees subject profiles in their own organization only'
);
select extensions.is(
  (select count(*)::bigint from public.creative_asset_reviews),
  2::bigint,
  'a viewer sees review history in their own organization only'
);
select extensions.throws_ok(
  $$
    select public.record_creative_asset_review(
      'a5100000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', 'a5100000-0000-4000-8000-000000000101',
        'subject_kind', 'brand_asset_version',
        'subject_id', 'a5100000-0000-4000-8000-000000000301',
        'verdict', 'approved', 'reason_codes', '[]'::jsonb
      )
    )
  $$,
  '42501', 'creative_asset_review_forbidden',
  'a viewer cannot review an asset'
);
select extensions.throws_ok(
  $$
    select public.update_brand_asset_metadata(
      'a5100000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', 'a5100000-0000-4000-8000-000000000101',
        'brand_asset_id', 'a5100000-0000-4000-8000-000000000201',
        'archived', true
      )
    )
  $$,
  '42501', 'brand_asset_metadata_forbidden',
  'a viewer cannot classify or archive a brand asset'
);
select extensions.throws_ok(
  $$
    select public.update_brand_asset_metadata(
      'a5100000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', 'a5100000-0000-4000-8000-000000000101',
        'brand_asset_id', 'not-a-uuid',
        'archived', 'maybe'
      )
    )
  $$,
  '42501', 'brand_asset_metadata_forbidden',
  'authorization runs before metadata values are parsed'
);
select extensions.throws_ok(
  $$
    select public.create_brand_asset_version(
      'a5100000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', 'a5100000-0000-4000-8000-000000000101',
        'brand_asset_id', 'not-a-uuid'
      )
    )
  $$,
  '42501', 'brand_asset_forbidden',
  'reservation authorization also runs before an existing asset id is parsed'
);

set local request.jwt.claim.sub = 'a5100000-0000-4000-8000-000000000002';
select extensions.throws_ok(
  $$
    select public.read_reference_candidates(
      'a5100000-0000-4000-8000-000000000101'::uuid
    )
  $$,
  '42501', 'reference_candidates_forbidden',
  'a member of another tenant cannot read reference candidates'
);

reset request.jwt.claim.sub;
set local request.jwt.claim.role = 'service_role';
select extensions.throws_ok(
  $$
    select public.read_reference_candidates(
      'a5100000-0000-4000-8000-000000000101'::uuid
    )
  $$,
  '42501', 'reference_candidates_forbidden',
  'a JWT role claim cannot grant the worker path without a database role switch'
);

reset request.jwt.claim.role;
select extensions.throws_ok(
  $$
    select public.read_reference_candidates(
      'a5100000-0000-4000-8000-000000000101'::uuid
    )
  $$,
  '42501', 'reference_candidates_forbidden',
  'an authenticated call with no JWT subject cannot masquerade as the worker'
);

reset role;

-- ---------------------------------------------------------------------------
-- Changed campaign functions pin and return all ten fields
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'a5100000-0000-4000-8000-000000000001';

insert into asset_library_state (key, value)
select 'campaign', public.create_campaign_with_source(
  'a5100000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', 'a5100000-0000-4000-8000-000000000101',
    'title', 'Declared subject campaign',
    'source_kind', 'manual_brief',
    'idempotency_key', 'asset-library-campaign-1',
    'brief', jsonb_build_object(
      'objective', 'Increase weekday dinner visits',
      'audience', 'Nearby families',
      'offer', null,
      'requested_channels', jsonb_build_array('instagram')
    ),
    'facts', jsonb_build_object('syntheticAssetsAllowed', false),
    'brand_asset_version_ids',
      jsonb_build_array('a5100000-0000-4000-8000-000000000301'),
    'assertions', '[]'::jsonb,
    'reference_slots', jsonb_build_array(
      jsonb_build_object(
        'slot', 'subject',
        'ordinal', 0,
        'brandAssetVersionId', 'a5100000-0000-4000-8000-000000000301'
      )
    ),
    'negative_rules', jsonb_build_array(
      jsonb_build_object('code', 'people_shown', 'description', 'Do not show people.')
    ),
    'resolver_version', 1,
    'resolution_outcome', 'resolved',
    'subject_profile_id', (
      select value ->> 'subject_profile_id' from asset_library_state where key = 'subject'
    ),
    'subject_description',
      'Kingfish steaks in brick-red tamarind coconut gravy, served in a red clay pot.',
    'avoid_reference_version_ids',
      jsonb_build_array('a5100000-0000-4000-8000-000000000303'),
    'blueprint', jsonb_build_object(
      'composition', 'Centered clay pot with generous negative space',
      'lighting', 'Warm side light'
    ),
    'plan_model_id', 'gemini-plan-test',
    'creative_direction', 'Keep the treatment warm and restrained.'
  )
);

select extensions.ok(
  (
    select jsonb_array_length(reference_slots) = 1
      and jsonb_array_length(negative_rules) = 1
      and resolver_version = 1
      and resolution_outcome = 'resolved'
      and subject_profile_id = (
        select (value ->> 'subject_profile_id')::uuid
        from asset_library_state where key = 'subject'
      )
      and subject_description =
        'Kingfish steaks in brick-red tamarind coconut gravy, served in a red clay pot.'
      and avoid_reference_version_ids =
        array['a5100000-0000-4000-8000-000000000303'::uuid]
      and blueprint = jsonb_build_object(
        'composition', 'Centered clay pot with generous negative space',
        'lighting', 'Warm side light'
      )
      and plan_model_id = 'gemini-plan-test'
      and creative_direction = 'Keep the treatment warm and restrained.'
    from public.campaign_source_snapshots
    where id = (
      select (value ->> 'source_snapshot_id')::uuid
      from asset_library_state where key = 'campaign'
    )
  ),
  'campaign creation records all ten declared resolver and art-direction fields immutably'
);

-- A variants run is derived from an approved bundle version. The run must be
-- allowed to pin that input; the original revise-only constraint rejected this
-- correctly formed enqueue before a worker could ever claim it.
reset role;

insert into public.campaign_bundle_versions (
  id, organization_id, campaign_id, version, source_snapshot_id, manifest, digest,
  generation_profile, execution_mode
)
select
  'a5100000-0000-4000-8000-000000000703'::uuid,
  'a5100000-0000-4000-8000-000000000101'::uuid,
  (value ->> 'campaign_id')::uuid,
  1,
  (value ->> 'source_snapshot_id')::uuid,
  jsonb_build_object(
    'schemaVersion', 2,
    'campaignId', value ->> 'campaign_id',
    'version', 1,
    'generationProfile', 'brand_guided',
    'executionMode', 'best_effort',
    'generationPolicy', jsonb_build_object(
      'maxVariantsPerDirection', 2,
      'maxVariantsTotal', 2,
      'policyExpiresAt', '2026-12-01T00:00:00.000Z',
      'lockedOfferRef', null,
      'lockedAssertionKeys', '[]'::jsonb
    ),
    'directions', '[]'::jsonb,
    'actions', '[]'::jsonb,
    'assets', '[]'::jsonb
  ),
  pg_catalog.repeat('e', 64),
  'brand_guided',
  'best_effort'
from asset_library_state
where key = 'campaign';

set local role authenticated;
set local request.jwt.claim.sub = 'a5100000-0000-4000-8000-000000000001';

select extensions.ok(
  (
    public.enqueue_campaign_generation_run(
      'a5100000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', 'a5100000-0000-4000-8000-000000000101',
        'campaign_id', (
          select value ->> 'campaign_id' from asset_library_state where key = 'campaign'
        ),
        'source_snapshot_id', (
          select value ->> 'source_snapshot_id' from asset_library_state where key = 'campaign'
        ),
        'kind', 'variants',
        'idempotency_key', 'asset-library-variants-1',
        'request_digest', pg_catalog.repeat('a', 64),
        'correlation_id', 'a5100000-0000-4000-8000-000000000997',
        'base_version_id', 'a5100000-0000-4000-8000-000000000703',
        'base_digest', pg_catalog.repeat('e', 64),
        'variants_per_direction', 2
      )
    ) ->> 'run_id'
  ) is not null,
  'a variants run may pin the approved bundle version it derives from'
);

insert into asset_library_state (key, value)
select 'run', public.enqueue_campaign_generation_run(
  'a5100000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', 'a5100000-0000-4000-8000-000000000101',
    'campaign_id', (
      select value ->> 'campaign_id' from asset_library_state where key = 'campaign'
    ),
    'source_snapshot_id', (
      select value ->> 'source_snapshot_id' from asset_library_state where key = 'campaign'
    ),
    'kind', 'generate',
    'idempotency_key', 'asset-library-generation-1',
    'request_digest', pg_catalog.repeat('f', 64),
    'correlation_id', 'a5100000-0000-4000-8000-000000000999'
  )
);

reset role;
reset request.jwt.claim.sub;

set local request.jwt.claim.role = 'service_role';
select extensions.throws_ok(
  $$
    select public.pin_campaign_generation_run_reference_context(
      'a5100000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', 'a5100000-0000-4000-8000-000000000101',
        'run_id', (select value ->> 'run_id' from asset_library_state where key = 'run'),
        'claim_token', 'a5100000-0000-4000-8000-000000000998',
        'phase', 'resolution',
        'reference_slots', '[]'::jsonb,
        'avoid_reference_version_ids', '[]'::jsonb,
        'negative_rules', '[]'::jsonb,
        'resolver_version', 1,
        'resolution_outcome', 'synthesis_permitted'
      )
    )
  $$,
  '42501', 'campaign_generation_pin_forbidden',
  'a JWT role claim cannot grant the worker write path without a database role switch'
);
reset request.jwt.claim.role;

set local role service_role;
reset request.jwt.claim.role;

insert into asset_library_state (key, value)
select 'worker_candidates', public.read_reference_candidates(
  'a5100000-0000-4000-8000-000000000101'::uuid
);

select extensions.ok(
  not exists (
    select 1
    from asset_library_state state,
      lateral jsonb_array_elements(state.value -> 'candidates') candidate
    where state.key = 'worker_candidates'
      and candidate ->> 'brand_asset_version_id'
        = 'a5100000-0000-4000-8000-000000000302'
  ),
  'the worker read remains explicitly scoped to the requested organization'
);

insert into asset_library_state (key, value)
select 'claim', public.claim_campaign_generation_run(
  'a5100000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', 'a5100000-0000-4000-8000-000000000101',
    'run_id', (select value ->> 'run_id' from asset_library_state where key = 'run'),
    'lease_seconds', 300
  )
);

select extensions.throws_ok(
  $$
    select public.pin_campaign_generation_run_reference_context(
      'a5100000-0000-4000-8000-000000000102'::uuid,
      jsonb_build_object(
        'organization_id', 'a5100000-0000-4000-8000-000000000102',
        'run_id', (select value ->> 'run_id' from asset_library_state where key = 'run'),
        'claim_token', (select value ->> 'claim_token' from asset_library_state where key = 'claim'),
        'phase', 'resolution',
        'reference_slots', '[]'::jsonb,
        'avoid_reference_version_ids', '[]'::jsonb,
        'negative_rules', '[]'::jsonb,
        'resolver_version', 1,
        'resolution_outcome', 'synthesis_permitted'
      )
    )
  $$,
  '42501', 'campaign_generation_run_not_found',
  'a run receipt cannot be pinned through another organization'
);

select extensions.throws_ok(
  $$
    select public.pin_campaign_generation_run_reference_context(
      'a5100000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', 'a5100000-0000-4000-8000-000000000101',
        'run_id', (select value ->> 'run_id' from asset_library_state where key = 'run'),
        'claim_token', 'a5100000-0000-4000-8000-000000000998',
        'phase', 'resolution',
        'reference_slots', '[]'::jsonb,
        'avoid_reference_version_ids', '[]'::jsonb,
        'negative_rules', '[]'::jsonb,
        'resolver_version', 1,
        'resolution_outcome', 'synthesis_permitted'
      )
    )
  $$,
  '42501', 'campaign_generation_claim_lost',
  'a stale worker claim cannot pin a run receipt'
);

select extensions.throws_ok(
  $$
    select public.pin_campaign_generation_run_reference_context(
      'a5100000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', 'a5100000-0000-4000-8000-000000000101',
        'run_id', (select value ->> 'run_id' from asset_library_state where key = 'run'),
        'claim_token', (select value ->> 'claim_token' from asset_library_state where key = 'claim'),
        'phase', 'resolution',
        'reference_slots', jsonb_build_array(
          jsonb_build_object(
            'slot', 'subject',
            'ordinal', 0,
            'brandAssetVersionId', 'a5100000-0000-4000-8000-000000000301'
          )
        ),
        'avoid_reference_version_ids',
          jsonb_build_array('a5100000-0000-4000-8000-000000000301'),
        'negative_rules', jsonb_build_array(
          jsonb_build_object('code', 'wrong_style', 'description', 'Do not repeat this style.')
        ),
        'resolver_version', 1,
        'resolution_outcome', 'resolved'
      )
    )
  $$,
  '22023', 'campaign_generation_reference_role_conflict',
  'one reference version cannot be both a positive source and an avoid example'
);

select extensions.throws_ok(
  $$
    select public.pin_campaign_generation_run_reference_context(
      'a5100000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', 'a5100000-0000-4000-8000-000000000101',
        'run_id', (select value ->> 'run_id' from asset_library_state where key = 'run'),
        'claim_token', (select value ->> 'claim_token' from asset_library_state where key = 'claim'),
        'phase', 'blueprint',
        'blueprint', jsonb_build_object('composition', 'Too early'),
        'plan_model_id', 'gemini-plan-test'
      )
    )
  $$,
  '22023', 'campaign_generation_resolution_not_pinned',
  'the blueprint cannot be pinned before the resolution receipt'
);

insert into asset_library_state (key, value)
select 'resolution_pin', public.pin_campaign_generation_run_reference_context(
  'a5100000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', 'a5100000-0000-4000-8000-000000000101',
    'run_id', (select value ->> 'run_id' from asset_library_state where key = 'run'),
    'claim_token', (select value ->> 'claim_token' from asset_library_state where key = 'claim'),
    'phase', 'resolution',
    'reference_slots', jsonb_build_array(
      jsonb_build_object(
        'slot', 'subject',
        'ordinal', 0,
        'brandAssetVersionId', 'a5100000-0000-4000-8000-000000000301'
      )
    ),
    'avoid_reference_version_ids',
      jsonb_build_array('a5100000-0000-4000-8000-000000000303'),
    'negative_rules', jsonb_build_array(
      jsonb_build_object('code', 'people_shown', 'description', 'Do not show people.')
    ),
    'resolver_version', 1,
    'resolution_outcome', 'resolved'
  )
);

select extensions.is(
  (select value ->> 'replayed' from asset_library_state where key = 'resolution_pin'),
  'false'::text,
  'the first resolution receipt is a new pin'
);

insert into asset_library_state (key, value)
select 'resolution_replay', public.pin_campaign_generation_run_reference_context(
  'a5100000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', 'a5100000-0000-4000-8000-000000000101',
    'run_id', (select value ->> 'run_id' from asset_library_state where key = 'run'),
    'claim_token', (select value ->> 'claim_token' from asset_library_state where key = 'claim'),
    'phase', 'resolution',
    'reference_slots', jsonb_build_array(
      jsonb_build_object(
        'slot', 'subject',
        'ordinal', 0,
        'brandAssetVersionId', 'a5100000-0000-4000-8000-000000000301'
      )
    ),
    'avoid_reference_version_ids',
      jsonb_build_array('a5100000-0000-4000-8000-000000000303'),
    'negative_rules', jsonb_build_array(
      jsonb_build_object('code', 'people_shown', 'description', 'Do not show people.')
    ),
    'resolver_version', 1,
    'resolution_outcome', 'resolved'
  )
);

select extensions.ok(
  (
    select replay.value ->> 'replayed' = 'true'
      and jsonb_array_length(run.reference_slots) = 1
      and run.avoid_reference_version_ids =
        array['a5100000-0000-4000-8000-000000000303'::uuid]
      and jsonb_array_length(run.negative_rules) = 1
      and run.resolver_version = 1
      and run.resolution_outcome = 'resolved'
      and run.blueprint is null
      and run.plan_model_id is null
    from public.campaign_generation_runs run
    cross join asset_library_state replay
    where run.id = (
      select (value ->> 'run_id')::uuid from asset_library_state where key = 'run'
    ) and replay.key = 'resolution_replay'
  ),
  'an exact resolution replay is a no-op and stage two remains empty'
);

select extensions.throws_ok(
  $$
    select public.pin_campaign_generation_run_reference_context(
      'a5100000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', 'a5100000-0000-4000-8000-000000000101',
        'run_id', (select value ->> 'run_id' from asset_library_state where key = 'run'),
        'claim_token', (select value ->> 'claim_token' from asset_library_state where key = 'claim'),
        'phase', 'resolution',
        'reference_slots', '[]'::jsonb,
        'avoid_reference_version_ids', '[]'::jsonb,
        'negative_rules', '[]'::jsonb,
        'resolver_version', 1,
        'resolution_outcome', 'synthesis_permitted'
      )
    )
  $$,
  '22023', 'campaign_generation_resolution_conflict',
  'a conflicting resolution replay is refused'
);

insert into asset_library_state (key, value)
select 'blueprint_pin', public.pin_campaign_generation_run_reference_context(
  'a5100000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', 'a5100000-0000-4000-8000-000000000101',
    'run_id', (select value ->> 'run_id' from asset_library_state where key = 'run'),
    'claim_token', (select value ->> 'claim_token' from asset_library_state where key = 'claim'),
    'phase', 'blueprint',
    'blueprint', jsonb_build_object(
      'composition', 'Centered clay pot with generous negative space',
      'lighting', 'Warm side light'
    ),
    'plan_model_id', 'gemini-plan-test'
  )
);

select extensions.is(
  (select value ->> 'replayed' from asset_library_state where key = 'blueprint_pin'),
  'false'::text,
  'the first blueprint receipt is a new pin'
);

insert into asset_library_state (key, value)
select 'blueprint_replay', public.pin_campaign_generation_run_reference_context(
  'a5100000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', 'a5100000-0000-4000-8000-000000000101',
    'run_id', (select value ->> 'run_id' from asset_library_state where key = 'run'),
    'claim_token', (select value ->> 'claim_token' from asset_library_state where key = 'claim'),
    'phase', 'blueprint',
    'blueprint', jsonb_build_object(
      'composition', 'Centered clay pot with generous negative space',
      'lighting', 'Warm side light'
    ),
    'plan_model_id', 'gemini-plan-test'
  )
);

select extensions.ok(
  (
    select replay.value ->> 'replayed' = 'true'
      and run.blueprint = jsonb_build_object(
        'composition', 'Centered clay pot with generous negative space',
        'lighting', 'Warm side light'
      )
      and run.plan_model_id = 'gemini-plan-test'
    from public.campaign_generation_runs run
    cross join asset_library_state replay
    where run.id = (
      select (value ->> 'run_id')::uuid from asset_library_state where key = 'run'
    ) and replay.key = 'blueprint_replay'
  ),
  'an exact blueprint replay is a no-op and preserves the first receipt'
);

select extensions.throws_ok(
  $$
    select public.pin_campaign_generation_run_reference_context(
      'a5100000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', 'a5100000-0000-4000-8000-000000000101',
        'run_id', (select value ->> 'run_id' from asset_library_state where key = 'run'),
        'claim_token', (select value ->> 'claim_token' from asset_library_state where key = 'claim'),
        'phase', 'blueprint',
        'blueprint', jsonb_build_object('composition', 'Conflicting composition'),
        'plan_model_id', 'gemini-plan-test'
      )
    )
  $$,
  '22023', 'campaign_generation_blueprint_conflict',
  'a conflicting blueprint replay is refused'
);

insert into asset_library_state (key, value)
select 'context', public.load_campaign_generation_context(
  'a5100000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'run_id', (select value ->> 'run_id' from asset_library_state where key = 'run'),
    'claim_token', (select value ->> 'claim_token' from asset_library_state where key = 'claim')
  )
);

select extensions.ok(
  (
    select jsonb_array_length(value -> 'reference_slots') = 1
      and jsonb_array_length(value -> 'negative_rules') = 1
      and value ->> 'resolver_version' = '1'
      and value ->> 'resolution_outcome' = 'resolved'
      and value ->> 'subject_profile_id' = (
        select subject.value ->> 'subject_profile_id'
        from asset_library_state subject where subject.key = 'subject'
      )
      and value ->> 'subject_description' =
        'Kingfish steaks in brick-red tamarind coconut gravy, served in a red clay pot.'
      and value -> 'avoid_reference_version_ids' =
        jsonb_build_array('a5100000-0000-4000-8000-000000000303')
      and value -> 'blueprint' = jsonb_build_object(
        'composition', 'Centered clay pot with generous negative space',
        'lighting', 'Warm side light'
      )
      and value ->> 'plan_model_id' = 'gemini-plan-test'
      and value ->> 'creative_direction' = 'Keep the treatment warm and restrained.'
    from asset_library_state
    where key = 'context'
  ),
  'the claimed worker context returns all ten immutable declared fields'
);

reset role;

select extensions.throws_ok(
  $$
    update public.campaign_source_snapshots
    set facts = jsonb_build_object('rewritten', true)
    where id = (
      select (value ->> 'source_snapshot_id')::uuid
      from asset_library_state where key = 'campaign'
    )
  $$,
  '23514', 'campaign_bundle_version_is_immutable',
  'the source snapshot immutability trigger still refuses an update'
);

select * from extensions.finish();
rollback;
