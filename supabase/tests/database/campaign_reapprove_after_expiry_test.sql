begin;

create extension if not exists pgtap with schema extensions;

select extensions.no_plan();

-- Covers `20260917160000_campaign_reapprove_after_expiry.sql`.
--
-- The rule under test: an expired approval that was never revoked must not
-- occupy the version's single live slot forever. Re-approval retires the
-- dead rows and records the new one; a still-live approval keeps blocking,
-- so authority that has not lapsed can never be replaced by a second one.

insert into auth.users (id) values
  ('f9600000-0000-4000-8000-000000000001'::uuid);

insert into public.accounts (id, name, slug, created_by) values (
  'f96c0000-0000-4000-8000-000000000001'::uuid,
  'Reapprove account', 'reapprove-account', 'f9600000-0000-4000-8000-000000000001'::uuid
);

insert into public.organizations (
  id, name, slug, industry, country_code, base_currency, default_timezone, created_by, account_id
) values (
  'f9600000-0000-4000-8000-000000000101'::uuid, 'Reapprove A', 'reapprove-a',
  'testing', 'AE', 'AED', 'Asia/Dubai', 'f9600000-0000-4000-8000-000000000001'::uuid,
  'f96c0000-0000-4000-8000-000000000001'::uuid
);

insert into public.organization_memberships (organization_id, user_id, role) values
  ('f9600000-0000-4000-8000-000000000101'::uuid, 'f9600000-0000-4000-8000-000000000001'::uuid, 'owner');

insert into public.campaign_briefs (organization_id, objective, audience, offer, requested_channels, created_by)
values ('f9600000-0000-4000-8000-000000000101'::uuid, 'Lunch covers', 'Nearby workers', null,
        '{instagram}'::text[], 'f9600000-0000-4000-8000-000000000001'::uuid);

insert into public.campaigns (id, organization_id, title, source_kind, brief_id, created_by)
select 'f9600000-0000-4000-8000-000000000201'::uuid,
       'f9600000-0000-4000-8000-000000000101'::uuid,
       'Weekday lunch', 'manual_brief', brief.id,
       'f9600000-0000-4000-8000-000000000001'::uuid
from public.campaign_briefs brief
where brief.organization_id = 'f9600000-0000-4000-8000-000000000101'::uuid
limit 1;

insert into public.campaign_source_snapshots (
  id, organization_id, campaign_id, facts, brand_asset_version_ids, assertions,
  reference_slots, negative_rules, avoid_reference_version_ids
) values (
  'f9600000-0000-4000-8000-000000000501'::uuid,
  'f9600000-0000-4000-8000-000000000101'::uuid,
  'f9600000-0000-4000-8000-000000000201'::uuid,
  '{}'::jsonb, '{}'::uuid[], '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '{}'::uuid[]
);

insert into public.campaign_bundle_versions (
  id, organization_id, campaign_id, version, source_snapshot_id, manifest, digest,
  generation_profile, execution_mode, total_spend_ceiling_minor, spend_currency, created_by
) values (
  'f9600000-0000-4000-8000-000000000601'::uuid,
  'f9600000-0000-4000-8000-000000000101'::uuid,
  'f9600000-0000-4000-8000-000000000201'::uuid,
  1,
  'f9600000-0000-4000-8000-000000000501'::uuid,
  pg_catalog.jsonb_build_object(
    'schemaVersion', 2, 'version', 1,
    'campaignId', 'f9600000-0000-4000-8000-000000000201',
    'generationPolicy', pg_catalog.jsonb_build_object(
      'maxVariantsPerDirection', 2, 'maxVariantsTotal', 6,
      'policyExpiresAt', '2026-12-31T00:00:00Z'
    )
  ),
  repeat('e', 64), 'brand_guided', 'best_effort', 0, 'AED',
  'f9600000-0000-4000-8000-000000000001'::uuid
);

insert into public.campaign_creative_directions (
  organization_id, bundle_version_id, direction_key, kind, name, rationale
) values (
  'f9600000-0000-4000-8000-000000000101'::uuid,
  'f9600000-0000-4000-8000-000000000601'::uuid,
  'f9600000-0000-4000-8000-000000000701'::uuid,
  'control', 'House style', 'The reference treatment.'
);

