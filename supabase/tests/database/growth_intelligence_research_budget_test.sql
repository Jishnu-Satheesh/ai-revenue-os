begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(60);

-- Contract: fenced spend boundary and private ledgers -------------------------

select extensions.has_function(
  'public', 'reserve_research_pipeline_budget',
  array['uuid', 'uuid', 'bigint', 'text'],
  'pipeline admission reserves its quote against the organization day'
);
select extensions.has_function(
  'public', 'reserve_research_request_budget',
  array['uuid', 'uuid', 'bigint', 'text'],
  'standalone synthesis and legacy research share the same daily allowance'
);
select extensions.has_function(
  'public', 'reserve_research_attempt',
  array['uuid', 'jsonb', 'text', 'text', 'integer', 'bigint', 'uuid'],
  'every paid call debits its worst case from the reservation first'
);
select extensions.has_function(
  'public', 'settle_research_attempt',
  array['uuid', 'uuid', 'jsonb'],
  'usage receipts reconcile explicitly, never by timer'
);
select extensions.has_function(
  'public', 'release_research_budget_reservation',
  array['uuid', 'uuid'],
  'confirmed unused reserves release exactly once'
);
select extensions.has_function(
  'public', 'check_research_provider_qualification',
  'provider qualification answers safely without secrets'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.reserve_research_pipeline_budget(uuid,uuid,bigint,text)',
    'execute'
  ),
  'signed-in members reserve through the governed RPC'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.reserve_research_request_budget(uuid,uuid,bigint,text)',
    'execute'
  ),
  'signed-in members reserve request budgets through the governed RPC'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.reserve_research_attempt(uuid,jsonb,text,text,integer,bigint,uuid)',
    'execute'
  ),
  'signed-in members debit attempts through the governed RPC'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.settle_research_attempt(uuid,uuid,jsonb)',
    'execute'
  ),
  'signed-in members reconcile attempts through the governed RPC'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.release_research_budget_reservation(uuid,uuid)',
    'execute'
  ),
  'signed-in members release reserves through the governed RPC'
);
select extensions.ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.reserve_research_pipeline_budget(uuid,uuid,bigint,text)',
    'execute'
  ),
  'anonymous callers cannot reserve research spend'
);
select extensions.has_table(
  'private', 'growth_intelligence_research_day_allowances',
  'the organization-day allowance ledger exists outside browser grants'
);
select extensions.has_table(
  'private', 'growth_intelligence_provider_qualifications',
  'provider qualification lives outside browser grants'
);
select extensions.has_table(
  'private', 'growth_intelligence_research_budget_reservations',
  'pipeline-or-request reservations live outside browser grants'
);
select extensions.has_table(
  'private', 'growth_intelligence_research_attempt_ledger',
  'per-attempt worst-case debits live outside browser grants'
);
select extensions.ok(
  not pg_catalog.has_table_privilege(
    'authenticated', 'private.growth_intelligence_research_day_allowances', 'select'
  ),
  'browser sessions cannot read the allowance ledger directly'
);
select extensions.ok(
  not pg_catalog.has_table_privilege(
    'authenticated', 'private.growth_intelligence_research_budget_reservations', 'select'
  ),
  'browser sessions cannot read the reservation ledger directly'
);
select extensions.ok(
  not pg_catalog.has_table_privilege(
    'authenticated', 'private.growth_intelligence_research_attempt_ledger', 'select'
  ),
  'browser sessions cannot read the attempt ledger directly'
);
select extensions.ok(
  not pg_catalog.has_table_privilege(
    'authenticated', 'private.growth_intelligence_provider_qualifications', 'select'
  ),
  'browser sessions cannot read provider qualification directly'
);

-- Two-account fixtures ---------------------------------------------------------

insert into auth.users (id) values
  ('e5000000-0000-4000-8000-000000000001'::uuid),
  ('e5000000-0000-4000-8000-000000000002'::uuid),
  ('e5000000-0000-4000-8000-000000000003'::uuid),
  ('e5000000-0000-4000-8000-000000000004'::uuid);

insert into public.accounts (id, name, slug, created_by) values
  ('e5000000-0000-4000-8000-000000000101'::uuid, 'Budget agency A', 'budget-agency-a', 'e5000000-0000-4000-8000-000000000001'::uuid),
  ('e5000000-0000-4000-8000-000000000102'::uuid, 'Budget agency B', 'budget-agency-b', 'e5000000-0000-4000-8000-000000000004'::uuid);

insert into public.organizations (
  id, account_id, name, slug, industry, country_code, base_currency,
  default_timezone, created_by
) values
  ('e5000000-0000-4000-8000-000000000201'::uuid, 'e5000000-0000-4000-8000-000000000101'::uuid, 'Budget client A', 'budget-client-a', 'testing', 'AE', 'AED', 'Asia/Dubai', 'e5000000-0000-4000-8000-000000000001'::uuid),
  ('e5000000-0000-4000-8000-000000000202'::uuid, 'e5000000-0000-4000-8000-000000000102'::uuid, 'Budget client B', 'budget-client-b', 'testing', 'AE', 'AED', 'Asia/Dubai', 'e5000000-0000-4000-8000-000000000004'::uuid);

