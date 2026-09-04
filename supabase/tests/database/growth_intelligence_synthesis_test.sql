begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(48);

-- Contract, indexes, and grants --------------------------------------------

select extensions.has_table('public', 'growth_intelligence_synthesis_runs', 'synthesis runs are durable');
select extensions.has_table('public', 'growth_intelligence_items', 'synthesized items persist');
select extensions.has_table('public', 'growth_intelligence_item_market_claims', 'item claim links persist');
select extensions.has_table('public', 'growth_intelligence_item_channel_findings', 'item finding links persist');
select extensions.has_table('public', 'growth_intelligence_item_goals', 'item goal links persist');
select extensions.has_table('public', 'growth_intelligence_item_decisions', 'item triage history persists');
select extensions.has_table('public', 'growth_intelligence_item_preferences', 'actor preferences persist');
select extensions.has_table('public', 'channel_recommendation_preferences', 'recommendation preferences persist');
select extensions.has_table('public', 'opportunity_preferences', 'opportunity preferences persist');

select extensions.has_function(
  'public', 'begin_growth_intelligence_synthesis', array['uuid', 'uuid', 'uuid', 'jsonb'],
  'synthesis runs begin under a request lease'
);
select extensions.has_function(
  'public', 'complete_growth_intelligence_synthesis', array['uuid', 'uuid', 'uuid', 'uuid', 'jsonb'],
  'synthesis completion stores validated items'
);
select extensions.has_function(
  'public', 'fail_growth_intelligence_synthesis', array['uuid', 'uuid', 'uuid', 'uuid', 'text'],
  'synthesis failure is fenced and sanitized'
);
select extensions.hasnt_column(
  'public', 'growth_intelligence_items', 'channel_recommendation_id',
  'no Channel Recommendation identifier can be stored as a synthesized item copy'
);
select extensions.hasnt_column(
  'public', 'growth_intelligence_items', 'opportunity_id',
  'no Opportunity identifier can be stored as a synthesized item copy'
);
select extensions.ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.begin_growth_intelligence_synthesis(uuid,uuid,uuid,jsonb)'::regprocedure
    ),
    'pg_advisory_xact_lock'
  ) > 0,
  'synthesis run admission is serialized before lookup'
);
select extensions.ok(
  pg_catalog.has_table_privilege('authenticated', 'public.growth_intelligence_items', 'select')
  and not pg_catalog.has_table_privilege('authenticated', 'public.growth_intelligence_items', 'insert,update,delete'),
  'authenticated sessions read items but cannot write them directly'
);
select extensions.ok(
  pg_catalog.has_function_privilege('service_role', 'public.begin_growth_intelligence_synthesis(uuid,uuid,uuid,jsonb)', 'execute')
  and pg_catalog.has_function_privilege('service_role', 'public.complete_growth_intelligence_synthesis(uuid,uuid,uuid,uuid,jsonb)', 'execute')
  and pg_catalog.has_function_privilege('service_role', 'public.fail_growth_intelligence_synthesis(uuid,uuid,uuid,uuid,text)', 'execute'),
  'only the worker role begins, completes, and fails synthesis runs'
);
select extensions.ok(
  not pg_catalog.has_function_privilege('authenticated', 'public.begin_growth_intelligence_synthesis(uuid,uuid,uuid,jsonb)', 'execute')
  and not pg_catalog.has_function_privilege('anon', 'public.complete_growth_intelligence_synthesis(uuid,uuid,uuid,uuid,jsonb)', 'execute'),
  'signed-in sessions and anonymous callers cannot impersonate a synthesis worker'
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
select extensions.ok(
  (select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid = 'public.growth_intelligence_items'::regclass),
  'items enforce tenant isolation even for table owners'
);

-- Two-account fixtures ------------------------------------------------------

insert into auth.users (id) values
  ('b9000000-0000-4000-8000-000000000001'::uuid),
  ('b9000000-0000-4000-8000-000000000004'::uuid);

insert into public.accounts (id, name, slug, created_by) values
  ('b9000000-0000-4000-8000-000000000101'::uuid, 'Synthesis agency A', 'synthesis-agency-a', 'b9000000-0000-4000-8000-000000000001'::uuid),
  ('b9000000-0000-4000-8000-000000000102'::uuid, 'Synthesis agency B', 'synthesis-agency-b', 'b9000000-0000-4000-8000-000000000004'::uuid);

insert into public.organizations (
  id, account_id, name, slug, industry, country_code, base_currency,
  default_timezone, created_by
) values
  ('b9000000-0000-4000-8000-000000000201'::uuid, 'b9000000-0000-4000-8000-000000000101'::uuid, 'Synthesis client A', 'synthesis-client-a', 'testing', 'AE', 'AED', 'Asia/Dubai', 'b9000000-0000-4000-8000-000000000001'::uuid),
  ('b9000000-0000-4000-8000-000000000202'::uuid, 'b9000000-0000-4000-8000-000000000102'::uuid, 'Synthesis client B', 'synthesis-client-b', 'testing', 'AE', 'AED', 'Asia/Dubai', 'b9000000-0000-4000-8000-000000000004'::uuid);

insert into public.account_memberships (
  account_id, user_id, account_role, default_organization_role
) values
  ('b9000000-0000-4000-8000-000000000101'::uuid, 'b9000000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner'),
  ('b9000000-0000-4000-8000-000000000102'::uuid, 'b9000000-0000-4000-8000-000000000004'::uuid, 'owner', 'owner');

-- Profile starts disabled: the table check requires (not enabled or current_version_id
-- is not null), so the row is enabled atomically with its first version below.
insert into public.organization_market_profiles (id, organization_id, enabled) values
  ('b9000000-0000-4000-8000-000000000301'::uuid, 'b9000000-0000-4000-8000-000000000201'::uuid, false);

insert into public.organization_market_profile_versions (
  id, organization_id, market_profile_id, version, schema_version,
  profile_document, profile_digest, source_policy_digest, proposal_source,
  created_by, correlation_id
) values (
  'b9000000-0000-4000-8000-000000000302'::uuid, 'b9000000-0000-4000-8000-000000000201'::uuid,
  'b9000000-0000-4000-8000-000000000301'::uuid, 1, 1,
  pg_catalog.jsonb_build_object('schemaVersion', 1),
  repeat('d', 64), repeat('c', 64), 'operator',
  'b9000000-0000-4000-8000-000000000001'::uuid, 'b9000000-0000-4000-8000-000000000006'::uuid
);

update public.organization_market_profiles
set current_version_id = 'b9000000-0000-4000-8000-000000000302'::uuid,
    enabled = true
where id = 'b9000000-0000-4000-8000-000000000301'::uuid;

insert into public.growth_intelligence_requests (
  id, organization_id, kind, trigger_reason, request_fingerprint,
  market_profile_version_id, source_policy_digest, research_rule_version,
  local_time_bucket, status, due_at, claim_token, lease_expires_at,
  attempt_count, correlation_id
) values (
  'b9000000-0000-4000-8000-000000000401'::uuid, 'b9000000-0000-4000-8000-000000000201'::uuid,
  'business_evidence_changed', 'business_evidence_current', repeat('e', 64),
  'b9000000-0000-4000-8000-000000000302'::uuid, repeat('c', 64), 'market-research@1',
  'immediate', 'claimed', pg_catalog.now(),
  'b9000000-0000-4000-8000-000000000402'::uuid, pg_catalog.now() + interval '10 minutes',
  1, 'b9000000-0000-4000-8000-000000000006'::uuid
);

-- Lease fencing ---------------------------------------------------------------

set local role service_role;

select extensions.throws_ok(
  $$
  select public.begin_growth_intelligence_synthesis(
    'b9000000-0000-4000-8000-000000000201'::uuid,
    'b9000000-0000-4000-8000-000000000401'::uuid,
    'b9000000-0000-4000-8000-000000000403'::uuid,
    pg_catalog.jsonb_build_object(
      'provider', 'synthesis-test',
      'runFingerprint', repeat('f', 64),
      'correlationId', 'b9000000-0000-4000-8000-000000000006'
    )
  )
  $$,
  '42501', 'growth_intelligence_synthesis_claim_lost',
  'synthesis cannot begin without the live request lease'
);

select extensions.is(
  public.begin_growth_intelligence_synthesis(
    'b9000000-0000-4000-8000-000000000201'::uuid,
    'b9000000-0000-4000-8000-000000000401'::uuid,
    'b9000000-0000-4000-8000-000000000402'::uuid,
    pg_catalog.jsonb_build_object(
      'provider', 'synthesis-test',
      'runFingerprint', repeat('f', 64),
      'correlationId', 'b9000000-0000-4000-8000-000000000006'
    )
  ) ->> 'replayed',
  'false',
  'the first begin opens the run'
);

select extensions.is(
  public.begin_growth_intelligence_synthesis(
    'b9000000-0000-4000-8000-000000000201'::uuid,
    'b9000000-0000-4000-8000-000000000401'::uuid,
    'b9000000-0000-4000-8000-000000000402'::uuid,
    pg_catalog.jsonb_build_object(
      'provider', 'synthesis-test',
      'runFingerprint', repeat('f', 64),
      'correlationId', 'b9000000-0000-4000-8000-000000000006'
    )
  ) ->> 'replayed',
  'true',
  'duplicate delivery replays the same run'
);

select extensions.throws_ok(
  $$
  select public.begin_growth_intelligence_synthesis(
    'b9000000-0000-4000-8000-000000000201'::uuid,
    'b9000000-0000-4000-8000-000000000401'::uuid,
    'b9000000-0000-4000-8000-000000000402'::uuid,
    pg_catalog.jsonb_build_object(
      'provider', 'synthesis-test',
      'runFingerprint', repeat('a', 64),
      'correlationId', 'b9000000-0000-4000-8000-000000000006'
    )
  )
  $$,
  '23505', 'growth_intelligence_synthesis_run_idempotency_conflict',
  'a conflicting fingerprint under one lease is a conflict, not a replay'
);

reset role;

select extensions.throws_ok(
  $$
  select public.begin_growth_intelligence_synthesis(
    'b9000000-0000-4000-8000-000000000201'::uuid,
    'b9000000-0000-4000-8000-000000000401'::uuid,
    'b9000000-0000-4000-8000-000000000402'::uuid,
    pg_catalog.jsonb_build_object(
      'provider', 'synthesis-test',
      'runFingerprint', repeat('f', 64),
      'correlationId', 'b9000000-0000-4000-8000-000000000006'
    )
  )
  $$,
  '42501', 'growth_intelligence_synthesis_worker_forbidden',
  'a signed-in session cannot impersonate a synthesis worker'
);

-- Fenced completion, idempotency, and tenant isolation --------------------------

set local role service_role;

select extensions.is(
  public.complete_growth_intelligence_synthesis(
    'b9000000-0000-4000-8000-000000000201'::uuid,
    'b9000000-0000-4000-8000-000000000401'::uuid,
    'b9000000-0000-4000-8000-000000000402'::uuid,
    (select run.id from public.growth_intelligence_synthesis_runs run
     where run.organization_id = 'b9000000-0000-4000-8000-000000000201'::uuid
     and run.growth_intelligence_request_id = 'b9000000-0000-4000-8000-000000000401'::uuid),
    pg_catalog.jsonb_build_object(
      'outcome', 'completed',
      'resultDigest', repeat('b', 64),
      'items', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'kind', 'insight',
          'narrative', 'Recorded dinner demand clusters across Dubai this month.',
          'itemFingerprint', repeat('1', 64),
          'evidenceFingerprint', repeat('2', 64),
          'geographicLayer', 'city',
          'geographyRef', 'ae:du',
          'supportGrade', 'corroborated',
          'freshness', 'current',
          'urgency', 'high',
          'goalAlignment', 'direct',
          'activityMonth', '2026-08',
          'claimIds', pg_catalog.jsonb_build_array(),
          'findings', pg_catalog.jsonb_build_array(),
          'goals', pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object('ref', 'cover-more-occasions', 'alignment', 'direct')
          )
        )
      )
    )
  ) ->> 'itemCount',
  '1',
  'completion stores one validated item with its goal link'
);

