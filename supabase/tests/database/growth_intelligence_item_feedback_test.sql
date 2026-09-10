begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(17);

-- Shape -----------------------------------------------------------------------

select extensions.has_table(
  'public', 'growth_intelligence_item_feedback',
  'synthesized items carry one helpfulness vote per actor'
);
select extensions.has_column(
  'public', 'growth_intelligence_item_feedback', 'helpful',
  'the vote is a single helpful boolean'
);
select extensions.col_not_null(
  'public', 'growth_intelligence_item_feedback', 'helpful',
  'an abstention is never stored'
);
select extensions.ok(
  (select relrowsecurity from pg_catalog.pg_class
   where oid = 'public.growth_intelligence_item_feedback'::pg_catalog.regclass),
  'feedback rows enforce row level security'
);
select extensions.ok(
  (select relforcerowsecurity from pg_catalog.pg_class
   where oid = 'public.growth_intelligence_item_feedback'::pg_catalog.regclass),
  'feedback rows force row level security for table owners too'
);
select extensions.ok(
  pg_catalog.has_table_privilege('authenticated', 'public.growth_intelligence_item_feedback', 'select'),
  'members read feedback through row level security'
);
select extensions.ok(
  not pg_catalog.has_table_privilege('authenticated', 'public.growth_intelligence_item_feedback', 'insert,update,delete'),
  'authenticated sessions cannot write feedback directly'
);
select extensions.has_function(
  'public', 'record_growth_intelligence_item_feedback',
  array['uuid', 'uuid', 'boolean', 'uuid'],
  'helpfulness votes have one governed write path'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.record_growth_intelligence_item_feedback(uuid,uuid,boolean,uuid)',
    'execute'
  ),
  'authenticated members receive the feedback entry point'
);
select extensions.ok(
  not pg_catalog.has_function_privilege(
    'service_role',
    'public.record_growth_intelligence_item_feedback(uuid,uuid,boolean,uuid)',
    'execute'
  ),
  'the worker role never casts a member helpfulness vote'
);

-- Fixtures --------------------------------------------------------------------

insert into auth.users (id) values
  ('c9100000-0000-4000-8000-000000000001'::uuid),
  ('c9100000-0000-4000-8000-000000000003'::uuid),
  ('c9100000-0000-4000-8000-000000000004'::uuid);

insert into public.accounts (id, name, slug, created_by) values
  ('c9100000-0000-4000-8000-000000000101'::uuid, 'Feedback agency', 'feedback-agency', 'c9100000-0000-4000-8000-000000000001'::uuid);

insert into public.organizations (
  id, account_id, name, slug, industry, country_code, base_currency,
  default_timezone, created_by
) values
  ('c9100000-0000-4000-8000-000000000201'::uuid, 'c9100000-0000-4000-8000-000000000101'::uuid, 'Feedback client', 'feedback-client', 'testing', 'AE', 'AED', 'Asia/Dubai', 'c9100000-0000-4000-8000-000000000001'::uuid),
  ('c9100000-0000-4000-8000-000000000202'::uuid, 'c9100000-0000-4000-8000-000000000101'::uuid, 'Neighbour client', 'neighbour-client', 'testing', 'AE', 'AED', 'Asia/Dubai', 'c9100000-0000-4000-8000-000000000001'::uuid);

insert into public.account_memberships (
  account_id, user_id, account_role, default_organization_role
) values
  ('c9100000-0000-4000-8000-000000000101'::uuid, 'c9100000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner'),
  ('c9100000-0000-4000-8000-000000000101'::uuid, 'c9100000-0000-4000-8000-000000000003'::uuid, 'member', 'viewer');

insert into public.organization_market_profiles (id, organization_id, enabled) values
  ('c9100000-0000-4000-8000-000000000301'::uuid, 'c9100000-0000-4000-8000-000000000201'::uuid, false),
  ('c9100000-0000-4000-8000-000000000302'::uuid, 'c9100000-0000-4000-8000-000000000202'::uuid, false);

