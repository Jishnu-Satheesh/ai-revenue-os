begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(24);

-- Contract ------------------------------------------------------------------

select extensions.has_column(
  'public', 'growth_intelligence_items', 'branch_id',
  'synthesized items carry their exact synthesis branch'
);

select extensions.is(
  (select pg_catalog.count(*) from pg_catalog.pg_constraint
   where conname = 'growth_intelligence_items_branch_fkey'),
  1::bigint,
  'item branches reference their tenant branch'
);

select extensions.is(
  (select pg_catalog.count(*) from pg_catalog.pg_class
   where relname = 'growth_intelligence_items_branch_idx'),
  1::bigint,
  'branch-scoped item reads are indexed'
);

select extensions.ok(
  pg_catalog.has_function_privilege('service_role', 'public.complete_growth_intelligence_synthesis(uuid,uuid,uuid,uuid,jsonb)', 'execute')
  and not pg_catalog.has_function_privilege('authenticated', 'public.complete_growth_intelligence_synthesis(uuid,uuid,uuid,uuid,jsonb)', 'execute'),
  'only the worker role completes synthesis runs'
);

select extensions.ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.complete_growth_intelligence_synthesis(uuid,uuid,uuid,uuid,jsonb)'::regprocedure
    ),
    'growth_intelligence_synthesis_branch_mismatch'
  ) > 0,
  'completion re-validates the exact branch in SQL'
);

-- Fixtures: one org, two branches --------------------------------------------

insert into auth.users (id) values
  ('c9000000-0000-4000-8000-000000000001'::uuid);

insert into public.accounts (id, name, slug, created_by) values
  ('c9000000-0000-4000-8000-000000000101'::uuid, 'Branch agency', 'branch-agency', 'c9000000-0000-4000-8000-000000000001'::uuid);

insert into public.organizations (
  id, account_id, name, slug, industry, country_code, base_currency,
  default_timezone, created_by
) values
  ('c9000000-0000-4000-8000-000000000201'::uuid, 'c9000000-0000-4000-8000-000000000101'::uuid, 'Branch client', 'branch-client', 'testing', 'AE', 'AED', 'Asia/Dubai', 'c9000000-0000-4000-8000-000000000001'::uuid);

insert into public.account_memberships (
  account_id, user_id, account_role, default_organization_role
) values
  ('c9000000-0000-4000-8000-000000000101'::uuid, 'c9000000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner');

insert into public.branches (id, organization_id, name, slug, timezone, currency) values
  ('c9000000-0000-4000-8000-000000000301'::uuid, 'c9000000-0000-4000-8000-000000000201'::uuid, 'Branch A', 'branch-a', 'Asia/Dubai', 'AED'),
  ('c9000000-0000-4000-8000-000000000302'::uuid, 'c9000000-0000-4000-8000-000000000201'::uuid, 'Branch B', 'branch-b', 'Asia/Dubai', 'AED');

insert into public.organization_market_profiles (id, organization_id, enabled) values
  ('c9000000-0000-4000-8000-000000000401'::uuid, 'c9000000-0000-4000-8000-000000000201'::uuid, false);

insert into public.organization_market_profile_versions (
  id, organization_id, market_profile_id, version, schema_version,
  profile_document, profile_digest, source_policy_digest, proposal_source,
  created_by, correlation_id
) values (
  'c9000000-0000-4000-8000-000000000402'::uuid, 'c9000000-0000-4000-8000-000000000201'::uuid,
  'c9000000-0000-4000-8000-000000000401'::uuid, 1, 1,
  pg_catalog.jsonb_build_object('schemaVersion', 1),
  repeat('d', 64), repeat('c', 64), 'operator',
  'c9000000-0000-4000-8000-000000000001'::uuid, 'c9000000-0000-4000-8000-000000000006'::uuid
), (
  'c9000000-0000-4000-8000-000000000403'::uuid, 'c9000000-0000-4000-8000-000000000201'::uuid,
  'c9000000-0000-4000-8000-000000000401'::uuid, 2, 1,
  pg_catalog.jsonb_build_object('schemaVersion', 1),
  repeat('e', 64), repeat('c', 64), 'operator',
  'c9000000-0000-4000-8000-000000000001'::uuid, 'c9000000-0000-4000-8000-000000000006'::uuid
);

update public.organization_market_profiles
set current_version_id = 'c9000000-0000-4000-8000-000000000402'::uuid,
    enabled = true
where id = 'c9000000-0000-4000-8000-000000000401'::uuid;

-- Research lineage: request (branch) -> research run -> source/claim --------

insert into public.growth_intelligence_requests (
  id, organization_id, branch_id, kind, trigger_reason, request_fingerprint,
  market_profile_version_id, source_policy_digest, research_rule_version,
  local_time_bucket, status, due_at, completed_at, attempt_count, correlation_id
) values
  ('c9000000-0000-4000-8000-000000000501'::uuid, 'c9000000-0000-4000-8000-000000000201'::uuid,
   'c9000000-0000-4000-8000-000000000301'::uuid,
   'market_research', 'daily_due', repeat('a', 64),
   'c9000000-0000-4000-8000-000000000402'::uuid, repeat('c', 64), 'market-research@1',
   'immediate', 'succeeded', pg_catalog.now(), pg_catalog.now(),
   1, 'c9000000-0000-4000-8000-000000000006'::uuid),
  ('c9000000-0000-4000-8000-000000000502'::uuid, 'c9000000-0000-4000-8000-000000000201'::uuid,
   'c9000000-0000-4000-8000-000000000302'::uuid,
   'market_research', 'daily_due', repeat('b', 64),
   'c9000000-0000-4000-8000-000000000402'::uuid, repeat('c', 64), 'market-research@1',
   'immediate', 'succeeded', pg_catalog.now(), pg_catalog.now(),
   1, 'c9000000-0000-4000-8000-000000000006'::uuid);

