begin;

create extension if not exists pgtap with schema extensions;

select extensions.no_plan();

insert into auth.users (id)
values
  ('8b000000-0000-4000-8000-000000000001'::uuid),
  ('8b000000-0000-4000-8000-000000000002'::uuid);

insert into public.organizations (
  id, name, slug, industry, country_code, base_currency, default_timezone, created_by
) values
  (
    '8b000000-0000-4000-8000-000000000101'::uuid,
    'Brand intake tenant', 'brand-intake-tenant', 'testing', 'AE', 'AED', 'Asia/Dubai',
    '8b000000-0000-4000-8000-000000000001'::uuid
  ),
  (
    '8b000000-0000-4000-8000-000000000102'::uuid,
    'Other tenant', 'brand-intake-other', 'testing', 'AE', 'AED', 'Asia/Dubai',
    '8b000000-0000-4000-8000-000000000002'::uuid
  );

insert into public.organization_memberships (organization_id, user_id, role)
values
  (
    '8b000000-0000-4000-8000-000000000101'::uuid,
    '8b000000-0000-4000-8000-000000000001'::uuid,
    'operator'
  ),
  (
    '8b000000-0000-4000-8000-000000000102'::uuid,
    '8b000000-0000-4000-8000-000000000002'::uuid,
    'operator'
  );

create temporary table intake_state (key text primary key, value jsonb not null);
grant select, insert on intake_state to authenticated;

-- ---------------------------------------------------------------------------
-- Brand asset intake
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = '8b000000-0000-4000-8000-000000000001';

insert into intake_state (key, value)
select 'first_version', public.create_brand_asset_version(
  '8b000000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', '8b000000-0000-4000-8000-000000000101',
    'label', 'Primary logo',
    'asset_role', 'logo'
  )
);

select extensions.ok(
  (select value ->> 'version_id' is not null from intake_state where key = 'first_version'),
  'an operator may reserve a brand asset version'
);

select extensions.ok(
  (
    select pg_catalog.starts_with(
      value ->> 'storage_path', '8b000000-0000-4000-8000-000000000101/'
    )
    from intake_state where key = 'first_version'
  ),
  'the storage path is tenant-first, decided by the database rather than the caller'
);

select extensions.ok(
  (
    select not is_usable
    from public.organization_brand_asset_versions
    where id = (select (value ->> 'version_id')::uuid from intake_state where key = 'first_version')
  ),
  'a reserved version is not usable until the server has seen the bytes'
);

-- A second version of the same asset increments rather than colliding.
insert into intake_state (key, value)
select 'second_version', public.create_brand_asset_version(
  '8b000000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', '8b000000-0000-4000-8000-000000000101',
    'brand_asset_id', (select value ->> 'brand_asset_id' from intake_state where key = 'first_version')
  )
);

select extensions.is(
  (
    select version
    from public.organization_brand_asset_versions
    where id = (select (value ->> 'version_id')::uuid from intake_state where key = 'second_version')
  ),
  2,
  'a second upload of the same asset becomes version two'
);

select extensions.throws_ok(
  $$
    select public.create_brand_asset_version(
      '8b000000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', '8b000000-0000-4000-8000-000000000102',
        'label', 'Smuggled', 'asset_role', 'logo'
      )
    )
  $$,
  '42501', 'brand_asset_organization_mismatch',
  'a body cannot redirect a brand asset to another tenant'
);

-- Promotion carries facts the server read out of the bytes.
select public.finalize_brand_asset_version(
  '8b000000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'version_id', (select value ->> 'version_id' from intake_state where key = 'first_version'),
    'content_hash', repeat('a', 64),
    'mime_type', 'image/png',
    'byte_size', 20480,
    'width_px', 1024,
    'height_px', 1024
  )
);

select extensions.ok(
  (
    select is_usable and content_hash = repeat('a', 64) and width_px = 1024
    from public.organization_brand_asset_versions
    where id = (select (value ->> 'version_id')::uuid from intake_state where key = 'first_version')
  ),
  'finalizing records the decoded facts and makes the version usable'
);

