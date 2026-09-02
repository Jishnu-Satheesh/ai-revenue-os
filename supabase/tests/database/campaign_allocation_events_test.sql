begin;

create extension if not exists pgtap with schema extensions;

select extensions.no_plan();

-- Two tenants, because the whole point of the fast loop is that one client's
-- waste is contained on their own evidence, never anyone else's.
insert into auth.users (id)
values
  ('a5000000-0000-4000-8000-000000000001'::uuid),
  ('a5000000-0000-4000-8000-000000000002'::uuid),
  ('a5000000-0000-4000-8000-000000000003'::uuid);

insert into public.accounts (id, name, slug, created_by)
values (
  'acc00000-0000-4000-8000-a5000000c0de'::uuid, 'Fixture agency',
  'fixture-agency-campaign-allocation-test',
  'a5000000-0000-4000-8000-000000000001'::uuid
);

insert into public.organizations (
  id, name, slug, industry, country_code, base_currency, default_timezone, created_by, account_id
)
values
  (
    'a5000000-0000-4000-8000-000000000101'::uuid,
    'Allocation tenant one', 'allocation-tenant-one', 'testing', 'AE', 'AED', 'Asia/Dubai',
    'a5000000-0000-4000-8000-000000000001'::uuid,
    'acc00000-0000-4000-8000-a5000000c0de'::uuid
  ),
  (
    'a5000000-0000-4000-8000-000000000102'::uuid,
    'Allocation tenant two', 'allocation-tenant-two', 'testing', 'AE', 'AED', 'Asia/Dubai',
    'a5000000-0000-4000-8000-000000000002'::uuid,
    'acc00000-0000-4000-8000-a5000000c0de'::uuid
  );

insert into public.organization_memberships (organization_id, user_id, role)
values
  ('a5000000-0000-4000-8000-000000000101'::uuid, 'a5000000-0000-4000-8000-000000000001'::uuid, 'operator'),
  ('a5000000-0000-4000-8000-000000000102'::uuid, 'a5000000-0000-4000-8000-000000000002'::uuid, 'operator'),
  ('a5000000-0000-4000-8000-000000000101'::uuid, 'a5000000-0000-4000-8000-000000000003'::uuid, 'viewer');

-- One published variant per tenant, with a channel action and a confirmed
-- action run behind it, so both the pause and the pause-run substrate have
-- something real to act on.
create function pg_temp.seed(
  org uuid, author uuid, campaign uuid, version_id uuid, direction uuid,
  asset uuid, variant uuid, action_key uuid, run_id uuid, digest_seed text
)
returns void language plpgsql set search_path = '' as $$
declare
  snapshot uuid := pg_catalog.gen_random_uuid();
  brief uuid := pg_catalog.gen_random_uuid();
begin
  insert into public.campaign_briefs (id, organization_id, objective, audience, created_by)
  values (brief, org, 'Fill weekday lunch covers', 'Nearby office workers', author);

  insert into public.campaigns (id, organization_id, title, source_kind, brief_id, created_by)
  values (campaign, org, 'Allocated campaign', 'manual_brief', brief, author);

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
    content_hash, provenance, state
  ) values (
    variant, org, campaign, version_id, direction, 1, 1, 2, 4,
    'instagram', 'feed_image', 'Two courses, one price',
    'Lunch that pays for itself.', 'Book a table', array['#lunch'], asset,
    pg_catalog.repeat(digest_seed, 64),
    pg_catalog.jsonb_build_object('kind', 'generated'), 'published'
  );

  insert into public.campaign_channel_actions (
    organization_id, bundle_version_id, action_key, direction_key, channel,
    placement, scheduled_for, requirement
  ) values (
    org, version_id, action_key, direction, 'instagram', 'feed_image',
    pg_catalog.now(), 'required'
  );

  insert into public.campaign_action_runs (
    id, organization_id, campaign_id, bundle_version_id, action_key, scheduled_for, status
  ) values (
    run_id, org, campaign, version_id, action_key, pg_catalog.now(), 'confirmed'
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
  'a5000000-0000-4000-8000-000000001001'::uuid,
  'a5000000-0000-4000-8000-000000001101'::uuid,
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
  'a5000000-0000-4000-8000-000000001002'::uuid,
  'a5000000-0000-4000-8000-000000001102'::uuid,
  'b'
);

-- Tenancy and grants ---------------------------------------------------------