-- Link tables are write-only for the worker (SELECT stays with
-- authenticated readers), so this white-box count runs as the owner.
reset role;

select extensions.is(
  (select pg_catalog.count(*) from public.growth_intelligence_item_goals
   where organization_id = 'b9000000-0000-4000-8000-000000000201'::uuid),
  1::bigint,
  'goal links persist tenant-composite'
);

set local role service_role;

-- Committed supersession (Ruling R-A) ------------------------------------------
-- Fixtures insert as the owner: the worker role is SELECT-only by design.
reset role;

insert into public.growth_intelligence_requests (
  id, organization_id, kind, trigger_reason, request_fingerprint,
  market_profile_version_id, source_policy_digest, research_rule_version,
  local_time_bucket, status, due_at, claim_token, lease_expires_at,
  attempt_count, correlation_id
) values (
  'b9000000-0000-4000-8000-000000000501'::uuid, 'b9000000-0000-4000-8000-000000000201'::uuid,
  'business_evidence_changed', 'business_evidence_current', repeat('7', 64),
  'b9000000-0000-4000-8000-000000000302'::uuid, repeat('c', 64), 'market-research@1',
  'immediate', 'claimed', pg_catalog.now(),
  'b9000000-0000-4000-8000-000000000502'::uuid, pg_catalog.now() + interval '10 minutes',
  1, 'b9000000-0000-4000-8000-000000000006'::uuid
);

