begin;

create extension if not exists pgtap with schema extensions;

select extensions.no_plan();

-- Two independent tenants and three roles. Everything below runs inside this
-- transaction, so no user, organization, campaign, or approval survives it.
insert into auth.users (id)
values
  ('cb000000-0000-4000-8000-000000000001'::uuid),
  ('cb000000-0000-4000-8000-000000000002'::uuid),
  ('cb000000-0000-4000-8000-000000000003'::uuid);

insert into public.organizations (
  id, name, slug, industry, country_code, base_currency, default_timezone, created_by
)
values
  (
    'cb000000-0000-4000-8000-000000000101'::uuid,
    'Campaign tenant one', 'campaign-tenant-one', 'testing', 'AE', 'AED', 'Asia/Dubai',
    'cb000000-0000-4000-8000-000000000001'::uuid
  ),
  (
    'cb000000-0000-4000-8000-000000000102'::uuid,
    'Campaign tenant two', 'campaign-tenant-two', 'testing', 'AE', 'AED', 'Asia/Dubai',
    'cb000000-0000-4000-8000-000000000002'::uuid
  );

insert into public.organization_memberships (organization_id, user_id, role)
values
  (
    'cb000000-0000-4000-8000-000000000101'::uuid,
    'cb000000-0000-4000-8000-000000000001'::uuid,
    'operator'
  ),
  (
    'cb000000-0000-4000-8000-000000000102'::uuid,
    'cb000000-0000-4000-8000-000000000002'::uuid,
    'operator'
  ),
  (
    'cb000000-0000-4000-8000-000000000101'::uuid,
    'cb000000-0000-4000-8000-000000000003'::uuid,
    'viewer'
  );

-- ---------------------------------------------------------------------------
-- Shape, RLS, and grants
-- ---------------------------------------------------------------------------

select extensions.has_table('public', 'campaigns', 'campaigns exist');
select extensions.has_table('public', 'campaign_bundle_versions', 'bundle versions exist');
select extensions.has_table('public', 'campaign_approvals', 'approvals exist');
select extensions.has_table('public', 'campaign_visual_attestations', 'attestations exist');

select extensions.ok(
  (
    select bool_and(relrowsecurity and relforcerowsecurity)
    from pg_catalog.pg_class
    where oid in (
      'public.organization_brand_assets'::regclass,
      'public.organization_brand_asset_versions'::regclass,
      'public.campaign_briefs'::regclass,
      'public.campaigns'::regclass,
      'public.campaign_source_snapshots'::regclass,
      'public.campaign_bundle_versions'::regclass,
      'public.campaign_creative_directions'::regclass,
      'public.campaign_assets'::regclass,
      'public.campaign_channel_actions'::regclass,
      'public.campaign_measurement_plans'::regclass,
      'public.campaign_visual_attestations'::regclass,
      'public.campaign_approvals'::regclass
    )
  ),
  'every campaign table enables and forces RLS'
);

select extensions.table_privs_are(
  'public', 'campaigns', 'anon', array[]::text[], 'anonymous cannot reach campaigns'
);
select extensions.table_privs_are(
  'public', 'campaign_bundle_versions', 'anon', array[]::text[],
  'anonymous cannot reach bundle versions'
);
select extensions.table_privs_are(
  'public', 'campaign_approvals', 'authenticated', array['SELECT'],
  'members read approvals and never write them directly'
);
select extensions.table_privs_are(
  'public', 'campaign_bundle_versions', 'authenticated', array['SELECT'],
  'members read bundle versions and never write them directly'
);

select extensions.function_privs_are(
  'public', 'create_campaign_bundle_version', array['uuid', 'jsonb'], 'authenticated',
  array[]::text[], 'a browser session cannot publish a bundle version'
);
select extensions.function_privs_are(
  'public', 'create_campaign_bundle_version', array['uuid', 'jsonb'], 'anon',
  array[]::text[], 'anonymous cannot publish a bundle version'
);
select extensions.function_privs_are(
  'public', 'approve_campaign_bundle', array['uuid', 'jsonb'], 'anon',
  array[]::text[], 'anonymous cannot approve a bundle'
);
select extensions.function_privs_are(
  'public', 'approve_campaign_bundle', array['uuid', 'jsonb'], 'authenticated',
  array['EXECUTE'], 'approval is a human act performed in a session'
);

