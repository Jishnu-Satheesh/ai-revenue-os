begin;

create extension if not exists pgtap with schema extensions;

select extensions.no_plan();

-- Covers `20260913140000_campaign_exact_output_launch_approval.sql`.
--
-- The rule under test: publication authority covers an exact set of reviewed
-- outputs and every term they go out under. The failure modes that matter are
-- an unreviewed variant riding along under a previously approved family, a
-- selection whose bytes moved after review, authority surviving a change of
-- terms, and approving a post quietly marking its artwork approved in the
-- Creative History library.

select extensions.has_table('public', 'campaign_launch_approvals', 'publication authority is recorded');
select extensions.has_table('public', 'campaign_launch_selections', 'and names the exact outputs it covers');

select extensions.function_privs_are(
  'public', 'approve_campaign_launch', array['uuid', 'jsonb'],
  'authenticated', array['EXECUTE'], 'a person authorizes publication through the governed writer'
);
select extensions.function_privs_are(
  'public', 'approve_campaign_launch', array['uuid', 'jsonb'],
  'service_role', array[]::text[], 'no worker authorizes a publication'
);
select extensions.function_privs_are(
  'public', 'approve_campaign_launch', array['uuid', 'jsonb'],
  'anon', array[]::text[], 'a signed-out caller authorizes nothing'
);

-- ---------------------------------------------------------------------------
-- Fixtures: one tenant, an owner who may publish, an operator who may not.
-- ---------------------------------------------------------------------------

insert into auth.users (id) values
  ('f9500000-0000-4000-8000-000000000001'::uuid),
  ('f9500000-0000-4000-8000-000000000002'::uuid),
  ('f9500000-0000-4000-8000-000000000003'::uuid);

insert into public.accounts (id, name, slug, created_by) values (
  'f95c0000-0000-4000-8000-000000000001'::uuid,
  'Launch account', 'launch-account', 'f9500000-0000-4000-8000-000000000001'::uuid
);

insert into public.organizations (
  id, name, slug, industry, country_code, base_currency, default_timezone, created_by, account_id
) values
  ('f9500000-0000-4000-8000-000000000101'::uuid, 'Launch A', 'launch-a',
   'testing', 'AE', 'AED', 'Asia/Dubai', 'f9500000-0000-4000-8000-000000000001'::uuid,
   'f95c0000-0000-4000-8000-000000000001'::uuid),
  ('f9500000-0000-4000-8000-000000000102'::uuid, 'Launch B', 'launch-b',
   'testing', 'AE', 'AED', 'Asia/Dubai', 'f9500000-0000-4000-8000-000000000002'::uuid,
   'f95c0000-0000-4000-8000-000000000001'::uuid);

insert into public.organization_memberships (organization_id, user_id, role) values
  ('f9500000-0000-4000-8000-000000000101'::uuid, 'f9500000-0000-4000-8000-000000000001'::uuid, 'owner'),
  ('f9500000-0000-4000-8000-000000000101'::uuid, 'f9500000-0000-4000-8000-000000000003'::uuid, 'operator'),
  ('f9500000-0000-4000-8000-000000000102'::uuid, 'f9500000-0000-4000-8000-000000000002'::uuid, 'owner');

insert into public.campaign_briefs (organization_id, objective, audience, offer, requested_channels, created_by)
values ('f9500000-0000-4000-8000-000000000101'::uuid, 'Lunch covers', 'Nearby workers', null,
        '{instagram}'::text[], 'f9500000-0000-4000-8000-000000000001'::uuid);

insert into public.campaigns (id, organization_id, title, source_kind, brief_id, created_by)
select 'f9500000-0000-4000-8000-000000000201'::uuid,
       'f9500000-0000-4000-8000-000000000101'::uuid,
       'Weekday lunch', 'manual_brief', brief.id,
       'f9500000-0000-4000-8000-000000000001'::uuid
from public.campaign_briefs brief
where brief.organization_id = 'f9500000-0000-4000-8000-000000000101'::uuid
limit 1;

insert into public.campaign_source_snapshots (
  id, organization_id, campaign_id, facts, brand_asset_version_ids, assertions,
  reference_slots, negative_rules, avoid_reference_version_ids
) values (
  'f9500000-0000-4000-8000-000000000501'::uuid,
  'f9500000-0000-4000-8000-000000000101'::uuid,
  'f9500000-0000-4000-8000-000000000201'::uuid,
  '{}'::jsonb, '{}'::uuid[], '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '{}'::uuid[]
);

