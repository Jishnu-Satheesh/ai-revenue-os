begin;

create extension if not exists pgtap with schema extensions;

select extensions.no_plan();

-- Two tenants, because a learning proposal is one client's lesson drafted from
-- one client's evidence. A proposal that cites another tenant's outcome or
-- variant is one client's conclusion built on another client's results.
insert into auth.users (id)
values
  ('c5000000-0000-4000-8000-000000000001'::uuid),
  ('c5000000-0000-4000-8000-000000000002'::uuid),
  ('c5000000-0000-4000-8000-000000000003'::uuid);

insert into public.accounts (id, name, slug, created_by)
values (
  'acc00000-0000-4000-8000-c5000000c0de'::uuid, 'Fixture agency',
  'fixture-agency-campaign-learning-test',
  'c5000000-0000-4000-8000-000000000001'::uuid
);

insert into public.organizations (
  id, name, slug, industry, country_code, base_currency, default_timezone, created_by, account_id
)
values
  (
    'c5000000-0000-4000-8000-000000000101'::uuid,
    'Learning tenant one', 'learning-tenant-one', 'testing', 'AE', 'AED', 'Asia/Dubai',
    'c5000000-0000-4000-8000-000000000001'::uuid,
    'acc00000-0000-4000-8000-c5000000c0de'::uuid
  ),
  (
    'c5000000-0000-4000-8000-000000000102'::uuid,
    'Learning tenant two', 'learning-tenant-two', 'testing', 'AE', 'AED', 'Asia/Dubai',
    'c5000000-0000-4000-8000-000000000002'::uuid,
    'acc00000-0000-4000-8000-c5000000c0de'::uuid
  );

insert into public.organization_memberships (organization_id, user_id, role)
values
  ('c5000000-0000-4000-8000-000000000101'::uuid, 'c5000000-0000-4000-8000-000000000001'::uuid, 'operator'),
  ('c5000000-0000-4000-8000-000000000102'::uuid, 'c5000000-0000-4000-8000-000000000002'::uuid, 'operator'),
  ('c5000000-0000-4000-8000-000000000101'::uuid, 'c5000000-0000-4000-8000-000000000003'::uuid, 'viewer');

-- A full campaign that has published, generated a variant, been approved, and
-- settled. The learning proposal is drafted from this settled outcome.
create function pg_temp.seed_learning(
  org uuid, author uuid, campaign uuid, version_id uuid, direction uuid,
  asset uuid, variant uuid, action_key uuid, run_id uuid, attestation uuid,
  outcome uuid, policy uuid, digest_seed text
)
returns void language plpgsql set search_path = '' as $$
declare
  snapshot uuid := pg_catalog.gen_random_uuid();
  brief uuid := pg_catalog.gen_random_uuid();
  digest text := pg_catalog.repeat(digest_seed, 64);
begin
  insert into public.campaign_briefs (id, organization_id, objective, audience, created_by)
  values (brief, org, 'Fill weekday lunch covers', 'Nearby office workers', author);

  insert into public.campaigns (id, organization_id, title, source_kind, brief_id, created_by)
  values (campaign, org, 'Learned campaign', 'manual_brief', brief, author);

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
    digest, 'brand_guided', 'best_effort'
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
    content_hash, provenance, state
  ) values (
    variant, org, campaign, version_id, direction, 1, 1, 2, 4,
    'instagram', 'feed_image', 'Two courses, one price',
    'Lunch that pays for itself.', 'Book a table', array['#lunch'], asset,
    digest, pg_catalog.jsonb_build_object('kind', 'generated'), 'published'
  );

  insert into public.campaign_channel_actions (
    organization_id, bundle_version_id, action_key, direction_key, channel,
    placement, scheduled_for, requirement
  ) values (
    org, version_id, action_key, direction, 'instagram', 'feed_image',
    pg_catalog.now() - interval '20 days', 'required'
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
    run_id, org, campaign, version_id, action_key,
    pg_catalog.now() - interval '20 days', 'confirmed'
  );

  insert into public.campaign_exposures (
    organization_id, campaign_id, bundle_version_id, action_run_id,
    external_reference, provider_status, published_at, metrics_eligible_at
  ) values (
    org, campaign, version_id, run_id, 'ig_post_1', 'published',
    pg_catalog.now() - interval '20 days', pg_catalog.now() - interval '20 days'
  );

  insert into public.policies (id, organization_id, policy_type, name, mode)
  values (policy, org, 'spend_guardrail', 'Fixture policy', 'approval_required');

  insert into public.campaign_visual_attestations (
    id, organization_id, campaign_id, bundle_version_id, bundle_digest, attested_by, statement
  ) values (attestation, org, campaign, version_id, digest, author, 'Fixture attestation.');

  insert into public.campaign_approvals (
    organization_id, campaign_id, bundle_version_id, bundle_digest, attestation_id,
    approved_by, expires_at, capability_grant_versions, policy_version_ids,
    action_keys, total_spend_ceiling_minor, spend_currency
  ) values (
    org, campaign, version_id, digest, attestation, author,
    pg_catalog.now() + interval '20 days', '{}'::jsonb, array[policy],
    array[action_key], null, null
  );

  insert into public.campaign_outcomes (
    id, organization_id, campaign_id, bundle_version_id, plan_digest,
    verdict, attribution_method, primary_metric_key,
    outcome_window_days, settlement_delay_days, baseline_source, baseline_lookback_days,
    planned_exposure_count, realized_exposure_count,
    guardrail_state, evidence_tier, limitations
  ) values (
    outcome, org, campaign, version_id, digest,
    'inconclusive', 'observational_prepost', 'revenue.purchase_value',
    14, 3, 'goal_baseline_measured:revenue.purchase_value', 28,
    1, 1, 'unmeasured', null,
    '["The preregistered evidence bar was not met."]'::jsonb
  );
