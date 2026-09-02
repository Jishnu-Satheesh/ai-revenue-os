begin;

create extension if not exists pgtap with schema extensions;

select extensions.no_plan();

-- Two tenants, because a verdict is a claim about one client's results. A
-- verdict read or written across the tenant boundary is one client's conclusion
-- made on another client's evidence.
insert into auth.users (id)
values
  ('b5000000-0000-4000-8000-000000000001'::uuid),
  ('b5000000-0000-4000-8000-000000000002'::uuid);

insert into public.accounts (id, name, slug, created_by)
values (
  'acc00000-0000-4000-8000-b5000000c0de'::uuid, 'Fixture agency',
  'fixture-agency-campaign-outcomes-test',
  'b5000000-0000-4000-8000-000000000001'::uuid
);

insert into public.organizations (
  id, name, slug, industry, country_code, base_currency, default_timezone, created_by, account_id
)
values
  (
    'b5000000-0000-4000-8000-000000000101'::uuid,
    'Outcome tenant one', 'outcome-tenant-one', 'testing', 'AE', 'AED', 'Asia/Dubai',
    'b5000000-0000-4000-8000-000000000001'::uuid,
    'acc00000-0000-4000-8000-b5000000c0de'::uuid
  ),
  (
    'b5000000-0000-4000-8000-000000000102'::uuid,
    'Outcome tenant two', 'outcome-tenant-two', 'testing', 'AE', 'AED', 'Asia/Dubai',
    'b5000000-0000-4000-8000-000000000002'::uuid,
    'acc00000-0000-4000-8000-b5000000c0de'::uuid
  );

insert into public.organization_memberships (organization_id, user_id, role)
values
  (
    'b5000000-0000-4000-8000-000000000101'::uuid,
    'b5000000-0000-4000-8000-000000000001'::uuid,
    'operator'
  ),
  (
    'b5000000-0000-4000-8000-000000000102'::uuid,
    'b5000000-0000-4000-8000-000000000002'::uuid,
    'operator'
  );

-- A campaign that has published once, which is the minimum the evidence loop
-- can settle. `published_at` is a parameter so a test can place the first
-- exposure either long enough ago to be due, or too recently to settle.
create function pg_temp.seed_outcome(
  org uuid, author uuid, campaign uuid, version_id uuid, direction uuid,
  action uuid, run_id uuid, digest_seed text, published_at timestamptz
)
returns void language plpgsql set search_path = '' as $$
declare
  snapshot uuid := pg_catalog.gen_random_uuid();
  brief uuid := pg_catalog.gen_random_uuid();
begin
  insert into public.campaign_briefs (id, organization_id, objective, audience, created_by)
  values (brief, org, 'Fill weekday lunch covers', 'Nearby office workers', author);

  insert into public.campaigns (id, organization_id, title, source_kind, brief_id, created_by)
  values (campaign, org, 'Settled campaign', 'manual_brief', brief, author);

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

  insert into public.campaign_channel_actions (
    organization_id, bundle_version_id, action_key, direction_key, channel, placement,
    scheduled_for, requirement
  ) values (
    org, version_id, action, direction, 'instagram', 'feed_image', published_at, 'required'
  );

  insert into public.campaign_measurement_plans (
    organization_id, bundle_version_id, primary_metric_key, guardrail_metric_keys,
    baseline_source, baseline_lookback_days, attribution_method, outcome_window_days,
    settlement_delay_days, minimum_evidence_tier
  ) values (
    org, version_id, 'revenue.purchase_value', array['delivery.spend'],
    'goal_baseline_measured:revenue.purchase_value', 28, 'observational_prepost', 14, 3, 'observed'
  );

  insert into public.campaign_action_runs (
    id, organization_id, campaign_id, bundle_version_id, action_key, scheduled_for, status
  ) values (
    run_id, org, campaign, version_id, action, published_at, 'confirmed'
  );

  insert into public.campaign_exposures (
    organization_id, campaign_id, bundle_version_id, action_run_id,
    external_reference, provider_status, published_at, metrics_eligible_at
  ) values (
    org, campaign, version_id, run_id, 'ig_post_1', 'published', published_at, published_at
  );
end;
$$;

-- Tenant one, due (published 20 days ago; window + delay is 17 days).
select pg_temp.seed_outcome(
  'b5000000-0000-4000-8000-000000000101'::uuid,
  'b5000000-0000-4000-8000-000000000001'::uuid,
  'b5000000-0000-4000-8000-000000000301'::uuid,
  'b5000000-0000-4000-8000-000000000501'::uuid,
  'b5000000-0000-4000-8000-000000000601'::uuid,
  'b5000000-0000-4000-8000-000000000701'::uuid,
  'b5000000-0000-4000-8000-000000000901'::uuid,
  'a',
  pg_catalog.now() - interval '20 days'
);