select extensions.ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class where relname = 'campaign_allocation_events'),
  'the allocation ledger enables and forces row level security'
);

select extensions.table_privs_are(
  'public', 'campaign_allocation_events', 'authenticated', array['SELECT'],
  'members read the ledger and never write it from a session'
);

select extensions.function_privs_are(
  'public', 'append_campaign_allocation_event', array['uuid', 'jsonb'], 'authenticated',
  array[]::text[],
  'a browser session cannot append an allocation decision'
);

select extensions.function_privs_are(
  'public', 'append_campaign_allocation_event', array['uuid', 'jsonb'], 'service_role',
  array['EXECUTE'],
  'only the worker appends a decision'
);

select extensions.function_privs_are(
  'public', 'resume_campaign_variant', array['uuid', 'jsonb'], 'authenticated',
  array['EXECUTE'],
  'resume is an operator action, so an authenticated session may call it'
);

select extensions.function_privs_are(
  'public', 'pause_campaign_variant', array['uuid', 'jsonb'], 'authenticated',
  array[]::text[],
  'the loop pauses under the worker, never a browser session'
);

-- Appending ------------------------------------------------------------------

select extensions.is(
  (select public.append_campaign_allocation_event(
    'a5000000-0000-4000-8000-000000000101'::uuid,
    pg_catalog.jsonb_build_object(
      'organization_id', 'a5000000-0000-4000-8000-000000000101',
      'campaign_id', 'a5000000-0000-4000-8000-000000000301',
      'cycle_id', 'a5000000-0000-4000-8000-000000000901',
      'variant_id', 'a5000000-0000-4000-8000-000000000801',
      'rule_key', 'diagnostic.spend_ceiling', 'rule_version', 'v1',
      'observed_value', 12000, 'threshold', 10000,
      'resolved_margin_minor', null, 'resolved_margin_grade', null,
      'action', 'pause', 'reason_code', 'spend_ceiling_exceeded',
      'actor', 'agent', 'at', '2026-08-19T12:00:00+00'
    )
  )) is not null,
  true,
  'a pause decision is appended and carries its rule, value, threshold and reason'
);

select extensions.is(
  (select pg_catalog.count(*)::int from public.campaign_allocation_events
   where organization_id = 'a5000000-0000-4000-8000-000000000101'::uuid),
  1,
  'the decision lands against the right tenant'
);

select extensions.is(
  (select reason_code from public.campaign_allocation_events
   where organization_id = 'a5000000-0000-4000-8000-000000000101'::uuid),
  'spend_ceiling_exceeded',
  'and records the stable reason code'
);

-- A decision not to act is still a decision.
select extensions.is(
  (select public.append_campaign_allocation_event(
    'a5000000-0000-4000-8000-000000000101'::uuid,
    pg_catalog.jsonb_build_object(
      'organization_id', 'a5000000-0000-4000-8000-000000000101',
      'campaign_id', 'a5000000-0000-4000-8000-000000000301',
      'cycle_id', 'a5000000-0000-4000-8000-000000000901',
      'variant_id', 'a5000000-0000-4000-8000-000000000801',
      'rule_key', 'margin.contribution_floor', 'rule_version', 'v1',
      'observed_value', null, 'threshold', null,
      'resolved_margin_minor', null, 'resolved_margin_grade', null,
      'action', 'no_action', 'reason_code', 'margin_grade_insufficient',
      'actor', 'agent', 'at', '2026-08-19T12:00:00+00'
    )
  )) is not null,
  true,
  'a margin rule that did not fire is still recorded with its refusal reason'
);

-- Cross-tenant ---------------------------------------------------------------

select extensions.throws_ok(
  format(
    'select public.append_campaign_allocation_event(%L::uuid, %L::jsonb)',
    'a5000000-0000-4000-8000-000000000102'::uuid,
    pg_catalog.jsonb_build_object(
      'organization_id', 'a5000000-0000-4000-8000-000000000102',
      'campaign_id', 'a5000000-0000-4000-8000-000000000302',
      'cycle_id', 'a5000000-0000-4000-8000-000000000902',
      'variant_id', 'a5000000-0000-4000-8000-000000000801',
      'rule_key', 'diagnostic.spend_ceiling', 'rule_version', 'v1',
      'observed_value', 12000, 'threshold', 10000,
      'resolved_margin_minor', null, 'resolved_margin_grade', null,
      'action', 'pause', 'reason_code', 'spend_ceiling_exceeded',
      'actor', 'agent', 'at', '2026-08-19T12:00:00+00'
    )
  ),
  '23503',
  null,
  'one tenant cannot record a decision against another tenant''s variant'
);