end;
$$;

select pg_temp.seed_learning(
  'c5000000-0000-4000-8000-000000000101'::uuid,
  'c5000000-0000-4000-8000-000000000001'::uuid,
  'c5000000-0000-4000-8000-000000000301'::uuid,
  'c5000000-0000-4000-8000-000000000501'::uuid,
  'c5000000-0000-4000-8000-000000000601'::uuid,
  'c5000000-0000-4000-8000-000000000701'::uuid,
  'c5000000-0000-4000-8000-000000000801'::uuid,
  'c5000000-0000-4000-8000-000000000901'::uuid,
  'c5000000-0000-4000-8000-000000001001'::uuid,
  'c5000000-0000-4000-8000-000000001101'::uuid,
  'c5000000-0000-4000-8000-000000001201'::uuid,
  'c5000000-0000-4000-8000-000000001301'::uuid,
  'a'
);

select pg_temp.seed_learning(
  'c5000000-0000-4000-8000-000000000102'::uuid,
  'c5000000-0000-4000-8000-000000000002'::uuid,
  'c5000000-0000-4000-8000-000000000302'::uuid,
  'c5000000-0000-4000-8000-000000000502'::uuid,
  'c5000000-0000-4000-8000-000000000602'::uuid,
  'c5000000-0000-4000-8000-000000000702'::uuid,
  'c5000000-0000-4000-8000-000000000802'::uuid,
  'c5000000-0000-4000-8000-000000000902'::uuid,
  'c5000000-0000-4000-8000-000000001002'::uuid,
  'c5000000-0000-4000-8000-000000001102'::uuid,
  'c5000000-0000-4000-8000-000000001202'::uuid,
  'c5000000-0000-4000-8000-000000001302'::uuid,
  'b'
);

-- The one write path, with sane defaults so each test overrides only what it
-- needs to change.
create function pg_temp.propose(
  org uuid, campaign uuid, variant_ids jsonb, evidence_links jsonb,
  overrides jsonb default '{}'::jsonb
)
returns jsonb language plpgsql set search_path = '' as $$
declare
  base jsonb;
begin
  base := pg_catalog.jsonb_build_object(
    'organization_id', org,
    'campaign_id', campaign,
    'variant_ids', variant_ids,
    'hypothesis', 'The preregistered plan tested creative variants.',
    'observation', 'The campaign ran and settled inconclusive.',
    'proposed_lesson', 'The lesson stays attached to this campaign.',
    'suggested_next_test', 'Run the same preregistered method again.',
    'evidence_links', evidence_links
  );
  return public.propose_campaign_learning(org, base || overrides);
end;
$$;

-- Tenancy and grants ----------------------------------------------------------

select extensions.ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class where relname = 'campaign_learning_proposals'),
  'campaign learning proposals enable and force row level security'
);

select extensions.table_privs_are(
  'public', 'campaign_learning_proposals', 'anon', array[]::text[],
  'anonymous sessions cannot reach learning proposals at all'
);

