begin;

create extension if not exists pgtap with schema extensions;

select extensions.no_plan();

-- Two tenants, because a variant carries creative that will become public and
-- must never be reachable from another organization's session.
insert into auth.users (id)
values
  ('a1000000-0000-4000-8000-000000000001'::uuid),
  ('a1000000-0000-4000-8000-000000000002'::uuid);

-- Inert account fixture: organizations.account_id is NOT NULL, but this suite
-- grants no account membership, so access still resolves purely from the
-- organization_memberships rows below.
insert into public.accounts (id, name, slug, created_by)
values (
  'acc00000-0000-4000-8000-a1000000c0de'::uuid, 'Fixture agency',
  'fixture-agency-campaign-creative-variants-test',
  'a1000000-0000-4000-8000-000000000001'::uuid
);

insert into public.organizations (
  id, name, slug, industry, country_code, base_currency, default_timezone, created_by, account_id
)
values
  (
    'a1000000-0000-4000-8000-000000000101'::uuid,
    'Variant tenant one', 'variant-tenant-one', 'testing', 'AE', 'AED', 'Asia/Dubai',
    'a1000000-0000-4000-8000-000000000001'::uuid,
    'acc00000-0000-4000-8000-a1000000c0de'::uuid
  ),
  (
    'a1000000-0000-4000-8000-000000000102'::uuid,
    'Variant tenant two', 'variant-tenant-two', 'testing', 'AE', 'AED', 'Asia/Dubai',
    'a1000000-0000-4000-8000-000000000002'::uuid,
    'acc00000-0000-4000-8000-a1000000c0de'::uuid
  );

insert into public.organization_memberships (organization_id, user_id, role)
values
  (
    'a1000000-0000-4000-8000-000000000101'::uuid,
    'a1000000-0000-4000-8000-000000000001'::uuid,
    'operator'
  ),
  (
    'a1000000-0000-4000-8000-000000000102'::uuid,
    'a1000000-0000-4000-8000-000000000002'::uuid,
    'operator'
  );

-- Builds one approved version with a two-per-direction, four-total policy, so
-- the caps are small enough to reach inside a test.
create function pg_temp.seed_version(
  org uuid, author uuid, campaign uuid, version_id uuid, direction uuid,
  asset uuid, digest_seed text, expires text
)
returns void language plpgsql set search_path = '' as $$
declare
  snapshot uuid := pg_catalog.gen_random_uuid();
  brief uuid := pg_catalog.gen_random_uuid();
  attestation uuid := pg_catalog.gen_random_uuid();
  action uuid := pg_catalog.gen_random_uuid();
begin
  insert into public.campaign_briefs (id, organization_id, objective, audience, created_by)
  values (brief, org, 'Increase weekday lunch covers', 'Nearby office workers', author);

  insert into public.campaigns (id, organization_id, title, source_kind, brief_id, created_by)
  values (campaign, org, 'Variant campaign', 'manual_brief', brief, author);

  insert into public.campaign_source_snapshots (
    id, organization_id, campaign_id, facts, assertions
  ) values (snapshot, org, campaign, '{}'::jsonb, '[]'::jsonb);

  insert into public.campaign_bundle_versions (
    id, organization_id, campaign_id, version, source_snapshot_id, manifest, digest,
    generation_profile, execution_mode
  ) values (
    version_id, org, campaign, 1, snapshot,
    pg_catalog.jsonb_build_object(
      'schemaVersion', 2,
      'campaignId', campaign,
      'version', 1,
      'generationProfile', 'brand_guided',
      'executionMode', 'best_effort',
      'generationPolicy', pg_catalog.jsonb_build_object(
        'maxVariantsPerDirection', 2,
        'maxVariantsTotal', 4,
        'policyExpiresAt', expires,
        'lockedOfferRef', null,
        'lockedAssertionKeys', '[]'::jsonb
      ),
      'directions', '[1, 2]'::jsonb,
      'actions', '[]'::jsonb,
      'assets', '[]'::jsonb
    ),
    pg_catalog.repeat(digest_seed, 64), 'brand_guided', 'best_effort'
  );

  insert into public.campaign_creative_directions (
    organization_id, bundle_version_id, direction_key, kind, name, rationale
  ) values (org, version_id, direction, 'control', 'House style', 'The reference treatment.');

  insert into public.campaign_assets (
    id, organization_id, bundle_version_id, asset_key, content_hash, mime_type,
    width_px, height_px, truth_class, provenance, alt_text, storage_path
  ) values (
    asset, org, version_id, asset, pg_catalog.repeat('c', 64), 'image/png',
    1080, 1080, 'synthetic_generated',
    pg_catalog.jsonb_build_object('kind', 'generated', 'modelId', 'image-model-v1'),
    'A plated dish on a wooden table.',
    org || '/' || campaign || '/' || version_id || '/' || asset || '.png'
  );

  insert into public.campaign_channel_actions (
    organization_id, bundle_version_id, direction_key, action_key,
    channel, placement, scheduled_for, requirement
  ) values (
    org, version_id, direction, action, 'instagram', 'feed_image',
    pg_catalog.now() + interval '2 days', 'required'
  );

  insert into public.campaign_visual_attestations (
    id, organization_id, campaign_id, bundle_version_id, bundle_digest, statement, attested_by
  ) values (
    attestation, org, campaign, version_id, pg_catalog.repeat(digest_seed, 64),
    'I reviewed every proposed asset.', author
  );

  insert into public.campaign_approvals (
    organization_id, campaign_id, bundle_version_id, bundle_digest, attestation_id,
    approved_by, expires_at, action_keys, capability_grant_versions, policy_version_ids
  ) values (
    org, campaign, version_id, pg_catalog.repeat(digest_seed, 64), attestation,
    author, pg_catalog.now() + interval '30 days', array[action], '{}'::jsonb, '{}'::uuid[]
  );
