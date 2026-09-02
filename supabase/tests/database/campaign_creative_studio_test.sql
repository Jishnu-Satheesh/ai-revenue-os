begin;

create extension if not exists pgtap with schema extensions;

select extensions.no_plan();

-- ---------------------------------------------------------------------------
-- Structure, grants, and forced RLS
-- ---------------------------------------------------------------------------

select extensions.has_table(
  'public', 'campaign_poster_templates', 'the poster template registry exists'
);
select extensions.has_table(
  'public', 'campaign_poster_renders', 'the append-only render ledger exists'
);
select extensions.has_table(
  'public', 'campaign_plate_edits', 'the append-only plate edit lineage exists'
);

-- The absences are load-bearing, so they are asserted rather than assumed.
--
-- A render carries no truth class of its own: that describes the plate, and
-- `synthetic_composite` means "drawn from the client's photograph", not "layers
-- composited". A column of that name here would invite somebody to fill it in
-- and mislabel a truth claim shown to a client.
select extensions.hasnt_column(
  'public', 'campaign_poster_renders', 'truth_class',
  'a render carries no truth class of its own; the plate holds it'
);
select extensions.hasnt_column(
  'public', 'campaign_poster_renders', 'output_asset_id',
  'a poster is not a campaign asset row, so it holds its own output'
);
-- An edit does not run the art-direction stage: a blueprint directs a whole
-- image and would fight the mask it is supposed to respect.
select extensions.hasnt_column(
  'public', 'campaign_plate_edits', 'blueprint',
  'an edit does not run the blueprint stage'
);
select extensions.hasnt_column(
  'public', 'campaign_plate_edits', 'plan_model_id',
  'an edit has no plan model because it has no plan stage'
);

select extensions.has_column(
  'public', 'campaign_poster_renders', 'plate_generation_run_id',
  'a render records the run that produced its plate, when one did'
);
select extensions.has_column(
  'public', 'campaign_poster_renders', 'render_digest',
  'a render pins the digest of its inputs'
);
select extensions.has_column(
  'public', 'campaign_poster_renders', 'output_content_hash',
  'a render pins the digest of its produced bytes separately'
);
select extensions.has_column(
  'public', 'campaign_poster_renders', 'refusal_code',
  'a refused render is recorded rather than discarded'
);
select extensions.has_column(
  'public', 'campaign_plate_edits', 'idempotency_key',
  'an edit is fenced against a duplicate write'
);
select extensions.has_column(
  'public', 'campaign_plate_edits', 'cost_minor',
  'an edit meters its own model spend'
);

select extensions.ok(
  (
    select bool_and(relrowsecurity and relforcerowsecurity)
    from pg_catalog.pg_class
    where relname in (
      'campaign_poster_templates', 'campaign_poster_renders', 'campaign_plate_edits'
    )
  ),
  'row level security is enabled and forced on all three tables'
);

select extensions.ok(
  not exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in (
        'campaign_poster_templates', 'campaign_poster_renders', 'campaign_plate_edits'
      )
      and grantee in ('anon', 'authenticated')
      and privilege_type <> 'SELECT'
  ),
  'no browser role holds a write grant on any studio table'
);

select extensions.ok(
  not exists (
    select 1
    from pg_catalog.pg_proc proc
    join pg_catalog.pg_namespace space on space.oid = proc.pronamespace
    where space.nspname = 'public'
      and proc.proname in (
        'record_campaign_poster_render', 'record_campaign_plate_edit'
      )
      and (
        not proc.prosecdef
        or coalesce(array_to_string(proc.proconfig, ','), '') not like '%search_path=%'
      )
  ),
  'both writers are security definer with an explicit search path'
);

select extensions.ok(
  not exists (
    select 1
    from information_schema.role_routine_grants
    where routine_schema = 'public'
      and routine_name in ('record_campaign_poster_render', 'record_campaign_plate_edit')
      and grantee in ('anon', 'authenticated', 'PUBLIC')
  ),
  'no browser role may execute either worker writer'
);

select extensions.ok(
  exists (
    select 1 from storage.buckets
    where id = 'campaign-masks' and public = false
  ),
  'the mask bucket exists and is private'
);

-- ---------------------------------------------------------------------------
-- Fixtures: two tenants, so isolation is proved against a real foreign row
-- ---------------------------------------------------------------------------

insert into auth.users (id)
values
  ('c5200000-0000-4000-8000-000000000001'::uuid),
  ('c5200000-0000-4000-8000-000000000002'::uuid),
  ('c5200000-0000-4000-8000-000000000003'::uuid);

insert into public.accounts (id, name, slug, created_by)
values (
  'c52c0000-0000-4000-8000-000000000001'::uuid,
  'Creative studio fixture agency',
  'creative-studio-fixture-agency',
  'c5200000-0000-4000-8000-000000000001'::uuid
);