set local role service_role;

select extensions.is(
  public.begin_growth_intelligence_synthesis(
    'b9000000-0000-4000-8000-000000000201'::uuid,
    'b9000000-0000-4000-8000-000000000501'::uuid,
    'b9000000-0000-4000-8000-000000000502'::uuid,
    pg_catalog.jsonb_build_object(
      'provider', 'synthesis-test',
      'runFingerprint', repeat('e', 64),
      'correlationId', 'b9000000-0000-4000-8000-000000000006'
    )
  ) ->> 'replayed',
  'false',
  'a new request opens its own run'
);

create temporary table second_completion as
select public.complete_growth_intelligence_synthesis(
  'b9000000-0000-4000-8000-000000000201'::uuid,
  'b9000000-0000-4000-8000-000000000501'::uuid,
  'b9000000-0000-4000-8000-000000000502'::uuid,
  (select run.id from public.growth_intelligence_synthesis_runs run
   where run.organization_id = 'b9000000-0000-4000-8000-000000000201'::uuid
   and run.growth_intelligence_request_id = 'b9000000-0000-4000-8000-000000000501'::uuid),
  pg_catalog.jsonb_build_object(
    'outcome', 'completed',
    'resultDigest', repeat('a', 64),
    'items', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'kind', 'insight',
        'narrative', 'Recorded dinner demand clusters across Dubai this month, revised.',
        'itemFingerprint', repeat('3', 64),
        'evidenceFingerprint', repeat('4', 64),
        'geographicLayer', 'city',
        'geographyRef', 'ae:du',
        'supportGrade', 'corroborated',
        'freshness', 'current',
        'urgency', 'high',
        'goalAlignment', 'direct',
        'activityMonth', '2026-08',
        'claimIds', pg_catalog.jsonb_build_array(),
        'findings', pg_catalog.jsonb_build_array(),
        'goals', pg_catalog.jsonb_build_array()
      )
    )
  )
) as result;

