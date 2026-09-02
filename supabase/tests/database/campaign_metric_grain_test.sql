begin;

create extension if not exists pgtap with schema extensions;

select extensions.no_plan();

-- Two tenants, because these rows are what the agent reasons from. A figure
-- read across the tenant boundary is one client's decisions made on another
-- client's results.
insert into auth.users (id)
values
  ('a5000000-0000-4000-8000-000000000001'::uuid),
  ('a5000000-0000-4000-8000-000000000002'::uuid);

insert into public.accounts (id, name, slug, created_by)
values (
  'acc00000-0000-4000-8000-a5000000c0de'::uuid, 'Fixture agency',
  'fixture-agency-campaign-metric-grain-test',
  'a5000000-0000-4000-8000-000000000001'::uuid
);

insert into public.organizations (
  id, name, slug, industry, country_code, base_currency, default_timezone, created_by, account_id
)
values
  (
    'a5000000-0000-4000-8000-000000000101'::uuid,
    'Metric tenant one', 'metric-tenant-one', 'testing', 'AE', 'AED', 'Asia/Dubai',
    'a5000000-0000-4000-8000-000000000001'::uuid,
    'acc00000-0000-4000-8000-a5000000c0de'::uuid
  ),
  (
    'a5000000-0000-4000-8000-000000000102'::uuid,
    'Metric tenant two', 'metric-tenant-two', 'testing', 'AE', 'AED', 'Asia/Dubai',
    'a5000000-0000-4000-8000-000000000002'::uuid,
    'acc00000-0000-4000-8000-a5000000c0de'::uuid
  );

insert into public.organization_memberships (organization_id, user_id, role)
values
  (
    'a5000000-0000-4000-8000-000000000101'::uuid,
    'a5000000-0000-4000-8000-000000000001'::uuid,
    'operator'
  ),
  (
    'a5000000-0000-4000-8000-000000000102'::uuid,
    'a5000000-0000-4000-8000-000000000002'::uuid,
    'operator'
  );

-- One approved version with one variant per tenant: the smallest thing a
-- variant-grain figure can be attached to.
create function pg_temp.seed(
  org uuid, author uuid, campaign uuid, version_id uuid, direction uuid,
  asset uuid, variant uuid, digest_seed text
)
returns void language plpgsql set search_path = '' as $$
declare
  snapshot uuid := pg_catalog.gen_random_uuid();
  brief uuid := pg_catalog.gen_random_uuid();