insert into public.account_memberships (
  account_id, user_id, account_role, default_organization_role
) values
  ('e5000000-0000-4000-8000-000000000101'::uuid, 'e5000000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner'),
  ('e5000000-0000-4000-8000-000000000101'::uuid, 'e5000000-0000-4000-8000-000000000002'::uuid, 'member', 'operator'),
  ('e5000000-0000-4000-8000-000000000101'::uuid, 'e5000000-0000-4000-8000-000000000003'::uuid, 'member', 'viewer'),
  ('e5000000-0000-4000-8000-000000000102'::uuid, 'e5000000-0000-4000-8000-000000000004'::uuid, 'owner', 'owner');

insert into public.branches (
  id, organization_id, name, slug, kind, timezone, currency, is_active
) values
  ('e5000000-0000-4000-8000-000000000301'::uuid, 'e5000000-0000-4000-8000-000000000201'::uuid, 'Budget branch one', 'budget-branch-one', 'physical', 'Asia/Dubai', 'AED', true),
  ('e5000000-0000-4000-8000-000000000302'::uuid, 'e5000000-0000-4000-8000-000000000201'::uuid, 'Budget branch two', 'budget-branch-two', 'physical', 'Asia/Dubai', 'AED', true),
  ('e5000000-0000-4000-8000-000000000303'::uuid, 'e5000000-0000-4000-8000-000000000201'::uuid, 'Budget branch three', 'budget-branch-three', 'physical', 'Asia/Dubai', 'AED', true),
  ('e5000000-0000-4000-8000-000000000304'::uuid, 'e5000000-0000-4000-8000-000000000202'::uuid, 'Other tenant branch', 'other-tenant-branch', 'physical', 'Asia/Dubai', 'AED', true);

create or replace function pg_temp.budget_v2_doc(p_branch_id uuid)
returns jsonb
language sql
immutable
as $$
  select pg_catalog.jsonb_build_object(
    'schemaVersion', 2,
    'branchId', p_branch_id,
    'publicIdentity', pg_catalog.jsonb_build_object(
      'approvedName', 'Budget Kitchen',
      'domains', pg_catalog.jsonb_build_array('example.com'),
      'publicUrls', pg_catalog.jsonb_build_array('https://example.com/menu')
    ),
    'nicheDescriptors', pg_catalog.jsonb_build_array('Kerala cuisine', 'Restaurant'),
    'geographies', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'layer', 'city', 'locationRef', 'ae:du', 'name', 'Dubai', 'countryCode', 'AE'
      ),
      pg_catalog.jsonb_build_object(
        'layer', 'country', 'locationRef', 'ae', 'name', 'United Arab Emirates',
        'countryCode', 'AE'
      ),
      pg_catalog.jsonb_build_object(
        'layer', 'trade_area', 'locationRef', 'ae:du:budget', 'name', 'Budget area',
        'branchId', p_branch_id, 'radiusKm', 8
      )
    ),
    'competitors', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'key', 'budget-rival', 'name', 'Budget Rival',
        'geographyRefs', pg_catalog.jsonb_build_array('ae:du'),
        'provenance', 'operator_lead', 'suggestedBy', 'operator',
        'relevanceEvidenceUrls', '[]'::jsonb
      )
    ),
    'topics', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('key', 'local-events', 'label', 'Local events', 'provenance', 'operator')
    ),
    'sourcePolicy', pg_catalog.jsonb_build_object(
      'excludedDomains', pg_catalog.jsonb_build_array('spam.example'),
      'excludedPublishers', pg_catalog.jsonb_build_array('Untrusted Publisher'),
      'excludedCompetitorKeys', '[]'::jsonb,
      'allowBoundedQuotes', true,
      'maxQuotationCharacters', 240
    ),
    'cadence', pg_catalog.jsonb_build_object(
      'timeZone', 'Asia/Dubai', 'dailyLocalTime', '06:30',
      'weeklyDay', 'monday', 'weeklyLocalTime', '07:00'
    )
  );
$$;

create or replace function pg_temp.budget_digest(p_document jsonb)
returns text
language sql
security definer
set search_path = ''
as $$
  select private.create_market_profile_digest(p_document);
$$;

-- Pipelines start before spend or qualification ----------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'e5000000-0000-4000-8000-000000000002';

