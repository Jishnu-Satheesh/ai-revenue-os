begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(77);

-- Spec 023 Swarm 2: growth capture adapters (market_claim, growth_item,
-- growth_decision). Registry rows, projectors, and enqueue integrations inside
-- the existing fenced source RPCs. Posts to the queue run inside the source
-- transactions; projection runs through the leased complete_ path.
--
-- NOTE on environments: this file is written against the post-push shape (the
-- growth capture migration applied). Calls to the seven new private functions
-- are wrapped in pg_temp.state_of so a missing function reports a failure code
-- instead of aborting the script; every other assertion reads tables or
-- long-lived RPCs that exist already. A pre-push db:test run itemizes those
-- state_of failures as missing-migration artifacts.

create or replace function pg_temp.state_of(call_sql text)
returns text language plpgsql as $$
begin
  execute call_sql;
  return 'no-error';
exception when others then
  return SQLSTATE;
end;
$$;

create or replace function pg_temp.priv_of(p_role text, p_sig text)
returns text language plpgsql as $$
begin
  if pg_catalog.has_function_privilege(p_role, p_sig, 'execute') then
    return 'true';
  end if;
  return 'false';
exception when others then
  return 'missing';
end;
$$;

-- Graceful function-definition check: 'true' when the named function exists and
-- contains none of the needles, 'false' when it exists and contains one,
-- 'missing' when the function itself is not there yet (pre-push artifact).

create or replace function pg_temp.def_lacks_all(p_sig text, p_needles text[])
returns text language plpgsql as $$
declare
  v_def text;
  v_needle text;
begin
  select pg_catalog.pg_get_functiondef(p_sig::regprocedure) into v_def;
  foreach v_needle in array p_needles loop
    if pg_catalog.strpos(v_def, v_needle) > 0 then
      return 'false';
    end if;
  end loop;
  return 'true';
exception when others then
  return 'missing';
end;
$$;

-- Definer wrappers: the private schema is invisible to session roles, so tests
-- reach enqueue helpers and projectors nested in definer rights exactly as the
-- worker path does. A still-pending migration reports through state_of instead
-- of aborting creation.