insert into public.organizations (
  id, name, slug, industry, country_code, base_currency, default_timezone, created_by, account_id
)
values
  (
    'c5200000-0000-4000-8000-000000000101'::uuid,
    'Studio tenant A', 'studio-tenant-a', 'testing', 'AE', 'AED', 'Asia/Dubai',
    'c5200000-0000-4000-8000-000000000001'::uuid,
    'c52c0000-0000-4000-8000-000000000001'::uuid
  ),
  (
    'c5200000-0000-4000-8000-000000000102'::uuid,
    'Studio tenant B', 'studio-tenant-b', 'testing', 'AE', 'AED', 'Asia/Dubai',
    'c5200000-0000-4000-8000-000000000002'::uuid,
    'c52c0000-0000-4000-8000-000000000001'::uuid
  );

insert into public.organization_memberships (organization_id, user_id, role)
values
  (
    'c5200000-0000-4000-8000-000000000101'::uuid,
    'c5200000-0000-4000-8000-000000000001'::uuid,
    'operator'
  ),
  (
    'c5200000-0000-4000-8000-000000000101'::uuid,
    'c5200000-0000-4000-8000-000000000003'::uuid,
    'viewer'
  ),
  (
    'c5200000-0000-4000-8000-000000000102'::uuid,
    'c5200000-0000-4000-8000-000000000002'::uuid,
    'operator'
  );

insert into public.campaign_briefs (id, organization_id, objective, audience, created_by)
values
  (
    'c5200000-0000-4000-8000-000000000401'::uuid,
    'c5200000-0000-4000-8000-000000000101'::uuid,
    'Sell the fish curry', 'Malayali families in Dubai',
    'c5200000-0000-4000-8000-000000000001'::uuid
  ),
  (
    'c5200000-0000-4000-8000-000000000402'::uuid,
    'c5200000-0000-4000-8000-000000000102'::uuid,
    'Foreign objective', 'Foreign audience',
    'c5200000-0000-4000-8000-000000000002'::uuid
  );

insert into public.campaigns (id, organization_id, title, source_kind, brief_id, created_by)
values
  (
    'c5200000-0000-4000-8000-000000000501'::uuid,
    'c5200000-0000-4000-8000-000000000101'::uuid,
    'Local campaign', 'manual_brief',
    'c5200000-0000-4000-8000-000000000401'::uuid,
    'c5200000-0000-4000-8000-000000000001'::uuid
  ),
  (
    'c5200000-0000-4000-8000-000000000502'::uuid,
    'c5200000-0000-4000-8000-000000000102'::uuid,
    'Foreign campaign', 'manual_brief',
    'c5200000-0000-4000-8000-000000000402'::uuid,
    'c5200000-0000-4000-8000-000000000002'::uuid
  );

insert into public.campaign_source_snapshots (
  id, organization_id, campaign_id, facts, assertions
)
values
  (
    'c5200000-0000-4000-8000-000000000601'::uuid,
    'c5200000-0000-4000-8000-000000000101'::uuid,
    'c5200000-0000-4000-8000-000000000501'::uuid,
    '{}'::jsonb, '[]'::jsonb
  ),
  (
    'c5200000-0000-4000-8000-000000000602'::uuid,
    'c5200000-0000-4000-8000-000000000102'::uuid,
    'c5200000-0000-4000-8000-000000000502'::uuid,
    '{}'::jsonb, '[]'::jsonb
  );