insert into public.market_research_runs (
  id, organization_id, growth_intelligence_request_id, market_profile_version_id,
  claim_token, adapter_provider, adapter_version, run_fingerprint,
  status, result_digest, correlation_id, completed_at
) values
  ('c9000000-0000-4000-8000-000000000511'::uuid, 'c9000000-0000-4000-8000-000000000201'::uuid,
   'c9000000-0000-4000-8000-000000000501'::uuid, 'c9000000-0000-4000-8000-000000000402'::uuid,
   'c9000000-0000-4000-8000-000000000006'::uuid, 'test-adapter', 'v1', repeat('f', 64),
   'completed', repeat('a', 64), 'c9000000-0000-4000-8000-000000000006'::uuid, pg_catalog.now()),
  ('c9000000-0000-4000-8000-000000000512'::uuid, 'c9000000-0000-4000-8000-000000000201'::uuid,
   'c9000000-0000-4000-8000-000000000502'::uuid, 'c9000000-0000-4000-8000-000000000402'::uuid,
   'c9000000-0000-4000-8000-000000000006'::uuid, 'test-adapter', 'v1', repeat('1', 64),
   'completed', repeat('b', 64), 'c9000000-0000-4000-8000-000000000006'::uuid, pg_catalog.now());

insert into public.market_evidence_sources (
  id, organization_id, market_research_run_id, market_profile_version_id,
  source_key, source_url, source_domain, source_class, availability,
  source_content_digest, safe_failure_code, retrieved_at
) values
  ('c9000000-0000-4000-8000-000000000521'::uuid, 'c9000000-0000-4000-8000-000000000201'::uuid,
   'c9000000-0000-4000-8000-000000000511'::uuid, 'c9000000-0000-4000-8000-000000000402'::uuid,
   'src-a', 'https://example.com/a', 'example.com', 'public_signal', 'available',
   repeat('a', 64), null, pg_catalog.now()),
  ('c9000000-0000-4000-8000-000000000522'::uuid, 'c9000000-0000-4000-8000-000000000201'::uuid,
   'c9000000-0000-4000-8000-000000000512'::uuid, 'c9000000-0000-4000-8000-000000000402'::uuid,
   'src-b', 'https://example.com/b', 'example.com', 'public_signal', 'available',
   repeat('b', 64), null, pg_catalog.now()),
  ('c9000000-0000-4000-8000-000000000523'::uuid, 'c9000000-0000-4000-8000-000000000201'::uuid,
   'c9000000-0000-4000-8000-000000000511'::uuid, 'c9000000-0000-4000-8000-000000000402'::uuid,
   'src-u', 'https://example.com/u', 'example.com', 'public_signal', 'available',
   repeat('8', 64), null, pg_catalog.now());

insert into public.market_evidence_claims (
  id, organization_id, market_research_run_id, market_profile_version_id,
  claim_key, claim_digest, subject_kind, subject_ref, claim_kind, paraphrase,
  geographic_layer, geography_ref, freshness_class, stale_at, expires_at
) values
  ('c9000000-0000-4000-8000-000000000531'::uuid, 'c9000000-0000-4000-8000-000000000201'::uuid,
   'c9000000-0000-4000-8000-000000000511'::uuid, 'c9000000-0000-4000-8000-000000000402'::uuid,
   'claim-a', repeat('a', 64), 'market', 'branch-a-demand', 'demand_signal', 'Branch A demand is recorded.',
   'city', 'ae:du', 'standard', pg_catalog.now() + interval '30 days', pg_catalog.now() + interval '60 days'),
  ('c9000000-0000-4000-8000-000000000532'::uuid, 'c9000000-0000-4000-8000-000000000201'::uuid,
   'c9000000-0000-4000-8000-000000000512'::uuid, 'c9000000-0000-4000-8000-000000000402'::uuid,
   'claim-b', repeat('b', 64), 'market', 'branch-b-demand', 'demand_signal', 'Branch B demand is recorded.',
   'city', 'ae:du', 'standard', pg_catalog.now() + interval '30 days', pg_catalog.now() + interval '60 days'),
  ('c9000000-0000-4000-8000-000000000533'::uuid, 'c9000000-0000-4000-8000-000000000201'::uuid,
   'c9000000-0000-4000-8000-000000000511'::uuid, 'c9000000-0000-4000-8000-000000000402'::uuid,
   'claim-u', repeat('c', 64), 'market', 'withdrawn-signal', 'demand_signal', 'A signal whose source went away.',
   'city', 'ae:du', 'standard', pg_catalog.now() + interval '30 days', pg_catalog.now() + interval '60 days'),
  ('c9000000-0000-4000-8000-000000000534'::uuid, 'c9000000-0000-4000-8000-000000000201'::uuid,
   'c9000000-0000-4000-8000-000000000511'::uuid, 'c9000000-0000-4000-8000-000000000402'::uuid,
   'claim-c', repeat('d', 64), 'market', 'contested-signal', 'demand_signal', 'A contested signal.',
   'city', 'ae:du', 'standard', pg_catalog.now() + interval '30 days', pg_catalog.now() + interval '60 days'),
  ('c9000000-0000-4000-8000-000000000535'::uuid, 'c9000000-0000-4000-8000-000000000201'::uuid,
   'c9000000-0000-4000-8000-000000000511'::uuid, 'c9000000-0000-4000-8000-000000000402'::uuid,
   'claim-s', repeat('e', 64), 'market', 'aging-signal', 'demand_signal', 'An aging but admissible signal.',
   'city', 'ae:du', 'standard', pg_catalog.now() - interval '1 day', pg_catalog.now() + interval '60 days'),
  ('c9000000-0000-4000-8000-000000000536'::uuid, 'c9000000-0000-4000-8000-000000000201'::uuid,
   'c9000000-0000-4000-8000-000000000511'::uuid, 'c9000000-0000-4000-8000-000000000403'::uuid,
   'claim-v2', repeat('f', 64), 'market', 'other-version-signal', 'demand_signal', 'A signal under another profile version.',
   'city', 'ae:du', 'standard', pg_catalog.now() + interval '30 days', pg_catalog.now() + interval '60 days'),
  ('c9000000-0000-4000-8000-000000000537'::uuid, 'c9000000-0000-4000-8000-000000000201'::uuid,
   'c9000000-0000-4000-8000-000000000511'::uuid, 'c9000000-0000-4000-8000-000000000402'::uuid,
   'claim-e', repeat('0', 64), 'market', 'lapsed-signal', 'demand_signal', 'A lapsed signal.',
   'city', 'ae:du', 'standard', pg_catalog.now() + interval '30 days', pg_catalog.now() + interval '60 days');