select extensions.throws_ok(
  format(
    $$
      select public.finalize_brand_asset_version(
        '8b000000-0000-4000-8000-000000000101'::uuid,
        jsonb_build_object(
          'version_id', %L, 'content_hash', %L, 'mime_type', 'image/png',
          'byte_size', 1, 'width_px', 2, 'height_px', 2
        )
      )
    $$,
    (select value ->> 'version_id' from intake_state where key = 'first_version'),
    repeat('b', 64)
  ),
  '23514', 'brand_asset_version_already_final',
  'a version cannot be finalized twice, so bytes a campaign used cannot be swapped'
);

reset role;

-- A member of another tenant cannot reserve into this one.
set local role authenticated;
set local request.jwt.claim.sub = '8b000000-0000-4000-8000-000000000002';

select extensions.throws_ok(
  $$
    select public.create_brand_asset_version(
      '8b000000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', '8b000000-0000-4000-8000-000000000101',
        'label', 'Outsider', 'asset_role', 'logo'
      )
    )
  $$,
  '42501', 'brand_asset_forbidden',
  'a member of another organization cannot reserve a brand asset here'
);

reset role;

-- ---------------------------------------------------------------------------
-- Scheduling
-- ---------------------------------------------------------------------------

insert into public.campaign_briefs (id, organization_id, objective, audience, created_by)
values (
  '8b000000-0000-4000-8000-000000000201'::uuid,
  '8b000000-0000-4000-8000-000000000101'::uuid,
  'Increase weekday lunch covers', 'Nearby office workers',
  '8b000000-0000-4000-8000-000000000001'::uuid
);

insert into public.campaigns (id, organization_id, title, source_kind, brief_id, created_by)
values (
  '8b000000-0000-4000-8000-000000000301'::uuid,
  '8b000000-0000-4000-8000-000000000101'::uuid,
  'Lunch campaign', 'manual_brief',
  '8b000000-0000-4000-8000-000000000201'::uuid,
  '8b000000-0000-4000-8000-000000000001'::uuid
);

insert into public.campaign_source_snapshots (id, organization_id, campaign_id, facts, assertions)
values (
  '8b000000-0000-4000-8000-000000000401'::uuid,
  '8b000000-0000-4000-8000-000000000101'::uuid,
  '8b000000-0000-4000-8000-000000000301'::uuid,
  '{}'::jsonb, '[]'::jsonb
);

insert into public.campaign_bundle_versions (
  id, organization_id, campaign_id, version, source_snapshot_id, manifest, digest,
  generation_profile, execution_mode
) values (
  '8b000000-0000-4000-8000-000000000501'::uuid,
  '8b000000-0000-4000-8000-000000000101'::uuid,
  '8b000000-0000-4000-8000-000000000301'::uuid,
  1,
  '8b000000-0000-4000-8000-000000000401'::uuid,
  jsonb_build_object(
    'version', 1,
    'campaignId', '8b000000-0000-4000-8000-000000000301',
    'generationProfile', 'brand_guided',
    'executionMode', 'best_effort'
  ),
  repeat('c', 64), 'brand_guided', 'best_effort'
);

insert into public.campaign_creative_directions (
  organization_id, bundle_version_id, direction_key, kind, name, rationale
) values (
  '8b000000-0000-4000-8000-000000000101'::uuid,
  '8b000000-0000-4000-8000-000000000501'::uuid,
  '8b000000-0000-4000-8000-000000000601'::uuid,
  'control', 'House style', 'The reference treatment.'
);

-- Two actions on the version; only one will be approved.
insert into public.campaign_channel_actions (
  organization_id, bundle_version_id, action_key, direction_key, channel, placement,
  scheduled_for, requirement
) values
  (
    '8b000000-0000-4000-8000-000000000101'::uuid,
    '8b000000-0000-4000-8000-000000000501'::uuid,
    '8b000000-0000-4000-8000-000000000701'::uuid,
    '8b000000-0000-4000-8000-000000000601'::uuid,
    'instagram', 'feed_image', pg_catalog.now() + interval '1 day', 'required'
  ),
  (
    '8b000000-0000-4000-8000-000000000101'::uuid,
    '8b000000-0000-4000-8000-000000000501'::uuid,
    '8b000000-0000-4000-8000-000000000702'::uuid,
    '8b000000-0000-4000-8000-000000000601'::uuid,
    'facebook', 'feed_image', pg_catalog.now() + interval '2 days', 'optional'
  );