select extensions.is(
  (select result ->> 'itemCount' from second_completion),
  '1',
  'a second completion with changed evidence stores the revised item'
);

select extensions.is(
  (select result -> 'supersededItemIds' from second_completion),
  (select pg_catalog.jsonb_build_array(pg_catalog.to_jsonb(item.id))
   from public.growth_intelligence_items item
   where item.item_fingerprint = repeat('1', 64)),
  'the committed outcome names the superseded item id'
);

select extensions.is(
  (select item.status from public.growth_intelligence_items item
   where item.item_fingerprint = repeat('1', 64)),
  'superseded',
  'the prior same-kind item flips to superseded'
);

select extensions.is(
  (select item.superseded_by_item_id::text from public.growth_intelligence_items item
   where item.item_fingerprint = repeat('1', 64)),
  (select item.id::text from public.growth_intelligence_items item
   where item.item_fingerprint = repeat('3', 64)),
  'the prior item points at its replacement'
);

-- Month-scoped supersession (Fix round 2: currency is per-month) -------------
-- A revised profile retires same-month priors; prior-month unresolved items
-- keep their status for Task 16 carry-over.
-- Fixtures insert as the owner: the worker role is SELECT-only by design.
reset role;

insert into public.growth_intelligence_requests (
  id, organization_id, kind, trigger_reason, request_fingerprint,
  market_profile_version_id, source_policy_digest, research_rule_version,
  local_time_bucket, status, due_at, claim_token, lease_expires_at,
  attempt_count, correlation_id
) values (
  'b9000000-0000-4000-8000-000000000601'::uuid, 'b9000000-0000-4000-8000-000000000201'::uuid,
  'business_evidence_changed', 'business_evidence_current', repeat('9', 64),
  'b9000000-0000-4000-8000-000000000302'::uuid, repeat('c', 64), 'market-research@1',
  'immediate', 'claimed', pg_catalog.now(),
  'b9000000-0000-4000-8000-000000000602'::uuid, pg_catalog.now() + interval '10 minutes',
  1, 'b9000000-0000-4000-8000-000000000006'::uuid
);