insert into public.market_evidence_links (
  organization_id, market_evidence_claim_id, market_evidence_source_id, relation
) values
  ('c9000000-0000-4000-8000-000000000201'::uuid, 'c9000000-0000-4000-8000-000000000531'::uuid, 'c9000000-0000-4000-8000-000000000521'::uuid, 'supports'),
  ('c9000000-0000-4000-8000-000000000201'::uuid, 'c9000000-0000-4000-8000-000000000532'::uuid, 'c9000000-0000-4000-8000-000000000522'::uuid, 'supports'),
  ('c9000000-0000-4000-8000-000000000201'::uuid, 'c9000000-0000-4000-8000-000000000533'::uuid, 'c9000000-0000-4000-8000-000000000523'::uuid, 'supports'),
  ('c9000000-0000-4000-8000-000000000201'::uuid, 'c9000000-0000-4000-8000-000000000534'::uuid, 'c9000000-0000-4000-8000-000000000521'::uuid, 'supports'),
  ('c9000000-0000-4000-8000-000000000201'::uuid, 'c9000000-0000-4000-8000-000000000535'::uuid, 'c9000000-0000-4000-8000-000000000521'::uuid, 'supports'),
  ('c9000000-0000-4000-8000-000000000201'::uuid, 'c9000000-0000-4000-8000-000000000536'::uuid, 'c9000000-0000-4000-8000-000000000521'::uuid, 'supports'),
  ('c9000000-0000-4000-8000-000000000201'::uuid, 'c9000000-0000-4000-8000-000000000537'::uuid, 'c9000000-0000-4000-8000-000000000521'::uuid, 'supports');

insert into public.market_evidence_links (
  organization_id, market_evidence_claim_id, related_market_evidence_claim_id, relation
) values
  ('c9000000-0000-4000-8000-000000000201'::uuid, 'c9000000-0000-4000-8000-000000000534'::uuid, 'c9000000-0000-4000-8000-000000000531'::uuid, 'contradicts');

-- The lapsed signal expires through an appended event, not a backdated row.
insert into public.market_evidence_claim_events (
  organization_id, market_evidence_claim_id, event_type, event_digest, occurred_at
) values (
  'c9000000-0000-4000-8000-000000000201'::uuid, 'c9000000-0000-4000-8000-000000000537'::uuid,
  'expired', repeat('9', 64), pg_catalog.now()
);

-- The withdrawn signal loses its only supports edge through the audited
-- erasure path: the source flips unavailable after the link was made.
set local role service_role;

select public.erase_research_source_payload(
  'c9000000-0000-4000-8000-000000000201'::uuid,
  'c9000000-0000-4000-8000-000000000523'::uuid,
  'SOURCE_WITHDRAWN',
  false
);

reset role;

-- Business evidence: branch A sales 100, branch B sales 900 ------------------

insert into public.channel_analysis_runs (
  id, organization_id, branch_id, window_start, window_end, period_grain,
  window_timezone, registry_version, detector_versions, metric_versions,
  input_digest, status, correlation_id, completed_at
) values
  ('c9000000-0000-4000-8000-000000000541'::uuid, 'c9000000-0000-4000-8000-000000000201'::uuid,
   'c9000000-0000-4000-8000-000000000301'::uuid,
   '2026-08-01', '2026-08-31', 'month', 'Asia/Dubai', 1,
   '[{"key": "x.y", "calculationVersion": 1}]'::jsonb, '[]'::jsonb,
   repeat('a', 64), 'completed', 'c9000000-0000-4000-8000-000000000006'::uuid, pg_catalog.now()),
  ('c9000000-0000-4000-8000-000000000542'::uuid, 'c9000000-0000-4000-8000-000000000201'::uuid,
   'c9000000-0000-4000-8000-000000000302'::uuid,
   '2026-08-01', '2026-08-31', 'month', 'Asia/Dubai', 1,
   '[{"key": "x.y", "calculationVersion": 1}]'::jsonb, '[]'::jsonb,
   repeat('b', 64), 'completed', 'c9000000-0000-4000-8000-000000000006'::uuid, pg_catalog.now()),
  ('c9000000-0000-4000-8000-000000000543'::uuid, 'c9000000-0000-4000-8000-000000000201'::uuid,
   null,
   '2026-08-01', '2026-08-31', 'month', 'Asia/Dubai', 1,
   '[{"key": "x.y", "calculationVersion": 1}]'::jsonb, '[]'::jsonb,
   repeat('c', 64), 'completed', 'c9000000-0000-4000-8000-000000000006'::uuid, pg_catalog.now()),
  ('c9000000-0000-4000-8000-000000000544'::uuid, 'c9000000-0000-4000-8000-000000000201'::uuid,
   'c9000000-0000-4000-8000-000000000301'::uuid,
   '2026-08-01', '2026-08-31', 'month', 'Asia/Dubai', 1,
   '[{"key": "x.y", "calculationVersion": 1}]'::jsonb, '[]'::jsonb,
   repeat('d', 64), 'completed', 'c9000000-0000-4000-8000-000000000006'::uuid, pg_catalog.now());

