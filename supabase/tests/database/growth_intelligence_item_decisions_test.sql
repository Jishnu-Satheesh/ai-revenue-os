begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(27);

select extensions.has_function(
  'public', 'decide_growth_intelligence_item',
  array['uuid', 'uuid', 'uuid', 'text', 'text', 'timestamptz', 'text'],
  'operators triage items through one governed operation'
);
select extensions.has_function(
  'public', 'set_growth_intelligence_preference',
  array['uuid', 'uuid', 'text', 'uuid', 'boolean', 'timestamptz'],
  'actor preferences have one governed write path'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated', 'public.decide_growth_intelligence_item(uuid,uuid,uuid,text,text,timestamptz,text)', 'execute'
  )
  and pg_catalog.has_function_privilege(
    'authenticated', 'public.set_growth_intelligence_preference(uuid,uuid,text,uuid,boolean,timestamptz)', 'execute'
  ),
  'authenticated operators receive triage and preference entry points'
);
select extensions.ok(
  not pg_catalog.has_table_privilege('authenticated', 'public.growth_intelligence_item_decisions', 'insert,update,delete'),
  'authenticated sessions cannot write triage history directly'
);
select extensions.ok(
  pg_catalog.has_table_privilege('service_role', 'public.growth_intelligence_requests', 'select')
  and pg_catalog.has_table_privilege('service_role', 'public.organization_market_profiles', 'select')
  and pg_catalog.has_table_privilege('service_role', 'public.organization_market_profile_versions', 'select')
  and pg_catalog.has_table_privilege('service_role', 'public.market_evidence_sources', 'select')
  and pg_catalog.has_table_privilege('service_role', 'public.market_evidence_claims', 'select')
  and pg_catalog.has_table_privilege('service_role', 'public.market_evidence_claim_events', 'select')
  and pg_catalog.has_table_privilege('service_role', 'public.market_evidence_links', 'select')
  and pg_catalog.has_table_privilege('service_role', 'public.channel_findings', 'select'),
  'the synthesis worker role reads request, profile, evidence, and finding tables'
);
select extensions.ok(
  pg_catalog.has_table_privilege('service_role', 'public.growth_intelligence_synthesis_runs', 'select')
  and pg_catalog.has_table_privilege('service_role', 'public.growth_intelligence_items', 'select'),
  'the synthesis worker role reads synthesis runs and items'
);

-- Fixtures --------------------------------------------------------------------

insert into auth.users (id) values
  ('c9000000-0000-4000-8000-000000000001'::uuid),
  ('c9000000-0000-4000-8000-000000000003'::uuid);

insert into public.accounts (id, name, slug, created_by) values
  ('c9000000-0000-4000-8000-000000000101'::uuid, 'Triage agency', 'triage-agency', 'c9000000-0000-4000-8000-000000000001'::uuid);

insert into public.organizations (
  id, account_id, name, slug, industry, country_code, base_currency,
  default_timezone, created_by
) values
  ('c9000000-0000-4000-8000-000000000201'::uuid, 'c9000000-0000-4000-8000-000000000101'::uuid, 'Triage client', 'triage-client', 'testing', 'AE', 'AED', 'Asia/Dubai', 'c9000000-0000-4000-8000-000000000001'::uuid);

insert into public.account_memberships (
  account_id, user_id, account_role, default_organization_role
) values
  ('c9000000-0000-4000-8000-000000000101'::uuid, 'c9000000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner'),
  ('c9000000-0000-4000-8000-000000000101'::uuid, 'c9000000-0000-4000-8000-000000000003'::uuid, 'member', 'viewer');

-- Profile stays disabled: the table check requires (not enabled or current_version_id
-- is not null), and no case in this suite reads profile state.
insert into public.organization_market_profiles (id, organization_id, enabled) values
  ('c9000000-0000-4000-8000-000000000301'::uuid, 'c9000000-0000-4000-8000-000000000201'::uuid, false);

insert into public.organization_market_profile_versions (
  id, organization_id, market_profile_id, version, schema_version,
  profile_document, profile_digest, source_policy_digest, proposal_source,
  created_by, correlation_id
) values (
  'c9000000-0000-4000-8000-000000000302'::uuid, 'c9000000-0000-4000-8000-000000000201'::uuid,
  'c9000000-0000-4000-8000-000000000301'::uuid, 1, 1,
  pg_catalog.jsonb_build_object('schemaVersion', 1),
  repeat('d', 64), repeat('c', 64), 'operator',
  'c9000000-0000-4000-8000-000000000001'::uuid, 'c9000000-0000-4000-8000-000000000006'::uuid
);