create or replace function pg_temp.set_capture(p_on boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.memory_integration_settings set capture_enabled = p_on
  where organization_id = 'fb410000-0000-4000-8000-000000000201'::uuid;
$$;

create or replace function pg_temp.claim_due(p_token uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.claim_memory_capture_events(
    'fb410000-0000-4000-8000-000000000201'::uuid, p_token, 25, 120);
$$;

create or replace function pg_temp.delivery_status(p_event uuid, p_token uuid)
returns text language plpgsql as $$
declare
  v_result jsonb;
begin
  select public.complete_memory_capture_event(
    'fb410000-0000-4000-8000-000000000201'::uuid, p_event, p_token) into v_result;
  return v_result ->> 'status';
exception when others then
  return SQLSTATE;
end;
$$;

create or replace function pg_temp.delivery_item(p_event uuid, p_token uuid)
returns text language plpgsql as $$
declare
  v_result jsonb;
begin
  select public.complete_memory_capture_event(
    'fb410000-0000-4000-8000-000000000201'::uuid, p_event, p_token) into v_result;
  return v_result ->> 'projectedItemId';
exception when others then
  return SQLSTATE;
end;
$$;

create or replace function pg_temp.claim_event_count()
returns integer
language sql
security definer
set search_path = ''
as $$
  select count(*)::integer from public.memory_capture_events
  where organization_id = 'fb410000-0000-4000-8000-000000000201'::uuid
    and source_kind = 'market_claim';
$$;

create or replace function pg_temp.item_event_count()
returns integer
language sql
security definer
set search_path = ''
as $$
  select count(*)::integer from public.memory_capture_events
  where organization_id = 'fb410000-0000-4000-8000-000000000201'::uuid
    and source_kind = 'growth_item';
$$;

create or replace function pg_temp.decision_event_count()
returns integer
language sql
security definer
set search_path = ''
as $$
  select count(*)::integer from public.memory_capture_events
  where organization_id = 'fb410000-0000-4000-8000-000000000201'::uuid
    and source_kind = 'growth_decision';
$$;

create or replace function pg_temp.reenqueue_items(p_run uuid)
returns text language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.enqueue_memory_growth_items(
    'fb410000-0000-4000-8000-000000000201'::uuid, p_run);
  return 'no-error';
exception when others then
  return SQLSTATE;
end;
$$;

-- Session-safe reads of worker-only tables (service_role holds no grant there;
-- the helpers run with definer rights exactly like the fenced RPCs).

create or replace function pg_temp.research_run_id(p_request uuid)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select run.id from public.market_research_runs run
  where run.organization_id = 'fb410000-0000-4000-8000-000000000201'::uuid
    and run.growth_intelligence_request_id = p_request;
$$;

create or replace function pg_temp.decision_event_for_fp(p_fp text)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select e.id from public.memory_capture_events e
  join public.growth_intelligence_item_decisions d on d.id = e.growth_decision_id
  where e.organization_id = 'fb410000-0000-4000-8000-000000000201'::uuid
    and d.item_fingerprint = p_fp
  order by d.created_at limit 1;
$$;

create or replace function pg_temp.project_claim(p_event uuid)
returns text language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.project_memory_market_claim(
    'fb410000-0000-4000-8000-000000000201'::uuid, p_event);
  return 'no-error';
exception when others then
  return SQLSTATE;
end;
$$;

-- Research fixtures ------------------------------------------------------------

create or replace function pg_temp.research_metadata()
returns jsonb
language sql
immutable
as $$
  select pg_catalog.jsonb_build_object(
    'adapterProvider', 'qualified-research', 'adapterVersion', 'market-research@1',
    'modelProvider', 'gemini', 'modelVersion', 'gemini-fixture-review-1',
    'runFingerprint', repeat('e', 64),
    'queryPlanDigest', repeat('c', 64),
    'correlationId', 'fb410000-0000-4000-8000-000000000751');
$$;

create or replace function pg_temp.evidence_payload()
returns jsonb
language sql
stable
as $$
  select pg_catalog.jsonb_build_object(
    'sources', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'key', 'tourism-signal', 'url', 'https://tourism.example/dubai-notice', 'domain', 'tourism.example',
        'publisher', 'Dubai Tourism', 'sourceClass', 'official', 'availability', 'available',
        'contentDigest', repeat('a', 64), 'safeFailureCode', null,
        'retrievedAt', pg_catalog.to_char(pg_catalog.now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'publishedAt', null,
        'observedAt', pg_catalog.to_char(pg_catalog.now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      ),
      pg_catalog.jsonb_build_object(
        'key', 'city-calendar', 'url', 'https://calendar.example/dubai-events', 'domain', 'calendar.example',
        'publisher', 'Dubai Calendar', 'sourceClass', 'first_party', 'availability', 'available',
        'contentDigest', repeat('b', 64), 'safeFailureCode', null,
        'retrievedAt', pg_catalog.to_char(pg_catalog.now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'publishedAt', null,
        'observedAt', pg_catalog.to_char(pg_catalog.now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      )
    ),
    'claims', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'key', 'tourism-demand', 'claimDigest', repeat('1', 64),
        'subjectKind', 'market', 'subjectRef', 'dubai-market', 'claimKind', 'demand_signal',
        'paraphrase', 'fb41 public market signal may affect local demand.', 'quotation', null,
        'geographicLayer', 'city', 'geographyRef', 'ae:du', 'sourceKeys', pg_catalog.jsonb_build_array('tourism-signal'),
        'freshnessClass', 'standard', 'claimCategory', 'demand_trend', 'freshnessRegistryVersion', 1,
        'publishedAt', null,
        'observedAt', pg_catalog.to_char(pg_catalog.now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'staleAt', pg_catalog.to_char((pg_catalog.now() + interval '14 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'expiresAt', pg_catalog.to_char((pg_catalog.now() + interval '30 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'limitations', pg_catalog.jsonb_build_array('BROADER_MARKET_INFERENCE')
      ),
      pg_catalog.jsonb_build_object(
        'key', 'festival-calendar', 'claimDigest', repeat('2', 64),
        'subjectKind', 'event', 'subjectRef', 'dubai-festival', 'claimKind', 'event_calendar',
        'paraphrase', 'fb41 local calendar entry may affect demand timing.', 'quotation', null,
        'geographicLayer', 'city', 'geographyRef', 'ae:du', 'sourceKeys', pg_catalog.jsonb_build_array('city-calendar'),
        'freshnessClass', 'standard', 'claimCategory', 'event', 'freshnessRegistryVersion', 1,
        'publishedAt', null,
        'observedAt', pg_catalog.to_char(pg_catalog.now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'staleAt', pg_catalog.to_char((pg_catalog.now() + interval '7 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'expiresAt', pg_catalog.to_char((pg_catalog.now() + interval '14 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'limitations', '[]'::jsonb
      )
    ),
    'links', '[]'::jsonb
  );
$$;

create or replace function pg_temp.research_result()
returns jsonb
language sql
immutable
as $$
  select pg_catalog.jsonb_build_object(
    'outcome', 'completed', 'resultDigest', repeat('d', 64),
    'sourceAttemptCount', 2, 'sourceSuccessCount', 2,
    'adapterCostMicrosUsd', 42000, 'adapterLatencyMs', 721
  );
$$;

create or replace function pg_temp.synth_item(
  p_kind text, p_narrative text, p_fp text, p_efp text, p_missing text,
  p_claim_ids jsonb
)
returns jsonb
language sql
stable
as $$
  select pg_catalog.jsonb_build_object(
    'kind', p_kind, 'narrative', p_narrative,
    'itemFingerprint', p_fp, 'evidenceFingerprint', p_efp,
    'geographicLayer', 'city', 'geographyRef', 'ae:du',
    'supportGrade', 'corroborated', 'freshness', 'current',
    'urgency', 'high', 'goalAlignment', 'direct',
    'activityMonth', '2026-08',
    'claimIds', p_claim_ids, 'findings', '[]'::jsonb,
    'goals', '[]'::jsonb
  ) || case when p_missing is null then '{}'::jsonb
      else pg_catalog.jsonb_build_object('missingInput', p_missing) end;
$$;

-- Tenant and branch fixtures: two branches plus a sibling tenant --------------

insert into auth.users (id) values
  ('fb410000-0000-4000-8000-000000000001'::uuid),
  ('fb410000-0000-4000-8000-000000000002'::uuid);
insert into public.accounts (id, name, slug, created_by) values
  ('fb410000-0000-4000-8000-000000000101'::uuid, 'Growth capture verifier', 'growth-capture-verifier', 'fb410000-0000-4000-8000-000000000001'::uuid),
  ('fb410000-0000-4000-8000-000000000102'::uuid, 'Growth capture outsider', 'growth-capture-outsider', 'fb410000-0000-4000-8000-000000000002'::uuid);
insert into public.organizations (id, account_id, name, slug, industry, country_code, base_currency, default_timezone, created_by) values
  ('fb410000-0000-4000-8000-000000000201'::uuid, 'fb410000-0000-4000-8000-000000000101'::uuid, 'Growth capture verifier', 'growth-capture-verifier', 'testing', 'AE', 'AED', 'Asia/Dubai', 'fb410000-0000-4000-8000-000000000001'::uuid),
  ('fb410000-0000-4000-8000-000000000202'::uuid, 'fb410000-0000-4000-8000-000000000102'::uuid, 'Growth capture outsider', 'growth-capture-outsider', 'testing', 'AE', 'AED', 'Asia/Dubai', 'fb410000-0000-4000-8000-000000000002'::uuid);
insert into public.account_memberships (account_id, user_id, account_role, default_organization_role) values
  ('fb410000-0000-4000-8000-000000000101'::uuid, 'fb410000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner'),
  ('fb410000-0000-4000-8000-000000000102'::uuid, 'fb410000-0000-4000-8000-000000000002'::uuid, 'owner', 'owner');
insert into public.branches (id, organization_id, name, slug, kind, timezone, currency, is_active) values
  ('fb410000-0000-4000-8000-000000000301'::uuid, 'fb410000-0000-4000-8000-000000000201'::uuid, 'Growth Marina', 'growth-marina', 'physical', 'Asia/Dubai', 'AED', true),
  ('fb410000-0000-4000-8000-000000000302'::uuid, 'fb410000-0000-4000-8000-000000000201'::uuid, 'Growth Downtown', 'growth-downtown', 'physical', 'Asia/Dubai', 'AED', true),
  ('fb410000-0000-4000-8000-000000000303'::uuid, 'fb410000-0000-4000-8000-000000000202'::uuid, 'Outsider outlet', 'growth-outsider-outlet', 'physical', 'Asia/Dubai', 'AED', true);

insert into public.memory_integration_settings (organization_id, capture_enabled) values
  ('fb410000-0000-4000-8000-000000000201'::uuid, true);

insert into public.organization_market_profiles (id, organization_id, enabled) values
  ('fb410000-0000-4000-8000-000000000401'::uuid, 'fb410000-0000-4000-8000-000000000201'::uuid, false);
insert into public.organization_market_profile_versions (
  id, organization_id, market_profile_id, version, schema_version,
  profile_document, profile_digest, source_policy_digest, proposal_source,
  created_by, correlation_id
) values (
  'fb410000-0000-4000-8000-000000000402'::uuid, 'fb410000-0000-4000-8000-000000000201'::uuid,
  'fb410000-0000-4000-8000-000000000401'::uuid, 1, 1,
  pg_catalog.jsonb_build_object('schemaVersion', 1),
  repeat('d', 64), repeat('c', 64), 'operator',
  'fb410000-0000-4000-8000-000000000001'::uuid, 'fb410000-0000-4000-8000-000000000751'::uuid
);
update public.organization_market_profiles
set current_version_id = 'fb410000-0000-4000-8000-000000000402'::uuid, enabled = true
where id = 'fb410000-0000-4000-8000-000000000401'::uuid;

-- Requests: R1 research (branch 301); R2 synthesis (branch 301); R3 synthesis
-- (branch 302); R4 synthesis for the empty receipt (branch 301); R6 research
-- (branch 301, stays claimed) for the withdrawal append path.

insert into public.growth_intelligence_requests (
  id, organization_id, branch_id, kind, trigger_reason, request_fingerprint,
  market_profile_version_id, source_policy_digest, research_rule_version,
  local_time_bucket, status, due_at, claim_token, lease_expires_at,
  attempt_count, correlation_id
) values
  ('fb410000-0000-4000-8000-000000000501'::uuid, 'fb410000-0000-4000-8000-000000000201'::uuid,
   'fb410000-0000-4000-8000-000000000301'::uuid, 'market_research', 'daily_due', repeat('1', 64),
   'fb410000-0000-4000-8000-000000000402'::uuid, repeat('c', 64), 'market-research@1',
   'immediate', 'claimed', pg_catalog.now(),
   'fb410000-0000-4000-8000-000000000511'::uuid, pg_catalog.now() + interval '10 minutes',
   1, 'fb410000-0000-4000-8000-000000000751'::uuid),
  ('fb410000-0000-4000-8000-000000000502'::uuid, 'fb410000-0000-4000-8000-000000000201'::uuid,
   'fb410000-0000-4000-8000-000000000301'::uuid, 'business_evidence_changed', 'business_evidence_current', repeat('2', 64),
   'fb410000-0000-4000-8000-000000000402'::uuid, repeat('c', 64), 'market-research@1',
   'immediate', 'claimed', pg_catalog.now(),
   'fb410000-0000-4000-8000-000000000512'::uuid, pg_catalog.now() + interval '10 minutes',
   1, 'fb410000-0000-4000-8000-000000000752'::uuid),
  ('fb410000-0000-4000-8000-000000000503'::uuid, 'fb410000-0000-4000-8000-000000000201'::uuid,
   'fb410000-0000-4000-8000-000000000302'::uuid, 'business_evidence_changed', 'business_evidence_current', repeat('3', 64),
   'fb410000-0000-4000-8000-000000000402'::uuid, repeat('c', 64), 'market-research@1',
   'immediate', 'claimed', pg_catalog.now(),
   'fb410000-0000-4000-8000-000000000513'::uuid, pg_catalog.now() + interval '10 minutes',
   1, 'fb410000-0000-4000-8000-000000000753'::uuid),
  ('fb410000-0000-4000-8000-000000000504'::uuid, 'fb410000-0000-4000-8000-000000000201'::uuid,
   'fb410000-0000-4000-8000-000000000301'::uuid, 'business_evidence_changed', 'business_evidence_current', repeat('4', 64),
   'fb410000-0000-4000-8000-000000000402'::uuid, repeat('c', 64), 'market-research@1',
   'immediate', 'claimed', pg_catalog.now(),
   'fb410000-0000-4000-8000-000000000514'::uuid, pg_catalog.now() + interval '10 minutes',
   1, 'fb410000-0000-4000-8000-000000000754'::uuid),
  ('fb410000-0000-4000-8000-000000000506'::uuid, 'fb410000-0000-4000-8000-000000000201'::uuid,
   'fb410000-0000-4000-8000-000000000301'::uuid, 'market_research', 'daily_due', repeat('6', 64),
   'fb410000-0000-4000-8000-000000000402'::uuid, repeat('c', 64), 'market-research@1',
   'immediate', 'claimed', pg_catalog.now(),
   'fb410000-0000-4000-8000-000000000515'::uuid, pg_catalog.now() + interval '10 minutes',
   1, 'fb410000-0000-4000-8000-000000000756'::uuid);

-- Adapters are registered, projectable, and fenced -----------------------------

select extensions.has_function(
  'private', 'project_memory_market_claim',
  'the market-claim projector exists where complete_ dispatches it');
select extensions.has_function(
  'private', 'project_memory_growth_item',
  'so does the growth-item projector');
select extensions.has_function(
  'private', 'project_memory_growth_decision',
  'and the growth-decision projector');
select extensions.has_function(
  'private', 'enqueue_memory_market_claims',
  'the claim enqueue helper exists');
select extensions.has_function(
  'private', 'enqueue_memory_market_claim_withdrawn',
  'so does the claim withdrawal helper');
select extensions.has_function(
  'private', 'enqueue_memory_growth_items',
  'so does the item enqueue helper');
select extensions.has_function(
  'private', 'enqueue_memory_growth_decision',
  'and the decision enqueue helper');
select extensions.is(
  (select count(*)::integer from public.memory_capture_adapters
   where source_kind in ('market_claim', 'growth_item', 'growth_decision')
     and registered),
  3, 'all three growth kinds are registered');
select extensions.is(
  pg_temp.priv_of('service_role', 'public.complete_market_research_run(uuid,uuid,uuid,uuid,jsonb)'),
  'true', 'the fenced research completion still belongs to the worker');
select extensions.is(
  pg_temp.priv_of('authenticated', 'public.complete_market_research_run(uuid,uuid,uuid,uuid,jsonb)'),
  'false', 'members still cannot complete research directly');
select extensions.is(
  pg_temp.priv_of('authenticated', 'public.decide_growth_intelligence_item(uuid,uuid,uuid,text,text,timestamptz,text)'),
  'true', 'members still hold the item triage path');
select extensions.is(
  pg_temp.priv_of('authenticated', 'private.project_memory_market_claim(uuid,uuid)') || '/'
    || pg_temp.priv_of('authenticated', 'private.project_memory_growth_item(uuid,uuid)') || '/'
    || pg_temp.priv_of('authenticated', 'private.project_memory_growth_decision(uuid,uuid)'),
  'false/false/false', 'no session reaches a growth projector directly');

-- Owning transactions keep their enqueue lines ---------------------------------

select extensions.ok(
  pg_catalog.pg_get_functiondef(
    'public.complete_market_research_run(uuid,uuid,uuid,uuid,jsonb)'::regprocedure
  ) like '%enqueue_memory_market_claims%',
  'research completion enqueues admitted claims');
select extensions.ok(
  pg_catalog.pg_get_functiondef(
    'public.complete_market_research_pipeline(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb)'::regprocedure
  ) like '%enqueue_memory_market_claims%',
  'the pipeline handoff enqueues admitted claims too');
select extensions.ok(
  pg_catalog.pg_get_functiondef(
    'public.complete_growth_intelligence_synthesis(uuid,uuid,uuid,uuid,jsonb)'::regprocedure
  ) like '%enqueue_memory_growth_items%',
  'synthesis completion enqueues its items');
select extensions.ok(
  pg_catalog.pg_get_functiondef(
    'public.complete_market_synthesis_pipeline(uuid,uuid,uuid,uuid,jsonb)'::regprocedure
  ) like '%enqueue_memory_growth_items%',
  'the pipeline finalization re-enqueues idempotently, covering replays');
select extensions.ok(
  pg_catalog.pg_get_functiondef(
    'public.decide_growth_intelligence_item(uuid,uuid,uuid,text,text,timestamptz,text)'::regprocedure
  ) like '%enqueue_memory_growth_decision%',
  'accepted triage enqueues its decision');
select extensions.ok(
  pg_catalog.pg_get_functiondef(
    'public.append_market_evidence_claim_event(uuid,uuid,uuid,text,jsonb)'::regprocedure
  ) like '%enqueue_memory_market_claim_withdrawn%',
  'withdrawal appends enqueue withdrawn memory events');
select extensions.ok(
  pg_catalog.pg_get_functiondef(
    'public.erase_research_source_payload(uuid,uuid,text,boolean)'::regprocedure
  ) like '%enqueue_memory_market_claim_withdrawn%'
  and pg_catalog.pg_get_functiondef(
    'public.erase_research_source_payload(uuid,uuid,text,boolean)'::regprocedure
  ) like '%erase_memory_source_content%',
  'erasure enqueues withdrawals and cleans descendants through the erase path');

-- Hygiene: excerpts never cross; pins and votes are never read ------------------

select extensions.is(
  pg_temp.def_lacks_all('private.project_memory_market_claim(uuid,uuid)',
    array['excerpt_text', 'excerpt_digest']),
  'true',
  'the claim projector never touches excerpt columns');
select extensions.is(
  pg_temp.def_lacks_all('private.project_memory_market_claim(uuid,uuid)',
    array['quotation']),
  'true',
  'nor bounded quotations: paraphrase plus lineage only');
select extensions.ok(
  pg_temp.def_lacks_all('private.project_memory_growth_decision(uuid,uuid)',
    array['preference', 'feedback']) = 'true'
  and pg_temp.def_lacks_all('private.enqueue_memory_growth_decision(uuid,uuid)',
    array['preference', 'feedback']) = 'true',
  'pins and helpfulness votes are never read');
select extensions.ok(
  pg_catalog.pg_get_functiondef(
    'public.complete_growth_intelligence_synthesis(uuid,uuid,uuid,uuid,jsonb)'::regprocedure
  ) like '%growth_intelligence_synthesis_support_inadmissible%'
  and pg_catalog.pg_get_functiondef(
    'public.complete_market_research_pipeline(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb)'::regprocedure
  ) like '%market_research_pipeline_scope_mismatch%',
  'support admission and scope fences survive the capture slice');

-- Claim capture: admitted completion enqueues, failure enqueues nothing --------

set local role service_role;

select extensions.is(
  (public.begin_market_research_run(
    'fb410000-0000-4000-8000-000000000201'::uuid,
    'fb410000-0000-4000-8000-000000000501'::uuid,
    'fb410000-0000-4000-8000-000000000511'::uuid,
    pg_temp.research_metadata()) ->> 'replayed'),
  'false', 'the research run opens under its lease');

select extensions.is(
  (public.record_market_evidence_claims(
    'fb410000-0000-4000-8000-000000000201'::uuid,
    'fb410000-0000-4000-8000-000000000501'::uuid,
    'fb410000-0000-4000-8000-000000000511'::uuid,
    pg_temp.research_run_id('fb410000-0000-4000-8000-000000000501'::uuid),
    pg_temp.evidence_payload()) ->> 'claimCount'),
  '2', 'two admitted claims persist');

select extensions.is(
  (public.complete_market_research_run(
    'fb410000-0000-4000-8000-000000000201'::uuid,
    'fb410000-0000-4000-8000-000000000501'::uuid,
    'fb410000-0000-4000-8000-000000000511'::uuid,
    pg_temp.research_run_id('fb410000-0000-4000-8000-000000000501'::uuid),
    pg_temp.research_result()) ->> 'status'),
  'completed', 'admitted research completes');

select extensions.is(
  pg_temp.claim_event_count(),
  2, 'completion enqueues exactly that run claims');

select extensions.is(
  (select count(*)::integer from public.memory_capture_events e
   where e.organization_id = 'fb410000-0000-4000-8000-000000000201'::uuid
     and e.source_kind = 'market_claim' and e.event_kind = 'recorded'
     and e.source_revision <> 1),
  0, 'first recordings start at revision one');

select extensions.ok(
  (public.complete_market_research_run(
    'fb410000-0000-4000-8000-000000000201'::uuid,
    'fb410000-0000-4000-8000-000000000501'::uuid,
    'fb410000-0000-4000-8000-000000000511'::uuid,
    pg_temp.research_run_id('fb410000-0000-4000-8000-000000000501'::uuid),
    pg_temp.research_result()) ->> 'replayed' = 'true'),
  'a replayed completion answers identically');

select extensions.is(
  pg_temp.claim_event_count(),
  2, 'the replay mints no new revision');

-- Claim projection through the leased path ----------------------------------------

select pg_temp.claim_due('fb410000-0000-4000-8000-0000000008c1'::uuid);

select extensions.is(
  (select pg_temp.delivery_status(
    (select e.id from public.memory_capture_events e
     join public.market_evidence_claims c on c.id = e.market_claim_id
     where c.claim_key = 'festival-calendar'),
    'fb410000-0000-4000-8000-0000000008c1'::uuid)),
  'completed', 'the claim delivery projects');

select extensions.is(
  (select i.memory_type || '/' || i.origin || '/' || i.verification_state || '/' || i.knowledge_kind
   from public.memory_items i
   join public.memory_capture_events e on e.id = i.capture_event_id
   join public.market_evidence_claims c on c.id = e.market_claim_id
   where c.claim_key = 'festival-calendar'),
  'episode/ai_proposed/unverified/observation', 'the item carries the claim contract');

select extensions.ok(
  ((select pg_catalog.strpos(i.body, 'fb41 local calendar entry may affect demand timing.')
    from public.memory_items i
    join public.memory_capture_events e on e.id = i.capture_event_id
    join public.market_evidence_claims c on c.id = e.market_claim_id
    where c.claim_key = 'festival-calendar') > 0),
  'the permitted paraphrase crosses into memory');

select extensions.is(
  (select i.source_reference
   from public.memory_items i
   join public.memory_capture_events e on e.id = i.capture_event_id
   join public.market_evidence_claims c on c.id = e.market_claim_id
   where c.claim_key = 'festival-calendar'),
  'market_claim:' || (select c.id::text from public.market_evidence_claims c
    where c.claim_key = 'festival-calendar'),
  'original source lineage survives projection');

select extensions.is(
  (select i.branch_id
   from public.memory_items i
   join public.memory_capture_events e on e.id = i.capture_event_id
   join public.market_evidence_claims c on c.id = e.market_claim_id
   where c.claim_key = 'festival-calendar'),
  'fb410000-0000-4000-8000-000000000301'::uuid, 'the research branch scope survives');

select extensions.is(
  (select pg_temp.delivery_status(
    (select e.id from public.memory_capture_events e
     join public.market_evidence_claims c on c.id = e.market_claim_id
     where c.claim_key = 'festival-calendar'),
    'fb410000-0000-4000-8000-0000000008c1'::uuid)),
  'replayed', 'a duplicate claim delivery replays');

select extensions.is(
  (select count(*)::integer from public.memory_items i
   join public.memory_capture_events e on e.id = i.capture_event_id
   join public.market_evidence_claims c on c.id = e.market_claim_id
   where c.claim_key = 'festival-calendar'),
  1, 'without a second row');

-- The second claim completes as a parent without its own assertions, so the
-- item enqueue below can link typed derived_from edges to completed parents.

select pg_temp.delivery_status(
  (select e.id from public.memory_capture_events e
   join public.market_evidence_claims c on c.id = e.market_claim_id
   where c.claim_key = 'tourism-demand'),
  'fb410000-0000-4000-8000-0000000008c1'::uuid);

-- Cross-tenant sources cannot back another organization events --------------------

reset role;

select extensions.is(
  pg_temp.state_of($$ insert into public.memory_capture_events (
      id, organization_id, source_kind, market_claim_id,
      source_revision, source_digest, correlation_id
    ) values (
      'fb410000-0000-4000-8000-0000000008d1', 'fb410000-0000-4000-8000-000000000202',
      'market_claim', (select c.id from public.market_evidence_claims c
        where c.organization_id = 'fb410000-0000-4000-8000-000000000201'::uuid
          and c.claim_key = 'festival-calendar'),
      1, repeat('a', 64), pg_catalog.gen_random_uuid()) $$),
  '23503', 'this organization claim cannot back a sibling tenant event');

set local role service_role;

-- Item capture: synthesis completion enqueues typed items ------------------------

select extensions.is(
  (public.begin_growth_intelligence_synthesis(
    'fb410000-0000-4000-8000-000000000201'::uuid,
    'fb410000-0000-4000-8000-000000000502'::uuid,
    'fb410000-0000-4000-8000-000000000512'::uuid,
    pg_catalog.jsonb_build_object(
      'provider', 'synthesis-test',
      'runFingerprint', repeat('f', 64),
      'correlationId', 'fb410000-0000-4000-8000-000000000752'
    )) ->> 'replayed'),
  'false', 'the synthesis run opens');

select extensions.is(
  (public.complete_growth_intelligence_synthesis(
    'fb410000-0000-4000-8000-000000000201'::uuid,
    'fb410000-0000-4000-8000-000000000502'::uuid,
    'fb410000-0000-4000-8000-000000000512'::uuid,
    (select run.id from public.growth_intelligence_synthesis_runs run
     where run.organization_id = 'fb410000-0000-4000-8000-000000000201'::uuid
       and run.growth_intelligence_request_id = 'fb410000-0000-4000-8000-000000000502'::uuid),
    pg_catalog.jsonb_build_object(
      'outcome', 'completed', 'resultDigest', repeat('b', 64),
      'items', pg_catalog.jsonb_build_array(
        pg_temp.synth_item('insight', 'fb41 dinner demand clusters across Dubai this month.',
          repeat('1', 64), repeat('2', 64), null,
          (select pg_catalog.jsonb_agg(c.id::text order by c.id) from public.market_evidence_claims c
           where c.organization_id = 'fb410000-0000-4000-8000-000000000201'::uuid
             and c.claim_key = 'tourism-demand')),
        pg_temp.synth_item('recommendation', 'fb41 extend Friday hours near the festival corridor.',
          repeat('3', 64), repeat('4', 64), null,
          (select pg_catalog.jsonb_agg(c.id::text order by c.id) from public.market_evidence_claims c
           where c.organization_id = 'fb410000-0000-4000-8000-000000000201'::uuid
             and c.claim_key = 'festival-calendar')),
        pg_temp.synth_item('data_gap', 'fb41 weekend channel coverage is thin.',
          repeat('5', 64), repeat('6', 64), 'weekend-channel-coverage',
          '[]'::jsonb)
      ))) ->> 'itemCount'),
  '3', 'three typed items persist');

select extensions.is(
  pg_temp.item_event_count(),
  3, 'completion enqueues exactly that run items');

select extensions.is(
  (select count(*)::integer from public.memory_capture_dependencies d
   join public.memory_capture_events e on e.id = d.capture_event_id
   join public.growth_intelligence_items i on i.id = e.growth_item_id
   where e.organization_id = 'fb410000-0000-4000-8000-000000000201'::uuid
     and i.item_fingerprint in (repeat('1', 64), repeat('3', 64))
     and d.relation = 'derived_from'),
  2, 'cited completed claims link as derived_from from typed joins only');

select extensions.is(
  pg_temp.reenqueue_items(
    (select run.id from public.growth_intelligence_synthesis_runs run
     where run.organization_id = 'fb410000-0000-4000-8000-000000000201'::uuid
       and run.growth_intelligence_request_id = 'fb410000-0000-4000-8000-000000000502'::uuid)),
  'no-error', 'the item enqueue helper runs');

select extensions.is(
  pg_temp.item_event_count(),
  3, 'an unchanged re-enqueue mints no new revision');

-- Second branch and the empty receipt --------------------------------------------

select extensions.is(
  (public.begin_growth_intelligence_synthesis(
    'fb410000-0000-4000-8000-000000000201'::uuid,
    'fb410000-0000-4000-8000-000000000503'::uuid,
    'fb410000-0000-4000-8000-000000000513'::uuid,
    pg_catalog.jsonb_build_object(
      'provider', 'synthesis-test',
      'runFingerprint', repeat('e', 64),
      'correlationId', 'fb410000-0000-4000-8000-000000000753'
    )) ->> 'replayed'),
  'false', 'the second-branch run opens');

select extensions.is(
  (public.complete_growth_intelligence_synthesis(
    'fb410000-0000-4000-8000-000000000201'::uuid,
    'fb410000-0000-4000-8000-000000000503'::uuid,
    'fb410000-0000-4000-8000-000000000513'::uuid,
    (select run.id from public.growth_intelligence_synthesis_runs run
     where run.organization_id = 'fb410000-0000-4000-8000-000000000201'::uuid
       and run.growth_intelligence_request_id = 'fb410000-0000-4000-8000-000000000503'::uuid),
    pg_catalog.jsonb_build_object(
      'outcome', 'completed', 'resultDigest', repeat('a', 64),
      'items', pg_catalog.jsonb_build_array(
        pg_temp.synth_item('insight', 'fb41 downtown lunch demand holds steady.',
          repeat('7', 64), repeat('8', 64), null, '[]'::jsonb)
      ))) ->> 'itemCount'),
  '1', 'the second branch persists its own item');

select extensions.is(
  (select count(*)::integer from public.memory_capture_events e
   join public.growth_intelligence_items i on i.id = e.growth_item_id
   where e.organization_id = 'fb410000-0000-4000-8000-000000000201'::uuid
     and e.source_kind = 'growth_item' and e.event_kind = 'recorded'
     and i.item_fingerprint = repeat('7', 64)
     and e.branch_id = 'fb410000-0000-4000-8000-000000000302'::uuid),
  1, 'the second-branch scope survives the enqueue');

select extensions.is(
  (public.begin_growth_intelligence_synthesis(
    'fb410000-0000-4000-8000-000000000201'::uuid,
    'fb410000-0000-4000-8000-000000000504'::uuid,
    'fb410000-0000-4000-8000-000000000514'::uuid,
    pg_catalog.jsonb_build_object(
      'provider', 'synthesis-test',
      'runFingerprint', repeat('9', 64),
      'correlationId', 'fb410000-0000-4000-8000-000000000754'
    )) ->> 'replayed'),
  'false', 'the empty run opens');

select extensions.is(
  (public.complete_growth_intelligence_synthesis(
    'fb410000-0000-4000-8000-000000000201'::uuid,
    'fb410000-0000-4000-8000-000000000504'::uuid,
    'fb410000-0000-4000-8000-000000000514'::uuid,
    (select run.id from public.growth_intelligence_synthesis_runs run
     where run.organization_id = 'fb410000-0000-4000-8000-000000000201'::uuid
       and run.growth_intelligence_request_id = 'fb410000-0000-4000-8000-000000000504'::uuid),
    pg_catalog.jsonb_build_object(
      'outcome', 'completed', 'resultDigest', repeat('0', 64),
      'items', '[]'::jsonb)) ->> 'itemCount'),
  '0', 'an empty synthesis stores nothing');

select extensions.is(
  pg_temp.item_event_count(),
  4, 'and fabricates no knowledge: the run row is the receipt');

-- Withdrawal: the first claim is withdrawn, then erased ----------------------------

select extensions.is(
  (public.append_market_evidence_claim_event(
    'fb410000-0000-4000-8000-000000000201'::uuid,
    'fb410000-0000-4000-8000-000000000506'::uuid,
    'fb410000-0000-4000-8000-000000000515'::uuid,
    'withdrawn',
    pg_catalog.jsonb_build_object(
      'claimId', (select c.id::text from public.market_evidence_claims c
        where c.claim_key = 'tourism-demand'),
      'reasonCode', 'SOURCE_RETRACTED',
      'occurredAt', pg_catalog.to_char(pg_catalog.now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
  ) ->> 'replayed'),
  'false', 'the withdrawal appends');

select extensions.is(
  (select count(*)::integer from public.memory_capture_events e
   join public.market_evidence_claims c on c.id = e.market_claim_id
   where c.claim_key = 'tourism-demand' and e.event_kind = 'withdrawn'),
  1, 'withdrawal enqueues a withdrawn memory event');

select pg_temp.claim_due('fb410000-0000-4000-8000-0000000008c2'::uuid);

select extensions.is(
  (select pg_temp.delivery_status(
    (select e.id from public.memory_capture_events e
     join public.market_evidence_claims c on c.id = e.market_claim_id
     where c.claim_key = 'tourism-demand' and e.event_kind = 'withdrawn'),
    'fb410000-0000-4000-8000-0000000008c2'::uuid)),
  'completed', 'the withdrawal itself completes');

select extensions.ok(
  (pg_temp.delivery_item(
    (select e.id from public.memory_capture_events e
     join public.market_evidence_claims c on c.id = e.market_claim_id
     where c.claim_key = 'tourism-demand' and e.event_kind = 'withdrawn'),
    'fb410000-0000-4000-8000-0000000008c2'::uuid) is null),
  'projecting no new item');

select extensions.is(
  pg_temp.project_claim(
    (select e.id from public.memory_capture_events e
     join public.market_evidence_claims c on c.id = e.market_claim_id
     where c.claim_key = 'tourism-demand' and e.event_kind = 'recorded')),
  'P0002', 'a withdrawn source takes the P0002 withdrawn path');

-- Rights erasure: descendants block immediately, withdrawals enqueue -------------

select extensions.is(
  (public.erase_research_source_payload(
    'fb410000-0000-4000-8000-000000000201'::uuid,
    (select s.id from public.market_evidence_sources s
     where s.organization_id = 'fb410000-0000-4000-8000-000000000201'::uuid
       and s.source_key = 'city-calendar'),
    'PRIVACY_REQUEST', true) ->> 'erasedClaims'),
  '1', 'erasing a source withdraws its derived claim text');

select extensions.ok(
  ((select i.body from public.memory_items i
    join public.memory_capture_events e on e.id = i.capture_event_id
    join public.market_evidence_claims c on c.id = e.market_claim_id
    where c.claim_key = 'festival-calendar') is null),
  'descendant retrieval blocks immediately through the erase path');

select extensions.is(
  (select count(*)::integer from public.memory_capture_events e
   join public.market_evidence_claims c on c.id = e.market_claim_id
   where c.claim_key = 'festival-calendar' and e.event_kind = 'withdrawn'),
  1, 'erasure enqueues a withdrawn memory event too');

-- Item projection: insight, recommendation, and the missing-data gap -------------

select pg_temp.claim_due('fb410000-0000-4000-8000-0000000008c3'::uuid);

select extensions.is(
  (select pg_temp.delivery_status(
    (select e.id from public.memory_capture_events e
     join public.growth_intelligence_items i on i.id = e.growth_item_id
     where i.item_fingerprint = repeat('1', 64)),
    'fb410000-0000-4000-8000-0000000008c3'::uuid)),
  'completed', 'the insight delivery projects');

select extensions.is(
  (select i.memory_type || '/' || i.origin || '/' || i.verification_state || '/' || i.knowledge_kind
   from public.memory_items i
   join public.memory_capture_events e on e.id = i.capture_event_id
   join public.growth_intelligence_items g on g.id = e.growth_item_id
   where g.item_fingerprint = repeat('1', 64)),
  'episode/ai_proposed/unverified/observation', 'the insight carries the episode contract');

select extensions.is(
  (select pg_temp.delivery_status(
    (select e.id from public.memory_capture_events e
     join public.growth_intelligence_items i on i.id = e.growth_item_id
     where i.item_fingerprint = repeat('3', 64)),
    'fb410000-0000-4000-8000-0000000008c3'::uuid)),
  'completed', 'the recommendation delivery projects');

select extensions.is(
  (select i.memory_type || '/' || i.origin || '/' || i.verification_state || '/' || i.knowledge_kind
   from public.memory_items i
   join public.memory_capture_events e on e.id = i.capture_event_id
   join public.growth_intelligence_items g on g.id = e.growth_item_id
   where g.item_fingerprint = repeat('3', 64)),
  'episode/ai_proposed/unverified/recommendation', 'recommendations stay recommendations');

select extensions.is(
  (select pg_temp.delivery_status(
    (select e.id from public.memory_capture_events e
     join public.growth_intelligence_items i on i.id = e.growth_item_id
     where i.item_fingerprint = repeat('5', 64)),
    'fb410000-0000-4000-8000-0000000008c3'::uuid)),
  'completed', 'the data-gap delivery projects');

select extensions.ok(
  ((select pg_catalog.strpos(i.body, 'data gap')
    from public.memory_items i
    join public.memory_capture_events e on e.id = i.capture_event_id
    join public.growth_intelligence_items g on g.id = e.growth_item_id
    where g.item_fingerprint = repeat('5', 64)) > 0
   and (select i.knowledge_kind
    from public.memory_items i
    join public.memory_capture_events e on e.id = i.capture_event_id
    join public.growth_intelligence_items g on g.id = e.growth_item_id
    where g.item_fingerprint = repeat('5', 64)) = 'observation'),
  'data gaps stay labeled missing-data observations');

select extensions.is(
  (select i.capture_event_id = e.id and e.projected_item_id = i.id
   from public.memory_items i
   join public.memory_capture_events e on e.id = i.capture_event_id
   join public.growth_intelligence_items g on g.id = e.growth_item_id
   where g.item_fingerprint = repeat('1', 64)),
  true, 'item and event link back to each other');

-- Decision capture: triage appends exactly one event -------------------------------

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'fb410000-0000-4000-8000-000000000001';

select extensions.is(
  (public.decide_growth_intelligence_item(
    'fb410000-0000-4000-8000-000000000201'::uuid,
    'fb410000-0000-4000-8000-000000000001'::uuid,
    (select id from public.growth_intelligence_items where item_fingerprint = repeat('1', 64)),
    'acknowledged', null, null, repeat('1', 64)
  ) ->> 'decision'),
  'acknowledged', 'an owner acknowledges the insight');

select extensions.is(
  pg_temp.decision_event_count(),
  1, 'the accepted append enqueues exactly one event');

select extensions.is(
  (public.decide_growth_intelligence_item(
    'fb410000-0000-4000-8000-000000000201'::uuid,
    'fb410000-0000-4000-8000-000000000001'::uuid,
    (select id from public.growth_intelligence_items where item_fingerprint = repeat('3', 64)),
    'planned', null, null, repeat('3', 64)
  ) ->> 'decision'),
  'planned', 'a recommendation records planned, distinct from acknowledged');

select extensions.is(
  pg_temp.decision_event_count(),
  2, 'as a new event; history keeps both');

select extensions.throws_ok(
  $$ select public.decide_growth_intelligence_item(
    'fb410000-0000-4000-8000-000000000201'::uuid,
    'fb410000-0000-4000-8000-000000000001'::uuid,
    (select id from public.growth_intelligence_items where item_fingerprint = repeat('1', 64)),
    'resolved', null, null, repeat('1', 64)) $$,
  '22023', 'growth_intelligence_data_gap_resolution_forbidden',
  'resolved never relabels to success');

select extensions.lives_ok(
  $$ select public.set_growth_intelligence_preference(
    'fb410000-0000-4000-8000-000000000201'::uuid,
    'fb410000-0000-4000-8000-000000000001'::uuid,
    'synthesis_item',
    (select id from public.growth_intelligence_items where item_fingerprint = repeat('1', 64)),
    true) $$,
  'a personal pin still records');

reset role;
set local role service_role;

create temp table fb41_event_count as
select pg_temp.decision_event_count() as n;

select extensions.is(
  pg_temp.decision_event_count(),
  (select n from fb41_event_count), 'the pin enqueues nothing');

select pg_temp.claim_due('fb410000-0000-4000-8000-0000000008c4'::uuid);

select extensions.is(
  (select pg_temp.delivery_status(
    pg_temp.decision_event_for_fp(repeat('1', 64)),
    'fb410000-0000-4000-8000-0000000008c4'::uuid)),
  'completed', 'the decision delivery projects');

select extensions.is(
  (select i.memory_type || '/' || i.origin || '/' || i.verification_state || '/' || i.knowledge_kind
   from public.memory_items i
   join public.memory_capture_events e on e.id = i.capture_event_id
   where e.organization_id = 'fb410000-0000-4000-8000-000000000201'::uuid
     and e.growth_decision_id is not null),
  'decision/system_generated/unverified/operator_decision', 'the item carries the decision contract');

select extensions.ok(
  ((select pg_catalog.strpos(i.body, 'acknowledged')
    from public.memory_items i
    join public.memory_capture_events e on e.id = i.capture_event_id
    where e.organization_id = 'fb410000-0000-4000-8000-000000000201'::uuid
      and e.growth_decision_id is not null) > 0),
  'the body carries the recorded decision value');

select extensions.is(
  (select pg_temp.delivery_status(
    pg_temp.decision_event_for_fp(repeat('1', 64)),
    'fb410000-0000-4000-8000-0000000008c4'::uuid)),
  'replayed', 'a duplicate decision delivery replays');

select extensions.is(
  (select count(*)::integer from public.memory_items i
   join public.memory_capture_events e on e.id = i.capture_event_id
   where e.organization_id = 'fb410000-0000-4000-8000-000000000201'::uuid
     and e.growth_decision_id is not null),
  1, 'without a second decision row');

select * from extensions.finish();

rollback;