insert into public.channel_findings (
  id, organization_id, analysis_run_id, branch_id, detector_key, detector_version,
  kind, code, severity, priority, period_start, period_end, value_kind, value_numerator,
  currency, quality_state, calculation_digest, status, superseded_by_run_id, superseded_at
) values
  ('c9000000-0000-4000-8000-000000000551'::uuid, 'c9000000-0000-4000-8000-000000000201'::uuid,
   'c9000000-0000-4000-8000-000000000541'::uuid, 'c9000000-0000-4000-8000-000000000301'::uuid,
   'sales.branch_total', 1, 'finding', 'SALES_LEVEL', 'high', 10,
   '2026-08-01', '2026-08-31', 'money', 100, 'AED', 'complete', repeat('a', 64), 'open', null, null),
  ('c9000000-0000-4000-8000-000000000552'::uuid, 'c9000000-0000-4000-8000-000000000201'::uuid,
   'c9000000-0000-4000-8000-000000000542'::uuid, 'c9000000-0000-4000-8000-000000000302'::uuid,
   'sales.branch_total', 1, 'finding', 'SALES_LEVEL', 'high', 10,
   '2026-08-01', '2026-08-31', 'money', 900, 'AED', 'complete', repeat('b', 64), 'open', null, null),
  ('c9000000-0000-4000-8000-000000000553'::uuid, 'c9000000-0000-4000-8000-000000000201'::uuid,
   'c9000000-0000-4000-8000-000000000543'::uuid, null,
   'sales.branch_total', 1, 'finding', 'SALES_LEVEL', 'high', 10,
   '2026-08-01', '2026-08-31', 'money', 1000, 'AED', 'complete', repeat('c', 64), 'open', null, null),
  ('c9000000-0000-4000-8000-000000000554'::uuid, 'c9000000-0000-4000-8000-000000000201'::uuid,
   'c9000000-0000-4000-8000-000000000541'::uuid, 'c9000000-0000-4000-8000-000000000301'::uuid,
   'sales.branch_total', 1, 'finding', 'SALES_LEVEL', 'high', 10,
   '2026-08-01', '2026-08-31', 'money', 100, 'AED', 'complete', repeat('d', 64), 'superseded',
   'c9000000-0000-4000-8000-000000000544'::uuid, pg_catalog.now());

-- Synthesis requests under test ------------------------------------------------
-- Fixtures insert as the owner: the worker role is SELECT-only by design.
-- (No reset needed yet: everything above ran as the suite owner.)

insert into public.growth_intelligence_requests (
  id, organization_id, branch_id, kind, trigger_reason, request_fingerprint,
  market_profile_version_id, source_policy_digest, research_rule_version,
  local_time_bucket, status, due_at, claim_token, lease_expires_at,
  attempt_count, correlation_id
) values
  ('c9000000-0000-4000-8000-000000000601'::uuid, 'c9000000-0000-4000-8000-000000000201'::uuid,
   'c9000000-0000-4000-8000-000000000301'::uuid,
   'business_evidence_changed', 'business_evidence_current', repeat('1', 64),
   'c9000000-0000-4000-8000-000000000402'::uuid, repeat('c', 64), 'market-research@1',
   'immediate', 'claimed', pg_catalog.now(),
   'c9000000-0000-4000-8000-000000000611'::uuid, pg_catalog.now() + interval '10 minutes',
   1, 'c9000000-0000-4000-8000-000000000006'::uuid),
  ('c9000000-0000-4000-8000-000000000602'::uuid, 'c9000000-0000-4000-8000-000000000201'::uuid,
   'c9000000-0000-4000-8000-000000000301'::uuid,
   'business_evidence_changed', 'business_evidence_current', repeat('2', 64),
   'c9000000-0000-4000-8000-000000000402'::uuid, repeat('c', 64), 'market-research@1',
   'immediate', 'claimed', pg_catalog.now(),
   'c9000000-0000-4000-8000-000000000612'::uuid, pg_catalog.now() + interval '10 minutes',
   1, 'c9000000-0000-4000-8000-000000000006'::uuid),
  ('c9000000-0000-4000-8000-000000000603'::uuid, 'c9000000-0000-4000-8000-000000000201'::uuid,
   'c9000000-0000-4000-8000-000000000301'::uuid,
   'business_evidence_changed', 'business_evidence_current', repeat('3', 64),
   'c9000000-0000-4000-8000-000000000402'::uuid, repeat('c', 64), 'market-research@1',
   'immediate', 'claimed', pg_catalog.now(),
   'c9000000-0000-4000-8000-000000000613'::uuid, pg_catalog.now() + interval '10 minutes',
   1, 'c9000000-0000-4000-8000-000000000006'::uuid),
  ('c9000000-0000-4000-8000-000000000604'::uuid, 'c9000000-0000-4000-8000-000000000201'::uuid,
   null,
   'business_evidence_changed', 'business_evidence_current', repeat('4', 64),
   'c9000000-0000-4000-8000-000000000402'::uuid, repeat('c', 64), 'market-research@1',
   'immediate', 'claimed', pg_catalog.now(),
   'c9000000-0000-4000-8000-000000000614'::uuid, pg_catalog.now() + interval '10 minutes',
   1, 'c9000000-0000-4000-8000-000000000006'::uuid),
  ('c9000000-0000-4000-8000-000000000605'::uuid, 'c9000000-0000-4000-8000-000000000201'::uuid,
   'c9000000-0000-4000-8000-000000000301'::uuid,
   'business_evidence_changed', 'business_evidence_current', repeat('5', 64),
   'c9000000-0000-4000-8000-000000000402'::uuid, repeat('c', 64), 'market-research@1',
   'immediate', 'claimed', pg_catalog.now(),
   'c9000000-0000-4000-8000-000000000615'::uuid, pg_catalog.now() + interval '10 minutes',
   1, 'c9000000-0000-4000-8000-000000000006'::uuid);