select extensions.ok(
  (select not public from storage.buckets where id = 'campaign-assets'),
  'campaign assets are private'
);
select extensions.ok(
  (select not public from storage.buckets where id = 'brand-assets'),
  'brand assets are private'
);

-- ---------------------------------------------------------------------------
-- Fixtures for both tenants
-- ---------------------------------------------------------------------------

create function pg_temp.campaign_manifest(campaign_id uuid, objective text)
returns jsonb language sql immutable set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'campaignId', campaign_id,
    'version', 1,
    'source', pg_catalog.jsonb_build_object('kind', 'manual_brief', 'sourceId', campaign_id),
    'objective', objective,
    'rationale', 'A bounded test proposal.',
    'generationProfile', 'brand_guided',
    'executionMode', 'best_effort',
    'directions', '[]'::jsonb,
    'actions', '[]'::jsonb,
    'assets', '[]'::jsonb
  )
$$;

insert into public.campaign_briefs (id, organization_id, objective, audience, created_by)
values
  (
    'cb000000-0000-4000-8000-000000000201'::uuid,
    'cb000000-0000-4000-8000-000000000101'::uuid,
    'Increase weekday lunch covers', 'Nearby office workers',
    'cb000000-0000-4000-8000-000000000001'::uuid
  ),
  (
    'cb000000-0000-4000-8000-000000000202'::uuid,
    'cb000000-0000-4000-8000-000000000102'::uuid,
    'Increase weekend brunch covers', 'Local families',
    'cb000000-0000-4000-8000-000000000002'::uuid
  );

insert into public.campaigns (
  id, organization_id, title, source_kind, brief_id, created_by
)
values
  (
    'cb000000-0000-4000-8000-000000000301'::uuid,
    'cb000000-0000-4000-8000-000000000101'::uuid,
    'Tenant one lunch campaign', 'manual_brief',
    'cb000000-0000-4000-8000-000000000201'::uuid,
    'cb000000-0000-4000-8000-000000000001'::uuid
  ),
  (
    'cb000000-0000-4000-8000-000000000302'::uuid,
    'cb000000-0000-4000-8000-000000000102'::uuid,
    'Tenant two brunch campaign', 'manual_brief',
    'cb000000-0000-4000-8000-000000000202'::uuid,
    'cb000000-0000-4000-8000-000000000002'::uuid
  );

insert into public.campaign_source_snapshots (
  id, organization_id, campaign_id, facts, assertions
)
values
  (
    'cb000000-0000-4000-8000-000000000401'::uuid,
    'cb000000-0000-4000-8000-000000000101'::uuid,
    'cb000000-0000-4000-8000-000000000301'::uuid,
    '{"currency":"AED"}'::jsonb, '[{"key":"policy.access.active"}]'::jsonb
  ),
  (
    'cb000000-0000-4000-8000-000000000402'::uuid,
    'cb000000-0000-4000-8000-000000000102'::uuid,
    'cb000000-0000-4000-8000-000000000302'::uuid,
    '{"currency":"AED"}'::jsonb, '[{"key":"policy.access.active"}]'::jsonb
  );

select extensions.throws_ok(
  $$
    insert into public.campaigns (
      id, organization_id, title, source_kind, brief_id, created_by
    ) values (
      'cb000000-0000-4000-8000-000000000399'::uuid,
      'cb000000-0000-4000-8000-000000000101'::uuid,
      'Cross-tenant brief', 'manual_brief',
      'cb000000-0000-4000-8000-000000000202'::uuid,
      'cb000000-0000-4000-8000-000000000001'::uuid
    )
  $$,
  '23503', null,
  'a campaign cannot borrow another tenant brief'
);