select extensions.table_privs_are(
  'public', 'campaign_learning_proposals', 'authenticated', array['SELECT'],
  'members read learning proposals and never write them directly'
);

select extensions.function_privs_are(
  'public', 'read_campaign_learning_context', array['uuid', 'uuid'], 'authenticated',
  array[]::text[],
  'no browser session reads the learning context'
);

select extensions.function_privs_are(
  'public', 'propose_campaign_learning', array['uuid', 'jsonb'], 'authenticated',
  array[]::text[],
  'no browser session writes a learning proposal'
);

select extensions.function_privs_are(
  'public', 'propose_campaign_learning', array['uuid', 'jsonb'], 'service_role',
  array['EXECUTE'],
  'only the evidence loop writes the proposal'
);

select extensions.function_privs_are(
  'public', 'decide_campaign_learning_proposal', array['uuid', 'jsonb'], 'authenticated',
  array['EXECUTE'],
  'deciding is an operator action, so an authenticated session may call it'
);

-- Reading the context ---------------------------------------------------------

select extensions.is(
  (public.read_campaign_learning_context(
    'c5000000-0000-4000-8000-000000000101'::uuid,
    'c5000000-0000-4000-8000-000000000301'::uuid
  ) ->> 'verdict'),
  'inconclusive',
  'the learning context returns the campaign''s own settled verdict'
);

select extensions.is(
  (select pg_catalog.jsonb_array_length(
    public.read_campaign_learning_context(
      'c5000000-0000-4000-8000-000000000101'::uuid,
      'c5000000-0000-4000-8000-000000000301'::uuid
    ) -> 'variant_ids'
  )),
  1,
  'and its own variant ids'
);

-- A proposal cites the exact bundle version and digest, policy versions,
-- variants, exposures, and outcome.
select extensions.is(
  (public.read_campaign_learning_context(
    'c5000000-0000-4000-8000-000000000101'::uuid,
    'c5000000-0000-4000-8000-000000000301'::uuid
  ) ->> 'bundle_digest'),
  pg_catalog.repeat('a', 64),
  'the context quotes the exact bundle digest'
);

select extensions.is(
  (select value::uuid
   from pg_catalog.jsonb_array_elements_text(
     public.read_campaign_learning_context(
       'c5000000-0000-4000-8000-000000000101'::uuid,
       'c5000000-0000-4000-8000-000000000301'::uuid
     ) -> 'policy_version_ids'
   )),
  'c5000000-0000-4000-8000-000000001301'::uuid,
  'and the policy version the approval assumed'
);

-- No settlement, no proposal --------------------------------------------------

select extensions.throws_ok(
  format(
    'select public.read_campaign_learning_context(%L::uuid, %L::uuid)',
    'c5000000-0000-4000-8000-000000000102'::uuid,
    'c5000000-0000-4000-8000-000000000301'::uuid
  ),
  '22023',
  null,
  'one tenant cannot read another tenant''s settled outcome as its learning context'
);

-- Proposing -------------------------------------------------------------------

select extensions.is(
  (pg_temp.propose(
    'c5000000-0000-4000-8000-000000000101'::uuid,
    'c5000000-0000-4000-8000-000000000301'::uuid,
    '["c5000000-0000-4000-8000-000000000801"]'::jsonb,
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('kind', 'outcome', 'id', 'c5000000-0000-4000-8000-000000001201'),
      pg_catalog.jsonb_build_object('kind', 'bundle_version', 'id', 'c5000000-0000-4000-8000-000000000501'),
      pg_catalog.jsonb_build_object('kind', 'variant', 'id', 'c5000000-0000-4000-8000-000000000801'),
      pg_catalog.jsonb_build_object('kind', 'policy', 'id', 'c5000000-0000-4000-8000-000000001301')
    )
  ) ->> 'outcome'),
  'proposed',
  'a settled campaign records its first learning proposal'
);

select extensions.is(
  (select pg_catalog.count(*)::int from public.campaign_learning_proposals
   where organization_id = 'c5000000-0000-4000-8000-000000000101'::uuid
     and campaign_id = 'c5000000-0000-4000-8000-000000000301'::uuid
     and status = 'proposed'),
  1,
  'and exactly one live proposal exists for the campaign'
);

