begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(18);

-- Contract: the three day-allowance RPCs expose the service_role-only
-- p_skip_allowance flag (ADR 0077). Default calls behave exactly as before.

select extensions.has_function(
  'public', 'reserve_research_request_budget',
  array['uuid', 'uuid', 'bigint', 'text', 'boolean'],
  'request admission exposes the allowance bypass flag'
);
select extensions.has_function(
  'public', 'reserve_research_pipeline_budget',
  array['uuid', 'uuid', 'bigint', 'text', 'boolean'],
  'pipeline admission exposes the allowance bypass flag'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.reserve_research_request_budget(uuid,uuid,bigint,text,boolean)',
    'execute'
  ),
  'signed-in members keep request admission through the governed RPC'
);

-- Fixtures -------------------------------------------------------------------

insert into auth.users (id) values
  ('e7000000-0000-4000-8000-000000000001'::uuid),
  ('e7000000-0000-4000-8000-000000000002'::uuid);

insert into public.accounts (id, name, slug, created_by) values
  ('e7000000-0000-4000-8000-000000000101'::uuid, 'Bypass agency', 'bypass-agency', 'e7000000-0000-4000-8000-000000000001'::uuid);

insert into public.organizations (
  id, account_id, name, slug, industry, country_code, base_currency,
  default_timezone, created_by
) values
  ('e7000000-0000-4000-8000-000000000201'::uuid, 'e7000000-0000-4000-8000-000000000101'::uuid, 'Bypass client', 'bypass-client', 'testing', 'AE', 'AED', 'Asia/Dubai', 'e7000000-0000-4000-8000-000000000001'::uuid);

insert into public.account_memberships (
  account_id, user_id, account_role, default_organization_role
) values
  ('e7000000-0000-4000-8000-000000000101'::uuid, 'e7000000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner'),
  ('e7000000-0000-4000-8000-000000000101'::uuid, 'e7000000-0000-4000-8000-000000000002'::uuid, 'member', 'operator');

insert into public.branches (
  id, organization_id, name, slug, kind, timezone, currency, is_active
) values
  ('e7000000-0000-4000-8000-000000000301'::uuid, 'e7000000-0000-4000-8000-000000000201'::uuid, 'Bypass branch', 'bypass-branch', 'physical', 'Asia/Dubai', 'AED', true);

create or replace function pg_temp.bypass_v2_doc(p_branch_id uuid)
returns jsonb
language sql
immutable
as $$
  select pg_catalog.jsonb_build_object(
    'schemaVersion', 2,
    'branchId', p_branch_id,
    'publicIdentity', pg_catalog.jsonb_build_object(
      'approvedName', 'Bypass Kitchen',
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
        'layer', 'trade_area', 'locationRef', 'ae:du:bypass', 'name', 'Bypass area',
        'branchId', p_branch_id, 'radiusKm', 8
      )
    ),
    'competitors', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'key', 'bypass-rival', 'name', 'Bypass Rival',
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

create or replace function pg_temp.bypass_digest(p_document jsonb)
returns text
language sql
security definer
set search_path = ''
as $$
  select private.create_market_profile_digest(p_document);
$$;

-- A live canary on shared staging may have committed a tinyfish row; remove
-- it inside this transaction (rolled back afterwards) so qualification below
-- is the staged one under test.

delete from private.growth_intelligence_provider_qualifications
where provider = 'tinyfish';

insert into private.growth_intelligence_provider_qualifications (
  provider, agreement_version, agreement_date, agreement_expires_at,
  permitted_uses, retention_policy, deletion_rules, pricing_version,
  search_rate_micros_usd, credential_ready, model_bounds, canary_result
) values (
  'tinyfish', 'TINYFISH-ORDER-2026-09-20', '2026-09-01', pg_catalog.now() + interval '90 days',
  array['snippet_storage', 'commercial_inference', 'organization_display', 'derived_claims', 'synthesis_reuse', 'agreed_retention'],
  'retain permitted excerpts per agreement, then erase',
  'erase on termination within 30 days, including derived text on request',
  'tinyfish-search-2026-09', 1, true,
  '{"extraction": {"maxInputTokens": 12000, "maxOutputTokens": 4000}, "supportReview": {"maxInputTokens": 12000, "maxOutputTokens": 4000}, "synthesis": {"maxInputTokens": 24000, "maxOutputTokens": 6000}}'::jsonb,
  'passed'
);

set local role authenticated;
set local request.jwt.claim.sub = 'e7000000-0000-4000-8000-000000000002';