insert into public.organization_market_profile_versions (
  id, organization_id, market_profile_id, version, schema_version,
  profile_document, profile_digest, source_policy_digest, proposal_source,
  created_by, correlation_id
) values (
  'c9100000-0000-4000-8000-000000000311'::uuid, 'c9100000-0000-4000-8000-000000000201'::uuid,
  'c9100000-0000-4000-8000-000000000301'::uuid, 1, 1,
  pg_catalog.jsonb_build_object('schemaVersion', 1),
  repeat('d', 64), repeat('c', 64), 'operator',
  'c9100000-0000-4000-8000-000000000001'::uuid, 'c9100000-0000-4000-8000-000000000006'::uuid
), (
  'c9100000-0000-4000-8000-000000000312'::uuid, 'c9100000-0000-4000-8000-000000000202'::uuid,
  'c9100000-0000-4000-8000-000000000302'::uuid, 1, 1,
  pg_catalog.jsonb_build_object('schemaVersion', 1),
  repeat('d', 64), repeat('c', 64), 'operator',
  'c9100000-0000-4000-8000-000000000001'::uuid, 'c9100000-0000-4000-8000-000000000006'::uuid
);

insert into public.growth_intelligence_requests (
  id, organization_id, kind, trigger_reason, request_fingerprint,
  market_profile_version_id, source_policy_digest, research_rule_version,
  local_time_bucket, status, due_at, correlation_id
) values (
  'c9100000-0000-4000-8000-000000000402'::uuid, 'c9100000-0000-4000-8000-000000000201'::uuid,
  'business_evidence_changed', 'business_evidence_current', repeat('e', 64),
  'c9100000-0000-4000-8000-000000000311'::uuid, repeat('c', 64), 'market-research@1',
  'immediate', 'pending', pg_catalog.now(),
  'c9100000-0000-4000-8000-000000000006'::uuid
), (
  'c9100000-0000-4000-8000-000000000412'::uuid, 'c9100000-0000-4000-8000-000000000202'::uuid,
  'business_evidence_changed', 'business_evidence_current', repeat('e', 64),
  'c9100000-0000-4000-8000-000000000312'::uuid, repeat('c', 64), 'market-research@1',
  'immediate', 'pending', pg_catalog.now(),
  'c9100000-0000-4000-8000-000000000006'::uuid
);

insert into public.growth_intelligence_synthesis_runs (
  id, organization_id, growth_intelligence_request_id, market_profile_version_id,
  claim_token, provider, run_fingerprint, status, result_digest, item_count,
  completed_at, correlation_id
) values (
  'c9100000-0000-4000-8000-000000000401'::uuid, 'c9100000-0000-4000-8000-000000000201'::uuid,
  'c9100000-0000-4000-8000-000000000402'::uuid, 'c9100000-0000-4000-8000-000000000311'::uuid,
  'c9100000-0000-4000-8000-000000000403'::uuid, 'synthesis-test', repeat('f', 64),
  'completed', repeat('b', 64), 1, pg_catalog.now(),
  'c9100000-0000-4000-8000-000000000006'::uuid
), (
  'c9100000-0000-4000-8000-000000000411'::uuid, 'c9100000-0000-4000-8000-000000000202'::uuid,
  'c9100000-0000-4000-8000-000000000412'::uuid, 'c9100000-0000-4000-8000-000000000312'::uuid,
  'c9100000-0000-4000-8000-000000000413'::uuid, 'synthesis-test', repeat('f', 64),
  'completed', repeat('b', 64), 1, pg_catalog.now(),
  'c9100000-0000-4000-8000-000000000006'::uuid
);

insert into public.growth_intelligence_items (
  id, organization_id, growth_intelligence_synthesis_run_id, market_profile_version_id,
  kind, narrative, item_fingerprint, evidence_fingerprint,
  geographic_layer, geography_ref, support_grade, freshness, urgency, goal_alignment,
  activity_month, missing_input
) values (
  'c9100000-0000-4000-8000-000000000501'::uuid, 'c9100000-0000-4000-8000-000000000201'::uuid,
  'c9100000-0000-4000-8000-000000000401'::uuid, 'c9100000-0000-4000-8000-000000000311'::uuid,
  'recommendation', 'Review the opening hours behind cancelled orders.',
  repeat('1', 64), repeat('2', 64),
  'city', 'ae:du', 'corroborated', 'current', 'high', 'direct',
  '2026-08', null
), (
  'c9100000-0000-4000-8000-000000000502'::uuid, 'c9100000-0000-4000-8000-000000000202'::uuid,
  'c9100000-0000-4000-8000-000000000411'::uuid, 'c9100000-0000-4000-8000-000000000312'::uuid,
  'recommendation', 'A neighbour recommendation that must stay invisible.',
  repeat('3', 64), repeat('4', 64),
  'city', 'ae:du', 'corroborated', 'current', 'high', 'direct',
  '2026-08', null
);