insert into public.campaign_bundle_versions (
  id, organization_id, campaign_id, version, source_snapshot_id, parent_version_id, manifest,
  digest, generation_profile, execution_mode
)
values
  (
    'c5200000-0000-4000-8000-000000000701'::uuid,
    'c5200000-0000-4000-8000-000000000101'::uuid,
    'c5200000-0000-4000-8000-000000000501'::uuid,
    1,
    'c5200000-0000-4000-8000-000000000601'::uuid,
    null,
    jsonb_build_object(
      'schemaVersion', 2,
      'campaignId', 'c5200000-0000-4000-8000-000000000501',
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
    pg_catalog.repeat('1', 64), 'brand_guided', 'best_effort'
  ),
  -- A second version in the same tenant, so "the plate belongs to this version"
  -- is proved against a real sibling rather than an invented identifier.
  (
    'c5200000-0000-4000-8000-000000000703'::uuid,
    'c5200000-0000-4000-8000-000000000101'::uuid,
    'c5200000-0000-4000-8000-000000000501'::uuid,
    2,
    'c5200000-0000-4000-8000-000000000601'::uuid,
    'c5200000-0000-4000-8000-000000000701'::uuid,
    jsonb_build_object(
      'schemaVersion', 2,
      'campaignId', 'c5200000-0000-4000-8000-000000000501',
      'version', 2,
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
    pg_catalog.repeat('3', 64), 'brand_guided', 'best_effort'
  ),
  (
    'c5200000-0000-4000-8000-000000000702'::uuid,
    'c5200000-0000-4000-8000-000000000102'::uuid,
    'c5200000-0000-4000-8000-000000000502'::uuid,
    1,
    'c5200000-0000-4000-8000-000000000602'::uuid,
    null,
    jsonb_build_object(
      'schemaVersion', 2,
      'campaignId', 'c5200000-0000-4000-8000-000000000502',
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
    pg_catalog.repeat('2', 64), 'brand_guided', 'best_effort'
  );

insert into public.campaign_assets (
  id, organization_id, bundle_version_id, asset_key, storage_path, content_hash,
  mime_type, width_px, height_px, truth_class, provenance, alt_text
)
values
  (
    'c5200000-0000-4000-8000-000000000801'::uuid,
    'c5200000-0000-4000-8000-000000000101'::uuid,
    'c5200000-0000-4000-8000-000000000701'::uuid,
    'c5200000-0000-4000-8000-000000000901'::uuid,
    'a/plate.png', pg_catalog.repeat('a', 64),
    'image/png', 1080, 1080, 'authentic_source', '{}'::jsonb, 'The client photograph'
  ),
  (
    'c5200000-0000-4000-8000-000000000803'::uuid,
    'c5200000-0000-4000-8000-000000000101'::uuid,
    'c5200000-0000-4000-8000-000000000701'::uuid,
    'c5200000-0000-4000-8000-000000000903'::uuid,
    'a/edited-plate.png', pg_catalog.repeat('c', 64),
    'image/png', 1080, 1080, 'authentic_source', '{}'::jsonb, 'The edited plate'
  ),
  (
    'c5200000-0000-4000-8000-000000000804'::uuid,
    'c5200000-0000-4000-8000-000000000101'::uuid,
    'c5200000-0000-4000-8000-000000000703'::uuid,
    'c5200000-0000-4000-8000-000000000904'::uuid,
    'a/other-version-plate.png', pg_catalog.repeat('d', 64),
    'image/png', 1080, 1080, 'synthetic_generated', '{}'::jsonb, 'A later version plate'
  ),
  (
    'c5200000-0000-4000-8000-000000000802'::uuid,
    'c5200000-0000-4000-8000-000000000102'::uuid,
    'c5200000-0000-4000-8000-000000000702'::uuid,
    'c5200000-0000-4000-8000-000000000902'::uuid,
    'b/plate.png', pg_catalog.repeat('b', 64),
    'image/png', 1080, 1080, 'synthetic_generated', '{}'::jsonb, 'Foreign generated asset'
  );

insert into public.campaign_generation_runs (
  id, organization_id, campaign_id, source_snapshot_id, kind, idempotency_key,
  request_digest, correlation_id
)
values (
  'c5200000-0000-4000-8000-000000000a01'::uuid,
  'c5200000-0000-4000-8000-000000000101'::uuid,
  'c5200000-0000-4000-8000-000000000501'::uuid,
  'c5200000-0000-4000-8000-000000000601'::uuid,
  'generate', 'studio-fixture-run-0001', pg_catalog.repeat('a', 64),
  'c5200000-0000-4000-8000-000000000b01'::uuid
);

-- ---------------------------------------------------------------------------
-- Template registry: the layout contract
-- ---------------------------------------------------------------------------

insert into public.campaign_poster_templates (
  key, version, placement, canvas_width_px, canvas_height_px, layout, owner_scope
)
values (
  'studio_feed_test', 1, 'feed_image', 1080, 1080,
  jsonb_build_object(
    'safeArea', jsonb_build_object('top', 64, 'right', 64, 'bottom', 64, 'left', 64),
    'textBoxes', jsonb_build_array(
      jsonb_build_object('slot', 'caption'),
      jsonb_build_object('slot', 'body'),
      jsonb_build_object('slot', 'footer')
    )
  ),
  'core'
);

select extensions.throws_ok(
  $$
    insert into public.campaign_poster_templates (
      key, version, placement, canvas_width_px, canvas_height_px, layout, owner_scope
    ) values (
      'studio_dup_slot', 1, 'feed_image', 1080, 1080,
      '{"safeArea":{},"textBoxes":[{"slot":"caption"},{"slot":"caption"}]}'::jsonb, 'core'
    )
  $$,
  '23514', null,
  'two boxes bound to one slot are refused, so no value renders twice'
);

select extensions.throws_ok(
  $$
    insert into public.campaign_poster_templates (
      key, version, placement, canvas_width_px, canvas_height_px, layout, owner_scope
    ) values (
      'studio_bad_slot', 1, 'feed_image', 1080, 1080,
      '{"safeArea":{},"textBoxes":[{"slot":"headline"}]}'::jsonb, 'core'
    )
  $$,
  '23514', null,
  'a slot outside the named vocabulary is refused'
);

select extensions.throws_ok(
  $$
    insert into public.campaign_poster_templates (
      key, version, placement, canvas_width_px, canvas_height_px, layout, owner_scope
    ) values (
      'studio_ownerless', 1, 'feed_image', 1080, 1080,
      '{"safeArea":{},"textBoxes":[{"slot":"caption"}]}'::jsonb, 'organization'
    )
  $$,
  '23514', null,
  'an organization-scoped template with no owner is refused rather than shared with every tenant'
);

select extensions.throws_ok(
  $$
    insert into public.campaign_poster_templates (
      key, version, placement, canvas_width_px, canvas_height_px, layout, owner_scope
    ) values (
      'studio_feed_test', 1, 'image_story', 1080, 1920,
      '{"safeArea":{},"textBoxes":[{"slot":"caption"}]}'::jsonb, 'core'
    )
  $$,
  '23505', null,
  'a template version is unique, so a version cannot be redefined in place'
);

-- ---------------------------------------------------------------------------
-- The render writer
-- ---------------------------------------------------------------------------

create temporary table studio_state (key text primary key, value jsonb not null);
grant select, insert, update on studio_state to authenticated, service_role;

select extensions.throws_ok(
  $$
    set local role authenticated;
    select public.record_campaign_poster_render(
      'c5200000-0000-4000-8000-000000000101'::uuid, '{}'::jsonb
    )
  $$,
  '42501', null,
  'a signed-in member cannot execute the render writer at all'
);

reset role;

select extensions.throws_ok(
  $$
    set local role service_role;
    select public.record_campaign_poster_render(
      'c5200000-0000-4000-8000-000000000101'::uuid,
      '{"organization_id":"c5200000-0000-4000-8000-000000000102"}'::jsonb
    )
  $$,
  '42501', 'campaign_poster_render_organization_mismatch',
  'an organization mismatch between argument and payload is refused'
);

reset role;

-- The plate must belong to the version being rendered. Composing an approved
-- version's poster over a different version's plate would produce a poster
-- nobody approved, assembled from parts that were each approved once.
select extensions.throws_ok(
  $$
    set local role service_role;
    select public.record_campaign_poster_render(
      'c5200000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', 'c5200000-0000-4000-8000-000000000101',
        'campaign_id', 'c5200000-0000-4000-8000-000000000501',
        'bundle_version_id', 'c5200000-0000-4000-8000-000000000701',
        'plate_asset_id', 'c5200000-0000-4000-8000-000000000804',
        'template_key', 'studio_feed_test', 'template_version', 1,
        'script', 'Latn', 'state', 'refused', 'refusal_code', 'text_does_not_fit',
        'render_digest', pg_catalog.repeat('a', 64)
      )
    )
  $$,
  '23503', 'campaign_poster_render_plate_not_found',
  'a plate from another version of the same campaign is refused'
);

reset role;

select extensions.throws_ok(
  $$
    set local role service_role;
    select public.record_campaign_poster_render(
      'c5200000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', 'c5200000-0000-4000-8000-000000000101',
        'campaign_id', 'c5200000-0000-4000-8000-000000000501',
        'bundle_version_id', 'c5200000-0000-4000-8000-000000000701',
        'plate_asset_id', 'c5200000-0000-4000-8000-000000000802',
        'template_key', 'studio_feed_test', 'template_version', 1,
        'script', 'Latn', 'state', 'refused', 'refusal_code', 'text_does_not_fit',
        'render_digest', pg_catalog.repeat('a', 64)
      )
    )
  $$,
  '23503', 'campaign_poster_render_plate_not_found',
  'another tenant''s plate is refused before any row exists'
);

reset role;

set local role service_role;

-- A refusal is a row. Spec 020 section 12 tracks refusal rates by script, and a
-- Malayalam rate materially above Latin means the font coverage is wrong rather
-- than the operator -- which cannot be seen if refusals are discarded.
insert into studio_state (key, value)
select 'refused', public.record_campaign_poster_render(
  'c5200000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', 'c5200000-0000-4000-8000-000000000101',
    'campaign_id', 'c5200000-0000-4000-8000-000000000501',
    'bundle_version_id', 'c5200000-0000-4000-8000-000000000701',
    'plate_asset_id', 'c5200000-0000-4000-8000-000000000801',
    'plate_generation_run_id', 'c5200000-0000-4000-8000-000000000a01',
    'template_key', 'studio_feed_test', 'template_version', 1,
    'script', 'Mlym',
    'text_values', jsonb_build_object('caption', 'കേരള മീൻ കറി'),
    'font_manifest', jsonb_build_object('digest', pg_catalog.repeat('f', 64)),
    'state', 'refused',
    'refusal_code', 'glyph_not_covered',
    'refusal_detail', jsonb_build_object('codepoint', 'U+0D7B'),
    'render_digest', pg_catalog.repeat('a', 64)
  )
);