insert into public.campaign_channel_actions (
  organization_id, bundle_version_id, action_key, direction_key, channel, placement,
  scheduled_for, requirement
) values (
  'f9600000-0000-4000-8000-000000000101'::uuid,
  'f9600000-0000-4000-8000-000000000601'::uuid,
  'f9600000-0000-4000-8000-000000000702'::uuid,
  'f9600000-0000-4000-8000-000000000701'::uuid,
  'instagram', 'feed_image', pg_catalog.now() - interval '1 hour', 'required'
);

insert into public.campaign_visual_attestations (
  id, organization_id, campaign_id, bundle_version_id, bundle_digest, attested_by, statement
) values (
  'f9600000-0000-4000-8000-000000000801'::uuid,
  'f9600000-0000-4000-8000-000000000101'::uuid,
  'f9600000-0000-4000-8000-000000000201'::uuid,
  'f9600000-0000-4000-8000-000000000601'::uuid,
  repeat('e', 64), 'f9600000-0000-4000-8000-000000000001'::uuid,
  'I reviewed every proposed image.'
);

-- A legacy expired approval, never revoked: exactly the row that used to
-- occupy the version's live slot forever.
insert into public.campaign_approvals (
  id, organization_id, campaign_id, bundle_version_id, bundle_digest, attestation_id,
  approved_by, approved_at, expires_at, capability_grant_versions, policy_version_ids,
  action_keys, total_spend_ceiling_minor, spend_currency
) values (
  'f9600000-0000-4000-8000-000000000901'::uuid,
  'f9600000-0000-4000-8000-000000000101'::uuid,
  'f9600000-0000-4000-8000-000000000201'::uuid,
  'f9600000-0000-4000-8000-000000000601'::uuid,
  repeat('e', 64),
  'f9600000-0000-4000-8000-000000000801'::uuid,
  'f9600000-0000-4000-8000-000000000001'::uuid,
  pg_catalog.now() - interval '30 days', pg_catalog.now() - interval '1 day',
  '{}'::jsonb, '{}'::uuid[],
  array['f9600000-0000-4000-8000-000000000702'::uuid], 0, 'AED'
);

set local role authenticated;
set local request.jwt.claim.sub = 'f9600000-0000-4000-8000-000000000001';

-- Re-approval retires the dead row and records the new authority.
select extensions.lives_ok(
  $$
    select public.approve_campaign_bundle(
      'f9600000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', 'f9600000-0000-4000-8000-000000000101',
        'bundle_version_id', 'f9600000-0000-4000-8000-000000000601',
        'bundle_digest', repeat('e', 64),
        'attestation_id', 'f9600000-0000-4000-8000-000000000801',
        'expires_at', '2027-01-01T00:00:00.000Z',
        'capability_grant_versions', '{}'::jsonb,
        'policy_version_ids', jsonb_build_array(),
        'action_keys', jsonb_build_array('f9600000-0000-4000-8000-000000000702'),
        'total_spend_ceiling', jsonb_build_object('amountMinor', 0, 'currency', 'AED')
      )
    )
  $$,
  're-approval after expiry succeeds instead of dying on the live-slot index'
);

select extensions.is(
  (select revoked_at is not null from public.campaign_approvals
   where id = 'f9600000-0000-4000-8000-000000000901'::uuid),
  true,
  'and the expired row is retired rather than deleted'
);

select extensions.is(
  (select count(*)::integer from public.campaign_approvals
   where organization_id = 'f9600000-0000-4000-8000-000000000101'::uuid
     and bundle_version_id = 'f9600000-0000-4000-8000-000000000601'::uuid
     and revoked_at is null),
  1,
  'and exactly one live approval remains'
);

-- A second approval while one is live stays refused: expiry retires the
-- dead, never replaces the living.
select extensions.throws_ok(
  $$
    select public.approve_campaign_bundle(
      'f9600000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', 'f9600000-0000-4000-8000-000000000101',
        'bundle_version_id', 'f9600000-0000-4000-8000-000000000601',
        'bundle_digest', repeat('e', 64),
        'attestation_id', 'f9600000-0000-4000-8000-000000000801',
        'expires_at', '2027-01-01T00:00:00.000Z',
        'capability_grant_versions', '{}'::jsonb,
        'policy_version_ids', jsonb_build_array(),
        'action_keys', jsonb_build_array('f9600000-0000-4000-8000-000000000702'),
        'total_spend_ceiling', jsonb_build_object('amountMinor', 0, 'currency', 'AED')
      )
    )
  $$,
  '22023', 'campaign_approval_already_live',
  'approving a version that already has live authority is refused by name'
);

select * from extensions.finish();

rollback;