insert into public.growth_intelligence_requests (
  id, organization_id, kind, trigger_reason, request_fingerprint,
  market_profile_version_id, source_policy_digest, research_rule_version,
  local_time_bucket, status, due_at, correlation_id
) values (
  'c9000000-0000-4000-8000-000000000402'::uuid, 'c9000000-0000-4000-8000-000000000201'::uuid,
  'business_evidence_changed', 'business_evidence_current', repeat('e', 64),
  'c9000000-0000-4000-8000-000000000302'::uuid, repeat('c', 64), 'market-research@1',
  'immediate', 'pending', pg_catalog.now(),
  'c9000000-0000-4000-8000-000000000006'::uuid
);

insert into public.growth_intelligence_synthesis_runs (
  id, organization_id, growth_intelligence_request_id, market_profile_version_id,
  claim_token, provider, run_fingerprint, status, result_digest, item_count,
  completed_at, correlation_id
) values (
  'c9000000-0000-4000-8000-000000000401'::uuid, 'c9000000-0000-4000-8000-000000000201'::uuid,
  'c9000000-0000-4000-8000-000000000402'::uuid, 'c9000000-0000-4000-8000-000000000302'::uuid,
  'c9000000-0000-4000-8000-000000000403'::uuid, 'synthesis-test', repeat('f', 64),
  'completed', repeat('b', 64), 2, pg_catalog.now(),
  'c9000000-0000-4000-8000-000000000006'::uuid
);

insert into public.growth_intelligence_items (
  id, organization_id, growth_intelligence_synthesis_run_id, market_profile_version_id,
  kind, narrative, item_fingerprint, evidence_fingerprint,
  geographic_layer, geography_ref, support_grade, freshness, urgency, goal_alignment,
  activity_month, missing_input
) values (
  'c9000000-0000-4000-8000-000000000501'::uuid, 'c9000000-0000-4000-8000-000000000201'::uuid,
  'c9000000-0000-4000-8000-000000000401'::uuid, 'c9000000-0000-4000-8000-000000000302'::uuid,
  'recommendation', 'Recorded dinner demand clusters across Dubai this month.',
  repeat('1', 64), repeat('2', 64),
  'city', 'ae:du', 'corroborated', 'current', 'high', 'direct',
  '2026-08', null
), (
  'c9000000-0000-4000-8000-000000000502'::uuid, 'c9000000-0000-4000-8000-000000000201'::uuid,
  'c9000000-0000-4000-8000-000000000401'::uuid, 'c9000000-0000-4000-8000-000000000302'::uuid,
  'data_gap', 'Weekend channel coverage is missing.',
  repeat('3', 64), repeat('4', 64),
  'city', 'ae:du', 'single_source', 'current', 'medium', 'none',
  '2026-08', 'weekend-channel-coverage'
), (
  'c9000000-0000-4000-8000-000000000503'::uuid, 'c9000000-0000-4000-8000-000000000201'::uuid,
  'c9000000-0000-4000-8000-000000000401'::uuid, 'c9000000-0000-4000-8000-000000000302'::uuid,
  'insight', 'Rainy Thursdays lift delivery orders across the city.',
  repeat('5', 64), repeat('6', 64),
  'city', 'ae:du', 'corroborated', 'current', 'medium', 'direct',
  '2026-08', null
);

-- Governed triage ---------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'c9000000-0000-4000-8000-000000000001';

select extensions.is(
  public.decide_growth_intelligence_item(
    'c9000000-0000-4000-8000-000000000201'::uuid,
    'c9000000-0000-4000-8000-000000000001'::uuid,
    'c9000000-0000-4000-8000-000000000501'::uuid,
    'acknowledged', null, null, repeat('1', 64)
  ) ->> 'decision',
  'acknowledged',
  'an operator acknowledges the exact fingerprint they saw'
);

select extensions.throws_ok(
  $$
  select public.decide_growth_intelligence_item(
    'c9000000-0000-4000-8000-000000000201'::uuid,
    'c9000000-0000-4000-8000-000000000001'::uuid,
    'c9000000-0000-4000-8000-000000000501'::uuid,
    'snoozed', null, pg_catalog.now() - interval '1 hour', repeat('1', 64)
  )
  $$,
  '22023', 'growth_intelligence_item_snooze_not_future',
  'snooze horizons must be future timestamps'
);