create temp table pg_temp.budget_starts as
select
  (public.start_branch_market_research(
    'e5000000-0000-4000-8000-000000000201'::uuid,
    'e5000000-0000-4000-8000-000000000002'::uuid,
    'e5000000-0000-4000-8000-000000000301'::uuid,
    pg_temp.budget_v2_doc('e5000000-0000-4000-8000-000000000301'::uuid),
    pg_temp.budget_digest(pg_temp.budget_v2_doc('e5000000-0000-4000-8000-000000000301'::uuid)),
    null,
    'budget-pipeline-one-key-001',
    'e5000000-0000-4000-8000-000000000701'::uuid
  ) ->> 'pipelineId')::uuid as pipeline_one,
  (public.start_branch_market_research(
    'e5000000-0000-4000-8000-000000000201'::uuid,
    'e5000000-0000-4000-8000-000000000002'::uuid,
    'e5000000-0000-4000-8000-000000000302'::uuid,
    pg_temp.budget_v2_doc('e5000000-0000-4000-8000-000000000302'::uuid),
    pg_temp.budget_digest(pg_temp.budget_v2_doc('e5000000-0000-4000-8000-000000000302'::uuid)),
    null,
    'budget-pipeline-two-key-002',
    'e5000000-0000-4000-8000-000000000702'::uuid
  ) ->> 'pipelineId')::uuid as pipeline_two,
  (public.start_branch_market_research(
    'e5000000-0000-4000-8000-000000000201'::uuid,
    'e5000000-0000-4000-8000-000000000002'::uuid,
    'e5000000-0000-4000-8000-000000000303'::uuid,
    pg_temp.budget_v2_doc('e5000000-0000-4000-8000-000000000303'::uuid),
    pg_temp.budget_digest(pg_temp.budget_v2_doc('e5000000-0000-4000-8000-000000000303'::uuid)),
    null,
    'budget-pipeline-three-key-003',
    'e5000000-0000-4000-8000-000000000703'::uuid
  ) ->> 'pipelineId')::uuid as pipeline_three;

-- The lease-claim probes below run as service_role, which holds no implicit
-- grant on tables owned by authenticated, so the owner shares this one.
grant select on table pg_temp.budget_starts to service_role;

reset role;

-- Qualification fails closed before any spend -----------------------------------
-- (request 503 is inserted by the runner: members hold SELECT only.)

insert into public.growth_intelligence_requests (
  id, organization_id, branch_id, kind, trigger_reason, request_fingerprint,
  market_profile_version_id, source_policy_digest, research_rule_version,
  local_time_bucket, due_at, correlation_id
)
select
  'e5000000-0000-4000-8000-000000000503'::uuid,
  'e5000000-0000-4000-8000-000000000201'::uuid,
  'e5000000-0000-4000-8000-000000000301'::uuid,
  'weekly_synthesis', 'weekly_due',
  'e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7',
  pipeline.market_profile_version_id,
  'f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5',
  'research-rules@1', 'weekly:2026-09-08',
  pg_catalog.now() - interval '1 hour',
  'e5000000-0000-4000-8000-000000000709'::uuid
from public.growth_intelligence_research_pipelines pipeline
where pipeline.organization_id = 'e5000000-0000-4000-8000-000000000201'::uuid
  and pipeline.id = (select pipeline_one from pg_temp.budget_starts);

set local role authenticated;
set local request.jwt.claim.sub = 'e5000000-0000-4000-8000-000000000002';

select extensions.throws_ok(
  $$select public.reserve_research_request_budget(
    'e5000000-0000-4000-8000-000000000201'::uuid,
    'e5000000-0000-4000-8000-000000000503'::uuid,
    1::bigint, 'brave-2026-09'
  )$$,
  '42501', null,
  'spend is refused while provider qualification is missing'
);

reset role;

-- A staged qualification row unlocks the boundary -------------------------------

insert into private.growth_intelligence_provider_qualifications (
  provider, agreement_version, agreement_date, agreement_expires_at,
  permitted_uses, retention_policy, deletion_rules, pricing_version,
  search_rate_micros_usd, credential_ready, model_bounds, canary_result
) values (
  'brave', 'BRAVE-ORDER-2026-09-08', '2026-09-01', pg_catalog.now() + interval '90 days',
  array['snippet_storage', 'commercial_inference', 'organization_display', 'derived_claims', 'synthesis_reuse', 'agreed_retention'],
  'retain permitted excerpts for 400 days, then erase',
  'erase on termination within 30 days, including derived text on request',
  'brave-search-2026-09', 1200, true,
  '{"extraction": {"maxInputTokens": 12000, "maxOutputTokens": 4000}, "supportReview": {"maxInputTokens": 12000, "maxOutputTokens": 4000}, "synthesis": {"maxInputTokens": 24000, "maxOutputTokens": 6000}}'::jsonb,
  'passed'
);

select extensions.is(
  (select (public.check_research_provider_qualification() ->> 'available')::boolean),
  true,
  'a complete staged qualification reports available'
);

-- Pipelines admit quotes against the organization local day ---------------------

set local role authenticated;
set local request.jwt.claim.sub = 'e5000000-0000-4000-8000-000000000002';

select extensions.throws_ok(
  $$select public.reserve_research_pipeline_budget(
    'e5000000-0000-4000-8000-000000000201'::uuid,
    (select pipeline_one from pg_temp.budget_starts),
    0::bigint, 'brave-2026-09'
  )$$,
  '22023', null,
  'a zero quote is not a reservation'
);