insert into studio_state (key, value)
select 'rendered', public.record_campaign_poster_render(
  'c5200000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', 'c5200000-0000-4000-8000-000000000101',
    'campaign_id', 'c5200000-0000-4000-8000-000000000501',
    'bundle_version_id', 'c5200000-0000-4000-8000-000000000701',
    'plate_asset_id', 'c5200000-0000-4000-8000-000000000801',
    'plate_generation_run_id', 'c5200000-0000-4000-8000-000000000a01',
    'template_key', 'studio_feed_test', 'template_version', 1,
    'script', 'Latn',
    'text_values', jsonb_build_object('caption', 'Kerala Fish Curry'),
    'font_manifest', jsonb_build_object('digest', pg_catalog.repeat('f', 64)),
    'state', 'rendered',
    'output_storage_path',
      'c5200000-0000-4000-8000-000000000101/c5200000-0000-4000-8000-000000000501/poster.png',
    'output_content_hash', pg_catalog.repeat('b', 64),
    'output_mime_type', 'image/png',
    'output_width_px', 1080,
    'output_height_px', 1080,
    'render_digest', pg_catalog.repeat('c', 64)
  )
);

-- An identical re-render is the same render, not a second one.
insert into studio_state (key, value)
select 'replayed', public.record_campaign_poster_render(
  'c5200000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', 'c5200000-0000-4000-8000-000000000101',
    'campaign_id', 'c5200000-0000-4000-8000-000000000501',
    'bundle_version_id', 'c5200000-0000-4000-8000-000000000701',
    'plate_asset_id', 'c5200000-0000-4000-8000-000000000801',
    'template_key', 'studio_feed_test', 'template_version', 1,
    'script', 'Latn',
    'state', 'rendered',
    'output_storage_path',
      'c5200000-0000-4000-8000-000000000101/c5200000-0000-4000-8000-000000000501/poster.png',
    'output_content_hash', pg_catalog.repeat('b', 64),
    'output_mime_type', 'image/png',
    'output_width_px', 1080,
    'output_height_px', 1080,
    'render_digest', pg_catalog.repeat('c', 64)
  )
);

