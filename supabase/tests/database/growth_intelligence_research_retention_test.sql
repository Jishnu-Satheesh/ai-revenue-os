begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(31);

-- Contract: qualified retention, provenance, and audited erasure ---------------

select extensions.has_function(
  'public', 'erase_research_source_payload',
  array['uuid', 'uuid', 'text', 'boolean'],
  'a privileged path removes payloads and withdraws eligibility with audit'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.erase_research_source_payload(uuid,uuid,text,boolean)',
    'execute'
  ),
  'support tooling erases through the governed RPC'
);
select extensions.ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'public.erase_research_source_payload(uuid,uuid,text,boolean)',
    'execute'
  ),
  'browser sessions cannot erase evidence payloads directly'
);
select extensions.ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.erase_research_source_payload(uuid,uuid,text,boolean)',
    'execute'
  ),
  'anonymous callers cannot erase evidence payloads'
);
select extensions.has_column(
  'public', 'market_evidence_sources', 'excerpt_text',
  'retained excerpts carry their bounded text'
);
select extensions.has_column(
  'public', 'market_evidence_sources', 'excerpt_digest',
  'retained excerpts carry their digest'
);
select extensions.has_column(
  'public', 'market_evidence_sources', 'qualification_version',
  'every excerpt records the qualification it was retained under'
);
select extensions.has_column(
  'public', 'market_evidence_sources', 'retain_until',
  'every excerpt records its retain-until policy'
);
select extensions.has_column(
  'public', 'market_evidence_sources', 'erased_at',
  'erasure keeps a safe timestamp, not the removed content'
);
select extensions.has_column(
  'public', 'market_evidence_sources', 'erasure_reason_code',
  'erasure keeps a safe reason code, not the removed content'
);
select extensions.has_column(
  'public', 'market_evidence_claims', 'text_withdrawn',
  'derived text withdrawal is explicit per claim'
);
select extensions.has_column(
  'public', 'market_evidence_links', 'support_verdict',
  'support review provenance records its verdict'
);
select extensions.has_column(
  'public', 'market_evidence_links', 'reviewed_at',
  'support review provenance records its time'
);
select extensions.has_column(
  'public', 'market_evidence_links', 'reviewer_ref',
  'support review provenance records its reviewer'
);
select extensions.ok(
  (
    select pg_catalog.pg_get_constraintdef(constraint_item.oid) like '%erased%'
    from pg_catalog.pg_constraint constraint_item
    where constraint_item.conrelid = 'public.market_evidence_claim_events'::regclass
      and constraint_item.conname = 'market_evidence_claim_events_event_type_check'
  ),
  'erasure writes an explicit erased audit event'
);

-- Fixtures ----------------------------------------------------------------------

insert into auth.users (id) values
  ('e6000000-0000-4000-8000-000000000001'::uuid),
  ('e6000000-0000-4000-8000-000000000002'::uuid);

insert into public.accounts (id, name, slug, created_by) values
  ('e6000000-0000-4000-8000-000000000101'::uuid, 'Retention agency', 'retention-agency', 'e6000000-0000-4000-8000-000000000001'::uuid);

insert into public.organizations (
  id, account_id, name, slug, industry, country_code, base_currency,
  default_timezone, created_by
) values
  ('e6000000-0000-4000-8000-000000000201'::uuid, 'e6000000-0000-4000-8000-000000000101'::uuid, 'Retention client', 'retention-client', 'testing', 'AE', 'AED', 'Asia/Dubai', 'e6000000-0000-4000-8000-000000000001'::uuid);

insert into public.account_memberships (
  account_id, user_id, account_role, default_organization_role
) values
  ('e6000000-0000-4000-8000-000000000101'::uuid, 'e6000000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner'),
  ('e6000000-0000-4000-8000-000000000101'::uuid, 'e6000000-0000-4000-8000-000000000002'::uuid, 'member', 'operator');

insert into public.branches (
  id, organization_id, name, slug, kind, timezone, currency, is_active
) values
  ('e6000000-0000-4000-8000-000000000301'::uuid, 'e6000000-0000-4000-8000-000000000201'::uuid, 'Retention branch', 'retention-branch', 'physical', 'Asia/Dubai', 'AED', true);

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