end;
$$;

select pg_temp.seed_version(
  'a1000000-0000-4000-8000-000000000101'::uuid,
  'a1000000-0000-4000-8000-000000000001'::uuid,
  'a1000000-0000-4000-8000-000000000301'::uuid,
  'a1000000-0000-4000-8000-000000000501'::uuid,
  'a1000000-0000-4000-8000-000000000601'::uuid,
  'a1000000-0000-4000-8000-000000000701'::uuid,
  'a', pg_catalog.to_char(
    pg_catalog.now() + interval '20 days', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  )
);

create function pg_temp.append(version_id uuid, direction uuid, asset uuid, hash_seed text)
returns uuid language sql set search_path = '' as $$
  select public.append_campaign_creative_variant(
    'a1000000-0000-4000-8000-000000000101'::uuid,
    pg_catalog.jsonb_build_object(
      'organization_id', 'a1000000-0000-4000-8000-000000000101',
      'bundle_version_id', version_id,
      'direction_key', direction,
      'asset_id', asset,
      'channel', 'instagram',
      'placement', 'feed_image',
      'hook', 'Two courses, one price',
      'caption', 'Lunch that pays for itself.',
      'call_to_action', 'Book a table',
      'hashtags', '["#lunch"]'::jsonb,
      'content_hash', pg_catalog.repeat(hash_seed, 64),
      'provenance', pg_catalog.jsonb_build_object('kind', 'generated')
    )
  );
$$;

-- Tenancy -------------------------------------------------------------------

select extensions.ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class where relname = 'campaign_creative_variants'),
  'creative variants enable and force row level security'
);

select extensions.table_privs_are(
  'public', 'campaign_creative_variants', 'anon', array[]::text[],
  'anonymous sessions cannot reach creative variants at all'
);

select extensions.table_privs_are(
  'public', 'campaign_creative_variants', 'authenticated', array['SELECT'],
  'members read variants and never write them directly'
);

select extensions.function_privs_are(
  'public', 'append_campaign_creative_variant', array['uuid', 'jsonb'], 'authenticated',
  array[]::text[],
  'a browser session cannot append a variant, because generation is a durable run'
);

select extensions.function_privs_are(
  'public', 'append_campaign_creative_variant', array['uuid', 'jsonb'], 'service_role',
  array['EXECUTE'],
  'only a worker may append a variant'
);

-- Appending under a live approval -------------------------------------------
-- This is also the required first live call of the new plpgsql function.

select extensions.isnt(
  pg_temp.append(
    'a1000000-0000-4000-8000-000000000501'::uuid,
    'a1000000-0000-4000-8000-000000000601'::uuid,
    'a1000000-0000-4000-8000-000000000701'::uuid,
    '1'
  ),
  null,
  'a variant under a live approval and an open policy is appended'
);

select extensions.is(
  (select direction_ordinal from public.campaign_creative_variants
   where content_hash = repeat('1', 64)),
  1,
  'the first variant in a direction takes slot one'
);

select extensions.is(
  (select max_variants_per_direction from public.campaign_creative_variants
   where content_hash = repeat('1', 64)),
  2,
  'the cap is inherited from the version rather than restated by the caller'
);

-- Duplicates ----------------------------------------------------------------
-- Deliberately before the caps fill up: with the direction already full, a
-- repeat would be refused for being the third variant rather than for being a
-- copy, and the test would pass without proving anything about duplicates.

select extensions.throws_ok(
  $$ select pg_temp.append(
       'a1000000-0000-4000-8000-000000000501'::uuid,
       'a1000000-0000-4000-8000-000000000601'::uuid,
       'a1000000-0000-4000-8000-000000000701'::uuid,
       '1') $$,
  '23505',
  null,
  'an identical creative cannot be stored twice for one version'
);

-- Caps ----------------------------------------------------------------------

select extensions.isnt(
  pg_temp.append(
    'a1000000-0000-4000-8000-000000000501'::uuid,
    'a1000000-0000-4000-8000-000000000601'::uuid,
    'a1000000-0000-4000-8000-000000000701'::uuid,
    '2'
  ),
  null,
  'the second variant fills the direction to its cap'
);