reset role;

select extensions.is(
  (select value ->> 'state' from studio_state where key = 'refused'),
  'refused',
  'a refused render is recorded with its refusal'
);

select extensions.is(
  (select value ->> 'replayed' from studio_state where key = 'replayed'),
  'true',
  'an identical re-render replays rather than duplicating'
);

select extensions.is(
  (select value ->> 'render_id' from studio_state where key = 'replayed'),
  (select value ->> 'render_id' from studio_state where key = 'rendered'),
  'the replay returns the original render rather than a new one'
);

select extensions.is(
  (
    select count(*)::bigint
    from public.campaign_poster_renders
    where organization_id = 'c5200000-0000-4000-8000-000000000101'::uuid
  ),
  2::bigint,
  'the replay wrote no second row'
);

select extensions.is(
  (
    select refusal_code
    from public.campaign_poster_renders
    where organization_id = 'c5200000-0000-4000-8000-000000000101'::uuid
      and script = 'Mlym'
  ),
  'glyph_not_covered'::text,
  'the refusal code is queryable by script, which is what the alert rests on'
);

-- The Malayalam text values survive the round trip byte for byte. Text that
-- changed on the way into the database would publish as something other than
-- what was approved.
select extensions.is(
  (
    select text_values ->> 'caption'
    from public.campaign_poster_renders
    where organization_id = 'c5200000-0000-4000-8000-000000000101'::uuid
      and script = 'Mlym'
  ),
  'കേരള മീൻ കറി'::text,
  'Malayalam text values round-trip unchanged'
);

select extensions.is(
  (
    select plate_generation_run_id
    from public.campaign_poster_renders
    where organization_id = 'c5200000-0000-4000-8000-000000000101'::uuid
      and script = 'Latn'
  ),
  'c5200000-0000-4000-8000-000000000a01'::uuid,
  'the render reaches its plate''s run in one hop'
);

-- Same inputs, different bytes: reproducibility has been lost, and that is a
-- refusal rather than a row quietly replaced.
select extensions.throws_ok(
  $$
    set local role service_role;
    select public.record_campaign_poster_render(
      'c5200000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', 'c5200000-0000-4000-8000-000000000101',
        'campaign_id', 'c5200000-0000-4000-8000-000000000501',
        'bundle_version_id', 'c5200000-0000-4000-8000-000000000701',
        'plate_asset_id', 'c5200000-0000-4000-8000-000000000801',
        'template_key', 'studio_feed_test', 'template_version', 1,
        'script', 'Latn', 'state', 'rendered',
        'output_storage_path', 'c5200000-0000-4000-8000-000000000101/x/poster.png',
        'output_content_hash', pg_catalog.repeat('9', 64),
        'output_mime_type', 'image/png',
        'output_width_px', 1080, 'output_height_px', 1080,
        'render_digest', pg_catalog.repeat('c', 64)
      )
    )
  $$,
  '22023', 'campaign_poster_render_conflict',
  'one render digest yielding different bytes is refused, not overwritten'
);

reset role;