insert into public.campaign_bundle_versions (
  id, organization_id, campaign_id, version, source_snapshot_id, manifest, digest,
  generation_profile, execution_mode, created_by
) values (
  'f9500000-0000-4000-8000-000000000601'::uuid,
  'f9500000-0000-4000-8000-000000000101'::uuid,
  'f9500000-0000-4000-8000-000000000201'::uuid,
  1,
  'f9500000-0000-4000-8000-000000000501'::uuid,
  pg_catalog.jsonb_build_object(
    'schemaVersion', 2, 'version', 1,
    'campaignId', 'f9500000-0000-4000-8000-000000000201',
    'generationProfile', 'brand_guided', 'executionMode', 'best_effort',
    'directions', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('key', 'a'),
      pg_catalog.jsonb_build_object('key', 'b'),
      pg_catalog.jsonb_build_object('key', 'c')
    ),
    'generationPolicy', pg_catalog.jsonb_build_object(
      'maxVariantsPerDirection', 2, 'maxVariantsTotal', 6,
      'policyExpiresAt', '2026-12-31T00:00:00Z'
    )
  ),
  repeat('f', 64), 'brand_guided', 'best_effort',
  'f9500000-0000-4000-8000-000000000001'::uuid
);

-- A second tenant with its own campaign and bundle, so a selection naming the
-- first tenant's output can be proven refused rather than merely unreadable.
insert into public.campaign_briefs (organization_id, objective, audience, offer, requested_channels, created_by)
values ('f9500000-0000-4000-8000-000000000102'::uuid, 'Dinner covers', 'Nearby families', null,
        '{instagram}'::text[], 'f9500000-0000-4000-8000-000000000002'::uuid);

insert into public.campaigns (id, organization_id, title, source_kind, brief_id, created_by)
select 'f9500000-0000-4000-8000-000000000202'::uuid,
       'f9500000-0000-4000-8000-000000000102'::uuid,
       'Weekend dinner', 'manual_brief', brief.id,
       'f9500000-0000-4000-8000-000000000002'::uuid
from public.campaign_briefs brief
where brief.organization_id = 'f9500000-0000-4000-8000-000000000102'::uuid
limit 1;

insert into public.campaign_source_snapshots (
  id, organization_id, campaign_id, facts, brand_asset_version_ids, assertions,
  reference_slots, negative_rules, avoid_reference_version_ids
) values (
  'f9500000-0000-4000-8000-000000000502'::uuid,
  'f9500000-0000-4000-8000-000000000102'::uuid,
  'f9500000-0000-4000-8000-000000000202'::uuid,
  '{}'::jsonb, '{}'::uuid[], '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '{}'::uuid[]
);

insert into public.campaign_bundle_versions (
  id, organization_id, campaign_id, version, source_snapshot_id, manifest, digest,
  generation_profile, execution_mode, created_by
) values (
  'f9500000-0000-4000-8000-000000000602'::uuid,
  'f9500000-0000-4000-8000-000000000102'::uuid,
  'f9500000-0000-4000-8000-000000000202'::uuid,
  1,
  'f9500000-0000-4000-8000-000000000502'::uuid,
  pg_catalog.jsonb_build_object(
    'schemaVersion', 2, 'version', 1,
    'campaignId', 'f9500000-0000-4000-8000-000000000202',
    'generationProfile', 'brand_guided', 'executionMode', 'best_effort',
    'directions', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('key', 'a'),
      pg_catalog.jsonb_build_object('key', 'b'),
      pg_catalog.jsonb_build_object('key', 'c')
    ),
    'generationPolicy', pg_catalog.jsonb_build_object(
      'maxVariantsPerDirection', 2, 'maxVariantsTotal', 6,
      'policyExpiresAt', '2026-12-31T00:00:00Z'
    )
  ),
  repeat('e', 64), 'brand_guided', 'best_effort',
  'f9500000-0000-4000-8000-000000000002'::uuid
);

create temporary table launch_state (key text primary key, value jsonb not null);
grant select, insert, update on launch_state to service_role, authenticated;

-- Two finished outputs: one that will be reviewed, one that never is.
set local role service_role;

insert into launch_state (key, value)
select 'reviewed', public.record_campaign_deliverable_version(
  'f9500000-0000-4000-8000-000000000101'::uuid,
  pg_catalog.jsonb_build_object(
    'campaign_id', 'f9500000-0000-4000-8000-000000000201',
    'channel', 'instagram', 'placement', 'feed', 'language', 'en', 'format', 'feed',
    'bundle_version_id', 'f9500000-0000-4000-8000-000000000601',
    'direction_key', 'f9500000-0000-4000-8000-000000000301',
    'source_kind', 'final_image',
    'final_asset_id', 'f9500000-0000-4000-8000-000000000401',
    'copy', pg_catalog.jsonb_build_object('caption', 'Lunch is on.'),
    'render_inputs', pg_catalog.jsonb_build_object('templateVersion', 3),
    'render_digest', 'digest-one', 'content_hash', repeat('a', 64)
  )
);