set local role service_role;

-- Happy path: branch A advice cites the A claim and the A (100) finding -----

select extensions.is(
  public.begin_growth_intelligence_synthesis(
    'c9000000-0000-4000-8000-000000000201'::uuid,
    'c9000000-0000-4000-8000-000000000601'::uuid,
    'c9000000-0000-4000-8000-000000000611'::uuid,
    pg_catalog.jsonb_build_object(
      'provider', 'synthesis-test',
      'runFingerprint', repeat('a', 64),
      'correlationId', 'c9000000-0000-4000-8000-000000000006'
    )
  ) ->> 'replayed',
  'false',
  'a branch A request opens its own run'
);

create temporary table branch_completion as
select public.complete_growth_intelligence_synthesis(
  'c9000000-0000-4000-8000-000000000201'::uuid,
  'c9000000-0000-4000-8000-000000000601'::uuid,
  'c9000000-0000-4000-8000-000000000611'::uuid,
  (select run.id from public.growth_intelligence_synthesis_runs run
   where run.organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid
   and run.growth_intelligence_request_id = 'c9000000-0000-4000-8000-000000000601'::uuid),
  pg_catalog.jsonb_build_object(
    'outcome', 'completed',
    'resultDigest', repeat('b', 64),
    'items', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'kind', 'insight',
        'narrative', 'Branch A recorded demand stands on its own August evidence.',
        'itemFingerprint', repeat('1', 64),
        'evidenceFingerprint', repeat('2', 64),
        'branchId', 'c9000000-0000-4000-8000-000000000301',
        'geographicLayer', 'city',
        'geographyRef', 'ae:du',
        'supportGrade', 'single_source',
        'freshness', 'current',
        'urgency', 'high',
        'goalAlignment', 'none',
        'activityMonth', '2026-08',
        'missingInput', null,
        'claimIds', pg_catalog.jsonb_build_array('c9000000-0000-4000-8000-000000000531'),
        'findings', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'id', 'c9000000-0000-4000-8000-000000000551', 'digest', repeat('a', 64)
          )
        ),
        'goals', pg_catalog.jsonb_build_array()
      )
    )
  )
) as result;

select extensions.is(
  (select result ->> 'itemCount' from branch_completion),
  '1',
  'branch A advice persists against exact branch support'
);

reset role;

select extensions.is(
  (select item.branch_id::text from public.growth_intelligence_items item
   where item.item_fingerprint = repeat('1', 64)),
  'c9000000-0000-4000-8000-000000000301',
  'the saved item carries its synthesis branch'
);

set local role service_role;

-- Wrong-branch fence: privileged access is not admissible support -----------

select extensions.is(
  public.begin_growth_intelligence_synthesis(
    'c9000000-0000-4000-8000-000000000201'::uuid,
    'c9000000-0000-4000-8000-000000000602'::uuid,
    'c9000000-0000-4000-8000-000000000612'::uuid,
    pg_catalog.jsonb_build_object(
      'provider', 'synthesis-test',
      'runFingerprint', repeat('b', 64),
      'correlationId', 'c9000000-0000-4000-8000-000000000006'
    )
  ) ->> 'replayed',
  'false',
  'a second branch A request opens its own run'
);

select extensions.throws_ok(
  $$
  select public.complete_growth_intelligence_synthesis(
    'c9000000-0000-4000-8000-000000000201'::uuid,
    'c9000000-0000-4000-8000-000000000602'::uuid,
    'c9000000-0000-4000-8000-000000000612'::uuid,
    (select run.id from public.growth_intelligence_synthesis_runs run
     where run.organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid
     and run.growth_intelligence_request_id = 'c9000000-0000-4000-8000-000000000602'::uuid),
    pg_catalog.jsonb_build_object(
      'outcome', 'completed',
      'resultDigest', repeat('b', 64),
      'items', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'kind', 'insight',
          'narrative', 'Borrowed branch evidence.',
          'itemFingerprint', repeat('7', 64),
          'evidenceFingerprint', repeat('8', 64),
          'branchId', 'c9000000-0000-4000-8000-000000000302',
          'geographicLayer', 'city',
          'geographyRef', 'ae:du',
          'supportGrade', 'single_source',
          'freshness', 'current',
          'urgency', 'high',
          'goalAlignment', 'none',
          'activityMonth', '2026-08',
          'missingInput', null,
          'claimIds', pg_catalog.jsonb_build_array('c9000000-0000-4000-8000-000000000531'),
          'findings', pg_catalog.jsonb_build_array(),
          'goals', pg_catalog.jsonb_build_array()
        )
      )
    )
  )
  $$,
  '42501', 'growth_intelligence_synthesis_branch_mismatch',
  'a service-role call cannot persist branch B support on a branch A request'
);

-- The negative request opens one run; every refusal below reuses it ---------

select extensions.is(
  public.begin_growth_intelligence_synthesis(
    'c9000000-0000-4000-8000-000000000201'::uuid,
    'c9000000-0000-4000-8000-000000000603'::uuid,
    'c9000000-0000-4000-8000-000000000613'::uuid,
    pg_catalog.jsonb_build_object(
      'provider', 'synthesis-test',
      'runFingerprint', repeat('d', 64),
      'correlationId', 'c9000000-0000-4000-8000-000000000006'
    )
  ) ->> 'replayed',
  'false',
  'the refusal probe opens its own branch A run'
);