-- Tenant two, due.
select pg_temp.seed_outcome(
  'b5000000-0000-4000-8000-000000000102'::uuid,
  'b5000000-0000-4000-8000-000000000002'::uuid,
  'b5000000-0000-4000-8000-000000000302'::uuid,
  'b5000000-0000-4000-8000-000000000502'::uuid,
  'b5000000-0000-4000-8000-000000000602'::uuid,
  'b5000000-0000-4000-8000-000000000702'::uuid,
  'b5000000-0000-4000-8000-000000000902'::uuid,
  'b',
  pg_catalog.now() - interval '20 days'
);

-- Tenant one, not yet due (published just now).
select pg_temp.seed_outcome(
  'b5000000-0000-4000-8000-000000000101'::uuid,
  'b5000000-0000-4000-8000-000000000001'::uuid,
  'b5000000-0000-4000-8000-000000000303'::uuid,
  'b5000000-0000-4000-8000-000000000503'::uuid,
  'b5000000-0000-4000-8000-000000000603'::uuid,
  'b5000000-0000-4000-8000-000000000703'::uuid,
  'b5000000-0000-4000-8000-000000000903'::uuid,
  'c',
  pg_catalog.now()
);

-- The one write path, with sane defaults so each test overrides only what it
-- needs to change.
create function pg_temp.settle(
  org uuid, campaign uuid, version_id uuid, digest text, overrides jsonb default '{}'::jsonb
)
returns jsonb language plpgsql set search_path = '' as $$
declare
  base jsonb;
begin
  base := pg_catalog.jsonb_build_object(
    'organization_id', org,
    'campaign_id', campaign,
    'bundle_version_id', version_id,
    'plan_digest', digest,
    'verdict', 'inconclusive',
    'attribution_method', 'observational_prepost',
    'primary_metric_key', 'revenue.purchase_value',
    'outcome_window_days', 14,
    'settlement_delay_days', 3,
    'planned_exposure_count', 1,
    'realized_exposure_count', 1,
    'guardrail_state', 'unmeasured',
    'realized_spend_minor', null,
    'spend_ceiling_minor', null,
    'spend_currency', null,
    'estimate_minor', null,
    'estimate_low_minor', null,
    'estimate_high_minor', null,
    'estimate_currency', null,
    'evidence_tier', null,
    'truncation_causes', '[]'::jsonb,
    'limitations', '[]'::jsonb,
    'baseline_source', 'goal_baseline_measured:revenue.purchase_value',
    'baseline_lookback_days', 28
  );
  return public.settle_campaign_outcome(org, base || overrides);
end;
$$;

-- Tenancy and grants ----------------------------------------------------------

select extensions.ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class where relname = 'campaign_outcomes'),
  'campaign outcomes enable and force row level security'
);

select extensions.table_privs_are(
  'public', 'campaign_outcomes', 'anon', array[]::text[],
  'anonymous sessions cannot reach verdicts at all'
);

select extensions.table_privs_are(
  'public', 'campaign_outcomes', 'authenticated', array['SELECT'],
  'members read verdicts and never write them directly'
);

select extensions.function_privs_are(
  'public', 'read_campaign_measurement_context', array['uuid', 'uuid'], 'authenticated',
  array[]::text[],
  'no browser session reads the settlement context'
);

select extensions.function_privs_are(
  'public', 'settle_campaign_outcome', array['uuid', 'jsonb'], 'authenticated',
  array[]::text[],
  'no browser session writes a verdict'
);

select extensions.function_privs_are(
  'public', 'settle_campaign_outcome', array['uuid', 'jsonb'], 'service_role',
  array['EXECUTE'],
  'only the evidence loop writes the verdict'
);

-- Settlement delay ------------------------------------------------------------

select extensions.throws_ok(
  format(
    'select pg_temp.settle(%L::uuid, %L::uuid, %L::uuid, %L)',
    'b5000000-0000-4000-8000-000000000101'::uuid,
    'b5000000-0000-4000-8000-000000000303'::uuid,
    'b5000000-0000-4000-8000-000000000503'::uuid,
    pg_catalog.repeat('c', 64)
  ),
  '22023',
  null,
  'a campaign whose window and settlement delay have not passed cannot be settled'
);

-- Immutable preregistration ---------------------------------------------------

select extensions.throws_ok(
  format(
    'select pg_temp.settle(%L::uuid, %L::uuid, %L::uuid, %L)',
    'b5000000-0000-4000-8000-000000000101'::uuid,
    'b5000000-0000-4000-8000-000000000301'::uuid,
    'b5000000-0000-4000-8000-000000000501'::uuid,
    pg_catalog.repeat('d', 64)
  ),
  '22023',
  null,
  'a verdict computed against a digest not on file at first exposure is refused'
);

select extensions.throws_ok(
  format(
    'select pg_temp.settle(%L::uuid, %L::uuid, %L::uuid, %L)',
    'b5000000-0000-4000-8000-000000000101'::uuid,
    'b5000000-0000-4000-8000-000000000301'::uuid,
    'b5000000-0000-4000-8000-000000000502'::uuid,
    pg_catalog.repeat('a', 64)
  ),
  '22023',
  null,
  'a verdict computed against another version''s plan is refused'
);

-- Cross-tenant ----------------------------------------------------------------