select extensions.throws_ok(
  $$
  select public.decide_growth_intelligence_item(
    'c9000000-0000-4000-8000-000000000201'::uuid,
    'c9000000-0000-4000-8000-000000000001'::uuid,
    'c9000000-0000-4000-8000-000000000501'::uuid,
    'planned', null, null, repeat('9', 64)
  )
  $$,
  '23505', 'growth_intelligence_item_stale',
  'a stale fingerprint cannot decide a superseded reading'
);

select extensions.throws_ok(
  $$
  select public.decide_growth_intelligence_item(
    'c9000000-0000-4000-8000-000000000201'::uuid,
    'c9000000-0000-4000-8000-000000000001'::uuid,
    'c9000000-0000-4000-8000-000000000501'::uuid,
    'resolved', null, null, repeat('1', 64)
  )
  $$,
  '22023', 'growth_intelligence_data_gap_resolution_forbidden',
  'resolved fails closed off a Data Gap until a deterministic path exists'
);

select extensions.throws_ok(
  $$
  select public.decide_growth_intelligence_item(
    'c9000000-0000-4000-8000-000000000201'::uuid,
    'c9000000-0000-4000-8000-000000000001'::uuid,
    'c9000000-0000-4000-8000-000000000502'::uuid,
    'resolved', null, null, repeat('3', 64)
  )
  $$,
  '22023', 'growth_intelligence_data_gap_resolution_forbidden',
  'a Data Gap cannot resolve by operator assertion; Task 17 owns deterministic reopening'
);

-- Kind-to-decision gating -------------------------------------------------------

select extensions.is(
  public.decide_growth_intelligence_item(
    'c9000000-0000-4000-8000-000000000201'::uuid,
    'c9000000-0000-4000-8000-000000000001'::uuid,
    'c9000000-0000-4000-8000-000000000503'::uuid,
    'acknowledged', null, null, repeat('5', 64)
  ) ->> 'decision',
  'acknowledged',
  'an Insight accepts acknowledgement'
);

select extensions.throws_ok(
  $$
  select public.decide_growth_intelligence_item(
    'c9000000-0000-4000-8000-000000000201'::uuid,
    'c9000000-0000-4000-8000-000000000001'::uuid,
    'c9000000-0000-4000-8000-000000000503'::uuid,
    'planned', null, null, repeat('5', 64)
  )
  $$,
  '22023', 'growth_intelligence_item_decision_invalid',
  'an Insight cannot be planned; only a Recommendation records intent'
);

select extensions.throws_ok(
  $$
  select public.decide_growth_intelligence_item(
    'c9000000-0000-4000-8000-000000000201'::uuid,
    'c9000000-0000-4000-8000-000000000001'::uuid,
    'c9000000-0000-4000-8000-000000000503'::uuid,
    'snoozed', null, pg_catalog.now() + interval '7 days', repeat('5', 64)
  )
  $$,
  '22023', 'growth_intelligence_item_decision_invalid',
  'an Insight cannot be snoozed either'
);