select extensions.throws_ok(
  $$
    insert into public.campaigns (
      id, organization_id, title, source_kind, brief_id, opportunity_id, created_by
    ) values (
      'cb000000-0000-4000-8000-000000000398'::uuid,
      'cb000000-0000-4000-8000-000000000101'::uuid,
      'Two sources', 'manual_brief',
      'cb000000-0000-4000-8000-000000000201'::uuid,
      'cb000000-0000-4000-8000-000000000301'::uuid,
      'cb000000-0000-4000-8000-000000000001'::uuid
    )
  $$,
  '23514', null,
  'a campaign has exactly one source'
);

-- ---------------------------------------------------------------------------
-- Version creation is a worker-only, campaign-serialized write
-- ---------------------------------------------------------------------------

create temporary table campaign_state (key text primary key, value jsonb not null);
grant select, insert on campaign_state to service_role, authenticated;

set local role service_role;

insert into campaign_state (key, value)
select 'version_one', public.create_campaign_bundle_version(
  'cb000000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', 'cb000000-0000-4000-8000-000000000101',
    'campaign_id', 'cb000000-0000-4000-8000-000000000301',
    'source_snapshot_id', 'cb000000-0000-4000-8000-000000000401',
    'digest', repeat('a', 64),
    'manifest', pg_temp.campaign_manifest(
      'cb000000-0000-4000-8000-000000000301'::uuid, 'Increase weekday lunch covers'
    ),
    'total_spend_ceiling', jsonb_build_object('amountMinor', 150000, 'currency', 'AED'),
    'directions', jsonb_build_array(
      jsonb_build_object(
        'id', 'cb000000-0000-4000-8000-000000000501', 'kind', 'control',
        'name', 'House style', 'rationale', 'The current treatment.',
        'generationProfileOverride', null, 'experiment', null
      ),
      jsonb_build_object(
        'id', 'cb000000-0000-4000-8000-000000000502', 'kind', 'evidence_led',
        'name', 'Contribution led', 'rationale', 'Leads with the measured gap.',
        'generationProfileOverride', null, 'experiment', null
      ),
      jsonb_build_object(
        'id', 'cb000000-0000-4000-8000-000000000503', 'kind', 'experimental',
        'name', 'Quiet hour', 'rationale', 'Tests a different framing.',
        'generationProfileOverride', null,
        'experiment', jsonb_build_object('challengedAssumption', 'Price must lead.')
      )
    ),
    'assets', jsonb_build_array(
      jsonb_build_object(
        'id', 'cb000000-0000-4000-8000-000000000601',
        'storagePath', 'cb000000-0000-4000-8000-000000000101/cb000000-0000-4000-8000-000000000301/x/a.png',
        'contentHash', repeat('1', 64), 'mimeType', 'image/png',
        'widthPx', 1080, 'heightPx', 1080, 'truthClass', 'synthetic_generated',
        'provenance', jsonb_build_object('kind', 'generated', 'modelId', 'image-model-v1'),
        'altText', 'A plated dish on a wooden table.'
      )
    ),
    'actions', jsonb_build_array(
      jsonb_build_object(
        'id', 'cb000000-0000-4000-8000-000000000701',
        'directionId', 'cb000000-0000-4000-8000-000000000501',
        'channel', 'instagram', 'placement', 'feed_image',
        'scheduledFor', '2026-09-01T14:00:00.000Z', 'requirement', 'required',
        'spendCeiling', null
      )
    ),
    'measurement_plan', jsonb_build_object(
      'primaryMetricKey', 'contribution.incremental_gross_profit',
      'guardrailMetricKeys', jsonb_build_array('spend.total'),
      'baselineSource', 'channel economics weekday lunch',
      'baselineLookbackDays', 28, 'attributionMethod', 'observational_prepost',
      'outcomeWindowDays', 14, 'settlementDelayDays', 3, 'minimumEvidenceTier', 'computed'
    )
  )
);

reset role;