-- Append-only -----------------------------------------------------------------

select extensions.throws_ok(
  $$update public.campaign_allocation_events set reason_code = 'edited'
    where organization_id = 'a5000000-0000-4000-8000-000000000101'::uuid$$,
  '23514',
  null,
  'a recorded decision cannot be edited in place'
);

select extensions.throws_ok(
  $$delete from public.campaign_allocation_events
    where organization_id = 'a5000000-0000-4000-8000-000000000101'::uuid$$,
  '23514',
  null,
  'a recorded decision cannot be deleted'
);

-- The wall --------------------------------------------------------------------

select extensions.ok(
  (select pg_catalog.strpos(
    pg_catalog.pg_get_functiondef('public.append_campaign_allocation_event(uuid, jsonb)'::regprocedure),
    'campaign_exposures'
  ) = 0),
  'the allocation writer never names an exposure record'
);

select extensions.ok(
  (select pg_catalog.strpos(
    pg_catalog.pg_get_functiondef('public.append_campaign_allocation_event(uuid, jsonb)'::regprocedure),
    'campaign_metric_observations'
  ) = 0),
  'the allocation writer never names an observation record'
);

-- Task 22: the allocation loop can neither trigger nor influence a learning
-- proposal, so its writer can never name the proposals table either.
select extensions.ok(
  (select pg_catalog.strpos(
    pg_catalog.pg_get_functiondef('public.append_campaign_allocation_event(uuid, jsonb)'::regprocedure),
    'campaign_learning_proposals'
  ) = 0),
  'the allocation writer never names a learning proposal'
);

-- Variant state ---------------------------------------------------------------

select extensions.is(
  (public.pause_campaign_variant(
    'a5000000-0000-4000-8000-000000000101'::uuid,
    pg_catalog.jsonb_build_object(
      'organization_id', 'a5000000-0000-4000-8000-000000000101',
      'variant_id', 'a5000000-0000-4000-8000-000000000801'
    )
  ) ->> 'outcome'),
  'paused',
  'the loop marks a published variant paused by the agent'
);

select extensions.is(
  (select state from public.campaign_creative_variants
   where id = 'a5000000-0000-4000-8000-000000000801'::uuid),
  'paused_by_agent',
  'and the state is exactly the agent pause state'
);

select extensions.is(
  (public.pause_campaign_variant(
    'a5000000-0000-4000-8000-000000000101'::uuid,
    pg_catalog.jsonb_build_object(
      'organization_id', 'a5000000-0000-4000-8000-000000000101',
      'variant_id', 'a5000000-0000-4000-8000-000000000801'
    )
  ) ->> 'outcome'),
  'already_paused',
  'pausing an already-paused variant changes nothing'
);

select extensions.throws_ok(
  format(
    'select public.pause_campaign_variant(%L::uuid, %L::jsonb)',
    'a5000000-0000-4000-8000-000000000102'::uuid,
    pg_catalog.jsonb_build_object(
      'organization_id', 'a5000000-0000-4000-8000-000000000102',
      'variant_id', 'a5000000-0000-4000-8000-000000000801'
    )
  ),
  '42501',
  null,
  'one tenant cannot pause another tenant''s variant'
);

-- Resume, which is an operator-only act --------------------------------------

-- A viewer may not resume.
set local role authenticated;
set local request.jwt.claim.sub = 'a5000000-0000-4000-8000-000000000003';

select extensions.throws_ok(
  format(
    'select public.resume_campaign_variant(%L::uuid, %L::jsonb)',
    'a5000000-0000-4000-8000-000000000101'::uuid,
    pg_catalog.jsonb_build_object(
      'organization_id', 'a5000000-0000-4000-8000-000000000101',
      'variant_id', 'a5000000-0000-4000-8000-000000000801'
    )
  ),
  '42501',
  null,
  'a viewer cannot resume, because resume re-grants spend authority'
);

-- An operator may resume, and the act is recorded with actor and time.
set local request.jwt.claim.sub = 'a5000000-0000-4000-8000-000000000001';

