begin;

create extension if not exists pgtap with schema extensions;

select extensions.no_plan();

-- Two tenants, because these rows name objects sitting under a real ad account
-- that can spend real money. A row reachable from the wrong session is a client
-- reading, and potentially acting on, another client's live advertising.
insert into auth.users (id)
values
  ('a4000000-0000-4000-8000-000000000001'::uuid),
  ('a4000000-0000-4000-8000-000000000002'::uuid);

-- Inert account fixture: organizations.account_id is NOT NULL, but this suite
-- grants no account membership, so access resolves purely from the
-- organization_memberships rows below.
insert into public.accounts (id, name, slug, created_by)
values (
  'acc00000-0000-4000-8000-a4000000c0de'::uuid, 'Fixture agency',
  'fixture-agency-meta-ads-object-graph-test',
  'a4000000-0000-4000-8000-000000000001'::uuid
);

insert into public.organizations (
  id, name, slug, industry, country_code, base_currency, default_timezone, created_by, account_id
)
values
  (
    'a4000000-0000-4000-8000-000000000101'::uuid,
    'Ads tenant one', 'ads-tenant-one', 'testing', 'AE', 'AED', 'Asia/Dubai',
    'a4000000-0000-4000-8000-000000000001'::uuid,
    'acc00000-0000-4000-8000-a4000000c0de'::uuid
  ),
  (
    'a4000000-0000-4000-8000-000000000102'::uuid,
    'Ads tenant two', 'ads-tenant-two', 'testing', 'AE', 'AED', 'Asia/Dubai',
    'a4000000-0000-4000-8000-000000000002'::uuid,
    'acc00000-0000-4000-8000-a4000000c0de'::uuid
  );

insert into public.organization_memberships (organization_id, user_id, role)
values
  (
    'a4000000-0000-4000-8000-000000000101'::uuid,
    'a4000000-0000-4000-8000-000000000001'::uuid,
    'operator'
  ),
  (
    'a4000000-0000-4000-8000-000000000102'::uuid,
    'a4000000-0000-4000-8000-000000000002'::uuid,
    'operator'
  );

-- One approved version and one due action run per tenant: the minimum a paid
-- action needs before any provider object can belong to it.
create function pg_temp.seed_run(
  org uuid, author uuid, campaign uuid, version_id uuid, run_id uuid, digest_seed text
)
returns void language plpgsql set search_path = '' as $$
declare
  snapshot uuid := pg_catalog.gen_random_uuid();
  brief uuid := pg_catalog.gen_random_uuid();
  direction uuid := pg_catalog.gen_random_uuid();
  action uuid := pg_catalog.gen_random_uuid();
begin
  insert into public.campaign_briefs (id, organization_id, objective, audience, created_by)
  values (brief, org, 'Fill weekday lunch covers', 'Nearby office workers', author);

  insert into public.campaigns (id, organization_id, title, source_kind, brief_id, created_by)
  values (campaign, org, 'Paid experiment', 'manual_brief', brief, author);

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
        'policyExpiresAt', pg_catalog.to_char(
          pg_catalog.now() + interval '20 days', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ),
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

  insert into public.campaign_channel_actions (
    organization_id, bundle_version_id, direction_key, action_key,
    channel, placement, scheduled_for, requirement
  ) values (
    org, version_id, direction, action, 'instagram', 'feed_image',
    pg_catalog.now() + interval '1 day', 'required'
  );

  insert into public.campaign_action_runs (
    id, organization_id, campaign_id, bundle_version_id, action_key, scheduled_for
  ) values (run_id, org, campaign, version_id, action, pg_catalog.now() + interval '1 day');
end;
$$;

select pg_temp.seed_run(
  'a4000000-0000-4000-8000-000000000101'::uuid,
  'a4000000-0000-4000-8000-000000000001'::uuid,
  'a4000000-0000-4000-8000-000000000301'::uuid,
  'a4000000-0000-4000-8000-000000000501'::uuid,
  'a4000000-0000-4000-8000-000000000901'::uuid,
  'a'
);

select pg_temp.seed_run(
  'a4000000-0000-4000-8000-000000000102'::uuid,
  'a4000000-0000-4000-8000-000000000002'::uuid,
  'a4000000-0000-4000-8000-000000000302'::uuid,
  'a4000000-0000-4000-8000-000000000502'::uuid,
  'a4000000-0000-4000-8000-000000000902'::uuid,
  'b'
);

create function pg_temp.record(org uuid, run_id uuid, object_type text, external_id text)
returns jsonb language sql set search_path = '' as $$
  select public.record_campaign_ads_object(
    org,
    pg_catalog.jsonb_build_object(
      'action_run_id', run_id,
      'object_type', object_type,
      'external_id', external_id,
      'created_status', 'PAUSED'
    )
  );
$$;

-- Tenancy -------------------------------------------------------------------

select extensions.ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class where relname = 'campaign_ads_objects'),
  'the ads object ledger enables and forces row level security'
);

select extensions.table_privs_are(
  'public', 'campaign_ads_objects', 'anon', array[]::text[],
  'anonymous sessions cannot reach provider ad object ids at all'
);

select extensions.table_privs_are(
  'public', 'campaign_ads_objects', 'authenticated', array['SELECT'],
  'members read the ledger and never write it directly'
);

select extensions.function_privs_are(
  'public', 'record_campaign_ads_object', array['uuid', 'jsonb'], 'authenticated',
  array[]::text[],
  'a browser session cannot record a provider object, because only an adapter creates one'
);