select extensions.is(
  (select (value ->> 'version')::integer from campaign_state where key = 'version_one'),
  1,
  'the first version of a campaign is version one'
);
select extensions.ok(
  (select value ->> 'parent_version_id' is null from campaign_state where key = 'version_one'),
  'the first version has no parent'
);
select extensions.is(
  (
    select count(*)::bigint from public.campaign_creative_directions
    where bundle_version_id = (select (value ->> 'bundle_version_id')::uuid from campaign_state where key = 'version_one')
  ),
  3::bigint,
  'all three directions are persisted with the version'
);
select extensions.is(
  (
    select count(*)::bigint from public.campaign_measurement_plans
    where bundle_version_id = (select (value ->> 'bundle_version_id')::uuid from campaign_state where key = 'version_one')
  ),
  1::bigint,
  'the measurement plan is registered before anything can run'
);

select extensions.throws_ok(
  format(
    $$
      insert into public.campaign_creative_directions (
        organization_id, bundle_version_id, direction_key, kind, name, rationale
      ) values (
        'cb000000-0000-4000-8000-000000000101'::uuid, %L::uuid,
        'cb000000-0000-4000-8000-000000000599'::uuid, 'control', 'Second control',
        'A duplicate control makes the reference ambiguous.'
      )
    $$,
    (select value ->> 'bundle_version_id' from campaign_state where key = 'version_one')
  ),
  '23505', null,
  'a version cannot hold two directions of the same kind'
);

select extensions.throws_ok(
  format(
    $$ update public.campaign_bundle_versions set digest = repeat('b', 64) where id = %L::uuid $$,
    (select value ->> 'bundle_version_id' from campaign_state where key = 'version_one')
  ),
  '23514', 'campaign_bundle_version_is_immutable',
  'a published version cannot be edited'
);
select extensions.throws_ok(
  format(
    $$ delete from public.campaign_bundle_versions where id = %L::uuid $$,
    (select value ->> 'bundle_version_id' from campaign_state where key = 'version_one')
  ),
  '23514', 'campaign_bundle_version_is_immutable',
  'a published version cannot be deleted'
);
select extensions.throws_ok(
  format(
    $$ update public.campaign_assets set alt_text = 'rewritten' where bundle_version_id = %L::uuid $$,
    (select value ->> 'bundle_version_id' from campaign_state where key = 'version_one')
  ),
  '23514', 'campaign_bundle_version_is_immutable',
  'an approved asset cannot be relabelled in place'
);

-- ---------------------------------------------------------------------------
-- Attestation and approval bind to one exact version and digest
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'cb000000-0000-4000-8000-000000000001';

select extensions.throws_ok(
  format(
    $$
      select public.record_campaign_visual_attestation(
        'cb000000-0000-4000-8000-000000000101'::uuid, %L::uuid, repeat('f', 64),
        'I reviewed every image.'
      )
    $$,
    (select value ->> 'bundle_version_id' from campaign_state where key = 'version_one')
  ),
  '22023', 'campaign_attestation_digest_mismatch',
  'an attestation cannot cover a digest the version does not have'
);

create temporary table campaign_attestation (id uuid);
grant select, insert on campaign_attestation to authenticated, service_role;

insert into campaign_attestation (id)
select public.record_campaign_visual_attestation(
  'cb000000-0000-4000-8000-000000000101'::uuid,
  (select (value ->> 'bundle_version_id')::uuid from campaign_state where key = 'version_one'),
  repeat('a', 64),
  'I reviewed every proposed image and none of them implies a fact we cannot support.'
);

select extensions.ok(
  (select count(*) = 1 from campaign_attestation where id is not null),
  'an operator may attest to the exact digest they read'
);

-- Two gates, proved separately. A session has no grant to attempt the write at
-- all, and the trigger refuses it even for a role that does. Testing only the
-- outer gate would leave the inner one unproven for a privileged path.
select extensions.throws_ok(
  $$
    update public.campaign_visual_attestations
    set statement = 'I take it back.'
    where organization_id = 'cb000000-0000-4000-8000-000000000101'::uuid
  $$,
  '42501', null,
  'a session holds no grant to rewrite an attestation'
);