select extensions.throws_ok(
  $$select public.reserve_research_pipeline_budget(
    'e5000000-0000-4000-8000-000000000201'::uuid,
    (select pipeline_one from pg_temp.budget_starts),
    1000001::bigint, 'brave-2026-09'
  )$$,
  '22023', null,
  'a quote above USD 1 is refused before any paid call'
);

select extensions.is(
  (select public.reserve_research_pipeline_budget(
    'e5000000-0000-4000-8000-000000000201'::uuid,
    (select pipeline_one from pg_temp.budget_starts),
    1000000::bigint, 'brave-2026-09'
  ) ->> 'replayed')::boolean,
  false,
  'the first pipeline reservation admits its full quote'
);

-- Capture the admitted reservation through its own replayed receipt: browser
-- sessions hold no grant on the private ledger, so the suite never reads it
-- directly while authenticated.
create temp table pg_temp.budget_reservation_one as
select public.reserve_research_pipeline_budget(
  'e5000000-0000-4000-8000-000000000201'::uuid,
  (select pipeline_one from pg_temp.budget_starts),
  1000000::bigint, 'brave-2026-09'
) as response;

select extensions.is(
  (select public.reserve_research_pipeline_budget(
    'e5000000-0000-4000-8000-000000000201'::uuid,
    (select pipeline_one from pg_temp.budget_starts),
    1000000::bigint, 'brave-2026-09'
  ) ->> 'allowanceDay')::date,
  (pg_catalog.now() at time zone 'Asia/Dubai')::date,
  'the database resolves the organization local day, not the caller'
);

select extensions.is(
  (select public.reserve_research_pipeline_budget(
    'e5000000-0000-4000-8000-000000000201'::uuid,
    (select pipeline_one from pg_temp.budget_starts),
    1000000::bigint, 'brave-2026-09'
  ) ->> 'replayed')::boolean,
  true,
  'replaying the same pipeline reservation cannot reserve twice'
);

select extensions.is(
  (select public.reserve_research_pipeline_budget(
    'e5000000-0000-4000-8000-000000000201'::uuid,
    (select pipeline_one from pg_temp.budget_starts),
    1000000::bigint, 'brave-2026-09'
  ) ->> 'reservationId')::uuid,
  (select (response ->> 'reservationId')::uuid from pg_temp.budget_reservation_one),
  'replay returns the same reservation row'
);

select extensions.throws_ok(
  $$select public.reserve_research_pipeline_budget(
    'e5000000-0000-4000-8000-000000000201'::uuid,
    (select pipeline_one from pg_temp.budget_starts),
    500000::bigint, 'brave-2026-09'
  )$$,
  '23505', null,
  'replaying with a different quote conflicts instead of double booking'
);

reset role;

-- Tenant fencing and closed pipelines -------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'e5000000-0000-4000-8000-000000000004';

select extensions.throws_ok(
  $$select public.reserve_research_pipeline_budget(
    'e5000000-0000-4000-8000-000000000201'::uuid,
    (select pipeline_one from pg_temp.budget_starts),
    1000000::bigint, 'brave-2026-09'
  )$$,
  '42501', null,
  'another tenant cannot reserve against this pipeline'
);

reset role;

set local role authenticated;
set local request.jwt.claim.sub = 'e5000000-0000-4000-8000-000000000003';

select extensions.throws_ok(
  $$select public.reserve_research_pipeline_budget(
    'e5000000-0000-4000-8000-000000000201'::uuid,
    (select pipeline_two from pg_temp.budget_starts),
    1000000::bigint, 'brave-2026-09'
  )$$,
  '42501', null,
  'viewers cannot reserve research spend'
);

reset role;

update public.growth_intelligence_research_pipelines
set stage = 'cancelled'
where organization_id = 'e5000000-0000-4000-8000-000000000201'::uuid
  and id = (select pipeline_three from pg_temp.budget_starts);

set local role authenticated;
set local request.jwt.claim.sub = 'e5000000-0000-4000-8000-000000000002';

select extensions.throws_ok(
  $$select public.reserve_research_pipeline_budget(
    'e5000000-0000-4000-8000-000000000201'::uuid,
    (select pipeline_three from pg_temp.budget_starts),
    1000000::bigint, 'brave-2026-09'
  )$$,
  '23505', null,
  'a cancelled pipeline admits no new reservation'
);

-- Pipelines, weekly synthesis and legacy research share one allowance -------------

select extensions.is(
  (select public.reserve_research_pipeline_budget(
    'e5000000-0000-4000-8000-000000000201'::uuid,
    (select pipeline_two from pg_temp.budget_starts),
    1000000::bigint, 'brave-2026-09'
  ) ->> 'replayed')::boolean,
  false,
  'the second pipeline reserves against the same day ledger'
);

reset role;