select extensions.is(
  (public.resume_campaign_variant(
    'a5000000-0000-4000-8000-000000000101'::uuid,
    pg_catalog.jsonb_build_object(
      'organization_id', 'a5000000-0000-4000-8000-000000000101',
      'variant_id', 'a5000000-0000-4000-8000-000000000801'
    )
  ) ->> 'outcome'),
  'resumed',
  'an operator resumes a paused variant'
);

select extensions.is(
  (select state from public.campaign_creative_variants
   where id = 'a5000000-0000-4000-8000-000000000801'::uuid),
  'published',
  'and the variant is back to published'
);

select extensions.is(
  (select resumed_by from public.campaign_variant_resumes
   where variant_id = 'a5000000-0000-4000-8000-000000000801'::uuid),
  'a5000000-0000-4000-8000-000000000001'::uuid,
  'the resume records the operator who performed it'
);

select extensions.is(
  (select resumed_at is not null from public.campaign_variant_resumes
   where variant_id = 'a5000000-0000-4000-8000-000000000801'::uuid),
  true,
  'and the time it happened'
);

reset role;

-- Candidates and margin -------------------------------------------------------

-- Tenant one's published variant is a candidate with no diagnostics yet (no
-- metric rows), and absence is null rather than zero.
select extensions.is(
  (select pg_catalog.jsonb_array_length(
    public.read_campaign_allocation_candidates(
      'a5000000-0000-4000-8000-000000000101'::uuid,
      'a5000000-0000-4000-8000-000000000301'::uuid
    )
  )),
  1,
  'a published variant is a candidate for the loop'
);

select extensions.is(
  (select (value ->> 'impressions') is null
   from pg_catalog.jsonb_array_elements(
     public.read_campaign_allocation_candidates(
       'a5000000-0000-4000-8000-000000000101'::uuid,
       'a5000000-0000-4000-8000-000000000301'::uuid
     )
   )),
  true,
  'no collected impressions reads as null, not zero'
);

-- A channel margin the economics ledger graded as a scalar is returned.
insert into public.channel_economics_entries (
  organization_id, grain, channel, period_start, period_end, period_timezone,
  gross_revenue_minor, transaction_count, currency, margin_source,
  completeness_grade, contribution_margin_minor, reported_quality_tier
) values (
  'a5000000-0000-4000-8000-000000000101'::uuid, 'period', 'instagram',
  '2026-08-12T20:00:00+00', '2026-08-19T20:00:00+00', 'Asia/Dubai',
  50000, 120, 'AED', 'reported', 'complete', 8400, 'measured'
);

select extensions.is(
  (public.read_campaign_channel_margin(
    'a5000000-0000-4000-8000-000000000101'::uuid, 'instagram'
  ) ->> 'resolved_margin_grade'),
  'measured',
  'a graded channel margin resolves with its quality tier'
);

select extensions.is(
  (public.read_campaign_channel_margin(
    'a5000000-0000-4000-8000-000000000101'::uuid, 'instagram'
  ) ->> 'contribution_margin_minor')::numeric,
  8400::numeric,
  'and its figure in minor units'
);

select extensions.is(
  public.read_campaign_channel_margin(
    'a5000000-0000-4000-8000-000000000102'::uuid, 'instagram'
  ),
  null,
  'a tenant with no graded margin resolves to null, never another tenant''s figure'
);

-- Pause-run substrate ---------------------------------------------------------

select extensions.is(
  (public.create_campaign_pause_run(
    'a5000000-0000-4000-8000-000000000101'::uuid,
    pg_catalog.jsonb_build_object(
      'organization_id', 'a5000000-0000-4000-8000-000000000101',
      'variant_id', 'a5000000-0000-4000-8000-000000000801',
      'depth', 'ad'
    )
  ) ->> 'outcome'),
  'created',
  'a pause is its own action run targeting the confirmed build'
);

select extensions.is(
  (select pr.target_action_run_id
   from public.campaign_pause_runs pr
   where pr.organization_id = 'a5000000-0000-4000-8000-000000000101'::uuid),
  'a5000000-0000-4000-8000-000000001101'::uuid,
  'the pause request names the build run that created the ad'
);

select extensions.is(
  (public.read_campaign_pause_request(
    'a5000000-0000-4000-8000-000000000101'::uuid,
    (select pr.pause_action_run_id
     from public.campaign_pause_runs pr
     where pr.organization_id = 'a5000000-0000-4000-8000-000000000101'::uuid)
  ) ->> 'depth'),
  'ad',
  'and the adapter can resolve the pause request from the run id alone'
);

select * from extensions.finish();

rollback;