select extensions.throws_ok(
  format(
    $$
      select public.approve_campaign_bundle(
        'cb000000-0000-4000-8000-000000000101'::uuid,
        jsonb_build_object(
          'organization_id', 'cb000000-0000-4000-8000-000000000101',
          'bundle_version_id', %L,
          'bundle_digest', repeat('b', 64),
          'attestation_id', (select id::text from campaign_attestation limit 1),
          'expires_at', '2027-01-01T00:00:00.000Z',
          'capability_grant_versions', '{}'::jsonb,
          'policy_version_ids', jsonb_build_array(),
          'action_keys', jsonb_build_array('cb000000-0000-4000-8000-000000000701'),
          'total_spend_ceiling', jsonb_build_object('amountMinor', 150000, 'currency', 'AED')
        )
      )
    $$,
    (select value ->> 'bundle_version_id' from campaign_state where key = 'version_one')
  ),
  '22023', 'campaign_approval_digest_mismatch',
  'approval refuses a digest that is not the stored one'
);

select extensions.throws_ok(
  format(
    $$
      select public.approve_campaign_bundle(
        'cb000000-0000-4000-8000-000000000101'::uuid,
        jsonb_build_object(
          'organization_id', 'cb000000-0000-4000-8000-000000000101',
          'bundle_version_id', %L,
          'bundle_digest', repeat('a', 64),
          'attestation_id', (select id::text from campaign_attestation limit 1),
          'expires_at', '2027-01-01T00:00:00.000Z',
          'capability_grant_versions', '{}'::jsonb,
          'policy_version_ids', jsonb_build_array(),
          'action_keys', jsonb_build_array(),
          'total_spend_ceiling', jsonb_build_object('amountMinor', 150000, 'currency', 'AED')
        )
      )
    $$,
    (select value ->> 'bundle_version_id' from campaign_state where key = 'version_one')
  ),
  '22023', 'campaign_approval_actions_missing',
  'approval refuses to authorize no actions at all'
);

select extensions.throws_ok(
  format(
    $$
      select public.approve_campaign_bundle(
        'cb000000-0000-4000-8000-000000000101'::uuid,
        jsonb_build_object(
          'organization_id', 'cb000000-0000-4000-8000-000000000101',
          'bundle_version_id', %L,
          'bundle_digest', repeat('a', 64),
          'attestation_id', (select id::text from campaign_attestation limit 1),
          'expires_at', '2027-01-01T00:00:00.000Z',
          'capability_grant_versions', '{}'::jsonb,
          'policy_version_ids', jsonb_build_array(),
          'action_keys', jsonb_build_array('cb000000-0000-4000-8000-000000000701'),
          'total_spend_ceiling', jsonb_build_object('amountMinor', 999999, 'currency', 'AED')
        )
      )
    $$,
    (select value ->> 'bundle_version_id' from campaign_state where key = 'version_one')
  ),
  '22023', 'campaign_approval_spend_mismatch',
  'approval refuses a ceiling the version does not carry'
);

create temporary table campaign_approval (id uuid);
grant select, insert on campaign_approval to authenticated, service_role;

insert into campaign_approval (id)
select public.approve_campaign_bundle(
  'cb000000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', 'cb000000-0000-4000-8000-000000000101',
    'bundle_version_id', (select value ->> 'bundle_version_id' from campaign_state where key = 'version_one'),
    'bundle_digest', repeat('a', 64),
    'attestation_id', (select id::text from campaign_attestation limit 1),
    'expires_at', '2027-01-01T00:00:00.000Z',
    'capability_grant_versions', '{}'::jsonb,
    'policy_version_ids', jsonb_build_array(),
    'action_keys', jsonb_build_array('cb000000-0000-4000-8000-000000000701'),
    'total_spend_ceiling', jsonb_build_object('amountMinor', 150000, 'currency', 'AED')
  )
);

select extensions.ok(
  (select count(*) = 1 from campaign_approval where id is not null),
  'an attested, exact-digest approval is accepted'
);

select extensions.is(
  (
    select state from public.campaigns
    where id = 'cb000000-0000-4000-8000-000000000301'::uuid
  ),
  'approved'::text,
  'approving the version moves the campaign to approved'
);

reset role;

select extensions.throws_ok(
  $$
    update public.campaign_visual_attestations
    set statement = 'I take it back.'
    where organization_id = 'cb000000-0000-4000-8000-000000000101'::uuid
  $$,
  '23514', 'campaign_attestation_is_append_only',
  'the trigger refuses to rewrite an attestation even for a privileged role'
);

