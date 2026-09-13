begin;

create extension if not exists pgtap with schema extensions;

select extensions.no_plan();

-- Covers `20260913130000_campaign_finished_deliverables.sql`.
--
-- The rule under test is the second approval gate: nothing publishes without a
-- review of the EXACT finished bytes. The failure modes that matter are an
-- approval surviving a re-render, a new version inheriting the old approval, a
-- worker reviewing on a person's behalf, and a review being edited afterwards.

select extensions.has_table('public', 'campaign_deliverables', 'a deliverable has a stable identity');
select extensions.has_table('public', 'campaign_deliverable_versions', 'each finished output is its own immutable row');
select extensions.has_table('public', 'campaign_deliverable_reviews', 'reviews are recorded, not implied');

select extensions.function_privs_are(
  'public', 'review_campaign_deliverable_version', array['uuid', 'jsonb'],
  'authenticated', array['EXECUTE'], 'a person reviews through the governed writer'
);
select extensions.function_privs_are(
  'public', 'review_campaign_deliverable_version', array['uuid', 'jsonb'],
  'service_role', array[]::text[],
  'no worker reviews a finished output on a person''s behalf'
);
select extensions.function_privs_are(
  'public', 'record_campaign_deliverable_version', array['uuid', 'jsonb'],
  'authenticated', array[]::text[],
  'a browser session does not record finished renders directly'
);
select extensions.function_privs_are(
  'public', 'record_campaign_deliverable_version', array['uuid', 'jsonb'],
  'service_role', array['EXECUTE'], 'the render worker records what it produced'
);

select extensions.ok(
  not exists (
    select 1
    from pg_catalog.pg_proc proc
    join pg_catalog.pg_namespace space on space.oid = proc.pronamespace
    where space.nspname = 'public'
      and proc.proname in (
        'record_campaign_deliverable_version', 'review_campaign_deliverable_version'
      )
      and (not proc.prosecdef or proc.proconfig is null)
  ),
  'both deliverable writers are security definer with an explicit search path'
);

-- ---------------------------------------------------------------------------
-- Fixtures: one tenant with an owner, plus a second tenant to be kept out.
-- ---------------------------------------------------------------------------

insert into auth.users (id) values
  ('e9400000-0000-4000-8000-000000000001'::uuid),
  ('e9400000-0000-4000-8000-000000000002'::uuid);

insert into public.accounts (id, name, slug, created_by) values (
  'e94c0000-0000-4000-8000-000000000001'::uuid,
  'Deliverable account', 'deliverable-account', 'e9400000-0000-4000-8000-000000000001'::uuid
);

insert into public.organizations (
  id, name, slug, industry, country_code, base_currency, default_timezone, created_by, account_id
) values
  ('e9400000-0000-4000-8000-000000000101'::uuid, 'Deliverable A', 'deliverable-a',
   'testing', 'AE', 'AED', 'Asia/Dubai', 'e9400000-0000-4000-8000-000000000001'::uuid,
   'e94c0000-0000-4000-8000-000000000001'::uuid),
  ('e9400000-0000-4000-8000-000000000102'::uuid, 'Deliverable B', 'deliverable-b',
   'testing', 'AE', 'AED', 'Asia/Dubai', 'e9400000-0000-4000-8000-000000000002'::uuid,
   'e94c0000-0000-4000-8000-000000000001'::uuid);

insert into public.organization_memberships (organization_id, user_id, role) values
  ('e9400000-0000-4000-8000-000000000101'::uuid, 'e9400000-0000-4000-8000-000000000001'::uuid, 'owner'),
  ('e9400000-0000-4000-8000-000000000102'::uuid, 'e9400000-0000-4000-8000-000000000002'::uuid, 'owner');

insert into public.campaign_briefs (organization_id, objective, audience, offer, requested_channels, created_by)
values ('e9400000-0000-4000-8000-000000000101'::uuid, 'Lunch covers', 'Nearby workers', null,
        '{instagram}'::text[], 'e9400000-0000-4000-8000-000000000001'::uuid);