insert into public.growth_intelligence_requests (
  id, organization_id, branch_id, kind, trigger_reason, request_fingerprint,
  market_profile_version_id, source_policy_digest, research_rule_version,
  local_time_bucket, due_at, correlation_id
)
select
  'e5000000-0000-4000-8000-000000000501'::uuid,
  'e5000000-0000-4000-8000-000000000201'::uuid,
  'e5000000-0000-4000-8000-000000000301'::uuid,
  'weekly_synthesis', 'weekly_due',
  'e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5',
  pipeline.market_profile_version_id,
  'f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5',
  'research-rules@1', 'weekly:2026-09-08',
  pg_catalog.now() - interval '1 hour',
  'e5000000-0000-4000-8000-000000000704'::uuid
from public.growth_intelligence_research_pipelines pipeline
where pipeline.organization_id = 'e5000000-0000-4000-8000-000000000201'::uuid
  and pipeline.id = (select pipeline_one from pg_temp.budget_starts);

insert into public.growth_intelligence_requests (
  id, organization_id, branch_id, kind, trigger_reason, request_fingerprint,
  market_profile_version_id, source_policy_digest, research_rule_version,
  local_time_bucket, due_at, correlation_id
)
select
  'e5000000-0000-4000-8000-000000000502'::uuid,
  'e5000000-0000-4000-8000-000000000201'::uuid,
  'e5000000-0000-4000-8000-000000000301'::uuid,
  'weekly_synthesis', 'weekly_due',
  'e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6',
  pipeline.market_profile_version_id,
  'f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5',
  'research-rules@1', 'weekly:2026-09-08',
  pg_catalog.now() - interval '1 hour',
  'e5000000-0000-4000-8000-000000000705'::uuid
from public.growth_intelligence_research_pipelines pipeline
where pipeline.organization_id = 'e5000000-0000-4000-8000-000000000201'::uuid
  and pipeline.id = (select pipeline_one from pg_temp.budget_starts);

set local role authenticated;
set local request.jwt.claim.sub = 'e5000000-0000-4000-8000-000000000002';

select extensions.is(
  (select public.reserve_research_request_budget(
    'e5000000-0000-4000-8000-000000000201'::uuid,
    'e5000000-0000-4000-8000-000000000501'::uuid,
    1000000::bigint, 'brave-2026-09'
  ) ->> 'replayed')::boolean,
  false,
  'weekly synthesis reserves from the shared organization allowance'
);

select extensions.is(
  (select public.reserve_research_request_budget(
    'e5000000-0000-4000-8000-000000000201'::uuid,
    'e5000000-0000-4000-8000-000000000502'::uuid,
    1000000::bigint, 'brave-2026-09'
  ) ->> 'replayed')::boolean,
  false,
  'a second standalone request shares the same day ledger'
);

create temp table pg_temp.budget_reservation_501 as
select public.reserve_research_request_budget(
  'e5000000-0000-4000-8000-000000000201'::uuid,
  'e5000000-0000-4000-8000-000000000501'::uuid,
  1000000::bigint, 'brave-2026-09'
) as response;

select
  (public.start_branch_market_research(
    'e5000000-0000-4000-8000-000000000201'::uuid,
    'e5000000-0000-4000-8000-000000000002'::uuid,
    'e5000000-0000-4000-8000-000000000303'::uuid,
    pg_temp.budget_v2_doc('e5000000-0000-4000-8000-000000000303'::uuid),
    pg_temp.budget_digest(pg_temp.budget_v2_doc('e5000000-0000-4000-8000-000000000303'::uuid)),
    null,
    'budget-pipeline-four-key-004',
    'e5000000-0000-4000-8000-000000000708'::uuid
  ) ->> 'pipelineId')::uuid as pipeline_four
into temp pg_temp.budget_four;

select extensions.is(
  (select public.reserve_research_pipeline_budget(
    'e5000000-0000-4000-8000-000000000201'::uuid,
    (select pipeline_four from pg_temp.budget_four),
    1000000::bigint, 'brave-2026-09'
  ) ->> 'replayed')::boolean,
  false,
  'the day allowance fills exactly at USD 5 across pipelines and requests'
);

select extensions.is(
  (select public.release_research_budget_reservation(
    'e5000000-0000-4000-8000-000000000201'::uuid,
    (select (response ->> 'reservationId')::uuid from pg_temp.budget_reservation_501)
  ) ->> 'released')::boolean,
  true,
  'a confirmed unused reserve releases its allowance'
);

select extensions.is(
  (select public.release_research_budget_reservation(
    'e5000000-0000-4000-8000-000000000201'::uuid,
    (select (response ->> 'reservationId')::uuid from pg_temp.budget_reservation_501)
  ) ->> 'replayed')::boolean,
  true,
  'releasing twice replays instead of freeing twice'
);

reset role;

