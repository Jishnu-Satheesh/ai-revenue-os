begin;

create extension if not exists pgtap with schema extensions;

select extensions.no_plan();

-- One tenant is enough here: every assertion is about what the policy columns
-- and constraints will accept, not about who may read them. Tenant isolation
-- for this table is already covered by campaign_bundle_test.sql.
insert into auth.users (id) values ('9c000000-0000-4000-8000-000000000001'::uuid);

insert into public.organizations (
  id, name, slug, industry, country_code, base_currency, default_timezone, created_by
) values (
  '9c000000-0000-4000-8000-000000000101'::uuid,
  'Policy tenant', 'policy-tenant', 'testing', 'AE', 'AED', 'Asia/Dubai',
  '9c000000-0000-4000-8000-000000000001'::uuid
);

insert into public.organization_memberships (organization_id, user_id, role)
values (
  '9c000000-0000-4000-8000-000000000101'::uuid,
  '9c000000-0000-4000-8000-000000000001'::uuid,
  'operator'
);

insert into public.campaign_briefs (id, organization_id, objective, audience, created_by)
values (
  '9c000000-0000-4000-8000-000000000201'::uuid,
  '9c000000-0000-4000-8000-000000000101'::uuid,
  'Increase weekday lunch covers', 'Nearby office workers',
  '9c000000-0000-4000-8000-000000000001'::uuid
);

insert into public.campaigns (id, organization_id, title, source_kind, brief_id, created_by)
values (
  '9c000000-0000-4000-8000-000000000301'::uuid,
  '9c000000-0000-4000-8000-000000000101'::uuid,
  'Policy campaign', 'manual_brief',
  '9c000000-0000-4000-8000-000000000201'::uuid,
  '9c000000-0000-4000-8000-000000000001'::uuid
);

insert into public.campaign_source_snapshots (
  id, organization_id, campaign_id, facts, assertions
) values (
  '9c000000-0000-4000-8000-000000000401'::uuid,
  '9c000000-0000-4000-8000-000000000101'::uuid,
  '9c000000-0000-4000-8000-000000000301'::uuid,
  '{}'::jsonb,
  '[]'::jsonb
);

-- A manifest with a policy, parameterised on the parts under test.
create function pg_temp.policy_manifest(
  per_direction jsonb,
  total jsonb,
  expires jsonb,
  direction_count integer default 3,
  schema_version jsonb default '2'::jsonb
)
returns jsonb language sql immutable set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'schemaVersion', schema_version,
    'campaignId', '9c000000-0000-4000-8000-000000000301',
    'version', 1,
    'generationProfile', 'brand_guided',
    'executionMode', 'best_effort',
    'generationPolicy', pg_catalog.jsonb_build_object(
      'maxVariantsPerDirection', per_direction,
      'maxVariantsTotal', total,
      'policyExpiresAt', expires,
      'lockedOfferRef', null,
      'lockedAssertionKeys', '[]'::jsonb
    ),
    'directions', (
      select coalesce(pg_catalog.jsonb_agg(index), '[]'::jsonb)
      from pg_catalog.generate_series(1, direction_count) as index
    ),
    'actions', '[]'::jsonb,
    'assets', '[]'::jsonb
  )
$$;

-- Every insert is version 1 on its own fresh campaign.
--
-- Reusing one campaign would make the second insert version 2, which trips the
-- pre-existing "a later version needs a parent" check — and that check raises
-- 23514 too. Every negative assertion below would then pass for the wrong
-- reason, proving nothing about the constraints this migration adds.
create function pg_temp.insert_first_version(manifest jsonb, digest_seed text)
returns void language plpgsql set search_path = '' as $$
declare
  new_campaign uuid := pg_catalog.gen_random_uuid();
  new_snapshot uuid := pg_catalog.gen_random_uuid();
begin
  insert into public.campaigns (id, organization_id, title, source_kind, brief_id, created_by)
  values (
    new_campaign, '9c000000-0000-4000-8000-000000000101'::uuid,
    'Policy campaign', 'manual_brief',
    '9c000000-0000-4000-8000-000000000201'::uuid,
    '9c000000-0000-4000-8000-000000000001'::uuid
  );

  insert into public.campaign_source_snapshots (
    id, organization_id, campaign_id, facts, assertions
  ) values (
    new_snapshot, '9c000000-0000-4000-8000-000000000101'::uuid,
    new_campaign, '{}'::jsonb, '[]'::jsonb
  );

  insert into public.campaign_bundle_versions (
    organization_id, campaign_id, version, source_snapshot_id, manifest, digest,
    generation_profile, execution_mode
  ) values (
    '9c000000-0000-4000-8000-000000000101'::uuid,
    new_campaign, 1, new_snapshot,
    pg_catalog.jsonb_set(manifest, '{campaignId}', pg_catalog.to_jsonb(new_campaign::text)),
    pg_catalog.repeat(digest_seed, 64), 'brand_guided', 'best_effort'
  );