select extensions.throws_ok(
  $$
    insert into public.campaign_poster_renders (
      organization_id, campaign_id, bundle_version_id, plate_asset_id,
      template_key, template_version, script, text_values, font_manifest,
      render_digest, state
    ) values (
      'c5200000-0000-4000-8000-000000000101'::uuid,
      'c5200000-0000-4000-8000-000000000501'::uuid,
      'c5200000-0000-4000-8000-000000000701'::uuid,
      'c5200000-0000-4000-8000-000000000801'::uuid,
      'studio_feed_test', 1, 'Latn', '{}'::jsonb, '{}'::jsonb,
      pg_catalog.repeat('7', 64), 'rendered'
    )
  $$,
  '23514', null,
  'a rendered row with no output bytes is refused'
);

select extensions.throws_ok(
  $$
    insert into public.campaign_poster_renders (
      organization_id, campaign_id, bundle_version_id, plate_asset_id,
      template_key, template_version, script, text_values, font_manifest,
      render_digest, state
    ) values (
      'c5200000-0000-4000-8000-000000000101'::uuid,
      'c5200000-0000-4000-8000-000000000501'::uuid,
      'c5200000-0000-4000-8000-000000000701'::uuid,
      'c5200000-0000-4000-8000-000000000801'::uuid,
      'studio_feed_test', 1, 'Latn', '{}'::jsonb, '{}'::jsonb,
      pg_catalog.repeat('8', 64), 'refused'
    )
  $$,
  '23514', null,
  'a refused row with no refusal code is refused'
);

select extensions.throws_ok(
  $$
    update public.campaign_poster_renders
    set script = 'Arab'
    where organization_id = 'c5200000-0000-4000-8000-000000000101'::uuid
  $$,
  '23514', 'campaign_poster_renders is append-only',
  'the render ledger refuses an update'
);

select extensions.throws_ok(
  $$
    delete from public.campaign_poster_renders
    where organization_id = 'c5200000-0000-4000-8000-000000000101'::uuid
  $$,
  '23514', 'campaign_poster_renders is append-only',
  'the render ledger refuses a delete'
);

-- ---------------------------------------------------------------------------
-- The edit writer
-- ---------------------------------------------------------------------------

select extensions.throws_ok(
  $$
    set local role authenticated;
    select public.record_campaign_plate_edit(
      'c5200000-0000-4000-8000-000000000101'::uuid, '{}'::jsonb
    )
  $$,
  '42501', null,
  'a signed-in member cannot execute the edit writer at all'
);

reset role;

set local role service_role;

insert into studio_state (key, value)
select 'edit', public.record_campaign_plate_edit(
  'c5200000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', 'c5200000-0000-4000-8000-000000000101',
    'campaign_id', 'c5200000-0000-4000-8000-000000000501',
    'parent_plate_asset_id', 'c5200000-0000-4000-8000-000000000801',
    'child_plate_asset_id', 'c5200000-0000-4000-8000-000000000803',
    'mask_storage_path',
      'c5200000-0000-4000-8000-000000000101/c5200000-0000-4000-8000-000000000501/edit/mask.png',
    'mask_content_hash', pg_catalog.repeat('e', 64),
    'union_coverage_ratio', 0.084,
    'annotations', jsonb_build_array(
      jsonb_build_object(
        'ordinal', 1,
        'bounds', jsonb_build_object('x', 10, 'y', 10, 'width', 50, 'height', 50),
        'instruction', 'remove the fork'
      ),
      jsonb_build_object(
        'ordinal', 2,
        'bounds', jsonb_build_object('x', 80, 'y', 80, 'width', 40, 'height', 40),
        'instruction', 'warm the light'
      )
    ),
    'negative_rules', jsonb_build_array('no faces'),
    'model_id', 'fixture-image-model',
    'cost_minor', 1200,
    'idempotency_key', 'studio-fixture-edit-0001',
    'edited_by', 'c5200000-0000-4000-8000-000000000001'
  )
);

insert into studio_state (key, value)
select 'edit_replay', public.record_campaign_plate_edit(
  'c5200000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', 'c5200000-0000-4000-8000-000000000101',
    'campaign_id', 'c5200000-0000-4000-8000-000000000501',
    'parent_plate_asset_id', 'c5200000-0000-4000-8000-000000000801',
    'child_plate_asset_id', 'c5200000-0000-4000-8000-000000000803',
    'mask_storage_path',
      'c5200000-0000-4000-8000-000000000101/c5200000-0000-4000-8000-000000000501/edit/mask.png',
    'mask_content_hash', pg_catalog.repeat('e', 64),
    'union_coverage_ratio', 0.084,
    'annotations', jsonb_build_array(
      jsonb_build_object('ordinal', 1, 'bounds', '{}'::jsonb, 'instruction', 'remove the fork')
    ),
    'model_id', 'fixture-image-model',
    'idempotency_key', 'studio-fixture-edit-0001',
    'edited_by', 'c5200000-0000-4000-8000-000000000001'
  )
);

reset role;

select extensions.is(
  (select value ->> 'replayed' from studio_state where key = 'edit_replay'),
  'true',
  'a retried edit replays rather than editing twice'
);