set local role service_role;

select extensions.is(
  public.begin_growth_intelligence_synthesis(
    'b9000000-0000-4000-8000-000000000201'::uuid,
    'b9000000-0000-4000-8000-000000000601'::uuid,
    'b9000000-0000-4000-8000-000000000602'::uuid,
    pg_catalog.jsonb_build_object(
      'provider', 'synthesis-test',
      'runFingerprint', repeat('8', 64),
      'correlationId', 'b9000000-0000-4000-8000-000000000006'
    )
  ) ->> 'replayed',
  'false',
  'a later-month request opens its own run'
);

create temporary table third_completion as
select public.complete_growth_intelligence_synthesis(
  'b9000000-0000-4000-8000-000000000201'::uuid,
  'b9000000-0000-4000-8000-000000000601'::uuid,
  'b9000000-0000-4000-8000-000000000602'::uuid,
  (select run.id from public.growth_intelligence_synthesis_runs run
   where run.organization_id = 'b9000000-0000-4000-8000-000000000201'::uuid
   and run.growth_intelligence_request_id = 'b9000000-0000-4000-8000-000000000601'::uuid),
  pg_catalog.jsonb_build_object(
    'outcome', 'completed',
    'resultDigest', repeat('0', 64),
    'items', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'kind', 'insight',
        'narrative', 'Recorded dinner demand clusters across Dubai next month.',
        'itemFingerprint', repeat('5', 64),
        'evidenceFingerprint', repeat('6', 64),
        'geographicLayer', 'city',
        'geographyRef', 'ae:du',
        'supportGrade', 'corroborated',
        'freshness', 'current',
        'urgency', 'high',
        'goalAlignment', 'direct',
        'activityMonth', '2026-09',
        'claimIds', pg_catalog.jsonb_build_array(),
        'findings', pg_catalog.jsonb_build_array(),
        'goals', pg_catalog.jsonb_build_array()
      )
    )
  )
) as result;

select extensions.is(
  (select result ->> 'itemCount' from third_completion),
  '1',
  'a cross-month completion with changed evidence stores the new-month item'
);

select extensions.is(
  (select result -> 'supersededItemIds' from third_completion),
  (select pg_catalog.jsonb_build_array()),
  'a cross-month item supersedes nothing'
);

select extensions.is(
  (select item.status from public.growth_intelligence_items item
   where item.item_fingerprint = repeat('3', 64)),
  'current',
  'the prior-month same-kind item stays current'
);

select extensions.is(
  (select item.status from public.growth_intelligence_items item
   where item.item_fingerprint = repeat('5', 64)),
  'current',
  'the new-month item is current'
);

-- Layer-scoped supersession (final review item 3: the flip is scoped to
-- geographic_layer as well as geography_ref) --------------------------------
-- Same kind, geography, and month at a different layer retires nothing.
-- Fixtures insert as the owner: the worker role is SELECT-only by design.
reset role;

insert into public.growth_intelligence_requests (
  id, organization_id, kind, trigger_reason, request_fingerprint,
  market_profile_version_id, source_policy_digest, research_rule_version,
  local_time_bucket, status, due_at, claim_token, lease_expires_at,
  attempt_count, correlation_id
) values (
  'b9000000-0000-4000-8000-000000000801'::uuid, 'b9000000-0000-4000-8000-000000000201'::uuid,
  'business_evidence_changed', 'business_evidence_current', repeat('4', 64),
  'b9000000-0000-4000-8000-000000000302'::uuid, repeat('c', 64), 'market-research@1',
  'immediate', 'claimed', pg_catalog.now(),
  'b9000000-0000-4000-8000-000000000802'::uuid, pg_catalog.now() + interval '10 minutes',
  1, 'b9000000-0000-4000-8000-000000000006'::uuid
);

set local role service_role;

do $$
begin
  perform public.begin_growth_intelligence_synthesis(
    'b9000000-0000-4000-8000-000000000201'::uuid,
    'b9000000-0000-4000-8000-000000000801'::uuid,
    'b9000000-0000-4000-8000-000000000802'::uuid,
    pg_catalog.jsonb_build_object(
      'provider', 'synthesis-test',
      'runFingerprint', repeat('2', 64),
      'correlationId', 'b9000000-0000-4000-8000-000000000006'
    )
  );