select extensions.throws_ok(
  $$
    update public.campaign_approvals set expires_at = '2099-01-01T00:00:00.000Z'
    where organization_id = 'cb000000-0000-4000-8000-000000000101'::uuid
  $$,
  '23514', 'campaign_approval_is_append_only',
  'an approval cannot be extended after the fact'
);
select extensions.throws_ok(
  $$
    delete from public.campaign_approvals
    where organization_id = 'cb000000-0000-4000-8000-000000000101'::uuid
  $$,
  '23514', 'campaign_approval_is_append_only',
  'an approval cannot be deleted'
);

-- ---------------------------------------------------------------------------
-- A later version invalidates the approval that came before it
-- ---------------------------------------------------------------------------

set local role service_role;

insert into campaign_state (key, value)
select 'version_two', public.create_campaign_bundle_version(
  'cb000000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', 'cb000000-0000-4000-8000-000000000101',
    'campaign_id', 'cb000000-0000-4000-8000-000000000301',
    'source_snapshot_id', 'cb000000-0000-4000-8000-000000000401',
    'digest', repeat('c', 64),
    'manifest', pg_temp.campaign_manifest(
      'cb000000-0000-4000-8000-000000000301'::uuid, 'Increase weekday lunch covers, revised'
    ),
    'total_spend_ceiling', jsonb_build_object('amountMinor', 150000, 'currency', 'AED'),
    'directions', jsonb_build_array(
      jsonb_build_object(
        'id', 'cb000000-0000-4000-8000-000000000511', 'kind', 'control',
        'name', 'House style', 'rationale', 'The current treatment.',
        'generationProfileOverride', null, 'experiment', null
      )
    ),
    'assets', jsonb_build_array(),
    'actions', jsonb_build_array(),
    'measurement_plan', jsonb_build_object(
      'primaryMetricKey', 'contribution.incremental_gross_profit',
      'guardrailMetricKeys', jsonb_build_array('spend.total'),
      'baselineSource', 'channel economics weekday lunch',
      'baselineLookbackDays', 28, 'attributionMethod', 'observational_prepost',
      'outcomeWindowDays', 14, 'settlementDelayDays', 3, 'minimumEvidenceTier', 'computed'
    )
  )
);

reset role;

select extensions.is(
  (select (value ->> 'version')::integer from campaign_state where key = 'version_two'),
  2,
  'the next version increments under the campaign lock'
);
select extensions.is(
  (select value ->> 'parent_version_id' from campaign_state where key = 'version_two'),
  (select value ->> 'bundle_version_id' from campaign_state where key = 'version_one'),
  'the new version records the version it revises'
);
select extensions.is(
  (select (value ->> 'revoked_approval_count')::integer from campaign_state where key = 'version_two'),
  1,
  'publishing a new version revokes the approval of the old one'
);
select extensions.is(
  (
    select revoked_reason from public.campaign_approvals
    where organization_id = 'cb000000-0000-4000-8000-000000000101'::uuid
  ),
  'superseded_by_new_version'::text,
  'the revocation says why, rather than deleting the record'
);

set local role authenticated;
set local request.jwt.claim.sub = 'cb000000-0000-4000-8000-000000000001';

select extensions.throws_ok(
  format(
    $$
      select public.approve_campaign_bundle(
        'cb000000-0000-4000-8000-000000000101'::uuid,
        jsonb_build_object(
          'organization_id', 'cb000000-0000-4000-8000-000000000101',
          'bundle_version_id', %L,
          'bundle_digest', repeat('a', 64),
          'attestation_id', (select id::text from campaign_attestation limit 1),
          'expires_at', '2027-01-01T00:00:00.000Z',
          'capability_grant_versions', '{}'::jsonb,
          'policy_version_ids', jsonb_build_array(),
          'action_keys', jsonb_build_array('cb000000-0000-4000-8000-000000000701'),
          'total_spend_ceiling', jsonb_build_object('amountMinor', 150000, 'currency', 'AED')
        )
      )
    $$,
    (select value ->> 'bundle_version_id' from campaign_state where key = 'version_one')
  ),
  '22023', 'campaign_approval_version_superseded',
  'a superseded version cannot be approved even with its own valid attestation'
);