create temp table pg_temp.bypass_starts as
select
  (public.start_branch_market_research(
    'e7000000-0000-4000-8000-000000000201'::uuid,
    'e7000000-0000-4000-8000-000000000002'::uuid,
    'e7000000-0000-4000-8000-000000000301'::uuid,
    pg_temp.bypass_v2_doc('e7000000-0000-4000-8000-000000000301'::uuid),
    pg_temp.bypass_digest(pg_temp.bypass_v2_doc('e7000000-0000-4000-8000-000000000301'::uuid)),
    null,
    'bypass-pipeline-one-key-001',
    'e7000000-0000-4000-8000-000000000701'::uuid
  ) ->> 'pipelineId')::uuid as pipeline_one;

grant select on table pg_temp.bypass_starts to service_role;

reset role;

insert into public.growth_intelligence_requests (
  id, organization_id, branch_id, kind, trigger_reason, request_fingerprint,
  market_profile_version_id, source_policy_digest, research_rule_version,
  local_time_bucket, due_at, correlation_id
)
select
  ('e7000000-0000-4000-8000-0000000005' || lpad(gs.n::text, 2, '0'))::uuid,
  'e7000000-0000-4000-8000-000000000201'::uuid,
  'e7000000-0000-4000-8000-000000000301'::uuid,
  'weekly_synthesis', 'weekly_due',
  ('e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9' || lpad(gs.n::text, 2, '0')),
  pipeline.market_profile_version_id,
  'f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5',
  'research-rules@1', 'weekly:2026-09-08',
  pg_catalog.now() - interval '1 hour',
  ('e7000000-0000-4000-8000-0000000007' || lpad(gs.n::text, 2, '0'))::uuid
from public.growth_intelligence_research_pipelines pipeline,
  pg_catalog.generate_series(1, 7) gs(n)
where pipeline.organization_id = 'e7000000-0000-4000-8000-000000000201'::uuid
  and pipeline.id = (select pipeline_one from pg_temp.bypass_starts);

insert into public.growth_intelligence_research_projects (
  id, organization_id, branch_id, title, question, mode, created_by
) values
  ('e7000000-0000-4000-8000-000000000401'::uuid, 'e7000000-0000-4000-8000-000000000201'::uuid, 'e7000000-0000-4000-8000-000000000301'::uuid, 'Bypass probe', 'How does demand change?', 'one-time', 'e7000000-0000-4000-8000-000000000001'::uuid);

insert into public.growth_intelligence_monitoring_updates (
  update_id, organization_id, project_id, stage, attempts
) values
  ('e7000000-0000-4000-8000-000000000801'::uuid, 'e7000000-0000-4000-8000-000000000201'::uuid, 'e7000000-0000-4000-8000-000000000401'::uuid, 'queued', 1),
  ('e7000000-0000-4000-8000-000000000802'::uuid, 'e7000000-0000-4000-8000-000000000201'::uuid, 'e7000000-0000-4000-8000-000000000401'::uuid, 'queued', 1);

-- Fill the USD 5 day allowance with five ordinary reservations -------------

set local role authenticated;
set local request.jwt.claim.sub = 'e7000000-0000-4000-8000-000000000002';

select extensions.is(
  (select public.reserve_research_request_budget(
    'e7000000-0000-4000-8000-000000000201'::uuid,
    'e7000000-0000-4000-8000-000000000501'::uuid,
    1000000::bigint, 'tinyfish-search-2026-09'
  ) ->> 'replayed')::boolean,
  false,
  'first ordinary reservation succeeds'
);
select extensions.is(
  (select public.reserve_research_request_budget(
    'e7000000-0000-4000-8000-000000000201'::uuid,
    'e7000000-0000-4000-8000-000000000502'::uuid,
    1000000::bigint, 'tinyfish-search-2026-09'
  ) ->> 'replayed')::boolean,
  false,
  'second ordinary reservation succeeds'
);
select extensions.is(
  (select public.reserve_research_request_budget(
    'e7000000-0000-4000-8000-000000000201'::uuid,
    'e7000000-0000-4000-8000-000000000503'::uuid,
    1000000::bigint, 'tinyfish-search-2026-09'
  ) ->> 'replayed')::boolean,
  false,
  'third ordinary reservation succeeds'
);
select extensions.is(
  (select public.reserve_research_request_budget(
    'e7000000-0000-4000-8000-000000000201'::uuid,
    'e7000000-0000-4000-8000-000000000504'::uuid,
    1000000::bigint, 'tinyfish-search-2026-09'
  ) ->> 'replayed')::boolean,
  false,
  'fourth ordinary reservation succeeds'
);
select extensions.is(
  (select public.reserve_research_request_budget(
    'e7000000-0000-4000-8000-000000000201'::uuid,
    'e7000000-0000-4000-8000-000000000505'::uuid,
    1000000::bigint, 'tinyfish-search-2026-09'
  ) ->> 'replayed')::boolean,
  false,
  'fifth ordinary reservation fills the day allowance exactly'
);