select extensions.throws_ok(
  $$ select pg_temp.append(
       'a1000000-0000-4000-8000-000000000501'::uuid,
       'a1000000-0000-4000-8000-000000000601'::uuid,
       'a1000000-0000-4000-8000-000000000701'::uuid,
       '3') $$,
  '22023',
  'campaign_variant_direction_cap_reached',
  'a third variant in a two-slot direction is refused by name, not by constraint noise'
);

-- The cap is not merely enforced by the RPC. A direct insert that skips it
-- entirely still cannot represent a slot beyond the cap.
select extensions.throws_ok(
  $$ insert into public.campaign_creative_variants (
       organization_id, campaign_id, bundle_version_id, direction_key,
       direction_ordinal, total_ordinal, max_variants_per_direction, max_variants_total,
       asset_id, channel, placement, hook, caption, call_to_action,
       content_hash, provenance
     ) values (
       'a1000000-0000-4000-8000-000000000101'::uuid,
       'a1000000-0000-4000-8000-000000000301'::uuid,
       'a1000000-0000-4000-8000-000000000501'::uuid,
       'a1000000-0000-4000-8000-000000000601'::uuid,
       9, 9, 2, 4,
       'a1000000-0000-4000-8000-000000000701'::uuid,
       'instagram', 'feed_image', 'Hook', 'Caption', 'Book',
       repeat('9', 64), '{}'::jsonb
     ) $$,
  '23514',
  null,
  'a direct insert cannot occupy a slot beyond the cap either'
);

-- A variant cannot forge a larger cap than its version allows.
select extensions.throws_ok(
  $$ insert into public.campaign_creative_variants (
       organization_id, campaign_id, bundle_version_id, direction_key,
       direction_ordinal, total_ordinal, max_variants_per_direction, max_variants_total,
       asset_id, channel, placement, hook, caption, call_to_action,
       content_hash, provenance
     ) values (
       'a1000000-0000-4000-8000-000000000101'::uuid,
       'a1000000-0000-4000-8000-000000000301'::uuid,
       'a1000000-0000-4000-8000-000000000501'::uuid,
       'a1000000-0000-4000-8000-000000000601'::uuid,
       9, 9, 99, 99,
       'a1000000-0000-4000-8000-000000000701'::uuid,
       'instagram', 'feed_image', 'Hook', 'Caption', 'Book',
       repeat('8', 64), '{}'::jsonb
     ) $$,
  '23503',
  null,
  'a variant claiming a bigger cap than its version is refused by the foreign key'
);

-- Immutability --------------------------------------------------------------

select extensions.throws_ok(
  $$ update public.campaign_creative_variants set caption = 'Rewritten after approval'
     where content_hash = repeat('1', 64) $$,
  '23514',
  'campaign_creative_variant_is_immutable',
  'an approved variant cannot be edited in place'
);

select extensions.throws_ok(
  $$ delete from public.campaign_creative_variants where content_hash = repeat('1', 64) $$,
  '23514',
  'campaign_creative_variant_is_immutable',
  'an approved variant cannot be deleted'
);

-- Approval and policy gates -------------------------------------------------

select pg_temp.seed_version(
  'a1000000-0000-4000-8000-000000000102'::uuid,
  'a1000000-0000-4000-8000-000000000002'::uuid,
  'a1000000-0000-4000-8000-000000000302'::uuid,
  'a1000000-0000-4000-8000-000000000502'::uuid,
  'a1000000-0000-4000-8000-000000000602'::uuid,
  'a1000000-0000-4000-8000-000000000702'::uuid,
  'b', pg_catalog.to_char(
    pg_catalog.now() - interval '1 day', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  )
);

select extensions.throws_ok(
  format(
    $$ select public.append_campaign_creative_variant(
         'a1000000-0000-4000-8000-000000000102'::uuid,
         jsonb_build_object(
           'organization_id', 'a1000000-0000-4000-8000-000000000102',
           'bundle_version_id', 'a1000000-0000-4000-8000-000000000502',
           'direction_key', 'a1000000-0000-4000-8000-000000000602',
           'asset_id', 'a1000000-0000-4000-8000-000000000702',
           'channel', 'instagram', 'placement', 'feed_image',
           'hook', 'Hook', 'caption', 'Caption', 'call_to_action', 'Book',
           'hashtags', '[]'::jsonb, 'content_hash', %L, 'provenance', '{}'::jsonb
         )) $$,
    repeat('7', 64)
  ),
  '22023',
  'campaign_variant_policy_expired',
  'a closed policy window authorizes no further variants, whatever the approval says'
);

-- A caller naming another tenant's organization is refused before any read.
select extensions.throws_ok(
  $$ select public.append_campaign_creative_variant(
       'a1000000-0000-4000-8000-000000000101'::uuid,
       jsonb_build_object(
         'organization_id', 'a1000000-0000-4000-8000-000000000102',
         'bundle_version_id', 'a1000000-0000-4000-8000-000000000502'
       )) $$,
  '42501',
  'campaign_variant_organization_mismatch',
  'a mismatched organization is refused before the version is even looked up'
);

select * from extensions.finish();
rollback;