reset role;

-- ---------------------------------------------------------------------------
-- Tenant isolation and role boundaries
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'cb000000-0000-4000-8000-000000000002';

select extensions.is(
  (select count(*)::bigint from public.campaigns),
  1::bigint,
  'a member of tenant two sees only tenant two campaigns'
);
select extensions.is(
  (select count(*)::bigint from public.campaign_bundle_versions),
  0::bigint,
  'a member of tenant two sees no tenant one bundle versions'
);
select extensions.is(
  (select count(*)::bigint from public.campaign_approvals),
  0::bigint,
  'a member of tenant two sees no tenant one approvals'
);

select extensions.throws_ok(
  format(
    $$
      select public.record_campaign_visual_attestation(
        'cb000000-0000-4000-8000-000000000101'::uuid, %L::uuid, repeat('c', 64),
        'I am not a member here.'
      )
    $$,
    (select value ->> 'bundle_version_id' from campaign_state where key = 'version_two')
  ),
  '42501', 'campaign_attestation_forbidden',
  'a member of another tenant cannot attest'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'cb000000-0000-4000-8000-000000000003';

select extensions.is(
  (select count(*)::bigint from public.campaigns),
  1::bigint,
  'a viewer reads their own organization campaigns'
);

select extensions.throws_ok(
  format(
    $$
      select public.record_campaign_visual_attestation(
        'cb000000-0000-4000-8000-000000000101'::uuid, %L::uuid, repeat('c', 64),
        'A viewer should not be able to say this.'
      )
    $$,
    (select value ->> 'bundle_version_id' from campaign_state where key = 'version_two')
  ),
  '42501', 'campaign_attestation_forbidden',
  'a viewer cannot attest to visual truth'
);

reset role;

set local role service_role;
select extensions.throws_ok(
  $$
    select public.create_campaign_bundle_version(
      'cb000000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', 'cb000000-0000-4000-8000-000000000102',
        'campaign_id', 'cb000000-0000-4000-8000-000000000301',
        'source_snapshot_id', 'cb000000-0000-4000-8000-000000000401',
        'digest', repeat('d', 64),
        'manifest', '{}'::jsonb
      )
    )
  $$,
  '42501', 'campaign_bundle_organization_mismatch',
  'a body cannot redirect a version write to another tenant'
);
select extensions.throws_ok(
  $$
    select public.create_campaign_bundle_version(
      'cb000000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', 'cb000000-0000-4000-8000-000000000101',
        'campaign_id', 'cb000000-0000-4000-8000-000000000301',
        'source_snapshot_id', 'cb000000-0000-4000-8000-000000000402',
        'digest', repeat('d', 64),
        'manifest', pg_temp.campaign_manifest(
          'cb000000-0000-4000-8000-000000000301'::uuid, 'Cross-tenant snapshot'
        )
      )
    )
  $$,
  '42501', 'campaign_source_snapshot_not_found',
  'a version cannot pin another tenant source snapshot'
);
reset role;

-- ---------------------------------------------------------------------------
-- Audit carries identifiers and normalized state only
-- ---------------------------------------------------------------------------

select extensions.ok(
  exists (
    select 1 from public.audit_events
    where organization_id = 'cb000000-0000-4000-8000-000000000101'::uuid
      and entity_type = 'campaign_approvals'
  ),
  'an approval emits an audit event'
);

select extensions.ok(
  not exists (
    select 1 from public.audit_events
    where organization_id = 'cb000000-0000-4000-8000-000000000101'::uuid
      and entity_type in ('campaigns', 'campaign_approvals', 'campaign_visual_attestations')
      and (
        payload::text ilike '%weekday lunch%'
        or payload::text ilike '%reviewed every%'
        or payload ?| array['manifest', 'digest', 'statement', 'capability_grant_versions']
      )
  ),
  'campaign audit rows carry no manifest, digest, or operator statement'
);

select * from extensions.finish();
rollback;