-- Branch B claim support on a branch A item is inadmissible ------------------

select extensions.throws_ok(
  $$
  select public.complete_growth_intelligence_synthesis(
    'c9000000-0000-4000-8000-000000000201'::uuid,
    'c9000000-0000-4000-8000-000000000603'::uuid,
    'c9000000-0000-4000-8000-000000000613'::uuid,
    (select run.id from public.growth_intelligence_synthesis_runs run
     where run.organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid
     and run.growth_intelligence_request_id = 'c9000000-0000-4000-8000-000000000603'::uuid),
    pg_catalog.jsonb_build_object(
      'outcome', 'completed',
      'resultDigest', repeat('b', 64),
      'items', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'kind', 'insight',
          'narrative', 'Borrowed claim support.',
          'itemFingerprint', repeat('7', 64),
          'evidenceFingerprint', repeat('8', 64),
          'branchId', 'c9000000-0000-4000-8000-000000000301',
          'geographicLayer', 'city',
          'geographyRef', 'ae:du',
          'supportGrade', 'single_source',
          'freshness', 'current',
          'urgency', 'high',
          'goalAlignment', 'none',
          'activityMonth', '2026-08',
          'missingInput', null,
          'claimIds', pg_catalog.jsonb_build_array('c9000000-0000-4000-8000-000000000532'),
          'findings', pg_catalog.jsonb_build_array(),
          'goals', pg_catalog.jsonb_build_array()
        )
      )
    )
  )
  $$,
  '42501', 'growth_intelligence_synthesis_support_inadmissible',
  'a branch B claim cannot support branch A advice'
);

-- Branch B (900) finding support on a branch A item is inadmissible ---------

select extensions.throws_ok(
  $$
  select public.complete_growth_intelligence_synthesis(
    'c9000000-0000-4000-8000-000000000201'::uuid,
    'c9000000-0000-4000-8000-000000000603'::uuid,
    'c9000000-0000-4000-8000-000000000613'::uuid,
    (select run.id from public.growth_intelligence_synthesis_runs run
     where run.organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid
     and run.growth_intelligence_request_id = 'c9000000-0000-4000-8000-000000000603'::uuid),
    pg_catalog.jsonb_build_object(
      'outcome', 'completed',
      'resultDigest', repeat('b', 64),
      'items', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'kind', 'insight',
          'narrative', 'Borrowed finding support.',
          'itemFingerprint', repeat('7', 64),
          'evidenceFingerprint', repeat('8', 64),
          'branchId', 'c9000000-0000-4000-8000-000000000301',
          'geographicLayer', 'city',
          'geographyRef', 'ae:du',
          'supportGrade', 'single_source',
          'freshness', 'current',
          'urgency', 'high',
          'goalAlignment', 'none',
          'activityMonth', '2026-08',
          'missingInput', null,
          'claimIds', pg_catalog.jsonb_build_array(),
          'findings', pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object(
              'id', 'c9000000-0000-4000-8000-000000000552', 'digest', repeat('b', 64)
            )
          ),
          'goals', pg_catalog.jsonb_build_array()
        )
      )
    )
  )
  $$,
  '42501', 'growth_intelligence_synthesis_finding_inadmissible',
  'the branch B (900) finding cannot support branch A advice'
);

-- Expired, superseded, unsupported, contradicted, and foreign support --------

select extensions.throws_ok(
  $$
  select public.complete_growth_intelligence_synthesis(
    'c9000000-0000-4000-8000-000000000201'::uuid,
    'c9000000-0000-4000-8000-000000000603'::uuid,
    'c9000000-0000-4000-8000-000000000613'::uuid,
    (select run.id from public.growth_intelligence_synthesis_runs run
     where run.organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid
     and run.growth_intelligence_request_id = 'c9000000-0000-4000-8000-000000000603'::uuid),
    pg_catalog.jsonb_build_object(
      'outcome', 'completed',
      'resultDigest', repeat('b', 64),
      'items', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'kind', 'insight',
          'narrative', 'Lapsed support.',
          'itemFingerprint', repeat('7', 64),
          'evidenceFingerprint', repeat('8', 64),
          'branchId', 'c9000000-0000-4000-8000-000000000301',
          'geographicLayer', 'city',
          'geographyRef', 'ae:du',
          'supportGrade', 'single_source',
          'freshness', 'current',
          'urgency', 'high',
          'goalAlignment', 'none',
          'activityMonth', '2026-08',
          'missingInput', null,
          'claimIds', pg_catalog.jsonb_build_array('c9000000-0000-4000-8000-000000000537'),
          'findings', pg_catalog.jsonb_build_array(),
          'goals', pg_catalog.jsonb_build_array()
        )
      )
    )
  )
  $$,
  '42501', 'growth_intelligence_synthesis_support_inadmissible',
  'an expired claim cannot support advice'
);