set local role authenticated;
set local request.jwt.claim.sub = '8b000000-0000-4000-8000-000000000001';

select extensions.throws_ok(
  $$
    select public.schedule_campaign_actions(
      '8b000000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', '8b000000-0000-4000-8000-000000000101',
        'bundle_version_id', '8b000000-0000-4000-8000-000000000501'
      )
    )
  $$,
  '42501', 'campaign_schedule_requires_approval',
  'scheduling cannot become a way around approval'
);

reset role;

insert into public.campaign_visual_attestations (
  id, organization_id, campaign_id, bundle_version_id, bundle_digest, attested_by, statement
) values (
  '8b000000-0000-4000-8000-000000000801'::uuid,
  '8b000000-0000-4000-8000-000000000101'::uuid,
  '8b000000-0000-4000-8000-000000000301'::uuid,
  '8b000000-0000-4000-8000-000000000501'::uuid,
  repeat('c', 64), '8b000000-0000-4000-8000-000000000001'::uuid,
  'I reviewed every proposed image.'
);

-- Approves only the first action, deliberately.
insert into public.campaign_approvals (
  id, organization_id, campaign_id, bundle_version_id, bundle_digest, attestation_id,
  approved_by, expires_at, capability_grant_versions, action_keys
) values (
  '8b000000-0000-4000-8000-000000000901'::uuid,
  '8b000000-0000-4000-8000-000000000101'::uuid,
  '8b000000-0000-4000-8000-000000000301'::uuid,
  '8b000000-0000-4000-8000-000000000501'::uuid,
  repeat('c', 64),
  '8b000000-0000-4000-8000-000000000801'::uuid,
  '8b000000-0000-4000-8000-000000000001'::uuid,
  pg_catalog.now() + interval '7 days',
  '{}'::jsonb,
  array['8b000000-0000-4000-8000-000000000701'::uuid]
);

set local role authenticated;
set local request.jwt.claim.sub = '8b000000-0000-4000-8000-000000000001';

insert into intake_state (key, value)
select 'first_schedule', public.schedule_campaign_actions(
  '8b000000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', '8b000000-0000-4000-8000-000000000101',
    'bundle_version_id', '8b000000-0000-4000-8000-000000000501'
  )
);

select extensions.is(
  (select (value ->> 'created_count')::integer from intake_state where key = 'first_schedule'),
  1,
  'scheduling materialises one run per approved action, not per action on the version'
);

select extensions.is(
  (
    select action_key from public.campaign_action_runs
    where organization_id = '8b000000-0000-4000-8000-000000000101'::uuid
  ),
  '8b000000-0000-4000-8000-000000000701'::uuid,
  'the unapproved action is left alone'
);

-- Scheduling twice must not double-book the same action.
insert into intake_state (key, value)
select 'second_schedule', public.schedule_campaign_actions(
  '8b000000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', '8b000000-0000-4000-8000-000000000101',
    'bundle_version_id', '8b000000-0000-4000-8000-000000000501'
  )
);

select extensions.is(
  (select (value ->> 'created_count')::integer from intake_state where key = 'second_schedule'),
  0,
  'scheduling again creates nothing new'
);
select extensions.is(
  (select (value ->> 'total_count')::integer from intake_state where key = 'second_schedule'),
  1,
  'one action still has exactly one run'
);

reset role;

select extensions.is(
  (
    select state from public.campaigns
    where id = '8b000000-0000-4000-8000-000000000301'::uuid
  ),
  'scheduled'::text,
  'scheduling moves the campaign to scheduled'
);

-- An approval whose digest no longer matches the version cannot schedule.
update public.campaign_approvals
set revoked_at = pg_catalog.now(), revoked_reason = 'operator_revoked'
where id = '8b000000-0000-4000-8000-000000000901'::uuid;

set local role authenticated;
set local request.jwt.claim.sub = '8b000000-0000-4000-8000-000000000001';

select extensions.throws_ok(
  $$
    select public.schedule_campaign_actions(
      '8b000000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', '8b000000-0000-4000-8000-000000000101',
        'bundle_version_id', '8b000000-0000-4000-8000-000000000501'
      )
    )
  $$,
  '42501', 'campaign_schedule_requires_approval',
  'a revoked approval cannot schedule anything further'
);

reset role;

select * from extensions.finish();
rollback;