end;
$$;

create temporary table fifth_completion as
select public.complete_growth_intelligence_synthesis(
  'b9000000-0000-4000-8000-000000000201'::uuid,
  'b9000000-0000-4000-8000-000000000801'::uuid,
  'b9000000-0000-4000-8000-000000000802'::uuid,
  (select run.id from public.growth_intelligence_synthesis_runs run
   where run.organization_id = 'b9000000-0000-4000-8000-000000000201'::uuid
   and run.growth_intelligence_request_id = 'b9000000-0000-4000-8000-000000000801'::uuid),
  pg_catalog.jsonb_build_object(
    'outcome', 'completed',
    'resultDigest', repeat('d', 64),
    'items', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'kind', 'insight',
        'narrative', 'Recorded dinner demand clusters across the country this month.',
        'itemFingerprint', repeat('7', 64),
        'evidenceFingerprint', repeat('8', 64),
        'geographicLayer', 'country',
        'geographyRef', 'ae:du',
        'supportGrade', 'corroborated',
        'freshness', 'current',
        'urgency', 'high',
        'goalAlignment', 'direct',
        'activityMonth', '2026-08',
        'claimIds', pg_catalog.jsonb_build_array(),
        'findings', pg_catalog.jsonb_build_array(),
        'goals', pg_catalog.jsonb_build_array()
      )
    )
  )
) as result;

select extensions.is(
  (select result -> 'supersededItemIds' from fifth_completion),
  (select pg_catalog.jsonb_build_array()),
  'a same-ref cross-layer item supersedes nothing'
);

-- Duplicate fingerprints across runs store nothing and flip nothing --------
-- A byte-identical fingerprint replays through ON CONFLICT DO NOTHING, so
-- links and supersession stay gated on the insert actually landing.
-- Fixtures insert as the owner: the worker role is SELECT-only by design.
reset role;

insert into public.growth_intelligence_requests (
  id, organization_id, kind, trigger_reason, request_fingerprint,
  market_profile_version_id, source_policy_digest, research_rule_version,
  local_time_bucket, status, due_at, claim_token, lease_expires_at,
  attempt_count, correlation_id
) values (
  'b9000000-0000-4000-8000-000000000701'::uuid, 'b9000000-0000-4000-8000-000000000201'::uuid,
  'business_evidence_changed', 'business_evidence_current', repeat('6', 64),
  'b9000000-0000-4000-8000-000000000302'::uuid, repeat('c', 64), 'market-research@1',
  'immediate', 'claimed', pg_catalog.now(),
  'b9000000-0000-4000-8000-000000000702'::uuid, pg_catalog.now() + interval '10 minutes',
  1, 'b9000000-0000-4000-8000-000000000006'::uuid
);

set local role service_role;

select extensions.is(
  public.begin_growth_intelligence_synthesis(
    'b9000000-0000-4000-8000-000000000201'::uuid,
    'b9000000-0000-4000-8000-000000000701'::uuid,
    'b9000000-0000-4000-8000-000000000702'::uuid,
    pg_catalog.jsonb_build_object(
      'provider', 'synthesis-test',
      'runFingerprint', repeat('7', 64),
      'correlationId', 'b9000000-0000-4000-8000-000000000006'
    )
  ) ->> 'replayed',
  'false',
  'a replayed-evidence request opens its own run'
);

create temporary table fourth_completion as
select public.complete_growth_intelligence_synthesis(
  'b9000000-0000-4000-8000-000000000201'::uuid,
  'b9000000-0000-4000-8000-000000000701'::uuid,
  'b9000000-0000-4000-8000-000000000702'::uuid,
  (select run.id from public.growth_intelligence_synthesis_runs run
   where run.organization_id = 'b9000000-0000-4000-8000-000000000201'::uuid
   and run.growth_intelligence_request_id = 'b9000000-0000-4000-8000-000000000701'::uuid),
  pg_catalog.jsonb_build_object(
    'outcome', 'completed',
    'resultDigest', repeat('9', 64),
    'items', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'kind', 'insight',
        'narrative', 'Recorded dinner demand clusters across Dubai this month, revised.',
        'itemFingerprint', repeat('3', 64),
        'evidenceFingerprint', repeat('4', 64),
        'geographicLayer', 'city',
        'geographyRef', 'ae:du',
        'supportGrade', 'corroborated',
        'freshness', 'current',
        'urgency', 'high',
        'goalAlignment', 'direct',
        'activityMonth', '2026-08',
        'claimIds', pg_catalog.jsonb_build_array(),
        'findings', pg_catalog.jsonb_build_array(),
        'goals', pg_catalog.jsonb_build_array()
      )
    )
  )
) as result;