end;
$$;

-- Columns exist and are derived, not written --------------------------------

select extensions.has_column(
  'public', 'campaign_bundle_versions', 'max_variants_per_direction',
  'the per-direction cap is projected onto the version row'
);
select extensions.has_column(
  'public', 'campaign_bundle_versions', 'max_variants_total',
  'the total cap is projected onto the version row'
);
select extensions.has_column(
  'public', 'campaign_bundle_versions', 'policy_expires_at_utc',
  'the policy window is projected onto the version row'
);

select extensions.lives_ok(
  $$ select pg_temp.insert_first_version(pg_temp.policy_manifest('4', '12', '"2026-12-01T00:00:00.000Z"'), 'a') $$,
  'a bundle carrying a well-formed policy is accepted'
);

select extensions.is(
  (select max_variants_per_direction from public.campaign_bundle_versions
   where digest = repeat('a', 64)),
  4,
  'the per-direction cap is projected out of the manifest rather than stored twice'
);

select extensions.is(
  (select policy_expires_at_utc from public.campaign_bundle_versions
   where digest = repeat('a', 64)),
  '2026-12-01T00:00:00.000Z',
  'the policy window is projected as the exact UTC instant the manifest declares'
);

-- A bundle with no bound at all is refused ----------------------------------

select extensions.throws_ok(
  $$ select pg_temp.insert_first_version(
       '{"schemaVersion":2,"version":1,"directions":[1,2,3]}'::jsonb, 'b') $$,
  '23502',
  null,
  'a manifest with no generation policy is refused rather than defaulted'
);

-- Version 1 cannot come back ------------------------------------------------

select extensions.throws_ok(
  $$ select pg_temp.insert_first_version(
       pg_temp.policy_manifest('4', '12', '"2026-12-01T00:00:00.000Z"', 3, '1'::jsonb), 'c') $$,
  '23514',
  null,
  'a schemaVersion 1 manifest is refused, because nothing reads version 1 any more'
);

-- The total may never starve a direction ------------------------------------

select extensions.throws_ok(
  $$ select pg_temp.insert_first_version(pg_temp.policy_manifest('5', '12', '"2026-12-01T00:00:00.000Z"'), 'd') $$,
  '23514',
  null,
  'five per direction across three directions cannot be capped at twelve total'
);

select extensions.lives_ok(
  $$ select pg_temp.insert_first_version(pg_temp.policy_manifest('5', '15', '"2026-12-01T00:00:00.000Z"'), 'e') $$,
  'a total exactly covering every direction at its own cap is accepted'
);

-- Caps stay inside their bounds ---------------------------------------------

select extensions.throws_ok(
  $$ select pg_temp.insert_first_version(pg_temp.policy_manifest('0', '12', '"2026-12-01T00:00:00.000Z"'), 'f') $$,
  '23514',
  null,
  'a zero per-direction cap is refused rather than read as unlimited'
);

select extensions.throws_ok(
  $$ select pg_temp.insert_first_version(pg_temp.policy_manifest('51', '306', '"2026-12-01T00:00:00.000Z"'), 'g') $$,
  '23514',
  null,
  'a per-direction cap beyond fifty is refused'
);

-- The window must be an unambiguous UTC instant -----------------------------

select extensions.throws_ok(
  $$ select pg_temp.insert_first_version(
       pg_temp.policy_manifest('4', '12', '"2026-12-01T00:00:00+04:00"'), 'h') $$,
  '23514',
  null,
  'an offset timestamp is refused, because the column compares as text'
);

select extensions.throws_ok(
  $$ select pg_temp.insert_first_version(pg_temp.policy_manifest('4', '12', '"soon"'), 'i') $$,
  '23514',
  null,
  'a policy window that is not a timestamp at all is refused'
);

-- An approval must cover the window it authorizes ---------------------------

select extensions.has_function(
  'public', 'approve_campaign_bundle', array['uuid', 'jsonb'],
  'the approval function still exists after being replaced'
);

select extensions.function_privs_are(
  'public', 'approve_campaign_bundle', array['uuid', 'jsonb'], 'anon', array[]::text[],
  'anon still cannot approve a campaign bundle'
);

select extensions.function_privs_are(
  'public', 'approve_campaign_bundle', array['uuid', 'jsonb'], 'authenticated', array['EXECUTE'],
  'an authenticated operator still holds approval'
);

select * from extensions.finish();
rollback;