select extensions.is(
  (
    select count(*)::bigint
    from public.campaign_plate_edits
    where organization_id = 'c5200000-0000-4000-8000-000000000101'::uuid
  ),
  1::bigint,
  'the retried edit wrote no second row'
);

select extensions.is(
  (
    select cost_minor
    from public.campaign_plate_edits
    where organization_id = 'c5200000-0000-4000-8000-000000000101'::uuid
  ),
  1200::bigint,
  'the edit meters its own spend, so an edit is not a free operation on the record'
);

-- A mask is fetched by the worker, so its prefix is checked before the row
-- exists rather than after the bytes are read.
select extensions.throws_ok(
  $$
    set local role service_role;
    select public.record_campaign_plate_edit(
      'c5200000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', 'c5200000-0000-4000-8000-000000000101',
        'campaign_id', 'c5200000-0000-4000-8000-000000000501',
        'parent_plate_asset_id', 'c5200000-0000-4000-8000-000000000801',
        'child_plate_asset_id', 'c5200000-0000-4000-8000-000000000803',
        'mask_storage_path', 'c5200000-0000-4000-8000-000000000102/x/mask.png',
        'mask_content_hash', pg_catalog.repeat('e', 64),
        'union_coverage_ratio', 0.084,
        'annotations', jsonb_build_array(
          jsonb_build_object('ordinal', 1, 'bounds', '{}'::jsonb, 'instruction', 'x')
        ),
        'model_id', 'fixture-image-model',
        'idempotency_key', 'studio-fixture-edit-0002',
        'edited_by', 'c5200000-0000-4000-8000-000000000001'
      )
    )
  $$,
  '42501', 'campaign_plate_edit_mask_path_foreign',
  'a mask under another tenant''s prefix is refused before any byte is fetched'
);

reset role;

select extensions.throws_ok(
  $$
    set local role service_role;
    select public.record_campaign_plate_edit(
      'c5200000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', 'c5200000-0000-4000-8000-000000000101',
        'campaign_id', 'c5200000-0000-4000-8000-000000000501',
        'parent_plate_asset_id', 'c5200000-0000-4000-8000-000000000801',
        'child_plate_asset_id', 'c5200000-0000-4000-8000-000000000804',
        'mask_storage_path', 'c5200000-0000-4000-8000-000000000101/x/mask.png',
        'mask_content_hash', pg_catalog.repeat('e', 64),
        'union_coverage_ratio', 0.084,
        'annotations', jsonb_build_array(
          jsonb_build_object('ordinal', 1, 'bounds', '{}'::jsonb, 'instruction', 'x')
        ),
        'model_id', 'fixture-image-model',
        'idempotency_key', 'studio-fixture-edit-0001',
        'edited_by', 'c5200000-0000-4000-8000-000000000001'
      )
    )
  $$,
  '22023', 'campaign_plate_edit_conflict',
  'one idempotency key naming different plates is a caller defect, not a retry'
);

reset role;

select extensions.throws_ok(
  $$
    insert into public.campaign_plate_edits (
      organization_id, campaign_id, parent_plate_asset_id, child_plate_asset_id,
      mask_storage_path, mask_content_hash, union_coverage_ratio, annotations,
      model_id, idempotency_key, edited_by
    )
    select
      'c5200000-0000-4000-8000-000000000101'::uuid,
      'c5200000-0000-4000-8000-000000000501'::uuid,
      'c5200000-0000-4000-8000-000000000801'::uuid,
      'c5200000-0000-4000-8000-000000000803'::uuid,
      'c5200000-0000-4000-8000-000000000101/x/mask.png', pg_catalog.repeat('e', 64), 0.5,
      (
        select jsonb_agg(
          jsonb_build_object('ordinal', n, 'bounds', '{}'::jsonb, 'instruction', 'x')
        )
        from generate_series(1, 9) as n
      ),
      'fixture-image-model', 'studio-fixture-nine', 'c5200000-0000-4000-8000-000000000001'::uuid
  $$,
  '23514', null,
  'a ninth marked region is refused'
);

select extensions.throws_ok(
  $$
    insert into public.campaign_plate_edits (
      organization_id, campaign_id, parent_plate_asset_id, child_plate_asset_id,
      mask_storage_path, mask_content_hash, union_coverage_ratio, annotations,
      model_id, idempotency_key, edited_by
    ) values (
      'c5200000-0000-4000-8000-000000000101'::uuid,
      'c5200000-0000-4000-8000-000000000501'::uuid,
      'c5200000-0000-4000-8000-000000000801'::uuid,
      'c5200000-0000-4000-8000-000000000803'::uuid,
      'c5200000-0000-4000-8000-000000000101/x/mask.png', pg_catalog.repeat('e', 64), 0.5,
      jsonb_build_array(
        jsonb_build_object(
          'ordinal', 1, 'bounds', '{}'::jsonb, 'instruction', pg_catalog.repeat('x', 501)
        )
      ),
      'fixture-image-model', 'studio-fixture-long', 'c5200000-0000-4000-8000-000000000001'::uuid
    )
  $$,
  '23514', null,
  'an instruction longer than five hundred characters is refused'
);