select extensions.is(
  (select result ->> 'itemCount' from fourth_completion),
  '0',
  'a byte-identical fingerprint stores nothing twice'
);

select extensions.is(
  (select result -> 'supersededItemIds' from fourth_completion),
  (select pg_catalog.jsonb_build_array()),
  'a skipped duplicate supersedes nothing'
);

-- Direct-DML guards run as the table owner: the trigger error fires
-- independent of role, while grant-less service_role would fail with 42501.
reset role;

select extensions.throws_ok(
  $$
  update public.growth_intelligence_items
  set status = 'current'
  where organization_id = 'b9000000-0000-4000-8000-000000000201'::uuid
    and status = 'superseded'
  $$,
  '55000', 'market_evidence_immutable',
  'superseded items cannot be revived outside the committed transition'
);

set local role service_role;

select extensions.throws_ok(
  $$
  select public.complete_growth_intelligence_synthesis(
    'b9000000-0000-4000-8000-000000000201'::uuid,
    'b9000000-0000-4000-8000-000000000401'::uuid,
    'b9000000-0000-4000-8000-000000000402'::uuid,
    (select run.id from public.growth_intelligence_synthesis_runs run
     where run.organization_id = 'b9000000-0000-4000-8000-000000000201'::uuid
     and run.growth_intelligence_request_id = 'b9000000-0000-4000-8000-000000000401'::uuid),
    pg_catalog.jsonb_build_object(
      'outcome', 'completed',
      'resultDigest', repeat('b', 64),
      'items', pg_catalog.jsonb_build_array()
    )
  )
  $$,
  '22023', 'growth_intelligence_synthesis_run_not_running',
  'a completed run cannot complete twice'
);

-- The FK error fires independent of role, while grant-less service_role
-- would fail with 42501 before the FK check.
reset role;

select extensions.throws_ok(
  $$
  insert into public.growth_intelligence_item_market_claims (
    organization_id, growth_intelligence_item_id, market_evidence_claim_id
  ) values (
    'b9000000-0000-4000-8000-000000000201'::uuid,
    (select item.id from public.growth_intelligence_items item
     where item.organization_id = 'b9000000-0000-4000-8000-000000000201'::uuid
     and item.item_fingerprint = repeat('1', 64)),
    'b9000000-0000-4000-8000-000000000202'::uuid
  )
  $$,
  '23503', 'insert or update on table "growth_intelligence_item_market_claims" violates foreign key constraint "growth_intelligence_item_mark_organization_id_market_evide_fkey"',
  'a cross-tenant claim link fails'
);

set local role service_role;

-- Direct-DML guards run as the table owner: the trigger error fires
-- independent of role, while grant-less service_role would fail with 42501.
reset role;

select extensions.throws_ok(
  $$
  update public.growth_intelligence_items
  set narrative = 'Rewritten history.'
  where organization_id = 'b9000000-0000-4000-8000-000000000201'::uuid
  $$,
  '55000', 'market_evidence_immutable',
  'stored items are append-only'
);

set local role service_role;

-- The delete guard fires independent of role: run as the owner so the
-- trigger error fires instead of 42501.
reset role;

select extensions.throws_ok(
  $$
  delete from public.growth_intelligence_synthesis_runs
  where organization_id = 'b9000000-0000-4000-8000-000000000201'::uuid
  $$,
  '55000', 'growth_intelligence_synthesis_run_delete_forbidden',
  'synthesis runs cannot be deleted'
);

set local role service_role;

reset role;

set local role authenticated;
set local request.jwt.claim.sub = 'b9000000-0000-4000-8000-000000000004';

select extensions.is(
  (select pg_catalog.count(*) from public.growth_intelligence_items
   where organization_id = 'b9000000-0000-4000-8000-000000000201'::uuid),
  0::bigint,
  'RLS hides another account synthesis ledger'
);

reset role;

select extensions.finish();
rollback;