-- Hypothesis and observation are stored as separate fields.
select extensions.is(
  (select hypothesis is distinct from observation from public.campaign_learning_proposals
   where organization_id = 'c5000000-0000-4000-8000-000000000101'::uuid
     and status = 'proposed'),
  true,
  'hypothesis and observation are stored separately, never merged'
);

-- A byte-identical replay is idempotent.
select extensions.is(
  (pg_temp.propose(
    'c5000000-0000-4000-8000-000000000101'::uuid,
    'c5000000-0000-4000-8000-000000000301'::uuid,
    '["c5000000-0000-4000-8000-000000000801"]'::jsonb,
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('kind', 'outcome', 'id', 'c5000000-0000-4000-8000-000000001201'),
      pg_catalog.jsonb_build_object('kind', 'bundle_version', 'id', 'c5000000-0000-4000-8000-000000000501'),
      pg_catalog.jsonb_build_object('kind', 'variant', 'id', 'c5000000-0000-4000-8000-000000000801'),
      pg_catalog.jsonb_build_object('kind', 'policy', 'id', 'c5000000-0000-4000-8000-000000001301')
    )
  ) ->> 'outcome'),
  'unchanged',
  'a replay of the same proposal writes nothing'
);

-- A different proposal while one is live is refused: one live proposal per campaign.
select extensions.throws_ok(
  format(
    'select pg_temp.propose(%L::uuid, %L::uuid, %L::jsonb, %L::jsonb, %L::jsonb)',
    'c5000000-0000-4000-8000-000000000101'::uuid,
    'c5000000-0000-4000-8000-000000000301'::uuid,
    '["c5000000-0000-4000-8000-000000000801"]'::jsonb,
    '[]'::jsonb,
    pg_catalog.jsonb_build_object('proposed_lesson', 'a different lesson')
  ),
  '22023',
  null,
  'a second proposal while one is undecided is refused'
);

-- Cross-tenant evidence -------------------------------------------------------

select extensions.throws_ok(
  format(
    'select pg_temp.propose(%L::uuid, %L::uuid, %L::jsonb, %L::jsonb)',
    'c5000000-0000-4000-8000-000000000101'::uuid,
    'c5000000-0000-4000-8000-000000000301'::uuid,
    '["c5000000-0000-4000-8000-000000000802"]'::jsonb,
    '[]'::jsonb
  ),
  '22023',
  null,
  'a proposal cannot cite another tenant''s variant'
);

select extensions.throws_ok(
  format(
    'select pg_temp.propose(%L::uuid, %L::uuid, %L::jsonb, %L::jsonb)',
    'c5000000-0000-4000-8000-000000000101'::uuid,
    'c5000000-0000-4000-8000-000000000301'::uuid,
    '[]'::jsonb,
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('kind', 'outcome', 'id', 'c5000000-0000-4000-8000-000000001202')
    )
  ),
  '22023',
  null,
  'a proposal cannot cite another tenant''s outcome'
);

select extensions.throws_ok(
  format(
    'select pg_temp.propose(%L::uuid, %L::uuid, %L::jsonb, %L::jsonb)',
    'c5000000-0000-4000-8000-000000000101'::uuid,
    'c5000000-0000-4000-8000-000000000301'::uuid,
    '[]'::jsonb,
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('kind', 'policy', 'id', 'c5000000-0000-4000-8000-000000001302')
    )
  ),
  '22023',
  null,
  'a proposal cannot cite a policy version the approval never assumed'
);

select extensions.throws_ok(
  $$select public.propose_campaign_learning(
    'c5000000-0000-4000-8000-000000000102'::uuid,
    '{"organization_id": "c5000000-0000-4000-8000-000000000101"}'::jsonb
  )$$,
  '42501',
  null,
  'a worker claiming another tenant is refused outright'
);

-- Append-only -----------------------------------------------------------------

select extensions.throws_ok(
  $$update public.campaign_learning_proposals set proposed_lesson = 'edited'
    where organization_id = 'c5000000-0000-4000-8000-000000000101'::uuid$$,
  '23514',
  null,
  'a drafted lesson cannot be edited in place'
);

select extensions.throws_ok(
  $$delete from public.campaign_learning_proposals
    where organization_id = 'c5000000-0000-4000-8000-000000000101'::uuid$$,
  '23514',
  null,
  'a learning proposal cannot be deleted'
);

-- Deciding --------------------------------------------------------------------