-- A second variant, produced under the same approved generation cap. Nobody
-- reviews this one; it must never be publishable on the family's authority.
insert into launch_state (key, value)
select 'unreviewed', public.record_campaign_deliverable_version(
  'f9500000-0000-4000-8000-000000000101'::uuid,
  pg_catalog.jsonb_build_object(
    'campaign_id', 'f9500000-0000-4000-8000-000000000201',
    'channel', 'instagram', 'placement', 'story', 'language', 'en', 'format', 'story',
    'bundle_version_id', 'f9500000-0000-4000-8000-000000000601',
    'direction_key', 'f9500000-0000-4000-8000-000000000301',
    'source_kind', 'final_image',
    'final_asset_id', 'f9500000-0000-4000-8000-000000000402',
    'copy', pg_catalog.jsonb_build_object('caption', 'Lunch is on.'),
    'render_inputs', pg_catalog.jsonb_build_object('templateVersion', 3),
    'render_digest', 'digest-two', 'content_hash', repeat('b', 64)
  )
);

set local role authenticated;
set local request.jwt.claim.sub = 'f9500000-0000-4000-8000-000000000001';

insert into launch_state (key, value)
select 'review', public.review_campaign_deliverable_version(
  'f9500000-0000-4000-8000-000000000101'::uuid,
  pg_catalog.jsonb_build_object(
    'deliverable_version_id',
      (select value ->> 'deliverable_version_id' from launch_state where key = 'reviewed'),
    'content_hash', repeat('a', 64),
    'decision', 'approved', 'idempotency_key', 'owner-reviews-11'
  )
);

-- ---------------------------------------------------------------------------
-- An unreviewed variant cannot ride along.
-- ---------------------------------------------------------------------------

select extensions.throws_ok(
  format(
    $$select public.approve_campaign_launch(
        'f9500000-0000-4000-8000-000000000101'::uuid,
        pg_catalog.jsonb_build_object(
          'campaign_id', 'f9500000-0000-4000-8000-000000000201',
          'bundle_version_id', 'f9500000-0000-4000-8000-000000000601',
          'manifest', '{}'::jsonb, 'launch_digest', %L,
          'idempotency_key', 'unreviewed-rides-11',
          'selections', pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object('deliverable_version_id', %L, 'content_hash', %L)
          )
        ))$$,
    repeat('1', 64),
    (select value ->> 'deliverable_version_id' from launch_state where key = 'unreviewed'),
    repeat('b', 64)
  ),
  '22023',
  'campaign_launch_selection_unreviewed',
  'an unreviewed later variant cannot publish on its family''s approval'
);

-- ---------------------------------------------------------------------------
-- The reviewed output can.
-- ---------------------------------------------------------------------------

insert into launch_state (key, value)
select 'launch', public.approve_campaign_launch(
  'f9500000-0000-4000-8000-000000000101'::uuid,
  pg_catalog.jsonb_build_object(
    'campaign_id', 'f9500000-0000-4000-8000-000000000201',
    'bundle_version_id', 'f9500000-0000-4000-8000-000000000601',
    'manifest', pg_catalog.jsonb_build_object('schemaVersion', 1),
    'launch_digest', repeat('2', 64),
    'idempotency_key', 'owner-launches-11',
    'selections', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'deliverable_version_id',
          (select value ->> 'deliverable_version_id' from launch_state where key = 'reviewed'),
        'content_hash', repeat('a', 64)
      )
    )
  )
);

select extensions.is(
  (select value ->> 'outcome' from launch_state where key = 'launch'),
  'saved',
  'a reviewed output can be authorized for publication'
);

select extensions.is(
  (select count(*)::int from public.campaign_launch_selections
    where launch_approval_id
      = (select (value ->> 'launch_approval_id')::uuid from launch_state where key = 'launch')),
  1,
  'and the authority names exactly the output it covers'
);

-- Approving a post to publish must NOT mark its artwork approved as a reusable
-- reference. The two are different questions with different consequences.
select extensions.is(
  (select count(*)::int from public.creative_item_reviews
    where organization_id = 'f9500000-0000-4000-8000-000000000101'::uuid),
  0,
  'authorizing a publication writes no Creative History verdict'
);