-- Browser sessions hold no grant on the private digest helper, so the suite
-- reaches it through this definer-rights wrapper, never directly.
create or replace function pg_temp.retention_digest(p_document jsonb)
returns text
language sql
security definer
set search_path = ''
as $$
  select private.create_market_profile_digest(p_document);
$$;

set local role authenticated;
set local request.jwt.claim.sub = 'e6000000-0000-4000-8000-000000000002';

create temp table pg_temp.retention_start as
select
  (public.start_branch_market_research(
    'e6000000-0000-4000-8000-000000000201'::uuid,
    'e6000000-0000-4000-8000-000000000002'::uuid,
    'e6000000-0000-4000-8000-000000000301'::uuid,
    pg_catalog.jsonb_build_object(
      'schemaVersion', 2,
      'branchId', 'e6000000-0000-4000-8000-000000000301'::uuid,
      'publicIdentity', pg_catalog.jsonb_build_object(
        'approvedName', 'Retention Kitchen',
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
          'layer', 'trade_area', 'locationRef', 'ae:du:retention', 'name', 'Retention area',
          'branchId', 'e6000000-0000-4000-8000-000000000301'::uuid, 'radiusKm', 8
        )
      ),
      'competitors', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'key', 'retention-rival', 'name', 'Retention Rival',
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
    ),
    pg_temp.retention_digest(pg_catalog.jsonb_build_object(
      'schemaVersion', 2,
      'branchId', 'e6000000-0000-4000-8000-000000000301'::uuid,
      'publicIdentity', pg_catalog.jsonb_build_object(
        'approvedName', 'Retention Kitchen',
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
          'layer', 'trade_area', 'locationRef', 'ae:du:retention', 'name', 'Retention area',
          'branchId', 'e6000000-0000-4000-8000-000000000301'::uuid, 'radiusKm', 8
        )
      ),
      'competitors', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'key', 'retention-rival', 'name', 'Retention Rival',
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
    )),
    null,
    'retention-pipeline-key-001',
    'e6000000-0000-4000-8000-000000000701'::uuid
  ) ->> 'pipelineId')::uuid as pipeline_id;

-- The run lifecycle below executes as service_role, which holds no implicit
-- grant on tables owned by authenticated, so the owner shares this one.
grant select on table pg_temp.retention_start to service_role;

reset role;

set local role service_role;

select public.claim_growth_intelligence_request(
  'e6000000-0000-4000-8000-000000000201'::uuid,
  (select research_request_id from public.growth_intelligence_research_pipelines
   where organization_id = 'e6000000-0000-4000-8000-000000000201'::uuid
     and id = (select pipeline_id from pg_temp.retention_start)),
  'e6000000-0000-4000-8000-000000000601'::uuid,
  600
);

create temp table pg_temp.retention_run as
select (public.begin_market_research_run(
  'e6000000-0000-4000-8000-000000000201'::uuid,
  (select research_request_id from public.growth_intelligence_research_pipelines
   where organization_id = 'e6000000-0000-4000-8000-000000000201'::uuid
     and id = (select pipeline_id from pg_temp.retention_start)),
  'e6000000-0000-4000-8000-000000000601'::uuid,
  '{"adapterProvider": "brave", "adapterVersion": "search-2026-09", "modelProvider": null, "modelVersion": null, "runFingerprint": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "queryPlanDigest": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "correlationId": "e6000000-0000-4000-8000-000000000702"}'::jsonb
) ->> 'runId')::uuid as run_id;