insert into public.campaigns (id, organization_id, title, source_kind, brief_id, created_by)
select 'e9400000-0000-4000-8000-000000000201'::uuid,
       'e9400000-0000-4000-8000-000000000101'::uuid,
       'Weekday lunch', 'manual_brief', brief.id,
       'e9400000-0000-4000-8000-000000000001'::uuid
from public.campaign_briefs brief
where brief.organization_id = 'e9400000-0000-4000-8000-000000000101'::uuid
limit 1;

-- A finished output binds to the exact bundle version whose approval it was
-- prepared under, so the fixture builds a real one rather than weakening that
-- column to nullable for the sake of a test.
insert into public.campaign_source_snapshots (
  id, organization_id, campaign_id, facts, brand_asset_version_ids, assertions,
  reference_slots, negative_rules, avoid_reference_version_ids
) values (
  'e9400000-0000-4000-8000-000000000501'::uuid,
  'e9400000-0000-4000-8000-000000000101'::uuid,
  'e9400000-0000-4000-8000-000000000201'::uuid,
  '{}'::jsonb, '{}'::uuid[], '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '{}'::uuid[]
);

insert into public.campaign_bundle_versions (
  id, organization_id, campaign_id, version, source_snapshot_id, manifest, digest,
  generation_profile, execution_mode, created_by
) values (
  'e9400000-0000-4000-8000-000000000601'::uuid,
  'e9400000-0000-4000-8000-000000000101'::uuid,
  'e9400000-0000-4000-8000-000000000201'::uuid,
  1,
  'e9400000-0000-4000-8000-000000000501'::uuid,
  pg_catalog.jsonb_build_object(
    'schemaVersion', 2,
    'version', 1,
    'campaignId', 'e9400000-0000-4000-8000-000000000201',
    'generationProfile', 'brand_guided',
    'executionMode', 'best_effort',
    'directions', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('key', 'a'),
      pg_catalog.jsonb_build_object('key', 'b'),
      pg_catalog.jsonb_build_object('key', 'c')
    ),
    'generationPolicy', pg_catalog.jsonb_build_object(
      'maxVariantsPerDirection', 2,
      'maxVariantsTotal', 6,
      'policyExpiresAt', '2026-12-31T00:00:00Z'
    )
  ),
  repeat('f', 64),
  'brand_guided', 'best_effort',
  'e9400000-0000-4000-8000-000000000001'::uuid
);

create temporary table deliverable_state (key text primary key, value jsonb not null);
grant select, insert, update on deliverable_state to service_role, authenticated;

-- ---------------------------------------------------------------------------
-- The worker records a finished output.
-- ---------------------------------------------------------------------------

set local role service_role;

insert into deliverable_state (key, value)
select 'v1', public.record_campaign_deliverable_version(
  'e9400000-0000-4000-8000-000000000101'::uuid,
  pg_catalog.jsonb_build_object(
    'campaign_id', 'e9400000-0000-4000-8000-000000000201',
    'channel', 'instagram', 'placement', 'feed', 'language', 'en', 'format', 'feed',
    'bundle_version_id', 'e9400000-0000-4000-8000-000000000601',
    'direction_key', 'e9400000-0000-4000-8000-000000000301',
    'source_kind', 'final_image',
    'final_asset_id', 'e9400000-0000-4000-8000-000000000401',
    'copy', pg_catalog.jsonb_build_object('caption', 'Lunch is on.'),
    'render_inputs', pg_catalog.jsonb_build_object('templateVersion', 3),
    'render_digest', 'digest-one',
    'content_hash', repeat('a', 64)
  )
);

select extensions.is(
  (select value ->> 'outcome' from deliverable_state where key = 'v1'),
  'saved',
  'the render worker records a finished output'
);
select extensions.is(
  (select (value ->> 'version')::int from deliverable_state where key = 'v1'),
  1,
  'the first finished output is version one'
);