insert into public.growth_intelligence_requests (
  id, organization_id, branch_id, kind, trigger_reason, request_fingerprint,
  market_profile_version_id, source_policy_digest, research_rule_version,
  local_time_bucket, due_at, correlation_id
)
select
  'e5000000-0000-4000-8000-000000000504'::uuid,
  'e5000000-0000-4000-8000-000000000201'::uuid,
  'e5000000-0000-4000-8000-000000000301'::uuid,
  'weekly_synthesis', 'weekly_due',
  'e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8',
  pipeline.market_profile_version_id,
  'f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5',
  'research-rules@1', 'weekly:2026-09-08',
  pg_catalog.now() - interval '1 hour',
  'e5000000-0000-4000-8000-000000000710'::uuid
from public.growth_intelligence_research_pipelines pipeline
where pipeline.organization_id = 'e5000000-0000-4000-8000-000000000201'::uuid
  and pipeline.id = (select pipeline_one from pg_temp.budget_starts);

set local role authenticated;
set local request.jwt.claim.sub = 'e5000000-0000-4000-8000-000000000002';

select extensions.is(
  (select public.reserve_research_request_budget(
    'e5000000-0000-4000-8000-000000000201'::uuid,
    'e5000000-0000-4000-8000-000000000504'::uuid,
    1000000::bigint, 'brave-2026-09'
  ) ->> 'replayed')::boolean,
  false,
  'a released allowance admits new work again'
);

select extensions.throws_ok(
  $$select public.reserve_research_attempt(
    'e5000000-0000-4000-8000-000000000201'::uuid,
    '{"kind": "request", "id": "e5000000-0000-4000-8000-000000000501"}'::jsonb,
    'synthesis', 'weekly-synthesis', 0, 100::bigint,
    'e5000000-0000-4000-8000-000000000601'::uuid
  )$$,
  '23505', null,
  'a released reservation issues no new calls'
);

reset role;

-- Attempts debit worst case before the call, under a live lease --------------------

set local role service_role;

select public.claim_growth_intelligence_request(
  'e5000000-0000-4000-8000-000000000201'::uuid,
  'e5000000-0000-4000-8000-000000000502'::uuid,
  'e5000000-0000-4000-8000-000000000601'::uuid,
  600
);

select public.claim_growth_intelligence_request(
  'e5000000-0000-4000-8000-000000000201'::uuid,
  (select research_request_id from public.growth_intelligence_research_pipelines
   where organization_id = 'e5000000-0000-4000-8000-000000000201'::uuid
     and id = (select pipeline_one from pg_temp.budget_starts)),
  'e5000000-0000-4000-8000-000000000602'::uuid,
  600
);

reset role;

set local role authenticated;
set local request.jwt.claim.sub = 'e5000000-0000-4000-8000-000000000002';

select extensions.is(
  (select public.reserve_research_attempt(
    'e5000000-0000-4000-8000-000000000201'::uuid,
    '{"kind": "request", "id": "e5000000-0000-4000-8000-000000000502"}'::jsonb,
    'synthesis', 'weekly-synthesis', 0, 600000::bigint,
    'e5000000-0000-4000-8000-000000000601'::uuid
  ) ->> 'replayed')::boolean,
  false,
  'the first attempt debits its worst case before the call'
);

create temp table pg_temp.budget_attempt_weekly_0 as
select public.reserve_research_attempt(
  'e5000000-0000-4000-8000-000000000201'::uuid,
  '{"kind": "request", "id": "e5000000-0000-4000-8000-000000000502"}'::jsonb,
  'synthesis', 'weekly-synthesis', 0, 600000::bigint,
  'e5000000-0000-4000-8000-000000000601'::uuid
) as response;

select extensions.is(
  (select public.reserve_research_attempt(
    'e5000000-0000-4000-8000-000000000201'::uuid,
    '{"kind": "request", "id": "e5000000-0000-4000-8000-000000000502"}'::jsonb,
    'synthesis', 'weekly-synthesis', 0, 600000::bigint,
    'e5000000-0000-4000-8000-000000000601'::uuid
  ) ->> 'replayed')::boolean,
  true,
  'replaying an attempt cannot debit twice'
);

select extensions.is(
  (select public.reserve_research_attempt(
    'e5000000-0000-4000-8000-000000000201'::uuid,
    '{"kind": "request", "id": "e5000000-0000-4000-8000-000000000502"}'::jsonb,
    'synthesis', 'weekly-synthesis', 0, 600000::bigint,
    'e5000000-0000-4000-8000-000000000601'::uuid
  ) ->> 'attemptId')::uuid,
  (select (response ->> 'attemptId')::uuid from pg_temp.budget_attempt_weekly_0),
  'replay returns the same attempt row'
);

select extensions.throws_ok(
  $$select public.reserve_research_attempt(
    'e5000000-0000-4000-8000-000000000201'::uuid,
    '{"kind": "request", "id": "e5000000-0000-4000-8000-000000000502"}'::jsonb,
    'synthesis', 'weekly-synthesis', 0, 600001::bigint,
    'e5000000-0000-4000-8000-000000000601'::uuid
  )$$,
  '23505', null,
  'the same attempt key with a different worst case conflicts'
);