select extensions.throws_ok(
  $$
  select public.decide_growth_intelligence_item(
    'c9000000-0000-4000-8000-000000000201'::uuid,
    'c9000000-0000-4000-8000-000000000001'::uuid,
    'c9000000-0000-4000-8000-000000000502'::uuid,
    'dismissed', 'No longer relevant.', null, repeat('3', 64)
  )
  $$,
  '22023', 'growth_intelligence_item_decision_invalid',
  'a Data Gap cannot be dismissed; it waits on evidence, not opinion'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'c9000000-0000-4000-8000-000000000003';

select extensions.throws_ok(
  $$
  select public.decide_growth_intelligence_item(
    'c9000000-0000-4000-8000-000000000201'::uuid,
    'c9000000-0000-4000-8000-000000000003'::uuid,
    'c9000000-0000-4000-8000-000000000501'::uuid,
    'dismissed', null, null, repeat('1', 64)
  )
  $$,
  '42501', 'growth_intelligence_item_decision_forbidden',
  'viewers cannot triage items'
);

select extensions.throws_ok(
  $$
  select public.decide_growth_intelligence_item(
    'c9000000-0000-4000-8000-000000000201'::uuid,
    'c9000000-0000-4000-8000-000000000001'::uuid,
    'c9000000-0000-4000-8000-000000000501'::uuid,
    'dismissed', null, null, repeat('1', 64)
  )
  $$,
  '42501', 'growth_intelligence_item_decision_forbidden',
  'one actor cannot decide as another'
);

-- Actor-scoped preferences ------------------------------------------------------

select extensions.is(
  public.set_growth_intelligence_preference(
    'c9000000-0000-4000-8000-000000000201'::uuid,
    'c9000000-0000-4000-8000-000000000003'::uuid,
    'synthesis_item',
    'c9000000-0000-4000-8000-000000000501'::uuid,
    true
  ) ->> 'pinned',
  'true',
  'a viewer may still pin their own view'
);

select extensions.is(
  (select pinned from public.growth_intelligence_item_preferences
   where organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid
     and user_id = 'c9000000-0000-4000-8000-000000000003'::uuid),
  true,
  'the pin persists actor-scoped'
);

select extensions.is(
  (select pg_catalog.count(*) from public.growth_intelligence_item_preferences
   where organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid
     and user_id = 'c9000000-0000-4000-8000-000000000001'::uuid),
  0::bigint,
  'one actor pin never touches another actor ordering'
);

select extensions.throws_ok(
  $$
  select public.set_growth_intelligence_preference(
    'c9000000-0000-4000-8000-000000000201'::uuid,
    'c9000000-0000-4000-8000-000000000003'::uuid,
    'channel_recommendation',
    'c9000000-0000-4000-8000-000000000501'::uuid,
    true
  )
  $$,
  '23503', 'insert or update on table "channel_recommendation_preferences" violates foreign key constraint "channel_recommendation_prefer_organization_id_channel_reco_fkey"',
  'a pin cannot name a nonexistent Channel Recommendation'
);

select extensions.throws_ok(
  $$
  select public.set_growth_intelligence_preference(
    'c9000000-0000-4000-8000-000000000201'::uuid,
    'c9000000-0000-4000-8000-000000000003'::uuid,
    'opportunity',
    'c9000000-0000-4000-8000-000000000502'::uuid,
    true
  )
  $$,
  '23503', 'insert or update on table "opportunity_preferences" violates foreign key constraint "opportunity_preferences_organization_id_opportunity_id_fkey"',
  'a pin cannot name a nonexistent Opportunity'
);

select extensions.is(
  (select pg_catalog.count(*) from public.growth_intelligence_item_decisions
   where organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid),
  2::bigint,
  'triage history stays append-only across decisions'
);

reset role;
-- Clear the viewer JWT left over from the triage block: SET LOCAL persists to
-- transaction end, and the membership guard trigger would read a stale actor
-- for the second tenant's fixtures below.
reset request.jwt.claim.sub;

select extensions.throws_ok(
  $$
  update public.growth_intelligence_item_decisions
  set reason = 'Rewritten history.'
  where organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid
  $$,
  '55000', 'market_evidence_immutable',
  'triage history cannot be rewritten directly'
);

select extensions.throws_ok(
  $$
  delete from public.growth_intelligence_item_decisions
  where organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid
  $$,
  -- DELETE carries its own refusal string since the Task 5 retention rewrite
  -- of private.reject_market_evidence_immutable_mutation(); the behavior —
  -- refusal — is unchanged, only the message names the operation.
  '55000', 'market_evidence_delete_forbidden',
  'triage history cannot be deleted directly'
);

insert into auth.users (id) values
  ('c9000000-0000-4000-8000-000000000004'::uuid);

insert into public.accounts (id, name, slug, created_by) values
  ('c9000000-0000-4000-8000-000000000102'::uuid, 'Second triage agency', 'triage-agency-b', 'c9000000-0000-4000-8000-000000000004'::uuid);

insert into public.organizations (
  id, account_id, name, slug, industry, country_code, base_currency,
  default_timezone, created_by
) values
  ('c9000000-0000-4000-8000-000000000202'::uuid, 'c9000000-0000-4000-8000-000000000102'::uuid, 'Second triage client', 'triage-client-b', 'testing', 'AE', 'AED', 'Asia/Dubai', 'c9000000-0000-4000-8000-000000000004'::uuid);

insert into public.account_memberships (
  account_id, user_id, account_role, default_organization_role
) values
  ('c9000000-0000-4000-8000-000000000102'::uuid, 'c9000000-0000-4000-8000-000000000004'::uuid, 'owner', 'owner');

set local role authenticated;
set local request.jwt.claim.sub = 'c9000000-0000-4000-8000-000000000004';

select extensions.is(
  (select pg_catalog.count(*) from public.growth_intelligence_item_decisions
   where organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid),
  0::bigint,
  'RLS hides another account triage history'
);

select extensions.is(
  (select pg_catalog.count(*) from public.growth_intelligence_item_preferences
   where organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid),
  0::bigint,
  'RLS hides another account actor preferences'
);

reset role;

select extensions.finish();
rollback;