begin
  insert into public.campaign_briefs (id, organization_id, objective, audience, created_by)
  values (brief, org, 'Fill weekday lunch covers', 'Nearby office workers', author);

  insert into public.campaigns (id, organization_id, title, source_kind, brief_id, created_by)
  values (campaign, org, 'Measured campaign', 'manual_brief', brief, author);

  insert into public.campaign_source_snapshots (
    id, organization_id, campaign_id, facts, assertions
  ) values (snapshot, org, campaign, '{}'::jsonb, '[]'::jsonb);

  insert into public.campaign_bundle_versions (
    id, organization_id, campaign_id, version, source_snapshot_id, manifest, digest,
    generation_profile, execution_mode
  ) values (
    version_id, org, campaign, 1, snapshot,
    pg_catalog.jsonb_build_object(
      'schemaVersion', 2, 'campaignId', campaign, 'version', 1,
      'generationProfile', 'brand_guided', 'executionMode', 'best_effort',
      'generationPolicy', pg_catalog.jsonb_build_object(
        'maxVariantsPerDirection', 2, 'maxVariantsTotal', 4,
        'policyExpiresAt', pg_catalog.to_char(
          pg_catalog.now() + interval '20 days', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ),
        'lockedOfferRef', null, 'lockedAssertionKeys', '[]'::jsonb
      ),
      'directions', '[1, 2]'::jsonb, 'actions', '[]'::jsonb, 'assets', '[]'::jsonb
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

  insert into public.campaign_creative_variants (
    id, organization_id, campaign_id, bundle_version_id, direction_key,
    direction_ordinal, total_ordinal, max_variants_per_direction, max_variants_total,
    channel, placement, hook, caption, call_to_action, hashtags, asset_id,
    content_hash, provenance
  ) values (
    variant, org, campaign, version_id, direction, 1, 1, 2, 4,
    'instagram', 'feed_image', 'Two courses, one price',
    'Lunch that pays for itself.', 'Book a table', array['#lunch'], asset,
    pg_catalog.repeat(digest_seed, 64),
    pg_catalog.jsonb_build_object('kind', 'generated')
  );
end;
$$;

select pg_temp.seed(
  'a5000000-0000-4000-8000-000000000101'::uuid,
  'a5000000-0000-4000-8000-000000000001'::uuid,
  'a5000000-0000-4000-8000-000000000301'::uuid,
  'a5000000-0000-4000-8000-000000000501'::uuid,
  'a5000000-0000-4000-8000-000000000601'::uuid,
  'a5000000-0000-4000-8000-000000000701'::uuid,
  'a5000000-0000-4000-8000-000000000801'::uuid,
  'a'
);

select pg_temp.seed(
  'a5000000-0000-4000-8000-000000000102'::uuid,
  'a5000000-0000-4000-8000-000000000002'::uuid,
  'a5000000-0000-4000-8000-000000000302'::uuid,
  'a5000000-0000-4000-8000-000000000502'::uuid,
  'a5000000-0000-4000-8000-000000000602'::uuid,
  'a5000000-0000-4000-8000-000000000702'::uuid,
  'a5000000-0000-4000-8000-000000000802'::uuid,
  'b'
);

create function pg_temp.record(
  org uuid, campaign uuid, variant uuid, metric_key text, presence text,
  numerator numeric, currency text
)
returns jsonb language sql set search_path = '' as $$
  select public.record_campaign_metric_observation(
    org,
    pg_catalog.jsonb_build_object(
      'campaign_id', campaign,
      'subject_kind', 'creative_variant',
      'variant_id', variant,
      'metric_key', metric_key,
      'period_grain', 'day',
      'period_start', '2026-08-18T20:00:00+00',
      'period_end', '2026-08-19T20:00:00+00',
      'period_timezone', 'Asia/Dubai',
      'presence', presence,
      'value_numerator', numerator,
      'currency', currency,
      'quality_tier', 'measured',
      'channel', 'instagram',
      'observed_at', '2026-08-19T21:00:00+00',
      'collection_run_id', 'a5000000-0000-4000-8000-000000000f01'
    )
  );
$$;

-- The grain itself -----------------------------------------------------------

select extensions.is(
  (select pg_catalog.count(*)::int from public.subject_kinds
   where key in ('campaign', 'campaign_action', 'creative_variant')),
  3,
  'a campaign, an action, and a variant are all measurable subjects'
);

select extensions.is(
  (select pg_catalog.count(*)::int from public.metric_definitions
   where key in ('delivery.impressions', 'delivery.clicks', 'delivery.spend')
     and organization_id is null),
  3,
  'the delivery diagnostics are shared vocabulary, not one tenant''s invention'
);

-- Reach and frequency count unique people and cannot be summed across days.
-- Registering them as summable would put a false aggregation into vocabulary
-- every consumer trusts.
select extensions.is(
  (select pg_catalog.count(*)::int from public.metric_definitions
   where key in ('delivery.reach', 'delivery.frequency')),
  0,
  'no non-additive diagnostic is registered with an additive aggregation'
);

-- Tenancy --------------------------------------------------------------------

select extensions.ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class where relname = 'campaign_metric_observations'),
  'campaign observations enable and force row level security'
);

select extensions.table_privs_are(
  'public', 'campaign_metric_observations', 'anon', array[]::text[],
  'anonymous sessions cannot reach campaign results at all'
);

select extensions.table_privs_are(
  'public', 'campaign_metric_observations', 'authenticated', array['SELECT'],
  'members read results and never write them directly'
);