select extensions.is(
  (select state from public.campaign_deliverables
    where id = (select (value ->> 'deliverable_id')::uuid from deliverable_state where key = 'v1')),
  'ready_for_review',
  'a freshly recorded output needs review, and is not publishable yet'
);

-- An identical retry reuses rather than paying to make the same picture twice.
insert into deliverable_state (key, value)
select 'v1_again', public.record_campaign_deliverable_version(
  'e9400000-0000-4000-8000-000000000101'::uuid,
  pg_catalog.jsonb_build_object(
    'campaign_id', 'e9400000-0000-4000-8000-000000000201',
    'channel', 'instagram', 'placement', 'feed', 'language', 'en', 'format', 'feed',
    'bundle_version_id', 'e9400000-0000-4000-8000-000000000601',
    'direction_key', 'e9400000-0000-4000-8000-000000000301',
    'source_kind', 'final_image',
    'final_asset_id', 'e9400000-0000-4000-8000-000000000401',
    'copy', pg_catalog.jsonb_build_object('caption', 'Lunch is on.'),
    'render_inputs', pg_catalog.jsonb_build_object('templateVersion', 3),
    'render_digest', 'digest-one',
    'content_hash', repeat('a', 64)
  )
);

select extensions.is(
  (select value ->> 'outcome' from deliverable_state where key = 'v1_again'),
  'replayed',
  'an identical retry reuses the recorded output instead of making a second'
);
select extensions.is(
  (select count(*)::int from public.campaign_deliverable_versions
    where organization_id = 'e9400000-0000-4000-8000-000000000101'::uuid),
  1,
  'and leaves exactly one finished version'
);

-- ---------------------------------------------------------------------------
-- A worker cannot review what it produced.
-- ---------------------------------------------------------------------------

select extensions.throws_ok(
  format(
    $$select public.review_campaign_deliverable_version(
        'e9400000-0000-4000-8000-000000000101'::uuid,
        pg_catalog.jsonb_build_object(
          'deliverable_version_id', %L, 'content_hash', %L,
          'decision', 'approved', 'idempotency_key', 'worker-approves-11'
        ))$$,
    (select value ->> 'deliverable_version_id' from deliverable_state where key = 'v1'),
    repeat('a', 64)
  ),
  '42501',
  'permission denied for function review_campaign_deliverable_version',
  'a worker cannot approve the output it just produced'
);

-- ---------------------------------------------------------------------------
-- A person reviews the exact bytes.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'e9400000-0000-4000-8000-000000000001';

-- The wrong hash is refused even though the version id is right.
select extensions.throws_ok(
  format(
    $$select public.review_campaign_deliverable_version(
        'e9400000-0000-4000-8000-000000000101'::uuid,
        pg_catalog.jsonb_build_object(
          'deliverable_version_id', %L, 'content_hash', %L,
          'decision', 'approved', 'idempotency_key', 'wrong-hash-11'
        ))$$,
    (select value ->> 'deliverable_version_id' from deliverable_state where key = 'v1'),
    repeat('b', 64)
  ),
  '22023',
  'campaign_deliverable_content_changed',
  'approving the right row but the wrong bytes is refused'
);

insert into deliverable_state (key, value)
select 'approval', public.review_campaign_deliverable_version(
  'e9400000-0000-4000-8000-000000000101'::uuid,
  pg_catalog.jsonb_build_object(
    'deliverable_version_id',
      (select value ->> 'deliverable_version_id' from deliverable_state where key = 'v1'),
    'content_hash', repeat('a', 64),
    'decision', 'approved',
    'idempotency_key', 'owner-approves-11'
  )
);