select public.record_market_evidence_claims(
  'e6000000-0000-4000-8000-000000000201'::uuid,
  (select research_request_id from public.growth_intelligence_research_pipelines
   where organization_id = 'e6000000-0000-4000-8000-000000000201'::uuid
     and id = (select pipeline_id from pg_temp.retention_start)),
  'e6000000-0000-4000-8000-000000000601'::uuid,
  (select run_id from pg_temp.retention_run),
  '{
    "sources": [
      {
        "key": "retained-notice",
        "url": "https://tourism.example/dubai-notice",
        "domain": "tourism.example",
        "publisher": "Dubai Tourism",
        "sourceClass": "official",
        "availability": "available",
        "contentDigest": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "safeFailureCode": null,
        "retrievedAt": "2026-09-01T10:00:00Z",
        "publishedAt": null,
        "observedAt": "2026-09-01T09:00:00Z",
        "excerptText": "A public notice about weekend demand near the marina.",
        "excerptDigest": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "qualificationVersion": "BRAVE-ORDER-2026-09-08",
        "retainUntil": "2027-09-01T00:00:00Z"
      },
      {
        "key": "legacy-notice",
        "url": "https://events.example/festival",
        "domain": "events.example",
        "publisher": null,
        "sourceClass": "public_signal",
        "availability": "available",
        "contentDigest": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        "safeFailureCode": null,
        "retrievedAt": "2026-09-01T10:00:00Z",
        "publishedAt": null,
        "observedAt": "2026-09-01T09:00:00Z"
      }
    ],
    "claims": [
      {
        "key": "marina-demand",
        "claimDigest": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        "subjectKind": "market",
        "subjectRef": "dubai-marina",
        "claimKind": "demand_signal",
        "paraphrase": "Weekend demand near the marina may rise during the festival.",
        "quotation": null,
        "geographicLayer": "city",
        "geographyRef": "ae:du",
        "sourceKeys": ["retained-notice", "legacy-notice"],
        "freshnessClass": "standard",
        "claimCategory": "demand_trend",
        "freshnessRegistryVersion": 1,
        "publishedAt": null,
        "observedAt": "2026-09-01T09:00:00Z",
        "staleAt": "2026-09-15T09:00:00Z",
        "expiresAt": "2026-10-01T09:00:00Z",
        "limitations": ["BROADER_MARKET_INFERENCE"]
      }
    ],
    "links": []
  }'::jsonb
);

reset role;

-- Admission persists qualification and retain-until provenance --------------------

select extensions.is(
  (select excerpt_text from public.market_evidence_sources
   where organization_id = 'e6000000-0000-4000-8000-000000000201'::uuid
     and source_key = 'retained-notice'),
  'A public notice about weekend demand near the marina.',
  'admission persists the bounded excerpt'
);

select extensions.is(
  (select qualification_version from public.market_evidence_sources
   where organization_id = 'e6000000-0000-4000-8000-000000000201'::uuid
     and source_key = 'retained-notice'),
  'BRAVE-ORDER-2026-09-08',
  'admission persists the qualification version'
);

select extensions.is(
  (select retain_until from public.market_evidence_sources
   where organization_id = 'e6000000-0000-4000-8000-000000000201'::uuid
     and source_key = 'retained-notice'),
  '2027-09-01T00:00:00Z'::timestamptz,
  'admission persists the retain-until policy'
);

-- Erasure is narrowly authorized and fully audited ----------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'e6000000-0000-4000-8000-000000000002';

select extensions.throws_ok(
  $$select public.erase_research_source_payload(
    'e6000000-0000-4000-8000-000000000201'::uuid,
    (select id from public.market_evidence_sources
     where organization_id = 'e6000000-0000-4000-8000-000000000201'::uuid
       and source_key = 'retained-notice'),
    'AGREEMENT_TERMINATED', false
  )$$,
  '42501', null,
  'browser members cannot erase evidence payloads'
);

reset role;

set local role service_role;

select extensions.throws_ok(
  $$select public.erase_research_source_payload(
    'e6000000-0000-4000-8000-000000000201'::uuid,
    (select id from public.market_evidence_sources
     where organization_id = 'e6000000-0000-4000-8000-000000000201'::uuid
       and source_key = 'retained-notice'),
    'lowercase-reason', false
  )$$,
  '22023', null,
  'erasure reasons stay safe codes'
);

select extensions.is(
  (select public.erase_research_source_payload(
    'e6000000-0000-4000-8000-000000000201'::uuid,
    (select id from public.market_evidence_sources
     where organization_id = 'e6000000-0000-4000-8000-000000000201'::uuid
       and source_key = 'retained-notice'),
    'AGREEMENT_TERMINATED', false
  ) ->> 'erasedClaims')::integer,
  1,
  'erasure withdraws the derived claim eligibility with audit'
);