select extensions.function_privs_are(
  'public', 'record_campaign_metric_observation', array['uuid', 'jsonb'], 'authenticated',
  array[]::text[],
  'a browser session cannot record a result, because collection is a durable run'
);

select extensions.function_privs_are(
  'public', 'record_campaign_metric_observation', array['uuid', 'jsonb'], 'service_role',
  array['EXECUTE'],
  'the collector records what the provider reported'
);

-- Recording ------------------------------------------------------------------

select extensions.is(
  pg_temp.record(
    'a5000000-0000-4000-8000-000000000101'::uuid,
    'a5000000-0000-4000-8000-000000000301'::uuid,
    'a5000000-0000-4000-8000-000000000801'::uuid,
    'delivery.impressions', 'observed', 4200, null
  ) ->> 'outcome',
  'recorded',
  'a first figure for a variant and a day is recorded'
);

select extensions.is(
  (select metric.subject_kind || ':' || metric.subject_ref
   from public.normalized_metrics metric
   join public.campaign_metric_observations observation
     on observation.normalized_metric_id = metric.id
   where observation.organization_id = 'a5000000-0000-4000-8000-000000000101'::uuid
     and observation.superseded_by_id is null),
  'creative_variant:a5000000-0000-4000-8000-000000000801',
  'the value lands in the warehouse at variant grain, not campaign grain'
);

-- Re-running a collection over a settled window is normal operation, and must
-- not produce a second current figure.
select extensions.is(
  pg_temp.record(
    'a5000000-0000-4000-8000-000000000101'::uuid,
    'a5000000-0000-4000-8000-000000000301'::uuid,
    'a5000000-0000-4000-8000-000000000801'::uuid,
    'delivery.impressions', 'observed', 4200, null
  ) ->> 'outcome',
  'unchanged',
  'the same figure again changes nothing'
);

select extensions.is(
  (select pg_catalog.count(*)::int from public.campaign_metric_observations
   where organization_id = 'a5000000-0000-4000-8000-000000000101'::uuid),
  1,
  'and writes no second row'
);

-- Restatement ----------------------------------------------------------------

select extensions.is(
  pg_temp.record(
    'a5000000-0000-4000-8000-000000000101'::uuid,
    'a5000000-0000-4000-8000-000000000301'::uuid,
    'a5000000-0000-4000-8000-000000000801'::uuid,
    'delivery.impressions', 'observed', 4380, null
  ) ->> 'outcome',
  'restated',
  'a provider that revises its own figure produces a new revision'
);

-- Forces the deferred supersession pointer to resolve here, since the suite
-- rolls back rather than commits; restored immediately, because leaving it
-- immediate would break every later restatement in this transaction.
set constraints all immediate;
set constraints all deferred;

select extensions.is(
  (select pg_catalog.count(*)::int from public.campaign_metric_observations
   where organization_id = 'a5000000-0000-4000-8000-000000000101'::uuid
     and superseded_by_id is null),
  1,
  'a restated series still has exactly one live answer'
);

select extensions.is(
  (select metric.value_numerator
   from public.normalized_metrics metric
   join public.campaign_metric_observations observation
     on observation.normalized_metric_id = metric.id
   where observation.superseded_by_id is null
     and observation.organization_id = 'a5000000-0000-4000-8000-000000000101'::uuid),
  4380::numeric,
  'the live answer is the revised figure'
);

select extensions.is(
  (select pg_catalog.count(*)::int from public.normalized_metrics
   where organization_id = 'a5000000-0000-4000-8000-000000000101'::uuid
     and superseded_by_id is not null),
  1,
  'and the figure the platform acted on at the time is still on record'
);

-- Missingness ----------------------------------------------------------------