-- A second identical request replays rather than authorizing twice.
insert into launch_state (key, value)
select 'launch_again', public.approve_campaign_launch(
  'f9500000-0000-4000-8000-000000000101'::uuid,
  pg_catalog.jsonb_build_object(
    'campaign_id', 'f9500000-0000-4000-8000-000000000201',
    'bundle_version_id', 'f9500000-0000-4000-8000-000000000601',
    'manifest', pg_catalog.jsonb_build_object('schemaVersion', 1),
    'launch_digest', repeat('2', 64),
    'idempotency_key', 'owner-launches-11',
    'selections', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'deliverable_version_id',
          (select value ->> 'deliverable_version_id' from launch_state where key = 'reviewed'),
        'content_hash', repeat('a', 64)
      )
    )
  )
);

select extensions.is(
  (select value ->> 'outcome' from launch_state where key = 'launch_again'),
  'replayed',
  'clicking publish twice replays the committed authority'
);
select extensions.is(
  (select count(*)::int from public.campaign_launch_approvals
    where organization_id = 'f9500000-0000-4000-8000-000000000101'::uuid),
  1,
  'and leaves exactly one authority on the record'
);

-- Different terms under a used key is a conflict, never an overwrite.
select extensions.throws_ok(
  format(
    $$select public.approve_campaign_launch(
        'f9500000-0000-4000-8000-000000000101'::uuid,
        pg_catalog.jsonb_build_object(
          'campaign_id', 'f9500000-0000-4000-8000-000000000201',
          'bundle_version_id', 'f9500000-0000-4000-8000-000000000601',
          'manifest', '{}'::jsonb, 'launch_digest', %L,
          'idempotency_key', 'owner-launches-11',
          'selections', pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object('deliverable_version_id', %L, 'content_hash', %L)
          )
        ))$$,
    repeat('3', 64),
    (select value ->> 'deliverable_version_id' from launch_state where key = 'reviewed'),
    repeat('a', 64)
  ),
  '23505',
  'campaign_launch_idempotency_conflict',
  'the same key carrying different terms is a conflict, never an overwrite'
);

-- ---------------------------------------------------------------------------
-- A selection whose bytes moved is refused.
-- ---------------------------------------------------------------------------

select extensions.throws_ok(
  format(
    $$select public.approve_campaign_launch(
        'f9500000-0000-4000-8000-000000000101'::uuid,
        pg_catalog.jsonb_build_object(
          'campaign_id', 'f9500000-0000-4000-8000-000000000201',
          'bundle_version_id', 'f9500000-0000-4000-8000-000000000601',
          'manifest', '{}'::jsonb, 'launch_digest', %L,
          'idempotency_key', 'moved-bytes-11',
          'selections', pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object('deliverable_version_id', %L, 'content_hash', %L)
          )
        ))$$,
    repeat('4', 64),
    (select value ->> 'deliverable_version_id' from launch_state where key = 'reviewed'),
    repeat('9', 64)
  ),
  '22023',
  'campaign_launch_content_changed',
  'a selection naming bytes the output no longer has is refused'
);

-- ---------------------------------------------------------------------------
-- A re-rendered output is refused: a later variant invalidates the old review.
-- ---------------------------------------------------------------------------

set local role service_role;

insert into launch_state (key, value)
select 'superseding', public.record_campaign_deliverable_version(
  'f9500000-0000-4000-8000-000000000101'::uuid,
  pg_catalog.jsonb_build_object(
    'campaign_id', 'f9500000-0000-4000-8000-000000000201',
    'channel', 'instagram', 'placement', 'feed', 'language', 'en', 'format', 'feed',
    'bundle_version_id', 'f9500000-0000-4000-8000-000000000601',
    'direction_key', 'f9500000-0000-4000-8000-000000000301',
    'source_kind', 'final_image',
    'final_asset_id', 'f9500000-0000-4000-8000-000000000403',
    'copy', pg_catalog.jsonb_build_object('caption', 'Lunch is on, again.'),
    'render_inputs', pg_catalog.jsonb_build_object('templateVersion', 4),
    'render_digest', 'digest-three', 'content_hash', repeat('d', 64)
  )
);

set local role authenticated;
set local request.jwt.claim.sub = 'f9500000-0000-4000-8000-000000000001';

select extensions.throws_ok(
  format(
    $$select public.approve_campaign_launch(
        'f9500000-0000-4000-8000-000000000101'::uuid,
        pg_catalog.jsonb_build_object(
          'campaign_id', 'f9500000-0000-4000-8000-000000000201',
          'bundle_version_id', 'f9500000-0000-4000-8000-000000000601',
          'manifest', '{}'::jsonb, 'launch_digest', %L,
          'idempotency_key', 'stale-digest-11',
          'selections', pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object('deliverable_version_id', %L, 'content_hash', %L)
          )
        ))$$,
    repeat('7', 64),
    (select value ->> 'deliverable_version_id' from launch_state where key = 'reviewed'),
    repeat('a', 64)
  ),
  '22023',
  'campaign_launch_selection_superseded',
  'a re-rendered output can no longer launch on its earlier review; it needs its own'
);