select extensions.throws_ok(
  $$
  select public.complete_growth_intelligence_synthesis(
    'c9000000-0000-4000-8000-000000000201'::uuid,
    'c9000000-0000-4000-8000-000000000603'::uuid,
    'c9000000-0000-4000-8000-000000000613'::uuid,
    (select run.id from public.growth_intelligence_synthesis_runs run
     where run.organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid
     and run.growth_intelligence_request_id = 'c9000000-0000-4000-8000-000000000603'::uuid),
    pg_catalog.jsonb_build_object(
      'outcome', 'completed',
      'resultDigest', repeat('b', 64),
      'items', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'kind', 'insight',
          'narrative', 'Superseded support.',
          'itemFingerprint', repeat('7', 64),
          'evidenceFingerprint', repeat('8', 64),
          'branchId', 'c9000000-0000-4000-8000-000000000301',
          'geographicLayer', 'city',
          'geographyRef', 'ae:du',
          'supportGrade', 'single_source',
          'freshness', 'current',
          'urgency', 'high',
          'goalAlignment', 'none',
          'activityMonth', '2026-08',
          'missingInput', null,
          'claimIds', pg_catalog.jsonb_build_array(),
          'findings', pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object(
              'id', 'c9000000-0000-4000-8000-000000000554', 'digest', repeat('d', 64)
            )
          ),
          'goals', pg_catalog.jsonb_build_array()
        )
      )
    )
  )
  $$,
  '42501', 'growth_intelligence_synthesis_finding_inadmissible',
  'a superseded finding cannot support advice'
);

select extensions.throws_ok(
  $$
  select public.complete_growth_intelligence_synthesis(
    'c9000000-0000-4000-8000-000000000201'::uuid,
    'c9000000-0000-4000-8000-000000000603'::uuid,
    'c9000000-0000-4000-8000-000000000613'::uuid,
    (select run.id from public.growth_intelligence_synthesis_runs run
     where run.organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid
     and run.growth_intelligence_request_id = 'c9000000-0000-4000-8000-000000000603'::uuid),
    pg_catalog.jsonb_build_object(
      'outcome', 'completed',
      'resultDigest', repeat('b', 64),
      'items', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'kind', 'insight',
          'narrative', 'Unsupported support.',
          'itemFingerprint', repeat('7', 64),
          'evidenceFingerprint', repeat('8', 64),
          'branchId', 'c9000000-0000-4000-8000-000000000301',
          'geographicLayer', 'city',
          'geographyRef', 'ae:du',
          'supportGrade', 'single_source',
          'freshness', 'current',
          'urgency', 'high',
          'goalAlignment', 'none',
          'activityMonth', '2026-08',
          'missingInput', null,
          'claimIds', pg_catalog.jsonb_build_array('c9000000-0000-4000-8000-000000000533'),
          'findings', pg_catalog.jsonb_build_array(),
          'goals', pg_catalog.jsonb_build_array()
        )
      )
    )
  )
  $$,
  '42501', 'growth_intelligence_synthesis_support_inadmissible',
  'a claim without available-source support cannot support advice'
);

select extensions.throws_ok(
  $$
  select public.complete_growth_intelligence_synthesis(
    'c9000000-0000-4000-8000-000000000201'::uuid,
    'c9000000-0000-4000-8000-000000000603'::uuid,
    'c9000000-0000-4000-8000-000000000613'::uuid,
    (select run.id from public.growth_intelligence_synthesis_runs run
     where run.organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid
     and run.growth_intelligence_request_id = 'c9000000-0000-4000-8000-000000000603'::uuid),
    pg_catalog.jsonb_build_object(
      'outcome', 'completed',
      'resultDigest', repeat('b', 64),
      'items', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'kind', 'insight',
          'narrative', 'Contested support.',
          'itemFingerprint', repeat('7', 64),
          'evidenceFingerprint', repeat('8', 64),
          'branchId', 'c9000000-0000-4000-8000-000000000301',
          'geographicLayer', 'city',
          'geographyRef', 'ae:du',
          'supportGrade', 'single_source',
          'freshness', 'current',
          'urgency', 'high',
          'goalAlignment', 'none',
          'activityMonth', '2026-08',
          'missingInput', null,
          'claimIds', pg_catalog.jsonb_build_array('c9000000-0000-4000-8000-000000000534'),
          'findings', pg_catalog.jsonb_build_array(),
          'goals', pg_catalog.jsonb_build_array()
        )
      )
    )
  )
  $$,
  '42501', 'growth_intelligence_synthesis_support_inadmissible',
  'a contradicted claim cannot support advice'
);

select extensions.throws_ok(
  $$
  select public.complete_growth_intelligence_synthesis(
    'c9000000-0000-4000-8000-000000000201'::uuid,
    'c9000000-0000-4000-8000-000000000603'::uuid,
    'c9000000-0000-4000-8000-000000000613'::uuid,
    (select run.id from public.growth_intelligence_synthesis_runs run
     where run.organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid
     and run.growth_intelligence_request_id = 'c9000000-0000-4000-8000-000000000603'::uuid),
    pg_catalog.jsonb_build_object(
      'outcome', 'completed',
      'resultDigest', repeat('b', 64),
      'items', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'kind', 'insight',
          'narrative', 'Foreign version support.',
          'itemFingerprint', repeat('7', 64),
          'evidenceFingerprint', repeat('8', 64),
          'branchId', 'c9000000-0000-4000-8000-000000000301',
          'geographicLayer', 'city',
          'geographyRef', 'ae:du',
          'supportGrade', 'single_source',
          'freshness', 'current',
          'urgency', 'high',
          'goalAlignment', 'none',
          'activityMonth', '2026-08',
          'missingInput', null,
          'claimIds', pg_catalog.jsonb_build_array('c9000000-0000-4000-8000-000000000536'),
          'findings', pg_catalog.jsonb_build_array(),
          'goals', pg_catalog.jsonb_build_array()
        )
      )
    )
  )
  $$,
  '42501', 'growth_intelligence_synthesis_support_inadmissible',
  'a claim under another profile version cannot support advice'
);

-- Stale evidence stays admissible: synthesis labels it, never hides it -----