-- The distinction this table exists for. A day the provider reported nothing
-- for is not a zero, and a decision made on an imputed zero is a decision made
-- on a number nobody measured.
select extensions.is(
  pg_temp.record(
    'a5000000-0000-4000-8000-000000000101'::uuid,
    'a5000000-0000-4000-8000-000000000301'::uuid,
    'a5000000-0000-4000-8000-000000000801'::uuid,
    'delivery.clicks', 'absent', null, null
  ) ->> 'outcome',
  'recorded',
  'a period the provider reported nothing for is recorded as a gap'
);

select extensions.is(
  (select observation.normalized_metric_id
   from public.campaign_metric_observations observation
   where observation.presence = 'absent'
     and observation.organization_id = 'a5000000-0000-4000-8000-000000000101'::uuid),
  null,
  'a gap carries no value, rather than a zero standing in for one'
);

select extensions.is(
  pg_temp.record(
    'a5000000-0000-4000-8000-000000000101'::uuid,
    'a5000000-0000-4000-8000-000000000301'::uuid,
    'a5000000-0000-4000-8000-000000000801'::uuid,
    'delivery.clicks', 'absent', null, null
  ) ->> 'outcome',
  'unchanged',
  'still nothing is not a change of answer'
);

-- Late data: the gap fills in, and the record that it was once a gap survives.
select extensions.is(
  pg_temp.record(
    'a5000000-0000-4000-8000-000000000101'::uuid,
    'a5000000-0000-4000-8000-000000000301'::uuid,
    'a5000000-0000-4000-8000-000000000801'::uuid,
    'delivery.clicks', 'observed', 61, null
  ) ->> 'outcome',
  'restated',
  'a late figure supersedes the gap rather than overwriting it'
);

-- Forces the deferred supersession pointer to resolve here, since the suite
-- rolls back rather than commits; restored immediately, because leaving it
-- immediate would break every later restatement in this transaction.
set constraints all immediate;
set constraints all deferred;

select extensions.is(
  (select pg_catalog.count(*)::int from public.campaign_metric_observations observation
   join public.metric_definitions definition
     on definition.id = observation.metric_definition_id
   where definition.key = 'delivery.clicks'
     and observation.presence = 'absent'
     and observation.superseded_by_id is not null),
  1,
  'and the period is still known to have been empty when it was first collected'
);

-- Cross-tenant ---------------------------------------------------------------

-- A variant id is a uuid. Guessing one must not be enough to attach a figure to
-- another tenant's creative.
select extensions.throws_ok(
  format(
    'select pg_temp.record(%L::uuid, %L::uuid, %L::uuid, %L, %L, %s, null)',
    'a5000000-0000-4000-8000-000000000102'::uuid,
    'a5000000-0000-4000-8000-000000000302'::uuid,
    'a5000000-0000-4000-8000-000000000801'::uuid,
    'delivery.impressions', 'observed', 999
  ),
  '23503',
  null,
  'one tenant cannot record a result against another tenant''s variant'
);

-- Shape ----------------------------------------------------------------------

select extensions.throws_ok(
  format(
    'select pg_temp.record(%L::uuid, %L::uuid, %L::uuid, %L, %L, %s, null)',
    'a5000000-0000-4000-8000-000000000101'::uuid,
    'a5000000-0000-4000-8000-000000000301'::uuid,
    'a5000000-0000-4000-8000-000000000801'::uuid,
    'delivery.invented_by_a_model', 'observed', 12
  ),
  '23503',
  null,
  'a metric nothing registered cannot be recorded, however confident the caller'
);

-- Append-only ----------------------------------------------------------------

select extensions.throws_ok(
  $$update public.campaign_metric_observations set presence = 'absent'
    where organization_id = 'a5000000-0000-4000-8000-000000000101'::uuid
      and superseded_by_id is null$$,
  '23514',
  null,
  'a recorded result cannot be edited in place'
);

select extensions.throws_ok(
  $$delete from public.campaign_metric_observations
    where organization_id = 'a5000000-0000-4000-8000-000000000101'::uuid$$,
  '23514',
  null,
  'a recorded result cannot be deleted'
);

select * from extensions.finish();

rollback;