-- An empty selection authorizes nothing and is refused as such.
select extensions.throws_ok(
  format(
    $$select public.approve_campaign_launch(
        'f9500000-0000-4000-8000-000000000101'::uuid,
        pg_catalog.jsonb_build_object(
          'campaign_id', 'f9500000-0000-4000-8000-000000000201',
          'bundle_version_id', 'f9500000-0000-4000-8000-000000000601',
          'manifest', '{}'::jsonb, 'launch_digest', %L,
          'idempotency_key', 'empty-launch-11',
          'selections', '[]'::jsonb
        ))$$,
    repeat('5', 64)
  ),
  '22023',
  'campaign_launch_empty_selection',
  'an authority covering nothing is refused rather than saved as a no-op'
);

-- ---------------------------------------------------------------------------
-- An operator may not authorize a publication.
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = 'f9500000-0000-4000-8000-000000000003';

select extensions.throws_ok(
  format(
    $$select public.approve_campaign_launch(
        'f9500000-0000-4000-8000-000000000101'::uuid,
        pg_catalog.jsonb_build_object(
          'campaign_id', 'f9500000-0000-4000-8000-000000000201',
          'bundle_version_id', 'f9500000-0000-4000-8000-000000000601',
          'manifest', '{}'::jsonb, 'launch_digest', %L,
          'idempotency_key', 'operator-publishes-11',
          'selections', pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object('deliverable_version_id', %L, 'content_hash', %L)
          )
        ))$$,
    repeat('6', 64),
    (select value ->> 'deliverable_version_id' from launch_state where key = 'reviewed'),
    repeat('a', 64)
  ),
  '42501',
  'campaign_launch_forbidden',
  'an operator may approve a version but may not authorize publishing it'
);

-- ---------------------------------------------------------------------------
-- Authority cannot be edited into covering something else.
-- ---------------------------------------------------------------------------

set local role postgres;

select extensions.throws_ok(
  $$update public.campaign_launch_approvals set launch_digest = repeat('7', 64)$$,
  '42501',
  'campaign_launch_terms_immutable',
  'the terms an authority was given for cannot be edited afterwards'
);

select extensions.throws_ok(
  $$update public.campaign_launch_selections set content_hash = repeat('8', 64)$$,
  '42501',
  'campaign_launch_selection_immutable',
  'nor can the outputs it covers be swapped'
);

select extensions.throws_ok(
  $$delete from public.campaign_launch_approvals$$,
  '42501',
  'campaign_launch_terms_immutable',
  'nor can an authority be deleted to hide what was published'
);

-- Superseding is allowed, because that is a state change rather than a rewrite.
select extensions.lives_ok(
  $$update public.campaign_launch_approvals set state = 'revoked'$$,
  'authority may be revoked, which ends its power without erasing the record'
);

-- ---------------------------------------------------------------------------
-- Tenancy.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'f9500000-0000-4000-8000-000000000002';

select extensions.is(
  (select count(*)::int from public.campaign_launch_approvals
    where organization_id = 'f9500000-0000-4000-8000-000000000101'::uuid),
  0,
  'another tenant cannot see this organization''s publication authority'
);

-- A selection naming another tenant's output is refused as if it were not
-- there at all. Answering "foreign" instead of "missing" would let somebody
-- confirm that a particular deliverable exists somewhere else.
select extensions.throws_ok(
  format(
    $$select public.approve_campaign_launch(
        'f9500000-0000-4000-8000-000000000102'::uuid,
        pg_catalog.jsonb_build_object(
          'campaign_id', 'f9500000-0000-4000-8000-000000000202',
          'bundle_version_id', 'f9500000-0000-4000-8000-000000000602',
          'manifest', '{}'::jsonb, 'launch_digest', %L,
          'idempotency_key', 'foreign-output-11',
          'selections', pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object('deliverable_version_id', %L, 'content_hash', %L)
          )
        ))$$,
    repeat('9', 64),
    (select value ->> 'deliverable_version_id' from launch_state where key = 'reviewed'),
    repeat('a', 64)
  ),
  'P0002',
  'campaign_launch_selection_not_found',
  'a selection naming another tenant''s output is refused like a missing one'
);

select * from extensions.finish();

rollback;
