begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(61);

-- Contract, tenant boundary, and least-privilege access --------------------

select extensions.has_table('public', 'market_research_runs', 'a research-run ledger exists');
select extensions.has_table('public', 'market_evidence_sources', 'compact evidence sources exist');
select extensions.has_table('public', 'market_evidence_claims', 'immutable evidence claims exist');
select extensions.has_table('public', 'market_evidence_claim_events', 'claim state history exists');
select extensions.has_table('public', 'market_evidence_links', 'corroboration and contradiction links exist');
select extensions.has_function(
  'public', 'begin_market_research_run', array['uuid', 'uuid', 'uuid', 'jsonb'],
  'a claimed request begins one fenced research run'
);
select extensions.has_function(
  'public', 'complete_market_research_run', array['uuid', 'uuid', 'uuid', 'uuid', 'jsonb'],
  'a research run completes through its request fence'
);
select extensions.has_function(
  'public', 'fail_market_research_run', array['uuid', 'uuid', 'uuid', 'uuid', 'jsonb'],
  'a research run records one audited safe fenced failure'
);
select extensions.has_function(
  'public', 'record_market_evidence_claims', array['uuid', 'uuid', 'uuid', 'uuid', 'jsonb'],
  'compact cited claims enter through the request fence'
);
select extensions.has_function(
  'public', 'append_market_evidence_claim_event', array['uuid', 'uuid', 'uuid', 'text', 'jsonb'],
  'claim changes append immutable state history'
);
select extensions.ok(
  (
    select pg_catalog.bool_and(relation.relrowsecurity and relation.relforcerowsecurity)
    from pg_catalog.pg_class relation
    where relation.oid in (
      'public.market_research_runs'::regclass,
      'public.market_evidence_sources'::regclass,
      'public.market_evidence_claims'::regclass,
      'public.market_evidence_claim_events'::regclass,
      'public.market_evidence_links'::regclass
    )
  ),
  'every exposed Market Evidence table enables and forces RLS'
);
select extensions.ok(
  pg_catalog.has_table_privilege('authenticated', 'public.market_evidence_claims', 'select')
  and pg_catalog.has_table_privilege('authenticated', 'public.market_evidence_sources', 'select')
  and pg_catalog.has_table_privilege('authenticated', 'public.market_evidence_links', 'select'),
  'authenticated members receive evidence read grants'
);
select extensions.ok(
  not pg_catalog.has_table_privilege('authenticated', 'public.market_evidence_claims', 'insert,update,delete')
  and not pg_catalog.has_table_privilege('authenticated', 'public.market_evidence_claim_events', 'insert,update,delete'),
  'authenticated members cannot write evidence rows directly'
);
select extensions.ok(
  pg_catalog.has_function_privilege('service_role', 'public.begin_market_research_run(uuid,uuid,uuid,jsonb)', 'execute')
  and pg_catalog.has_function_privilege('service_role', 'public.record_market_evidence_claims(uuid,uuid,uuid,uuid,jsonb)', 'execute')
  and pg_catalog.has_function_privilege('service_role', 'public.complete_market_research_run(uuid,uuid,uuid,uuid,jsonb)', 'execute')
  and pg_catalog.has_function_privilege('service_role', 'public.fail_market_research_run(uuid,uuid,uuid,uuid,jsonb)', 'execute')
  and pg_catalog.has_function_privilege('service_role', 'public.append_market_evidence_claim_event(uuid,uuid,uuid,text,jsonb)', 'execute'),
  'only the worker role receives evidence write operations'
);
select extensions.ok(
  not pg_catalog.has_function_privilege('authenticated', 'public.begin_market_research_run(uuid,uuid,uuid,jsonb)', 'execute')
  and not pg_catalog.has_function_privilege('authenticated', 'public.record_market_evidence_claims(uuid,uuid,uuid,uuid,jsonb)', 'execute')
  and not pg_catalog.has_function_privilege('authenticated', 'public.complete_market_research_run(uuid,uuid,uuid,uuid,jsonb)', 'execute'),
  'a signed-in session cannot impersonate an evidence worker'
);
select extensions.has_index(
  'public', 'market_evidence_claims', 'market_evidence_claims_active_idx',
  'active claim reads remain tenant-leading and bounded'
);

-- Two-tenant fixtures -------------------------------------------------------

insert into auth.users (id) values
  ('a9000000-0000-4000-8000-000000000001'::uuid),
  ('a9000000-0000-4000-8000-000000000002'::uuid),
  ('a9000000-0000-4000-8000-000000000003'::uuid),
  ('a9000000-0000-4000-8000-000000000004'::uuid);

insert into public.accounts (id, name, slug, created_by) values
  ('a9000000-0000-4000-8000-000000000101'::uuid, 'Market evidence agency A', 'market-evidence-agency-a', 'a9000000-0000-4000-8000-000000000001'::uuid),
  ('a9000000-0000-4000-8000-000000000102'::uuid, 'Market evidence agency B', 'market-evidence-agency-b', 'a9000000-0000-4000-8000-000000000004'::uuid);

insert into public.organizations (
  id, account_id, name, slug, industry, country_code, base_currency,
  default_timezone, created_by
) values
  ('a9000000-0000-4000-8000-000000000201'::uuid, 'a9000000-0000-4000-8000-000000000101'::uuid, 'Market evidence client A', 'market-evidence-client-a', 'testing', 'AE', 'AED', 'Asia/Dubai', 'a9000000-0000-4000-8000-000000000001'::uuid),
  ('a9000000-0000-4000-8000-000000000202'::uuid, 'a9000000-0000-4000-8000-000000000102'::uuid, 'Market evidence client B', 'market-evidence-client-b', 'testing', 'AE', 'AED', 'Asia/Dubai', 'a9000000-0000-4000-8000-000000000004'::uuid);