select extensions.is(
  (select value ->> 'outcome' from deliverable_state where key = 'approval'),
  'saved',
  'a person approves the exact finished output'
);
select extensions.is(
  (select state from public.campaign_deliverables
    where id = (select (value ->> 'deliverable_id')::uuid from deliverable_state where key = 'v1')),
  'approved',
  'and the deliverable reports that it is approved'
);

select extensions.is(
  (select actor_id from public.campaign_deliverable_reviews
    where id = (select (value ->> 'review_id')::uuid from deliverable_state where key = 'approval')),
  'e9400000-0000-4000-8000-000000000001'::uuid,
  'the reviewer is taken from the session, not from the request'
);

-- A double click replays rather than recording a second approval.
insert into deliverable_state (key, value)
select 'approval_again', public.review_campaign_deliverable_version(
  'e9400000-0000-4000-8000-000000000101'::uuid,
  pg_catalog.jsonb_build_object(
    'deliverable_version_id',
      (select value ->> 'deliverable_version_id' from deliverable_state where key = 'v1'),
    'content_hash', repeat('a', 64),
    'decision', 'approved',
    'idempotency_key', 'owner-approves-11'
  )
);

select extensions.is(
  (select value ->> 'outcome' from deliverable_state where key = 'approval_again'),
  'replayed',
  'clicking approve twice replays the committed review'
);
select extensions.is(
  (select count(*)::int from public.campaign_deliverable_reviews
    where organization_id = 'e9400000-0000-4000-8000-000000000101'::uuid),
  1,
  'and leaves exactly one review on the record'
);

-- ---------------------------------------------------------------------------
-- A re-render does not inherit the approval. This is D05.
-- ---------------------------------------------------------------------------

set local role service_role;

insert into deliverable_state (key, value)
select 'v2', public.record_campaign_deliverable_version(
  'e9400000-0000-4000-8000-000000000101'::uuid,
  pg_catalog.jsonb_build_object(
    'campaign_id', 'e9400000-0000-4000-8000-000000000201',
    'channel', 'instagram', 'placement', 'feed', 'language', 'en', 'format', 'feed',
    'bundle_version_id', 'e9400000-0000-4000-8000-000000000601',
    'direction_key', 'e9400000-0000-4000-8000-000000000301',
    'source_kind', 'final_image',
    'final_asset_id', 'e9400000-0000-4000-8000-000000000401',
    'copy', pg_catalog.jsonb_build_object('caption', 'Lunch is on, until 4pm.'),
    'render_inputs', pg_catalog.jsonb_build_object('templateVersion', 3),
    'render_digest', 'digest-two',
    'content_hash', repeat('c', 64)
  )
);

select extensions.is(
  (select (value ->> 'version')::int from deliverable_state where key = 'v2'),
  2,
  'a changed output is a new version'
);

select extensions.is(
  (select state from public.campaign_deliverables
    where id = (select (value ->> 'deliverable_id')::uuid from deliverable_state where key = 'v1')),
  'ready_for_review',
  'and the deliverable needs review again: approval is never inherited'
);

select extensions.is(
  (select count(*)::int from public.campaign_deliverable_reviews
    where deliverable_version_id
      = (select (value ->> 'deliverable_version_id')::uuid from deliverable_state where key = 'v2')),
  0,
  'the new version carries no review of its own yet'
);

-- The superseded version can no longer be reviewed into publishability.
set local role authenticated;
set local request.jwt.claim.sub = 'e9400000-0000-4000-8000-000000000001';

select extensions.throws_ok(
  format(
    $$select public.review_campaign_deliverable_version(
        'e9400000-0000-4000-8000-000000000101'::uuid,
        pg_catalog.jsonb_build_object(
          'deliverable_version_id', %L, 'content_hash', %L,
          'decision', 'approved', 'idempotency_key', 'stale-version-11'
        ))$$,
    (select value ->> 'deliverable_version_id' from deliverable_state where key = 'v1'),
    repeat('a', 64)
  ),
  '22023',
  'campaign_deliverable_superseded',
  'an output a newer render replaced cannot be approved after the fact'
);