-- Default calls stay capped --------------------------------------------------

select extensions.throws_ok(
  $$select public.reserve_research_request_budget(
    'e7000000-0000-4000-8000-000000000201'::uuid,
    'e7000000-0000-4000-8000-000000000506'::uuid,
    1000000::bigint, 'tinyfish-search-2026-09'
  )$$,
  '23505', null,
  'the sixth ordinary reservation refuses once the allowance is full'
);

-- service_role bypass skips only the allowance comparison -------------------

reset role;
set local role service_role;

select extensions.is(
  (select public.reserve_research_request_budget(
    'e7000000-0000-4000-8000-000000000201'::uuid,
    'e7000000-0000-4000-8000-000000000506'::uuid,
    1000000::bigint, 'tinyfish-search-2026-09', true
  ) ->> 'replayed')::boolean,
  false,
  'service_role bypass reserves past a full allowance'
);
select extensions.is(
  (select public.reserve_research_request_budget(
    'e7000000-0000-4000-8000-000000000201'::uuid,
    'e7000000-0000-4000-8000-000000000506'::uuid,
    1000000::bigint, 'tinyfish-search-2026-09', true
  ) ->> 'replayed')::boolean,
  true,
  'the bypassed reservation replays instead of double-spending'
);
select extensions.throws_ok(
  $$select public.reserve_research_request_budget(
    'e7000000-0000-4000-8000-000000000201'::uuid,
    'e7000000-0000-4000-8000-000000000506'::uuid,
    0::bigint, 'tinyfish-search-2026-09', true
  )$$,
  '22023', null,
  'the bypass keeps quote validation intact'
);
select extensions.throws_ok(
  $$select public.reserve_research_request_budget(
    'e7000000-0000-4000-8000-000000000201'::uuid,
    'e7000000-0000-4000-8000-000000000506'::uuid,
    500000::bigint, 'tinyfish-search-2026-09', true
  )$$,
  '23505', null,
  'the bypass keeps reservation conflict detection intact'
);
select extensions.is(
  (select public.reserve_research_pipeline_budget(
    'e7000000-0000-4000-8000-000000000201'::uuid,
    (select pipeline_one from pg_temp.bypass_starts),
    1000000::bigint, 'tinyfish-search-2026-09', true
  ) ->> 'replayed')::boolean,
  false,
  'the pipeline lane bypasses past a full allowance too'
);
select extensions.is(
  (select public.reserve_monitoring_update_budget(
    'e7000000-0000-4000-8000-000000000201'::uuid,
    'e7000000-0000-4000-8000-000000000801'::uuid,
    1000000::bigint, 'tinyfish-search-2026-09', true
  ) ->> 'replayed')::boolean,
  false,
  'the monitoring update lane bypasses past a full allowance too'
);

reset role;

select extensions.is(
  (select pg_catalog.count(*)::integer
   from private.growth_intelligence_research_budget_reservations reservation
   where reservation.organization_id = 'e7000000-0000-4000-8000-000000000201'::uuid
     and reservation.request_id = 'e7000000-0000-4000-8000-000000000506'::uuid),
  1,
  'the bypassed spend is still attributed in the ledger'
);

-- The bypass is service_role-only -------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'e7000000-0000-4000-8000-000000000002';

select extensions.throws_ok(
  $$select public.reserve_research_request_budget(
    'e7000000-0000-4000-8000-000000000201'::uuid,
    'e7000000-0000-4000-8000-000000000507'::uuid,
    1000000::bigint, 'tinyfish-search-2026-09', true
  )$$,
  '42501', null,
  'signed-in members cannot pass the bypass flag'
);
select extensions.throws_ok(
  $$select public.reserve_research_request_budget(
    'e7000000-0000-4000-8000-000000000201'::uuid,
    'e7000000-0000-4000-8000-000000000507'::uuid,
    1000000::bigint, 'tinyfish-search-2026-09'
  )$$,
  '23505', null,
  'the cap itself is unchanged for ordinary calls after bypass use'
);

reset role;

rollback;