select extensions.throws_ok(
  $$select public.reserve_research_attempt(
    'e5000000-0000-4000-8000-000000000201'::uuid,
    '{"kind": "request", "id": "e5000000-0000-4000-8000-000000000502"}'::jsonb,
    'synthesis', 'weekly-synthesis', 1, 500000::bigint,
    'e5000000-0000-4000-8000-000000000601'::uuid
  )$$,
  '23505', null,
  'attempts cannot exceed the admitted reservation quote'
);

select extensions.throws_ok(
  $$select public.reserve_research_attempt(
    'e5000000-0000-4000-8000-000000000201'::uuid,
    '{"kind": "request", "id": "e5000000-0000-4000-8000-000000000502"}'::jsonb,
    'synthesis', 'weekly-synthesis', 1, 100::bigint,
    'e5000000-0000-4000-8000-000000000699'::uuid
  )$$,
  '42501', null,
  'a stale worker with the wrong claim token issues no new calls'
);

-- Unknown cost stays reserved until explicit reconciliation ------------------------

select extensions.is(
  (select public.settle_research_attempt(
    'e5000000-0000-4000-8000-000000000201'::uuid,
    (select (response ->> 'attemptId')::uuid from pg_temp.budget_attempt_weekly_0),
    '{"kind": "unknown"}'::jsonb
  ) ->> 'settlementKind'),
  'unknown',
  'an ambiguous timeout settles as unknown, never as zero'
);

select extensions.throws_ok(
  $$select public.reserve_research_attempt(
    'e5000000-0000-4000-8000-000000000201'::uuid,
    '{"kind": "request", "id": "e5000000-0000-4000-8000-000000000502"}'::jsonb,
    'synthesis', 'weekly-synthesis', 1, 500000::bigint,
    'e5000000-0000-4000-8000-000000000601'::uuid
  )$$,
  '23505', null,
  'unknown cost retains its full worst-case liability'
);

select extensions.is(
  (select public.settle_research_attempt(
    'e5000000-0000-4000-8000-000000000201'::uuid,
    (select (response ->> 'attemptId')::uuid from pg_temp.budget_attempt_weekly_0),
    '{"kind": "reported", "microsUsd": 100000}'::jsonb
  ) ->> 'actualMicrosUsd')::bigint,
  100000::bigint,
  'a late accounting receipt reconciles the already-issued attempt'
);

select extensions.is(
  (select public.reserve_research_attempt(
    'e5000000-0000-4000-8000-000000000201'::uuid,
    '{"kind": "request", "id": "e5000000-0000-4000-8000-000000000502"}'::jsonb,
    'synthesis', 'weekly-synthesis', 1, 500000::bigint,
    'e5000000-0000-4000-8000-000000000601'::uuid
  ) ->> 'replayed')::boolean,
  false,
  'reconciliation frees the reservation for the next attempt'
);

create temp table pg_temp.budget_attempt_weekly_1 as
select public.reserve_research_attempt(
  'e5000000-0000-4000-8000-000000000201'::uuid,
  '{"kind": "request", "id": "e5000000-0000-4000-8000-000000000502"}'::jsonb,
  'synthesis', 'weekly-synthesis', 1, 500000::bigint,
  'e5000000-0000-4000-8000-000000000601'::uuid
) as response;

-- Actuals are never clamped; overruns block further calls --------------------------

select extensions.is(
  (select public.settle_research_attempt(
    'e5000000-0000-4000-8000-000000000201'::uuid,
    (select (response ->> 'attemptId')::uuid from pg_temp.budget_attempt_weekly_1),
    '{"kind": "reported", "microsUsd": 900000}'::jsonb
  ) ->> 'overrunBlocked')::boolean,
  true,
  'an actual above the worst case is recorded, never clamped'
);

select extensions.throws_ok(
  $$select public.reserve_research_attempt(
    'e5000000-0000-4000-8000-000000000201'::uuid,
    '{"kind": "request", "id": "e5000000-0000-4000-8000-000000000502"}'::jsonb,
    'synthesis', 'weekly-synthesis', 2, 100::bigint,
    'e5000000-0000-4000-8000-000000000601'::uuid
  )$$,
  '23505', null,
  'an overrun blocks further calls on the reservation'
);

select extensions.is(
  (select public.settle_research_attempt(
    'e5000000-0000-4000-8000-000000000201'::uuid,
    (select (response ->> 'attemptId')::uuid from pg_temp.budget_attempt_weekly_1),
    '{"kind": "reported", "microsUsd": 900000}'::jsonb
  ) ->> 'replayed')::boolean,
  true,
  'an identical receipt replays instead of duplicating'
);

select extensions.throws_ok(
  format(
    $$select public.settle_research_attempt(
      'e5000000-0000-4000-8000-000000000201'::uuid,
      %L::uuid,
      '{"kind": "reported", "microsUsd": 800000}'::jsonb
    )$$,
    (select response ->> 'attemptId' from pg_temp.budget_attempt_weekly_1)
  ),
  '23505', null,
  'a conflicting receipt never rewrites an immutable receipt'
);