insert into public.account_memberships (
  account_id, user_id, account_role, default_organization_role
) values
  ('a9000000-0000-4000-8000-000000000101'::uuid, 'a9000000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner'),
  ('a9000000-0000-4000-8000-000000000101'::uuid, 'a9000000-0000-4000-8000-000000000002'::uuid, 'member', 'operator'),
  ('a9000000-0000-4000-8000-000000000101'::uuid, 'a9000000-0000-4000-8000-000000000003'::uuid, 'member', 'viewer'),
  ('a9000000-0000-4000-8000-000000000102'::uuid, 'a9000000-0000-4000-8000-000000000004'::uuid, 'owner', 'owner');

insert into public.branches (
  id, organization_id, name, slug, kind, timezone, currency
) values
  ('a9000000-0000-4000-8000-000000000301'::uuid, 'a9000000-0000-4000-8000-000000000201'::uuid, 'Dubai Marina', 'market-evidence-dubai-marina', 'physical', 'Asia/Dubai', 'AED'),
  ('a9000000-0000-4000-8000-000000000302'::uuid, 'a9000000-0000-4000-8000-000000000202'::uuid, 'Other tenant branch', 'market-evidence-other-branch', 'physical', 'Asia/Dubai', 'AED');

create or replace function pg_temp.profile_document(p_branch_id uuid)
returns jsonb
language sql
immutable
as $$
  select pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'publicIdentity', pg_catalog.jsonb_build_object(
      'approvedName', 'Kerala Kitchen',
      'domains', pg_catalog.jsonb_build_array('example.com'),
      'publicUrls', pg_catalog.jsonb_build_array('https://example.com/menu')
    ),
    'nicheDescriptors', pg_catalog.jsonb_build_array('Kerala cuisine'),
    'geographies', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('layer', 'city', 'locationRef', 'ae:du', 'name', 'Dubai', 'countryCode', 'AE'),
      pg_catalog.jsonb_build_object('layer', 'country', 'locationRef', 'ae', 'name', 'United Arab Emirates', 'countryCode', 'AE'),
      pg_catalog.jsonb_build_object('layer', 'trade_area', 'locationRef', 'ae:du:dubai-marina', 'name', 'Dubai Marina delivery area', 'branchId', p_branch_id, 'radiusKm', 8)
    ),
    'competitors', '[]'::jsonb,
    'topics', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('key', 'local-events', 'label', 'Local events', 'provenance', 'core')),
    'sourcePolicy', pg_catalog.jsonb_build_object(
      'excludedDomains', pg_catalog.jsonb_build_array('spam.example'),
      'excludedPublishers', pg_catalog.jsonb_build_array('Untrusted Publisher'),
      'excludedCompetitorKeys', pg_catalog.jsonb_build_array('blocked-competitor'),
      'allowBoundedQuotes', true,
      'maxQuotationCharacters', 240
    ),
    'cadence', pg_catalog.jsonb_build_object(
      'timeZone', 'Asia/Dubai', 'dailyLocalTime', '06:30',
      'weeklyDay', 'monday', 'weeklyLocalTime', '07:00'
    )
  );
$$;

create or replace function pg_temp.profile_digest(p_document jsonb)
returns text
language sql
security definer
set search_path = ''
as $$
  select private.create_market_profile_digest(p_document);
$$;