-- Votes -----------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'c9100000-0000-4000-8000-000000000001';

select extensions.is(
  (select helpful from public.growth_intelligence_item_feedback
   where growth_intelligence_item_id = 'c9100000-0000-4000-8000-000000000501'::uuid
     and actor_id = 'c9100000-0000-4000-8000-000000000001'::uuid),
  null,
  'no vote exists before the first call'
);

select public.record_growth_intelligence_item_feedback(
  'c9100000-0000-4000-8000-000000000201'::uuid,
  'c9100000-0000-4000-8000-000000000501'::uuid,
  true,
  'c9100000-0000-4000-8000-000000000001'::uuid
);

select extensions.is(
  (select helpful from public.growth_intelligence_item_feedback
   where growth_intelligence_item_id = 'c9100000-0000-4000-8000-000000000501'::uuid
     and actor_id = 'c9100000-0000-4000-8000-000000000001'::uuid),
  true,
  'an owner records a helpful vote on their own item'
);

select public.record_growth_intelligence_item_feedback(
  'c9100000-0000-4000-8000-000000000201'::uuid,
  'c9100000-0000-4000-8000-000000000501'::uuid,
  false,
  'c9100000-0000-4000-8000-000000000001'::uuid
);

select extensions.is(
  (select helpful from public.growth_intelligence_item_feedback
   where growth_intelligence_item_id = 'c9100000-0000-4000-8000-000000000501'::uuid
     and actor_id = 'c9100000-0000-4000-8000-000000000001'::uuid),
  false,
  'changing your mind moves the same row rather than stacking votes'
);

reset role;

set local role authenticated;
set local request.jwt.claim.sub = 'c9100000-0000-4000-8000-000000000003';

select public.record_growth_intelligence_item_feedback(
  'c9100000-0000-4000-8000-000000000201'::uuid,
  'c9100000-0000-4000-8000-000000000501'::uuid,
  true,
  'c9100000-0000-4000-8000-000000000003'::uuid
);

select extensions.is(
  (select helpful from public.growth_intelligence_item_feedback
   where growth_intelligence_item_id = 'c9100000-0000-4000-8000-000000000501'::uuid
     and actor_id = 'c9100000-0000-4000-8000-000000000003'::uuid),
  true,
  'a viewer grades the narration while operators answer it'
);

select extensions.throws_ok(
  $$
  select public.record_growth_intelligence_item_feedback(
    'c9100000-0000-4000-8000-000000000201'::uuid,
    'c9100000-0000-4000-8000-000000000502'::uuid,
    true,
    'c9100000-0000-4000-8000-000000000003'::uuid
  )
  $$,
  'P0002', 'growth intelligence item was not found',
  'a neighbour item is refused exactly like one that does not exist'
);

reset role;

set local role authenticated;
set local request.jwt.claim.sub = 'c9100000-0000-4000-8000-000000000004';

select extensions.throws_ok(
  $$
  select public.record_growth_intelligence_item_feedback(
    'c9100000-0000-4000-8000-000000000201'::uuid,
    'c9100000-0000-4000-8000-000000000501'::uuid,
    true,
    'c9100000-0000-4000-8000-000000000004'::uuid
  )
  $$,
  '42501', 'growth intelligence item feedback is not authorized',
  'a stranger with no membership cannot vote'
);

select extensions.throws_ok(
  $$
  select public.record_growth_intelligence_item_feedback(
    'c9100000-0000-4000-8000-000000000201'::uuid,
    'c9100000-0000-4000-8000-000000000501'::uuid,
    true,
    'c9100000-0000-4000-8000-000000000001'::uuid
  )
  $$,
  '42501', 'growth intelligence item feedback is not authorized',
  'the session cannot vote as somebody else'
);

reset role;

rollback;