-- One tenant cannot settle another tenant's campaign: the first-exposure lookup
-- is scoped to the target tenant, so another tenant's campaign id names nothing.
select extensions.throws_ok(
  format(
    'select pg_temp.settle(%L::uuid, %L::uuid, %L::uuid, %L)',
    'b5000000-0000-4000-8000-000000000102'::uuid,
    'b5000000-0000-4000-8000-000000000301'::uuid,
    'b5000000-0000-4000-8000-000000000501'::uuid,
    pg_catalog.repeat('a', 64)
  ),
  '22023',
  null,
  'one tenant cannot settle another tenant''s campaign'
);

-- A worker claiming one tenant while executing for another is refused outright,
-- before any other field is even read.
select extensions.throws_ok(
  $$select public.settle_campaign_outcome(
    'b5000000-0000-4000-8000-000000000102'::uuid,
    '{"organization_id": "b5000000-0000-4000-8000-000000000101"}'::jsonb
  )$$,
  '42501',
  null,
  'a worker claiming another tenant is refused outright'
);

-- A valid settle, then restatement and idempotence ----------------------------

select extensions.is(
  pg_temp.settle(
    'b5000000-0000-4000-8000-000000000101'::uuid,
    'b5000000-0000-4000-8000-000000000301'::uuid,
    'b5000000-0000-4000-8000-000000000501'::uuid,
    pg_catalog.repeat('a', 64)
  ) ->> 'outcome',
  'recorded',
  'a due campaign records its first verdict'
);

select extensions.is(
  (select pg_catalog.count(*)::int from public.campaign_outcomes
   where organization_id = 'b5000000-0000-4000-8000-000000000101'::uuid
     and campaign_id = 'b5000000-0000-4000-8000-000000000301'::uuid
     and superseded_by_id is null),
  1,
  'and exactly one live verdict exists for the campaign'
);

-- A changed verdict is a restatement: the incumbent is retired, never edited.
select extensions.is(
  pg_temp.settle(
    'b5000000-0000-4000-8000-000000000101'::uuid,
    'b5000000-0000-4000-8000-000000000301'::uuid,
    'b5000000-0000-4000-8000-000000000501'::uuid,
    pg_catalog.repeat('a', 64),
    pg_catalog.jsonb_build_object('verdict', 'execution_only', 'realized_exposure_count', 0)
  ) ->> 'outcome',
  'restated',
  'a restatement supersedes rather than overwrites'
);

-- Forces the deferred supersession pointer to resolve here, since the suite
-- rolls back rather than commits; restored immediately, because leaving it
-- immediate would break every later restatement in this transaction.
set constraints all immediate;
set constraints all deferred;

select extensions.is(
  (select pg_catalog.count(*)::int from public.campaign_outcomes
   where organization_id = 'b5000000-0000-4000-8000-000000000101'::uuid
     and campaign_id = 'b5000000-0000-4000-8000-000000000301'::uuid
     and superseded_by_id is null),
  1,
  'a restated campaign still has exactly one live verdict'
);

select extensions.is(
  (select verdict from public.campaign_outcomes
   where organization_id = 'b5000000-0000-4000-8000-000000000101'::uuid
     and campaign_id = 'b5000000-0000-4000-8000-000000000301'::uuid
     and superseded_by_id is null),
  'execution_only',
  'and the live verdict is the revised one'
);

select extensions.is(
  (select pg_catalog.count(*)::int from public.campaign_outcomes
   where organization_id = 'b5000000-0000-4000-8000-000000000101'::uuid
     and campaign_id = 'b5000000-0000-4000-8000-000000000301'::uuid
     and superseded_by_id is not null),
  1,
  'while the verdict the platform first rendered is still on record'
);

-- An unchanged recompute writes nothing.
select extensions.is(
  pg_temp.settle(
    'b5000000-0000-4000-8000-000000000101'::uuid,
    'b5000000-0000-4000-8000-000000000301'::uuid,
    'b5000000-0000-4000-8000-000000000501'::uuid,
    pg_catalog.repeat('a', 64),
    pg_catalog.jsonb_build_object('verdict', 'execution_only', 'realized_exposure_count', 0)
  ) ->> 'outcome',
  'unchanged',
  'a recompute over an unchanged result changes nothing'
);

select extensions.is(
  (select pg_catalog.count(*)::int from public.campaign_outcomes
   where organization_id = 'b5000000-0000-4000-8000-000000000101'::uuid
     and campaign_id = 'b5000000-0000-4000-8000-000000000301'::uuid),
  2,
  'and no third row appears'
);

-- Append-only -----------------------------------------------------------------

select extensions.throws_ok(
  $$update public.campaign_outcomes set verdict = 'validated_outcome'
    where organization_id = 'b5000000-0000-4000-8000-000000000101'::uuid
      and superseded_by_id is null$$,
  '23514',
  null,
  'a recorded verdict cannot be edited in place'
);

select extensions.throws_ok(
  $$delete from public.campaign_outcomes
    where organization_id = 'b5000000-0000-4000-8000-000000000101'::uuid$$,
  '23514',
  null,
  'a recorded verdict cannot be deleted'
);

select * from extensions.finish();

rollback;