-- A late receipt reconciles without touching a cancelled pipeline -------------------

select extensions.is(
  (select public.reserve_research_attempt(
    'e5000000-0000-4000-8000-000000000201'::uuid,
    (select pg_catalog.jsonb_build_object(
      'kind', 'pipeline',
      'id', (select pipeline_one from pg_temp.budget_starts)
    )),
    'research', 'local-market', 0, 100000::bigint,
    'e5000000-0000-4000-8000-000000000602'::uuid
  ) ->> 'replayed')::boolean,
  false,
  'a pipeline attempt debits through the discriminated work scope'
);

create temp table pg_temp.budget_attempt_pipeline_0 as
select public.reserve_research_attempt(
  'e5000000-0000-4000-8000-000000000201'::uuid,
  (select pg_catalog.jsonb_build_object(
    'kind', 'pipeline',
    'id', (select pipeline_one from pg_temp.budget_starts)
  )),
  'research', 'local-market', 0, 100000::bigint,
  'e5000000-0000-4000-8000-000000000602'::uuid
) as response;

reset role;

set local role authenticated;
set local request.jwt.claim.sub = 'e5000000-0000-4000-8000-000000000002';

select public.cancel_growth_intelligence_request(
  'e5000000-0000-4000-8000-000000000201'::uuid,
  'e5000000-0000-4000-8000-000000000002'::uuid,
  (select research_request_id from public.growth_intelligence_research_pipelines
   where organization_id = 'e5000000-0000-4000-8000-000000000201'::uuid
     and id = (select pipeline_one from pg_temp.budget_starts)),
  'superseded by test',
  'budget-cancel-key-001',
  'e5000000-0000-4000-8000-000000000706'::uuid
);

select extensions.is(
  (select public.settle_research_attempt(
    'e5000000-0000-4000-8000-000000000201'::uuid,
    (select (response ->> 'attemptId')::uuid from pg_temp.budget_attempt_pipeline_0),
    '{"kind": "reported", "microsUsd": 50000}'::jsonb
  ) ->> 'settlementKind'),
  'reported',
  'a late accounting receipt reconciles after cancellation'
);

select extensions.is(
  (select stage from public.growth_intelligence_research_pipelines
   where organization_id = 'e5000000-0000-4000-8000-000000000201'::uuid
     and id = (select pipeline_one from pg_temp.budget_starts)),
  'queued',
  'reconciliation changes no pipeline stage'
);

reset role;

-- A running pipeline stays charged to its admission day -----------------------------

insert into private.growth_intelligence_research_day_allowances (
  organization_id, allowance_day
) values (
  'e5000000-0000-4000-8000-000000000201'::uuid,
  (pg_catalog.now() at time zone 'Asia/Dubai')::date - 1
);

insert into private.growth_intelligence_research_budget_reservations (
  id, organization_id, allowance_day, pipeline_id, quote_micros_usd, price_version
) values (
  'e5000000-0000-4000-8000-000000000801'::uuid,
  'e5000000-0000-4000-8000-000000000201'::uuid,
  (pg_catalog.now() at time zone 'Asia/Dubai')::date - 1,
  (select pipeline_three from pg_temp.budget_starts),
  100000::bigint, 'brave-2026-09'
);

insert into private.growth_intelligence_research_attempt_ledger (
  id, organization_id, reservation_id, phase, slot_key, attempt_index, maximum_micros_usd
) values (
  'e5000000-0000-4000-8000-000000000802'::uuid,
  'e5000000-0000-4000-8000-000000000201'::uuid,
  'e5000000-0000-4000-8000-000000000801'::uuid,
  'research', 'local-market', 0, 50000::bigint
);

set local role authenticated;
set local request.jwt.claim.sub = 'e5000000-0000-4000-8000-000000000002';

select extensions.is(
  (select public.settle_research_attempt(
    'e5000000-0000-4000-8000-000000000201'::uuid,
    'e5000000-0000-4000-8000-000000000802'::uuid,
    '{"kind": "reported", "microsUsd": 40000}'::jsonb
  ) ->> 'settlementKind'),
  'reported',
  'a cross-midnight attempt still reconciles'
);

reset role;

select extensions.is(
  (select allowance_day from private.growth_intelligence_research_budget_reservations
   where organization_id = 'e5000000-0000-4000-8000-000000000201'::uuid
     and id = 'e5000000-0000-4000-8000-000000000801'::uuid),
  (pg_catalog.now() at time zone 'Asia/Dubai')::date - 1,
  'a running pipeline remains charged to its admission day'
);

select extensions.is(
  (select coalesce(sum(quote_micros_usd), 0)::bigint
   from private.growth_intelligence_research_budget_reservations
   where organization_id = 'e5000000-0000-4000-8000-000000000201'::uuid
     and allowance_day = (pg_catalog.now() at time zone 'Asia/Dubai')::date
     and status = 'active'),
  5000000::bigint,
  'yesterday spend never leaks into the current allowance'
);

rollback;