select extensions.is(
  (select excerpt_text from public.market_evidence_sources
   where organization_id = 'e6000000-0000-4000-8000-000000000201'::uuid
     and source_key = 'retained-notice'),
  null,
  'erasure removes the retained payload'
);

select extensions.is(
  (select availability from public.market_evidence_sources
   where organization_id = 'e6000000-0000-4000-8000-000000000201'::uuid
     and source_key = 'retained-notice'),
  'unavailable',
  'history renders the source-unavailable state'
);

select extensions.is(
  (select erasure_reason_code from public.market_evidence_sources
   where organization_id = 'e6000000-0000-4000-8000-000000000201'::uuid
     and source_key = 'retained-notice'),
  'AGREEMENT_TERMINATED',
  'erasure keeps the safe reason code'
);

select extensions.is(
  (select pg_catalog.count(*)::integer from public.market_evidence_claim_events claim_event
   join public.market_evidence_claims claim
     on claim.organization_id = claim_event.organization_id
    and claim.id = claim_event.market_evidence_claim_id
   where claim_event.organization_id = 'e6000000-0000-4000-8000-000000000201'::uuid
     and claim.claim_key = 'marina-demand'
     and claim_event.event_type = 'erased'),
  1,
  'erasure writes an explicit erased audit event'
);

select extensions.is(
  (select paraphrase from public.market_evidence_claims
   where organization_id = 'e6000000-0000-4000-8000-000000000201'::uuid
     and claim_key = 'marina-demand'),
  'Weekend demand near the marina may rise during the festival.',
  'derived text survives unless the obligation covers it'
);

-- The guard triggers sit below the table grants, so this probe runs as the
-- table owner: service_role holds no direct write grant by design.
reset role;

select extensions.throws_ok(
  $$insert into public.market_evidence_links (
    organization_id, market_evidence_claim_id, market_evidence_source_id, relation
  )
  select
    'e6000000-0000-4000-8000-000000000201'::uuid,
    claim.id,
    source.id,
    'supports'
  from public.market_evidence_claims claim
  cross join public.market_evidence_sources source
  where claim.organization_id = 'e6000000-0000-4000-8000-000000000201'::uuid
    and claim.claim_key = 'marina-demand'
    and source.organization_id = 'e6000000-0000-4000-8000-000000000201'::uuid
    and source.source_key = 'retained-notice'$$,
  '22023', null,
  'an erased source cannot support new synthesis'
);

set local role service_role;

-- The obligation path removes derived text too -------------------------------------

select extensions.is(
  (select public.erase_research_source_payload(
    'e6000000-0000-4000-8000-000000000201'::uuid,
    (select id from public.market_evidence_sources
     where organization_id = 'e6000000-0000-4000-8000-000000000201'::uuid
       and source_key = 'legacy-notice'),
    'REGULATOR_REQUEST', true
  ) ->> 'erasedClaims')::integer,
  1,
  'the obligation path erases the remaining derived support'
);

select extensions.is(
  (select paraphrase from public.market_evidence_claims
   where organization_id = 'e6000000-0000-4000-8000-000000000201'::uuid
     and claim_key = 'marina-demand'),
  null,
  'derived text is removed where the obligation covers it'
);

select extensions.is(
  (select text_withdrawn from public.market_evidence_claims
   where organization_id = 'e6000000-0000-4000-8000-000000000201'::uuid
     and claim_key = 'marina-demand'),
  true,
  'withdrawal is explicit on the derived claim'
);

-- Append-only rules survive the narrow erasure exception ------------------------------
-- (owner role again: the immutability trigger sits below the table grants.)

reset role;

select extensions.throws_ok(
  $$update public.market_evidence_sources
   set publisher = 'Rewritten Publisher'
   where organization_id = 'e6000000-0000-4000-8000-000000000201'::uuid
     and source_key = 'legacy-notice'$$,
  '55000', null,
  'ordinary evidence edits stay forbidden after erasure'
);

rollback;