-- Ordinals are the replay order. Out of order, the edit could not be replayed
-- as the operator made it.
select extensions.throws_ok(
  $$
    insert into public.campaign_plate_edits (
      organization_id, campaign_id, parent_plate_asset_id, child_plate_asset_id,
      mask_storage_path, mask_content_hash, union_coverage_ratio, annotations,
      model_id, idempotency_key, edited_by
    ) values (
      'c5200000-0000-4000-8000-000000000101'::uuid,
      'c5200000-0000-4000-8000-000000000501'::uuid,
      'c5200000-0000-4000-8000-000000000801'::uuid,
      'c5200000-0000-4000-8000-000000000803'::uuid,
      'c5200000-0000-4000-8000-000000000101/x/mask.png', pg_catalog.repeat('e', 64), 0.5,
      jsonb_build_array(
        jsonb_build_object('ordinal', 7, 'bounds', '{}'::jsonb, 'instruction', 'x')
      ),
      'fixture-image-model', 'studio-fixture-ordinal', 'c5200000-0000-4000-8000-000000000001'::uuid
    )
  $$,
  '23514', null,
  'an annotation ordinal out of sequence is refused'
);

select extensions.throws_ok(
  $$
    insert into public.campaign_plate_edits (
      organization_id, campaign_id, parent_plate_asset_id, child_plate_asset_id,
      mask_storage_path, mask_content_hash, union_coverage_ratio, annotations,
      model_id, idempotency_key, edited_by
    ) values (
      'c5200000-0000-4000-8000-000000000101'::uuid,
      'c5200000-0000-4000-8000-000000000501'::uuid,
      'c5200000-0000-4000-8000-000000000801'::uuid,
      'c5200000-0000-4000-8000-000000000801'::uuid,
      'c5200000-0000-4000-8000-000000000101/x/mask.png', pg_catalog.repeat('e', 64), 0.5,
      jsonb_build_array(
        jsonb_build_object('ordinal', 1, 'bounds', '{}'::jsonb, 'instruction', 'x')
      ),
      'fixture-image-model', 'studio-fixture-self', 'c5200000-0000-4000-8000-000000000001'::uuid
    )
  $$,
  '23514', null,
  'a plate cannot be recorded as the edit of itself'
);

select extensions.throws_ok(
  $$
    update public.campaign_plate_edits
    set model_id = 'rewritten'
    where organization_id = 'c5200000-0000-4000-8000-000000000101'::uuid
  $$,
  '23514', 'campaign_plate_edits is append-only',
  'the edit lineage refuses an update'
);

-- ---------------------------------------------------------------------------
-- Audit and tenant isolation
-- ---------------------------------------------------------------------------

select extensions.is(
  (
    select count(distinct event_name)::bigint
    from public.audit_events
    where organization_id = 'c5200000-0000-4000-8000-000000000101'::uuid
      and event_name in (
        'campaign.poster_rendered', 'campaign.render_refused', 'campaign.plate_edited'
      )
  ),
  3::bigint,
  'a render, a refusal and an edit each emit their own audit event'
);

set local role authenticated;
set local request.jwt.claim.sub = 'c5200000-0000-4000-8000-000000000002';

select extensions.is(
  (select count(*)::bigint from public.campaign_poster_renders),
  0::bigint,
  'a member of the other tenant reads none of tenant A''s renders'
);

select extensions.is(
  (select count(*)::bigint from public.campaign_plate_edits),
  0::bigint,
  'a member of the other tenant reads none of tenant A''s plate edits'
);

select extensions.is(
  (select count(*)::bigint from public.campaign_poster_templates where key = 'studio_feed_test'),
  1::bigint,
  'a platform template is catalogue and readable by any signed-in member'
);

reset role;

set local role authenticated;
set local request.jwt.claim.sub = 'c5200000-0000-4000-8000-000000000001';

select extensions.is(
  (select count(*)::bigint from public.campaign_poster_renders),
  2::bigint,
  'a member of the owning tenant reads its own renders'
);

select extensions.throws_ok(
  $$
    insert into public.campaign_poster_renders (
      organization_id, campaign_id, bundle_version_id, plate_asset_id,
      template_key, template_version, script, text_values, font_manifest,
      render_digest, state, refusal_code
    ) values (
      'c5200000-0000-4000-8000-000000000101'::uuid,
      'c5200000-0000-4000-8000-000000000501'::uuid,
      'c5200000-0000-4000-8000-000000000701'::uuid,
      'c5200000-0000-4000-8000-000000000801'::uuid,
      'studio_feed_test', 1, 'Arab', '{}'::jsonb, '{}'::jsonb,
      pg_catalog.repeat('6', 64), 'refused', 'text_does_not_fit'
    )
  $$,
  '42501', null,
  'a member cannot write a render directly, only the worker writer may'
);

reset role;

select * from extensions.finish();
rollback;