create or replace function pg_temp.request_document(p_organization_id uuid, p_bucket text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_version_id uuid;
  policy_digest text;
begin
  select version.id, version.source_policy_digest
  into profile_version_id, policy_digest
  from public.organization_market_profiles profile
  join public.organization_market_profile_versions version
    on version.organization_id = profile.organization_id and version.id = profile.current_version_id
  where profile.organization_id = p_organization_id;
  return pg_catalog.jsonb_build_object(
    'organizationId', p_organization_id, 'branchId', null, 'channelId', null,
    'kind', 'market_research', 'triggerReason', 'daily_due', 'businessEvidenceDigest', null,
    'marketProfileVersionId', profile_version_id, 'sourcePolicyDigest', policy_digest,
    'researchRuleVersion', 'market-research@1', 'localTimeBucket', p_bucket,
    'synthesisVersionTuple', null, 'playbookVersionTuple', null,
    'requestFingerprint', private.create_growth_intelligence_request_fingerprint(
      p_organization_id, null, null, 'market_research', 'daily_due', null,
      profile_version_id, policy_digest, 'market-research@1', p_bucket, null, null
    ),
    'dueAt', pg_catalog.now(), 'correlationId', 'a9000000-0000-4000-8000-000000000701',
    'requestedBy', null
  );
end;
$$;

create or replace function pg_temp.pending_request_id(p_organization_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.growth_intelligence_requests
  where organization_id = p_organization_id and status = 'pending'
  order by created_at desc, id desc limit 1;
$$;

create or replace function pg_temp.claimed_request_id(p_organization_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.growth_intelligence_requests
  where organization_id = p_organization_id and status = 'claimed'
  order by created_at desc, id desc limit 1;
$$;

create or replace function pg_temp.market_research_run_id(
  p_organization_id uuid,
  p_status text default null
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.market_research_runs
  where organization_id = p_organization_id
    and (p_status is null or status = p_status)
  order by created_at desc, id desc limit 1;
$$;

create or replace function pg_temp.market_research_run_request_id(p_organization_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select growth_intelligence_request_id from public.market_research_runs
  where organization_id = p_organization_id
  order by created_at desc, id desc limit 1;
$$;

create or replace function pg_temp.claim_id(p_organization_id uuid, p_claim_key text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.market_evidence_claims
  where organization_id = p_organization_id and claim_key = p_claim_key
  order by created_at desc, id desc limit 1;
$$;

create or replace function pg_temp.claim_id_for_run(
  p_organization_id uuid,
  p_market_research_run_id uuid,
  p_claim_key text
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id
  from public.market_evidence_claims
  where organization_id = p_organization_id
    and market_research_run_id = p_market_research_run_id
    and claim_key = p_claim_key
  order by created_at desc, id desc
  limit 1;
$$;

create or replace function pg_temp.claim_count(p_organization_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.count(*)::integer from public.market_evidence_claims
  where organization_id = p_organization_id;
$$;

create or replace function pg_temp.source_quotation_characters(
  p_organization_id uuid,
  p_source_key text
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select quotation_characters
  from public.market_evidence_sources
  where organization_id = p_organization_id and source_key = p_source_key
  order by created_at desc, id desc
  limit 1;
$$;

create or replace function pg_temp.run_audit_matches(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.market_research_runs
    where organization_id = p_organization_id
      and query_plan_digest = pg_catalog.repeat('c', 64)
      and adapter_cost_micros_usd = 42000
      and adapter_latency_ms = 721
  );
$$;

create or replace function pg_temp.failed_run_audit_matches(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.market_research_runs
    where organization_id = p_organization_id
      and status = 'failed'
      and adapter_cost_micros_usd = 4200
      and adapter_latency_ms = 91
  );
$$;

create or replace function pg_temp.pending_request_count(p_organization_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.count(*)::integer from public.growth_intelligence_requests
  where organization_id = p_organization_id and status = 'pending';
$$;

create or replace function pg_temp.link_exists(p_organization_id uuid, p_relation text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.market_evidence_links
    where organization_id = p_organization_id and relation = p_relation
  );
$$;

-- Every claim-to-source support edge must carry the review verdict, the
-- review time, and the run's review-model version as reviewer: the
-- source → excerpt → claim → support-link lineage stays queryable.
create or replace function pg_temp.supports_links_reviewed(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    pg_catalog.count(*) > 0
    and pg_catalog.bool_and(
      support_verdict = 'supported'
      and reviewed_at is not null
      and reviewer_ref = 'gemini-fixture-review-1'
    )
  from public.market_evidence_links
  where organization_id = p_organization_id
    and relation = 'supports'
    and market_evidence_source_id is not null;
$$;

-- Claim-to-claim corroboration/contradiction edges carry their own pairwise
-- relation and no per-pair verdict: no review runs per pair in this slice.
create or replace function pg_temp.claim_pair_links_unreviewed(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    pg_catalog.count(*) = 2
    and pg_catalog.bool_and(
      support_verdict is null and reviewed_at is null and reviewer_ref is null
    )
  from public.market_evidence_links
  where organization_id = p_organization_id
    and market_evidence_source_id is null;
$$;

create or replace function pg_temp.request_status(p_organization_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select status from public.growth_intelligence_requests
  where organization_id = p_organization_id
  order by created_at desc, id desc limit 1;
$$;

create or replace function pg_temp.metadata(p_fingerprint text)
returns jsonb
language sql
immutable
as $$
  select pg_catalog.jsonb_build_object(
    'adapterProvider', 'qualified-research', 'adapterVersion', 'market-research@1',
    'modelProvider', 'gemini', 'modelVersion', 'gemini-fixture-review-1', 'runFingerprint', p_fingerprint,
    'queryPlanDigest', pg_catalog.repeat('c', 64),
    'correlationId', 'a9000000-0000-4000-8000-000000000702'
  );
$$;

create or replace function pg_temp.iso_at(p_timestamp timestamptz)
returns text
language sql
stable
as $$
  select pg_catalog.to_char(p_timestamp at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
$$;

create or replace function pg_temp.payload(p_quotation text default 'Dubai public event notice')
returns jsonb
language sql
stable
as $$
  select pg_catalog.jsonb_build_object(
    'sources', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'key', 'tourism-signal', 'url', 'https://tourism.example/dubai-notice', 'domain', 'tourism.example',
        'publisher', 'Dubai Tourism', 'sourceClass', 'official', 'availability', 'available',
        'contentDigest', pg_catalog.repeat('a', 64), 'safeFailureCode', null,
        'retrievedAt', pg_temp.iso_at(pg_catalog.now()), 'publishedAt', null, 'observedAt', pg_temp.iso_at(pg_catalog.now())
      ),
      pg_catalog.jsonb_build_object(
        'key', 'city-calendar', 'url', 'https://calendar.example/dubai-events', 'domain', 'calendar.example',
        'publisher', 'Dubai Calendar', 'sourceClass', 'first_party', 'availability', 'available',
        'contentDigest', pg_catalog.repeat('b', 64), 'safeFailureCode', null,
        'retrievedAt', pg_temp.iso_at(pg_catalog.now()), 'publishedAt', null, 'observedAt', pg_temp.iso_at(pg_catalog.now())
      )
    ),
    'claims', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'key', 'tourism-demand', 'claimDigest', pg_catalog.repeat('1', 64),
        'subjectKind', 'market', 'subjectRef', 'dubai-market', 'claimKind', 'demand_signal',
        'paraphrase', 'A public market signal may affect local demand.', 'quotation', p_quotation,
        'geographicLayer', 'city', 'geographyRef', 'ae:du', 'sourceKeys', pg_catalog.jsonb_build_array('tourism-signal'),
        'freshnessClass', 'standard', 'claimCategory', 'demand_trend', 'freshnessRegistryVersion', 1,
        'publishedAt', null, 'observedAt', pg_temp.iso_at(pg_catalog.now()),
        'staleAt', pg_temp.iso_at(pg_catalog.now() + interval '14 days'),
        'expiresAt', pg_temp.iso_at(pg_catalog.now() + interval '30 days'),
        'limitations', pg_catalog.jsonb_build_array('BROADER_MARKET_INFERENCE')
      ),
      pg_catalog.jsonb_build_object(
        'key', 'festival-calendar', 'claimDigest', pg_catalog.repeat('2', 64),
        'subjectKind', 'event', 'subjectRef', 'dubai-festival', 'claimKind', 'event_calendar',
        'paraphrase', 'A local calendar entry may affect demand timing.', 'quotation', null,
        'geographicLayer', 'city', 'geographyRef', 'ae:du', 'sourceKeys', pg_catalog.jsonb_build_array('city-calendar'),
        'freshnessClass', 'standard', 'claimCategory', 'event', 'freshnessRegistryVersion', 1,
        'publishedAt', null, 'observedAt', pg_temp.iso_at(pg_catalog.now()),
        'staleAt', pg_temp.iso_at(pg_catalog.now() + interval '7 days'),
        'expiresAt', pg_temp.iso_at(pg_catalog.now() + interval '14 days'), 'limitations', '[]'::jsonb
      )
    ),
    'links', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('fromClaimKey', 'festival-calendar', 'toClaimKey', 'tourism-demand', 'relation', 'corroborates'),
      pg_catalog.jsonb_build_object('fromClaimKey', 'tourism-demand', 'toClaimKey', 'festival-calendar', 'relation', 'contradicts')
    )
  );
$$;

create or replace function pg_temp.result(p_outcome text)
returns jsonb
language sql
immutable
as $$
  select pg_catalog.jsonb_build_object(
    'outcome', p_outcome, 'resultDigest', pg_catalog.repeat('d', 64),
    'sourceAttemptCount', 2, 'sourceSuccessCount', 2,
    'adapterCostMicrosUsd', 42000, 'adapterLatencyMs', 721
  );
$$;

create or replace function pg_temp.failure(p_safe_failure_code text)
returns jsonb
language sql
immutable
as $$
  select pg_catalog.jsonb_build_object(
    'safeFailureCode', p_safe_failure_code,
    'adapterCostMicrosUsd', 4200,
    'adapterLatencyMs', 91
  );
$$;

create or replace function pg_temp.stale_payload()
returns jsonb
language sql
stable
as $$
  with source_timed as (
    select pg_catalog.jsonb_set(
      pg_catalog.jsonb_set(
        pg_temp.payload(null),
        '{sources,0,retrievedAt}',
        pg_catalog.to_jsonb(pg_temp.iso_at(pg_catalog.now() - interval '7 hours'))
      ),
      '{sources,0,observedAt}',
      pg_catalog.to_jsonb(pg_temp.iso_at(pg_catalog.now() - interval '7 hours'))
    ) as document
  ), claim_categorized as (
    select pg_catalog.jsonb_set(
      pg_catalog.jsonb_set(document, '{claims,0,claimCategory}', '"availability"'::jsonb),
      '{claims,0,freshnessClass}', '"fast"'::jsonb
    ) as document
    from source_timed
  ), claim_timed as (
    select pg_catalog.jsonb_set(
      pg_catalog.jsonb_set(
        pg_catalog.jsonb_set(document, '{claims,0,observedAt}', pg_catalog.to_jsonb(pg_temp.iso_at(pg_catalog.now() - interval '7 hours'))),
        '{claims,0,staleAt}', pg_catalog.to_jsonb(pg_temp.iso_at(pg_catalog.now() - interval '1 hour'))
      ),
      '{claims,0,expiresAt}', pg_catalog.to_jsonb(pg_temp.iso_at(pg_catalog.now() + interval '17 hours'))
    ) as document
    from claim_categorized
  )
  select document from claim_timed;
$$;

set local role authenticated;
set local request.jwt.claim.sub = 'a9000000-0000-4000-8000-000000000002';
select public.propose_market_profile_version(
  'a9000000-0000-4000-8000-000000000201'::uuid,
  'a9000000-0000-4000-8000-000000000002'::uuid,
  pg_temp.profile_document('a9000000-0000-4000-8000-000000000301'::uuid),
  pg_temp.profile_digest(pg_temp.profile_document('a9000000-0000-4000-8000-000000000301'::uuid)),
  '{"source":"operator"}'::jsonb, 'market-evidence-profile-a',
  'a9000000-0000-4000-8000-000000000703'::uuid
);
select public.decide_market_profile_version(
  'a9000000-0000-4000-8000-000000000201'::uuid,
  'a9000000-0000-4000-8000-000000000002'::uuid,
  (select id from public.organization_market_profile_versions where organization_id = 'a9000000-0000-4000-8000-000000000201'::uuid),
  pg_temp.profile_digest(pg_temp.profile_document('a9000000-0000-4000-8000-000000000301'::uuid)),
  'confirmed', null, 'market-evidence-profile-a-confirm',
  'a9000000-0000-4000-8000-000000000704'::uuid
);

set local request.jwt.claim.sub = 'a9000000-0000-4000-8000-000000000004';
select public.propose_market_profile_version(
  'a9000000-0000-4000-8000-000000000202'::uuid,
  'a9000000-0000-4000-8000-000000000004'::uuid,
  pg_temp.profile_document('a9000000-0000-4000-8000-000000000302'::uuid),
  pg_temp.profile_digest(pg_temp.profile_document('a9000000-0000-4000-8000-000000000302'::uuid)),
  '{"source":"operator"}'::jsonb, 'market-evidence-profile-b',
  'a9000000-0000-4000-8000-000000000705'::uuid
);
select public.decide_market_profile_version(
  'a9000000-0000-4000-8000-000000000202'::uuid,
  'a9000000-0000-4000-8000-000000000004'::uuid,
  (select id from public.organization_market_profile_versions where organization_id = 'a9000000-0000-4000-8000-000000000202'::uuid),
  pg_temp.profile_digest(pg_temp.profile_document('a9000000-0000-4000-8000-000000000302'::uuid)),
  'confirmed', null, 'market-evidence-profile-b-confirm',
  'a9000000-0000-4000-8000-000000000706'::uuid
);

select extensions.is(
  pg_temp.pending_request_count('a9000000-0000-4000-8000-000000000201'::uuid),
  1,
  'profile confirmation creates one tenant-scoped market research request'
);

-- Fenced recording, bounded quotations, and immutable evidence ------------

reset role;
set local role service_role;
select extensions.is(
  public.claim_growth_intelligence_request(
    'a9000000-0000-4000-8000-000000000201'::uuid,
    pg_temp.pending_request_id('a9000000-0000-4000-8000-000000000201'::uuid),
    'a9000000-0000-4000-8000-000000000801'::uuid, 600
  ) ->> 'outcome',
  'acquired',
  'the worker acquires tenant A research through the durable request lease'
);
select extensions.throws_ok(
  $$
    select public.begin_market_research_run(
      'a9000000-0000-4000-8000-000000000201'::uuid,
      pg_temp.claimed_request_id('a9000000-0000-4000-8000-000000000201'::uuid),
      'a9000000-0000-4000-8000-000000000899'::uuid, pg_temp.metadata(repeat('e', 64))
    )
  $$,
  '42501', null,
  'a stale worker token cannot begin a research run'
);
select extensions.is(
  public.begin_market_research_run(
    'a9000000-0000-4000-8000-000000000201'::uuid,
    pg_temp.claimed_request_id('a9000000-0000-4000-8000-000000000201'::uuid),
    'a9000000-0000-4000-8000-000000000801'::uuid, pg_temp.metadata(repeat('e', 64))
  ) ->> 'replayed',
  'false',
  'the first worker delivery creates one research run'
);
select extensions.throws_ok(
  $$
    select public.record_market_evidence_claims(
      'a9000000-0000-4000-8000-000000000201'::uuid,
      pg_temp.claimed_request_id('a9000000-0000-4000-8000-000000000201'::uuid),
      'a9000000-0000-4000-8000-000000000801'::uuid,
      pg_temp.market_research_run_id('a9000000-0000-4000-8000-000000000201'::uuid),
      pg_temp.payload(repeat('q', 241))
    )
  $$,
  '22023', null,
  'a quotation cannot exceed the current profile retention bound'
);
select extensions.throws_ok(
  $$
    select public.record_market_evidence_claims(
      'a9000000-0000-4000-8000-000000000201'::uuid,
      pg_temp.claimed_request_id('a9000000-0000-4000-8000-000000000201'::uuid),
      'a9000000-0000-4000-8000-000000000801'::uuid,
      pg_temp.market_research_run_id('a9000000-0000-4000-8000-000000000201'::uuid),
      pg_catalog.jsonb_set(
        pg_catalog.jsonb_set(
          pg_temp.payload(pg_catalog.repeat('q', 140)),
          '{claims,1,quotation}',
          pg_catalog.to_jsonb(pg_catalog.repeat('r', 140))
        ),
        '{claims,1,sourceKeys}',
        pg_catalog.jsonb_build_array('tourism-signal')
      )
    )
  $$,
  '22023', null,
  'all quotations referring to one source remain within its retention bound'
);
select extensions.is(
  public.record_market_evidence_claims(
    'a9000000-0000-4000-8000-000000000201'::uuid,
    pg_temp.claimed_request_id('a9000000-0000-4000-8000-000000000201'::uuid),
    'a9000000-0000-4000-8000-000000000801'::uuid,
    pg_temp.market_research_run_id('a9000000-0000-4000-8000-000000000201'::uuid),
    pg_temp.payload()
  ) ->> 'claimCount',
  '2',
  'the worker records compact cited claims and no page payload'
);
select extensions.is(
  pg_temp.source_quotation_characters(
    'a9000000-0000-4000-8000-000000000201'::uuid,
    'tourism-signal'
  ),
  pg_catalog.char_length('Dubai public event notice'),
  'a source stores only the bounded aggregate quotation count'
);
select extensions.is(
  public.record_market_evidence_claims(
    'a9000000-0000-4000-8000-000000000201'::uuid,
    pg_temp.claimed_request_id('a9000000-0000-4000-8000-000000000201'::uuid),
    'a9000000-0000-4000-8000-000000000801'::uuid,
    pg_temp.market_research_run_id('a9000000-0000-4000-8000-000000000201'::uuid),
    pg_temp.payload()
  ) ->> 'replayed',
  'true',
  'an exact evidence payload replay does not duplicate immutable rows'
);
select extensions.throws_ok(
  $$
    select public.record_market_evidence_claims(
      'a9000000-0000-4000-8000-000000000201'::uuid,
      pg_temp.claimed_request_id('a9000000-0000-4000-8000-000000000201'::uuid),
      'a9000000-0000-4000-8000-000000000801'::uuid,
      pg_temp.market_research_run_id('a9000000-0000-4000-8000-000000000201'::uuid),
      pg_temp.payload('Different bounded quotation')
    )
  $$,
  '23505', null,
  'a changed payload cannot reuse the same run identity'
);
select extensions.ok(
  pg_temp.link_exists('a9000000-0000-4000-8000-000000000201'::uuid, 'corroborates'),
  'corroboration is stored as an immutable evidence edge'
);
select extensions.ok(
  pg_temp.link_exists('a9000000-0000-4000-8000-000000000201'::uuid, 'contradicts'),
  'contradiction is stored as an immutable evidence edge'
);
select extensions.ok(
  pg_temp.supports_links_reviewed('a9000000-0000-4000-8000-000000000201'::uuid),
  'every supports edge carries the supported verdict, review time and review model'
);
select extensions.ok(
  pg_temp.claim_pair_links_unreviewed('a9000000-0000-4000-8000-000000000201'::uuid),
  'claim-to-claim relations persist without a per-pair review verdict'
);

reset role;
select extensions.throws_ok(
  $$ update public.market_evidence_claims set paraphrase = 'rewritten evidence'
     where organization_id = 'a9000000-0000-4000-8000-000000000201'::uuid $$,
  '55000', null,
  'claims cannot be overwritten after recording'
);

-- Tenant B verifies policy and cross-tenant read/link refusal ---------------

set local role service_role;
select extensions.is(
  public.claim_growth_intelligence_request(
    'a9000000-0000-4000-8000-000000000202'::uuid,
    pg_temp.pending_request_id('a9000000-0000-4000-8000-000000000202'::uuid),
    'a9000000-0000-4000-8000-000000000802'::uuid, 600
  ) ->> 'outcome',
  'acquired',
  'tenant B receives its own worker lease'
);
select extensions.is(
  public.begin_market_research_run(
    'a9000000-0000-4000-8000-000000000202'::uuid,
    pg_temp.claimed_request_id('a9000000-0000-4000-8000-000000000202'::uuid),
    'a9000000-0000-4000-8000-000000000802'::uuid, pg_temp.metadata(repeat('f', 64))
  ) ->> 'replayed',
  'false',
  'tenant B receives its own research run'
);
select extensions.throws_ok(
  $$
    select public.record_market_evidence_claims(
      'a9000000-0000-4000-8000-000000000202'::uuid,
      pg_temp.claimed_request_id('a9000000-0000-4000-8000-000000000202'::uuid),
      'a9000000-0000-4000-8000-000000000802'::uuid,
      pg_temp.market_research_run_id('a9000000-0000-4000-8000-000000000202'::uuid),
      pg_catalog.jsonb_set(pg_temp.payload(), '{sources,0,domain}', '"spam.example"'::jsonb)
    )
  $$,
  '22023', null,
  'the confirmed profile source exclusion blocks a source before storage'
);
select extensions.throws_ok(
  $$
    select public.record_market_evidence_claims(
      'a9000000-0000-4000-8000-000000000202'::uuid,
      pg_temp.claimed_request_id('a9000000-0000-4000-8000-000000000202'::uuid),
      'a9000000-0000-4000-8000-000000000802'::uuid,
      pg_temp.market_research_run_id('a9000000-0000-4000-8000-000000000202'::uuid),
      pg_catalog.jsonb_set(pg_temp.payload(), '{sources,0,publisher}', '" Untrusted Publisher "'::jsonb)
    )
  $$,
  '22023', null,
  'publisher exclusions cannot be bypassed with whitespace'
);
select extensions.throws_ok(
  $$
    select public.record_market_evidence_claims(
      'a9000000-0000-4000-8000-000000000202'::uuid,
      pg_temp.claimed_request_id('a9000000-0000-4000-8000-000000000202'::uuid),
      'a9000000-0000-4000-8000-000000000802'::uuid,
      pg_temp.market_research_run_id('a9000000-0000-4000-8000-000000000202'::uuid),
      pg_catalog.jsonb_set(
        pg_catalog.jsonb_set(pg_temp.payload(), '{claims,0,subjectKind}', '"competitor"'::jsonb),
        '{claims,0,subjectRef}', '" blocked-competitor "'::jsonb
      )
    )
  $$,
  '22023', null,
  'excluded competitors cannot be recorded through a whitespace variant'
);
select extensions.throws_ok(
  $$
    select public.record_market_evidence_claims(
      'a9000000-0000-4000-8000-000000000202'::uuid,
      pg_temp.claimed_request_id('a9000000-0000-4000-8000-000000000202'::uuid),
      'a9000000-0000-4000-8000-000000000802'::uuid,
      pg_temp.market_research_run_id('a9000000-0000-4000-8000-000000000202'::uuid),
      pg_catalog.jsonb_set(
        pg_catalog.jsonb_set(
          pg_catalog.jsonb_set(pg_temp.payload(), '{sources,0,availability}', '"unavailable"'::jsonb),
          '{sources,0,contentDigest}', 'null'::jsonb
        ),
        '{sources,0,safeFailureCode}', '"ADAPTER_UNAVAILABLE"'::jsonb
      )
    )
  $$,
  '22023', null,
  'an unavailable source cannot be recorded as support for a claim'
);
select extensions.throws_ok(
  $$
    select public.record_market_evidence_claims(
      'a9000000-0000-4000-8000-000000000202'::uuid,
      pg_temp.claimed_request_id('a9000000-0000-4000-8000-000000000202'::uuid),
      'a9000000-0000-4000-8000-000000000802'::uuid,
      pg_temp.market_research_run_id('a9000000-0000-4000-8000-000000000202'::uuid),
      pg_catalog.jsonb_set(pg_temp.payload(), '{sources,0,domain}', '"calendar.example"'::jsonb)
    )
  $$,
  '22023', null,
  'a citation domain must match the public URL it claims to identify'
);
select extensions.is(
  public.record_market_evidence_claims(
    'a9000000-0000-4000-8000-000000000202'::uuid,
    pg_temp.claimed_request_id('a9000000-0000-4000-8000-000000000202'::uuid),
    'a9000000-0000-4000-8000-000000000802'::uuid,
    pg_temp.market_research_run_id('a9000000-0000-4000-8000-000000000202'::uuid),
    pg_temp.payload()
  ) ->> 'claimCount',
  '2',
  'allowed tenant B sources record independently'
);

set local role authenticated;
set local request.jwt.claim.sub = 'a9000000-0000-4000-8000-000000000003';
select extensions.is(
  (select count(*)::integer from public.market_evidence_claims where organization_id = 'a9000000-0000-4000-8000-000000000201'::uuid),
  2,
  'a tenant A viewer reads its own evidence'
);
select extensions.is(
  (select count(*)::integer from public.market_evidence_claims where organization_id = 'a9000000-0000-4000-8000-000000000202'::uuid),
  0,
  'a tenant A viewer cannot read tenant B evidence'
);
select extensions.throws_ok(
  $$
    insert into public.market_evidence_claim_events (
      organization_id, market_evidence_claim_id, event_type, event_digest, occurred_at
    ) values (
      'a9000000-0000-4000-8000-000000000201'::uuid,
      (select id from public.market_evidence_claims where organization_id = 'a9000000-0000-4000-8000-000000000201'::uuid limit 1),
      'expired', repeat('e', 64), pg_catalog.now()
    )
  $$,
  '42501', null,
  'a signed-in member cannot append evidence history directly'
);

-- Current state and partial-result preservation ----------------------------

select extensions.is(
  public.market_evidence_claim_current_state(
    'a9000000-0000-4000-8000-000000000201'::uuid,
    (select id from public.market_evidence_claims where organization_id = 'a9000000-0000-4000-8000-000000000201'::uuid and claim_key = 'tourism-demand')
  ),
  'current',
  'a fresh claim is current before a later state event'
);

reset role;
set local role service_role;
select extensions.is(
  public.append_market_evidence_claim_event(
    'a9000000-0000-4000-8000-000000000201'::uuid,
    pg_temp.claimed_request_id('a9000000-0000-4000-8000-000000000201'::uuid),
    'a9000000-0000-4000-8000-000000000801'::uuid,
    'withdrawn',
    pg_catalog.jsonb_build_object(
      'claimId', pg_temp.claim_id('a9000000-0000-4000-8000-000000000201'::uuid, 'tourism-demand'),
      'reasonCode', 'SOURCE_WITHDRAWN', 'occurredAt', pg_temp.iso_at(pg_catalog.now())
    )
  ) ->> 'replayed',
  'false',
  'a worker appends a withdrawal rather than changing the claim'
);

set local role authenticated;
set local request.jwt.claim.sub = 'a9000000-0000-4000-8000-000000000003';
select extensions.is(
  public.market_evidence_claim_current_state(
    'a9000000-0000-4000-8000-000000000201'::uuid,
    (select id from public.market_evidence_claims where organization_id = 'a9000000-0000-4000-8000-000000000201'::uuid and claim_key = 'tourism-demand')
  ),
  'withdrawn',
  'the latest withdrawal event removes a claim from current evidence'
);

reset role;
set local role service_role;
select extensions.is(
  public.append_market_evidence_claim_event(
    'a9000000-0000-4000-8000-000000000201'::uuid,
    pg_temp.claimed_request_id('a9000000-0000-4000-8000-000000000201'::uuid),
    'a9000000-0000-4000-8000-000000000801'::uuid,
    'expired',
    pg_catalog.jsonb_build_object(
      'claimId', pg_temp.claim_id('a9000000-0000-4000-8000-000000000201'::uuid, 'festival-calendar'),
      'reasonCode', 'FRESHNESS_EXPIRED', 'occurredAt', pg_temp.iso_at(pg_catalog.now())
    )
  ) ->> 'replayed',
  'false',
  'a worker appends expiry without deleting the source claim'
);
set local role authenticated;
set local request.jwt.claim.sub = 'a9000000-0000-4000-8000-000000000003';
select extensions.is(
  public.market_evidence_claim_current_state(
    'a9000000-0000-4000-8000-000000000201'::uuid,
    (select id from public.market_evidence_claims where organization_id = 'a9000000-0000-4000-8000-000000000201'::uuid and claim_key = 'festival-calendar')
  ),
  'expired',
  'the latest expiry event derives an expired current state'
);

reset role;
set local role service_role;
select extensions.is(
  public.complete_market_research_run(
    'a9000000-0000-4000-8000-000000000201'::uuid,
    pg_temp.claimed_request_id('a9000000-0000-4000-8000-000000000201'::uuid),
    'a9000000-0000-4000-8000-000000000801'::uuid,
    pg_temp.market_research_run_id('a9000000-0000-4000-8000-000000000201'::uuid),
    pg_temp.result('partial')
  ) ->> 'status',
  'partial',
  'a partial research run reaches a durable terminal state'
);
select extensions.is(
  pg_temp.claim_count('a9000000-0000-4000-8000-000000000201'::uuid),
  2,
  'partial completion preserves the usable claims already recorded'
);
select extensions.is(
  pg_temp.request_status('a9000000-0000-4000-8000-000000000201'::uuid),
  'succeeded',
  'partial research completes the durable request without claiming full coverage'
);
select extensions.ok(
  pg_temp.run_audit_matches('a9000000-0000-4000-8000-000000000201'::uuid),
  'a completed run retains its query digest, adapter cost, and latency'
);
select extensions.is(
  public.complete_market_research_run(
    'a9000000-0000-4000-8000-000000000201'::uuid,
    pg_temp.market_research_run_request_id('a9000000-0000-4000-8000-000000000201'::uuid),
    'a9000000-0000-4000-8000-000000000801'::uuid,
    pg_temp.market_research_run_id('a9000000-0000-4000-8000-000000000201'::uuid),
    pg_temp.result('partial')
  ) ->> 'replayed',
  'true',
  'a lost partial-completion response replays the existing terminal run'
);

reset role;
select extensions.throws_ok(
  $$
    insert into public.market_evidence_links (
      organization_id, market_evidence_claim_id, market_evidence_source_id, relation
    ) values (
      'a9000000-0000-4000-8000-000000000201'::uuid,
      (select id from public.market_evidence_claims where organization_id = 'a9000000-0000-4000-8000-000000000201'::uuid limit 1),
      (select id from public.market_evidence_sources where organization_id = 'a9000000-0000-4000-8000-000000000202'::uuid limit 1),
      'supports'
    )
  $$,
  '22023', 'market_evidence_link_source_missing',
  'a source from another tenant cannot be linked to this tenant claim'
-- (Task 7: the Task 5 link-eligibility trigger refuses cross-tenant sources
-- with 22023 before the foreign key fires, so the suite pins that code.
-- Tenant isolation still holds: the link is refused.)
);

-- A later failure keeps the ledger safe and request-fenced ------------------

set local role service_role;
select public.enqueue_growth_intelligence_request(
  'a9000000-0000-4000-8000-000000000201'::uuid,
  pg_temp.request_document('a9000000-0000-4000-8000-000000000201'::uuid, 'daily:2026-09-02')
);
select extensions.is(
  public.claim_growth_intelligence_request(
    'a9000000-0000-4000-8000-000000000201'::uuid,
    pg_temp.pending_request_id('a9000000-0000-4000-8000-000000000201'::uuid),
    'a9000000-0000-4000-8000-000000000803'::uuid, 600
  ) ->> 'outcome',
  'acquired',
  'a later research request receives its own worker fence'
);
select extensions.is(
  public.begin_market_research_run(
    'a9000000-0000-4000-8000-000000000201'::uuid,
    pg_temp.claimed_request_id('a9000000-0000-4000-8000-000000000201'::uuid),
    'a9000000-0000-4000-8000-000000000803'::uuid, pg_temp.metadata(repeat('9', 64))
  ) ->> 'replayed',
  'false',
  'the later request begins an independent run'
);
select extensions.throws_ok(
  $$
    select public.fail_market_research_run(
      'a9000000-0000-4000-8000-000000000201'::uuid,
      pg_temp.claimed_request_id('a9000000-0000-4000-8000-000000000201'::uuid),
      'a9000000-0000-4000-8000-000000000803'::uuid,
      pg_temp.market_research_run_id('a9000000-0000-4000-8000-000000000201'::uuid, 'running'),
      pg_temp.failure('raw provider error text')
    )
  $$,
  '22023', null,
  'a raw provider failure cannot cross into the durable evidence ledger'
);
select extensions.is(
  public.fail_market_research_run(
    'a9000000-0000-4000-8000-000000000201'::uuid,
    pg_temp.claimed_request_id('a9000000-0000-4000-8000-000000000201'::uuid),
    'a9000000-0000-4000-8000-000000000803'::uuid,
    pg_temp.market_research_run_id('a9000000-0000-4000-8000-000000000201'::uuid, 'running'),
    pg_temp.failure('ADAPTER_UNAVAILABLE')
  ) ->> 'status',
  'failed',
  'a current worker records one safe failed run and closes its request'
);
select extensions.ok(
  pg_temp.failed_run_audit_matches('a9000000-0000-4000-8000-000000000201'::uuid),
  'a failed run retains actual adapter cost and latency'
);

-- The registry, not a caller-provided label, governs stale evidence ----------

select public.enqueue_growth_intelligence_request(
  'a9000000-0000-4000-8000-000000000201'::uuid,
  pg_temp.request_document('a9000000-0000-4000-8000-000000000201'::uuid, 'daily:2026-09-03')
);
select extensions.is(
  public.claim_growth_intelligence_request(
    'a9000000-0000-4000-8000-000000000201'::uuid,
    pg_temp.pending_request_id('a9000000-0000-4000-8000-000000000201'::uuid),
    'a9000000-0000-4000-8000-000000000804'::uuid, 600
  ) ->> 'outcome',
  'acquired',
  'a later request can record evidence that is already stale'
);
select public.begin_market_research_run(
  'a9000000-0000-4000-8000-000000000201'::uuid,
  pg_temp.claimed_request_id('a9000000-0000-4000-8000-000000000201'::uuid),
  'a9000000-0000-4000-8000-000000000804'::uuid, pg_temp.metadata(pg_catalog.repeat('8', 64))
);
select extensions.is(
  public.record_market_evidence_claims(
    'a9000000-0000-4000-8000-000000000201'::uuid,
    pg_temp.claimed_request_id('a9000000-0000-4000-8000-000000000201'::uuid),
    'a9000000-0000-4000-8000-000000000804'::uuid,
    pg_temp.market_research_run_id('a9000000-0000-4000-8000-000000000201'::uuid, 'running'),
    pg_temp.stale_payload()
  ) ->> 'claimCount',
  '2',
  'the evidence ledger accepts a valid already-stale claim'
);
set local role authenticated;
set local request.jwt.claim.sub = 'a9000000-0000-4000-8000-000000000003';
select extensions.is(
  public.market_evidence_claim_current_state(
    'a9000000-0000-4000-8000-000000000201'::uuid,
    pg_temp.claim_id_for_run(
      'a9000000-0000-4000-8000-000000000201'::uuid,
      pg_temp.market_research_run_id('a9000000-0000-4000-8000-000000000201'::uuid, 'running'),
      'tourism-demand'
    )
  ),
  'stale',
  'the versioned freshness registry derives stale state before expiry'
);

select * from extensions.finish();

rollback;