-- A viewer may not decide.
set local role authenticated;
set local request.jwt.claim.sub = 'c5000000-0000-4000-8000-000000000003';

select extensions.throws_ok(
  format(
    'select public.decide_campaign_learning_proposal(%L::uuid, %L::jsonb)',
    'c5000000-0000-4000-8000-000000000101'::uuid,
    pg_catalog.jsonb_build_object(
      'organization_id', 'c5000000-0000-4000-8000-000000000101',
      'proposal_id', (select id from public.campaign_learning_proposals
                      where organization_id = 'c5000000-0000-4000-8000-000000000101'::uuid),
      'decision', 'dismiss'
    )
  ),
  '42501',
  null,
  'a viewer cannot decide a learning proposal'
);

-- An operator may dismiss.
set local request.jwt.claim.sub = 'c5000000-0000-4000-8000-000000000001';

select extensions.is(
  (public.decide_campaign_learning_proposal(
    'c5000000-0000-4000-8000-000000000101'::uuid,
    pg_catalog.jsonb_build_object(
      'organization_id', 'c5000000-0000-4000-8000-000000000101',
      'proposal_id', (select id from public.campaign_learning_proposals
                      where organization_id = 'c5000000-0000-4000-8000-000000000101'::uuid),
      'decision', 'dismiss'
    )
  ) ->> 'status'),
  'dismissed',
  'an operator dismisses a proposal'
);

select extensions.is(
  (select decided_by from public.campaign_learning_proposals
   where organization_id = 'c5000000-0000-4000-8000-000000000101'::uuid),
  'c5000000-0000-4000-8000-000000000001'::uuid,
  'and the decision records the operator'
);

select extensions.is(
  (select decided_at is not null from public.campaign_learning_proposals
   where organization_id = 'c5000000-0000-4000-8000-000000000101'::uuid),
  true,
  'and the time'
);

-- A decision is one-way; a second decision is refused.
select extensions.throws_ok(
  format(
    'select public.decide_campaign_learning_proposal(%L::uuid, %L::jsonb)',
    'c5000000-0000-4000-8000-000000000101'::uuid,
    pg_catalog.jsonb_build_object(
      'organization_id', 'c5000000-0000-4000-8000-000000000101',
      'proposal_id', (select id from public.campaign_learning_proposals
                      where organization_id = 'c5000000-0000-4000-8000-000000000101'::uuid),
      'decision', 'submit_for_promotion'
    )
  ),
  '22023',
  null,
  'a decided proposal cannot be decided again'
);

reset role;

-- Submission sets the target artifact type and nothing else -------------------

select extensions.is(
  (pg_temp.propose(
    'c5000000-0000-4000-8000-000000000102'::uuid,
    'c5000000-0000-4000-8000-000000000302'::uuid,
    '["c5000000-0000-4000-8000-000000000802"]'::jsonb,
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('kind', 'outcome', 'id', 'c5000000-0000-4000-8000-000000001202'),
      pg_catalog.jsonb_build_object('kind', 'bundle_version', 'id', 'c5000000-0000-4000-8000-000000000502'),
      pg_catalog.jsonb_build_object('kind', 'variant', 'id', 'c5000000-0000-4000-8000-000000000802'),
      pg_catalog.jsonb_build_object('kind', 'policy', 'id', 'c5000000-0000-4000-8000-000000001302')
    )
  ) ->> 'outcome'),
  'proposed',
  'tenant two proposes its own lesson from its own evidence'
);

set local role authenticated;
set local request.jwt.claim.sub = 'c5000000-0000-4000-8000-000000000002';

select extensions.is(
  (public.decide_campaign_learning_proposal(
    'c5000000-0000-4000-8000-000000000102'::uuid,
    pg_catalog.jsonb_build_object(
      'organization_id', 'c5000000-0000-4000-8000-000000000102',
      'proposal_id', (select id from public.campaign_learning_proposals
                      where organization_id = 'c5000000-0000-4000-8000-000000000102'::uuid),
      'decision', 'submit_for_promotion'
    )
  ) ->> 'status'),
  'submitted_for_promotion',
  'an operator submits a proposal as a reusable recipe'
);

select extensions.is(
  (select target_artifact_type from public.campaign_learning_proposals
   where organization_id = 'c5000000-0000-4000-8000-000000000102'::uuid),
  'reusable_recipe',
  'submission sets the target artifact type and nothing else'
);

reset role;

select * from extensions.finish();

rollback;