-- ---------------------------------------------------------------------------
-- A rejection must say why.
-- ---------------------------------------------------------------------------

set local role postgres;

select extensions.throws_ok(
  format(
    $$insert into public.campaign_deliverable_reviews
        (organization_id, deliverable_id, deliverable_version_id, content_hash, actor_id,
         decision, reason_codes, idempotency_key)
      values ('e9400000-0000-4000-8000-000000000101'::uuid, %L, %L, %L,
              'e9400000-0000-4000-8000-000000000001'::uuid, 'rejected', '{}'::text[], 'silent-reject-11')$$,
    (select value ->> 'deliverable_id' from deliverable_state where key = 'v2'),
    (select value ->> 'deliverable_version_id' from deliverable_state where key = 'v2'),
    repeat('c', 64)
  ),
  '23514',
  'new row for relation "campaign_deliverable_reviews" violates check constraint "campaign_deliverable_reviews_check"',
  'a rejection with no reason is refused, because nobody could act on it'
);

-- ---------------------------------------------------------------------------
-- The record cannot be rewritten.
-- ---------------------------------------------------------------------------

select extensions.throws_ok(
  $$update public.campaign_deliverable_reviews set decision = 'approved'$$,
  '42501',
  'campaign_deliverable_review_immutable',
  'a recorded review cannot be edited afterwards'
);

select extensions.throws_ok(
  $$update public.campaign_deliverable_versions set content_hash = repeat('d', 64)$$,
  '42501',
  'campaign_deliverable_version_immutable',
  'finished bytes cannot be swapped under a review'
);

select extensions.throws_ok(
  $$delete from public.campaign_deliverable_reviews$$,
  '42501',
  'campaign_deliverable_review_immutable',
  'nor can a review be deleted to hide it'
);

-- ---------------------------------------------------------------------------
-- A source must be exactly one thing.
-- ---------------------------------------------------------------------------

select extensions.throws_ok(
  format(
    $$insert into public.campaign_deliverable_versions
        (organization_id, deliverable_id, campaign_id, version, bundle_version_id, direction_key,
         source_kind, poster_render_id, final_asset_id, copy, render_inputs, render_digest, content_hash)
      values ('e9400000-0000-4000-8000-000000000101'::uuid, %L,
              'e9400000-0000-4000-8000-000000000201'::uuid, 99,
              'e9400000-0000-4000-8000-000000000601'::uuid,
              'e9400000-0000-4000-8000-000000000301'::uuid,
              'final_image', null, null, '{}'::jsonb, '{}'::jsonb, 'd', %L)$$,
    (select value ->> 'deliverable_id' from deliverable_state where key = 'v2'),
    repeat('e', 64)
  ),
  '23514',
  'new row for relation "campaign_deliverable_versions" violates check constraint "campaign_deliverable_versions_check"',
  'a finished output claiming a final image but linked to none is refused'
);

-- ---------------------------------------------------------------------------
-- Tenancy.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'e9400000-0000-4000-8000-000000000002';

select extensions.is(
  (select count(*)::int from public.campaign_deliverables
    where organization_id = 'e9400000-0000-4000-8000-000000000101'::uuid),
  0,
  'another tenant cannot see this organization''s finished outputs'
);

select extensions.throws_ok(
  format(
    $$select public.review_campaign_deliverable_version(
        'e9400000-0000-4000-8000-000000000101'::uuid,
        pg_catalog.jsonb_build_object(
          'deliverable_version_id', %L, 'content_hash', %L,
          'decision', 'approved', 'idempotency_key', 'foreign-approve-11'
        ))$$,
    (select value ->> 'deliverable_version_id' from deliverable_state where key = 'v2'),
    repeat('c', 64)
  ),
  '42501',
  'campaign_deliverable_forbidden',
  'and cannot approve one either'
);

select * from extensions.finish();

rollback;