select extensions.function_privs_are(
  'public', 'record_campaign_ads_object', array['uuid', 'jsonb'], 'service_role',
  array['EXECUTE'],
  'the worker records each provider id as the provider returns it'
);

select extensions.function_privs_are(
  'public', 'read_campaign_ads_objects', array['uuid', 'uuid'], 'authenticated',
  array[]::text[],
  'a browser session cannot read the ledger through the resume path'
);

-- Recording and resuming ----------------------------------------------------

select extensions.is(
  pg_temp.record(
    'a4000000-0000-4000-8000-000000000101'::uuid,
    'a4000000-0000-4000-8000-000000000901'::uuid,
    'campaign', '120200000000001'
  ) ->> 'outcome',
  'recorded',
  'the first provider id for an action run is recorded'
);

-- The whole reason this table exists: the second attempt must resume, not build
-- a second campaign that also sits under the ad account able to spend.
select extensions.is(
  pg_temp.record(
    'a4000000-0000-4000-8000-000000000101'::uuid,
    'a4000000-0000-4000-8000-000000000901'::uuid,
    'campaign', '120200000000999'
  ),
  pg_catalog.jsonb_build_object('outcome', 'already_created', 'external_id', '120200000000001'),
  'a retry is handed back the id already built rather than recording a second one'
);

select extensions.is(
  (select pg_catalog.count(*)::int from public.campaign_ads_objects
   where action_run_id = 'a4000000-0000-4000-8000-000000000901'::uuid
     and object_type = 'campaign'),
  1,
  'no second campaign row exists for the action run'
);

select extensions.is(
  pg_temp.record(
    'a4000000-0000-4000-8000-000000000101'::uuid,
    'a4000000-0000-4000-8000-000000000901'::uuid,
    'ad_set', '120200000000002'
  ) ->> 'outcome',
  'recorded',
  'a different object kind for the same run is a new row, not a conflict'
);

select extensions.is(
  public.read_campaign_ads_objects(
    'a4000000-0000-4000-8000-000000000101'::uuid,
    'a4000000-0000-4000-8000-000000000901'::uuid
  ),
  pg_catalog.jsonb_build_object('campaign', '120200000000001', 'ad_set', '120200000000002'),
  'the resume read returns exactly what has been built so far'
);

select extensions.is(
  public.read_campaign_ads_objects(
    'a4000000-0000-4000-8000-000000000101'::uuid,
    pg_catalog.gen_random_uuid()
  ),
  '{}'::jsonb,
  'an action run that built nothing reads as empty rather than failing'
);

-- Cross-tenant --------------------------------------------------------------

-- A run id is a uuid; guessing one must not be enough. The composite key is
-- what keeps a leaked run id from reaching another tenant's live ad objects.
select extensions.throws_ok(
  format(
    'select public.record_campaign_ads_object(%L::uuid, %L::jsonb)',
    'a4000000-0000-4000-8000-000000000102'::uuid,
    pg_catalog.jsonb_build_object(
      'action_run_id', 'a4000000-0000-4000-8000-000000000901',
      'object_type', 'campaign',
      'external_id', '120200000000003',
      'created_status', 'PAUSED'
    )::text
  ),
  '23503',
  null,
  'one tenant cannot attach a provider object to another tenant''s action run'
);

select extensions.is(
  public.read_campaign_ads_objects(
    'a4000000-0000-4000-8000-000000000102'::uuid,
    'a4000000-0000-4000-8000-000000000901'::uuid
  ),
  '{}'::jsonb,
  'the resume read is empty when the run belongs to another tenant'
);

-- Immutability --------------------------------------------------------------

-- What was created, and under what id, is a statement about the outside world.
-- Editing it would let this platform disown an object that still exists.
select extensions.throws_ok(
  $$update public.campaign_ads_objects set external_id = '120200000000004'
    where action_run_id = 'a4000000-0000-4000-8000-000000000901'::uuid$$,
  '23514',
  null,
  'a recorded provider id cannot be rewritten'
);

select extensions.throws_ok(
  $$delete from public.campaign_ads_objects
    where action_run_id = 'a4000000-0000-4000-8000-000000000901'::uuid$$,
  '23514',
  null,
  'a recorded provider object cannot be forgotten'
);

-- Shape ---------------------------------------------------------------------

select extensions.throws_ok(
  format(
    'select public.record_campaign_ads_object(%L::uuid, %L::jsonb)',
    'a4000000-0000-4000-8000-000000000101'::uuid,
    pg_catalog.jsonb_build_object(
      'action_run_id', 'a4000000-0000-4000-8000-000000000901',
      'object_type', 'ad_account',
      'external_id', '120200000000005',
      'created_status', 'PAUSED'
    )::text
  ),
  '23514',
  null,
  'only the four object kinds a capped experiment builds may be recorded'
);

-- An object recorded as already live would mean a build that could spend
-- halfway through. The build creates everything paused; nothing else is valid.
select extensions.throws_ok(
  format(
    'select public.record_campaign_ads_object(%L::uuid, %L::jsonb)',
    'a4000000-0000-4000-8000-000000000101'::uuid,
    pg_catalog.jsonb_build_object(
      'action_run_id', 'a4000000-0000-4000-8000-000000000901',
      'object_type', 'ad',
      'external_id', '120200000000006',
      'created_status', 'DELETED'
    )::text
  ),
  '23514',
  null,
  'a provider object may only be recorded as created paused or active'
);

select * from extensions.finish();

rollback;