create temporary table stale_completion as
select public.complete_growth_intelligence_synthesis(
  'c9000000-0000-4000-8000-000000000201'::uuid,
  'c9000000-0000-4000-8000-000000000602'::uuid,
  'c9000000-0000-4000-8000-000000000612'::uuid,
  (select run.id from public.growth_intelligence_synthesis_runs run
   where run.organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid
   and run.growth_intelligence_request_id = 'c9000000-0000-4000-8000-000000000602'::uuid),
  pg_catalog.jsonb_build_object(
    'outcome', 'completed',
    'resultDigest', repeat('b', 64),
    'items', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'kind', 'insight',
        'narrative', 'Branch A recorded demand with an aging signal labelled stale.',
        'itemFingerprint', repeat('3', 64),
        'evidenceFingerprint', repeat('4', 64),
        'branchId', 'c9000000-0000-4000-8000-000000000301',
        'geographicLayer', 'city',
        'geographyRef', 'ae:du',
        'supportGrade', 'single_source',
        'freshness', 'stale',
        'urgency', 'high',
        'goalAlignment', 'none',
        'activityMonth', '2026-08',
        'missingInput', null,
        'claimIds', pg_catalog.jsonb_build_array('c9000000-0000-4000-8000-000000000535'),
        'findings', pg_catalog.jsonb_build_array(),
        'goals', pg_catalog.jsonb_build_array()
      )
    )
  )
) as result;

select extensions.is(
  (select result ->> 'itemCount' from stale_completion),
  '1',
  'an explicitly stale claim stays admissible support'
);

-- Legacy payloads without a branch key keep working on null-branch scope ----

select extensions.is(
  public.begin_growth_intelligence_synthesis(
    'c9000000-0000-4000-8000-000000000201'::uuid,
    'c9000000-0000-4000-8000-000000000604'::uuid,
    'c9000000-0000-4000-8000-000000000614'::uuid,
    pg_catalog.jsonb_build_object(
      'provider', 'synthesis-test',
      'runFingerprint', repeat('e', 64),
      'correlationId', 'c9000000-0000-4000-8000-000000000006'
    )
  ) ->> 'replayed',
  'false',
  'a legacy organization request opens its own run'
);

select extensions.is(
  public.complete_growth_intelligence_synthesis(
    'c9000000-0000-4000-8000-000000000201'::uuid,
    'c9000000-0000-4000-8000-000000000604'::uuid,
    'c9000000-0000-4000-8000-000000000614'::uuid,
    (select run.id from public.growth_intelligence_synthesis_runs run
     where run.organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid
     and run.growth_intelligence_request_id = 'c9000000-0000-4000-8000-000000000604'::uuid),
    pg_catalog.jsonb_build_object(
      'outcome', 'completed',
      'resultDigest', repeat('b', 64),
      'items', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'kind', 'insight',
          'narrative', 'Organization demand stands on its own August evidence.',
          'itemFingerprint', repeat('5', 64),
          'evidenceFingerprint', repeat('6', 64),
          'geographicLayer', 'city',
          'geographyRef', 'ae:du',
          'supportGrade', 'single_source',
          'freshness', 'current',
          'urgency', 'high',
          'goalAlignment', 'none',
          'activityMonth', '2026-08',
          'missingInput', null,
          'claimIds', pg_catalog.jsonb_build_array(),
          'findings', pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object(
              'id', 'c9000000-0000-4000-8000-000000000553', 'digest', repeat('c', 64)
            )
          ),
          'goals', pg_catalog.jsonb_build_array()
        )
      )
    )
  ) ->> 'itemCount',
  '1',
  'a branchless legacy payload still completes on organization scope'
);

-- A missing branch key on a branch request derives the request branch ------

set local role service_role;

select extensions.is(
  public.begin_growth_intelligence_synthesis(
    'c9000000-0000-4000-8000-000000000201'::uuid,
    'c9000000-0000-4000-8000-000000000605'::uuid,
    'c9000000-0000-4000-8000-000000000615'::uuid,
    pg_catalog.jsonb_build_object(
      'provider', 'synthesis-test',
      'runFingerprint', repeat('7', 64),
      'correlationId', 'c9000000-0000-4000-8000-000000000006'
    )
  ) ->> 'replayed',
  'false',
  'a key-less branch request opens its own run'
);

select extensions.is(
  public.complete_growth_intelligence_synthesis(
    'c9000000-0000-4000-8000-000000000201'::uuid,
    'c9000000-0000-4000-8000-000000000605'::uuid,
    'c9000000-0000-4000-8000-000000000615'::uuid,
    (select run.id from public.growth_intelligence_synthesis_runs run
     where run.organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid
     and run.growth_intelligence_request_id = 'c9000000-0000-4000-8000-000000000605'::uuid),
    pg_catalog.jsonb_build_object(
      'outcome', 'completed',
      'resultDigest', repeat('b', 64),
      'items', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'kind', 'data_gap',
          'narrative', 'Branch evidence is missing for this request.',
          'itemFingerprint', repeat('9', 64),
          'evidenceFingerprint', repeat('0', 64),
          'geographicLayer', 'city',
          'geographyRef', 'ae:du',
          'supportGrade', 'contextual',
          'freshness', 'stale',
          'urgency', 'low',
          'goalAlignment', 'none',
          'activityMonth', '2026-09',
          'missingInput', 'BRANCH_BUSINESS_EVIDENCE',
          'claimIds', pg_catalog.jsonb_build_array(),
          'findings', pg_catalog.jsonb_build_array(),
          'goals', pg_catalog.jsonb_build_array()
        )
      )
    )
  ) ->> 'itemCount',
  '1',
  'a key-less payload on a branch request still completes'
);

reset role;

select extensions.is(
  (select item.branch_id::text from public.growth_intelligence_items item
   where item.item_fingerprint = repeat('9', 64)),
  'c9000000-0000-4000-8000-000000000301',
  'the derived item carries the request branch'
);

reset role;

select extensions.finish();
rollback;
