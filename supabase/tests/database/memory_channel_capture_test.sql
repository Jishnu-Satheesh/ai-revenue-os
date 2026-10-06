begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(76);

-- Spec 023 Task A: channel capture adapters (finding, recommendation,
-- decision). Registry rows, projectors, and enqueue integrations inside the
-- existing fenced source RPCs. Posts to the queue run inside the source
-- transactions; projection runs through the leased complete_ path.
--
-- NOTE on environments: the three adapter migrations are pending review and
-- are NOT applied on shared staging yet, so this file is written against the
-- post-push shape. Calls to the six new private functions are wrapped in
-- pg_temp.state_of so a missing function reports a failure code instead of
-- aborting the script; every other assertion reads tables or long-lived RPCs
-- that exist already.

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

create or replace function pg_temp.finding(
  p_code text, p_calc text, p_channel text, p_branch text, p_start text, p_end text
)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'detectorKey', 'evidence.period_coverage', 'detectorVersion', 1,
    'kind', 'observation', 'code', p_code,
    'channelId', p_channel, 'branchId', p_branch,
    'periodStart', p_start, 'periodEnd', p_end,
    'qualityState', 'complete',
    'limitations', jsonb_build_array('fb37 bounded limitation.'),
    'calculationDigest', p_calc,
    'evidence', '[]'::jsonb);
$$;

create or replace function pg_temp.complete_analysis(p_run text, p_token text, p_findings jsonb, p_digest text)
returns jsonb language sql as $$
  select public.complete_channel_analysis(
    'fb370000-0000-4000-8000-000000000201'::uuid, p_run::uuid, p_token::uuid, p_digest, p_findings);
$$;

create or replace function pg_temp.rec_item(p_headline text, p_detail text, p_citations jsonb)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'label', 'recommendation', 'headline', p_headline, 'detail', p_detail,
    'supportedActions', jsonb_build_array('fb37 check the portal.'),
    'limitations', jsonb_build_array('fb37 advice limit.'),
    'citations', p_citations);
$$;

create or replace function pg_temp.complete_recs(p_run text, p_token text, p_items jsonb, p_digest text)
returns jsonb language sql as $$
  select public.complete_channel_recommendations(
    'fb370000-0000-4000-8000-000000000201'::uuid, p_run::uuid, p_token::uuid,
    'openai', 'gpt-test', 1, repeat('d', 64), repeat('e', 64), p_digest, p_items);
$$;

-- The narration lease table is writable by nobody, including service_role, so
-- tests stage leases through definer rights, exactly like the fence suite.
create or replace function pg_temp.stage_rec_lease(p_run text, p_corr text, p_token text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.channel_recommendation_operations (
    organization_id, analysis_run_id, correlation_id, claim_token, lease_expires_at
  ) values (
    'fb370000-0000-4000-8000-000000000201'::uuid, p_run::uuid, p_corr, p_token::uuid,
    now() + interval '10 minutes');
$$;

create or replace function pg_temp.set_capture(p_on boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.memory_integration_settings set capture_enabled = p_on
  where organization_id = 'fb370000-0000-4000-8000-000000000201'::uuid;
$$;

-- Delivery wrappers: a missing event (pre-push world) reports its code
-- instead of aborting the script; post-push they return the delivery outcome.
create or replace function pg_temp.delivery_status(p_org uuid, p_event uuid, p_token uuid)
returns text language plpgsql as $$
declare
  v_result jsonb;
begin
  select public.complete_memory_capture_event(p_org, p_event, p_token) into v_result;
  return v_result ->> 'status';
exception when others then
  return SQLSTATE;
end;
$$;

create or replace function pg_temp.delivery_item(p_org uuid, p_event uuid, p_token uuid)
returns text language plpgsql as $$
declare
  v_result jsonb;
begin
  select public.complete_memory_capture_event(p_org, p_event, p_token) into v_result;
  return v_result ->> 'projectedItemId';
exception when others then
  return SQLSTATE;
end;
$$;

-- Member sessions hold no grant on the queue table, so count reads go
-- through definer rights.
create or replace function pg_temp.decision_event_count()
returns integer
language sql
security definer
set search_path = ''
as $$
  select count(*)::integer from public.memory_capture_events
  where organization_id = 'fb370000-0000-4000-8000-000000000201'::uuid
    and source_kind = 'channel_decision' and event_kind = 'recorded';
$$;

-- Projector calls from a session-safe context: the private schema is
-- invisible to session roles, so tests reach projectors nested in definer
-- rights exactly as the worker path does. plpgsql bodies bind at call time,
-- so a still-pending migration reports through state_of instead of aborting
-- creation.
create or replace function pg_temp.project_finding(p_org uuid, p_event uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.project_memory_channel_finding(p_org, p_event);
end;
$$;

create or replace function pg_temp.retry_finding_enqueue()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.enqueue_memory_channel_findings(
    'fb370000-0000-4000-8000-000000000201'::uuid,
    'fb370000-0000-4000-8000-000000000611'::uuid);
end;
$$;

-- Fixtures -----------------------------------------------------------------------

insert into auth.users (id) values
  ('fb370000-0000-4000-8000-000000000001'::uuid),
  ('fb370000-0000-4000-8000-000000000002'::uuid);
insert into public.accounts (id, name, slug, created_by) values
  ('fb370000-0000-4000-8000-000000000101'::uuid, 'Channel capture verifier', 'channel-capture-verifier', 'fb370000-0000-4000-8000-000000000001'::uuid),
  ('fb370000-0000-4000-8000-000000000102'::uuid, 'Channel capture outsider', 'channel-capture-outsider', 'fb370000-0000-4000-8000-000000000002'::uuid);
insert into public.organizations (id, account_id, name, slug, industry, country_code, base_currency, default_timezone, created_by) values
  ('fb370000-0000-4000-8000-000000000201'::uuid, 'fb370000-0000-4000-8000-000000000101'::uuid, 'Channel capture verifier', 'channel-capture-verifier', 'testing', 'AE', 'AED', 'Asia/Dubai', 'fb370000-0000-4000-8000-000000000001'::uuid),
  ('fb370000-0000-4000-8000-000000000202'::uuid, 'fb370000-0000-4000-8000-000000000102'::uuid, 'Channel capture outsider', 'channel-capture-outsider', 'testing', 'AE', 'AED', 'Asia/Dubai', 'fb370000-0000-4000-8000-000000000002'::uuid);
insert into public.account_memberships (account_id, user_id, account_role, default_organization_role) values
  ('fb370000-0000-4000-8000-000000000101'::uuid, 'fb370000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner'),
  ('fb370000-0000-4000-8000-000000000102'::uuid, 'fb370000-0000-4000-8000-000000000002'::uuid, 'owner', 'owner');

insert into public.branches (id, organization_id, name, slug, kind, timezone, currency)
values ('fb370000-0000-4000-8000-000000000301'::uuid, 'fb370000-0000-4000-8000-000000000201'::uuid, 'Dubai outlet', 'channel-capture-dubai', 'physical', 'Asia/Dubai', 'AED');
insert into public.organization_channels (id, organization_id, key, display_name, category, created_by) values
  ('fb370000-0000-4000-8000-000000000401'::uuid, 'fb370000-0000-4000-8000-000000000201'::uuid, 'talabat', 'Talabat', 'marketplace', 'fb370000-0000-4000-8000-000000000001'::uuid);
insert into public.branches (id, organization_id, name, slug, kind, timezone, currency)
values ('fb370000-0000-4000-8000-000000000302'::uuid, 'fb370000-0000-4000-8000-000000000202'::uuid, 'Outsider outlet', 'channel-capture-outsider-outlet', 'physical', 'Asia/Dubai', 'AED');
insert into public.organization_channels (id, organization_id, key, display_name, category, created_by) values
  ('fb370000-0000-4000-8000-000000000402'::uuid, 'fb370000-0000-4000-8000-000000000202'::uuid, 'talabat', 'Talabat', 'marketplace', 'fb370000-0000-4000-8000-000000000002'::uuid);

insert into public.memory_integration_settings (organization_id, capture_enabled) values
  ('fb370000-0000-4000-8000-000000000201'::uuid, true);

-- Running analysis runs plus their worker lease rows; completions below drive
-- the enqueue paths. 611/612 share scope and window (supersession), 613 is a
-- later window (history), 614 runs while capture is disabled, 615 feeds the
-- uncited-narration refusal.
insert into public.channel_analysis_runs (
  id, organization_id, channel_id, branch_id, window_start, window_end, period_grain,
  window_timezone, registry_version, detector_versions, metric_versions, input_digest,
  status, correlation_id
) values
  ('fb370000-0000-4000-8000-000000000611'::uuid, 'fb370000-0000-4000-8000-000000000201'::uuid,
   'fb370000-0000-4000-8000-000000000401'::uuid, 'fb370000-0000-4000-8000-000000000301'::uuid,
   date '2026-01-01', date '2026-01-05', 'day', 'Asia/Dubai', 1,
   '[{"key":"evidence.period_coverage","calculationVersion":1}]'::jsonb, '[]'::jsonb,
   repeat('a', 64), 'running', 'fb370000-0000-4000-8000-000000000911'::uuid),
  ('fb370000-0000-4000-8000-000000000612'::uuid, 'fb370000-0000-4000-8000-000000000201'::uuid,
   'fb370000-0000-4000-8000-000000000401'::uuid, 'fb370000-0000-4000-8000-000000000301'::uuid,
   date '2026-01-01', date '2026-01-05', 'day', 'Asia/Dubai', 1,
   '[{"key":"evidence.period_coverage","calculationVersion":1}]'::jsonb, '[]'::jsonb,
   repeat('b', 64), 'running', 'fb370000-0000-4000-8000-000000000912'::uuid),
  ('fb370000-0000-4000-8000-000000000613'::uuid, 'fb370000-0000-4000-8000-000000000201'::uuid,
   'fb370000-0000-4000-8000-000000000401'::uuid, 'fb370000-0000-4000-8000-000000000301'::uuid,
   date '2026-02-01', date '2026-02-05', 'day', 'Asia/Dubai', 1,
   '[{"key":"evidence.period_coverage","calculationVersion":1}]'::jsonb, '[]'::jsonb,
   repeat('c', 64), 'running', 'fb370000-0000-4000-8000-000000000913'::uuid),
  ('fb370000-0000-4000-8000-000000000614'::uuid, 'fb370000-0000-4000-8000-000000000201'::uuid,
   'fb370000-0000-4000-8000-000000000401'::uuid, 'fb370000-0000-4000-8000-000000000301'::uuid,
   date '2026-03-01', date '2026-03-05', 'day', 'Asia/Dubai', 1,
   '[{"key":"evidence.period_coverage","calculationVersion":1}]'::jsonb, '[]'::jsonb,
   repeat('d', 64), 'running', 'fb370000-0000-4000-8000-000000000914'::uuid),
  ('fb370000-0000-4000-8000-000000000615'::uuid, 'fb370000-0000-4000-8000-000000000201'::uuid,
   'fb370000-0000-4000-8000-000000000401'::uuid, 'fb370000-0000-4000-8000-000000000301'::uuid,
   date '2026-04-01', date '2026-04-05', 'day', 'Asia/Dubai', 1,
   '[{"key":"evidence.period_coverage","calculationVersion":1}]'::jsonb, '[]'::jsonb,
   repeat('e', 64), 'running', 'fb370000-0000-4000-8000-000000000915'::uuid);

insert into private.channel_analysis_operations (
  organization_id, analysis_run_id, idempotency_key, input_digest, claim_token, lease_expires_at
) values
  ('fb370000-0000-4000-8000-000000000201'::uuid, 'fb370000-0000-4000-8000-000000000611'::uuid,
   'fb37-analysis-run-611', repeat('a', 64), 'fb370000-0000-4000-8000-0000000008a1'::uuid, now() + interval '1 hour'),
  ('fb370000-0000-4000-8000-000000000201'::uuid, 'fb370000-0000-4000-8000-000000000612'::uuid,
   'fb37-analysis-run-612', repeat('b', 64), 'fb370000-0000-4000-8000-0000000008a2'::uuid, now() + interval '1 hour'),
  ('fb370000-0000-4000-8000-000000000201'::uuid, 'fb370000-0000-4000-8000-000000000613'::uuid,
   'fb37-analysis-run-613', repeat('c', 64), 'fb370000-0000-4000-8000-0000000008a3'::uuid, now() + interval '1 hour'),
  ('fb370000-0000-4000-8000-000000000201'::uuid, 'fb370000-0000-4000-8000-000000000614'::uuid,
   'fb37-analysis-run-614', repeat('d', 64), 'fb370000-0000-4000-8000-0000000008a4'::uuid, now() + interval '1 hour'),
  ('fb370000-0000-4000-8000-000000000201'::uuid, 'fb370000-0000-4000-8000-000000000615'::uuid,
   'fb37-analysis-run-615', repeat('e', 64), 'fb370000-0000-4000-8000-0000000008a5'::uuid, now() + interval '1 hour');

-- Outsider-owned source rows, so cross-tenant refusals below meet real rows.
insert into public.channel_analysis_runs (
  id, organization_id, channel_id, branch_id, window_start, window_end, period_grain,
  window_timezone, registry_version, detector_versions, metric_versions, input_digest,
  status, result_digest, correlation_id, completed_at
) values (
  'fb370000-0000-4000-8000-000000000622'::uuid, 'fb370000-0000-4000-8000-000000000202'::uuid,
  'fb370000-0000-4000-8000-000000000402'::uuid, 'fb370000-0000-4000-8000-000000000302'::uuid,
  date '2026-01-01', date '2026-01-05', 'day', 'Asia/Dubai', 1,
  '[{"key":"evidence.period_coverage","calculationVersion":1}]'::jsonb, '[]'::jsonb,
  repeat('f', 64), 'completed', repeat('1', 64),
  'fb370000-0000-4000-8000-000000000922'::uuid, now());

insert into public.channel_findings (
  id, organization_id, analysis_run_id, channel_id, branch_id, detector_key, detector_version,
  kind, code, quality_state, calculation_digest
) values (
  'fb370000-0000-4000-8000-000000000721'::uuid, 'fb370000-0000-4000-8000-000000000202'::uuid,
  'fb370000-0000-4000-8000-000000000622'::uuid, 'fb370000-0000-4000-8000-000000000402'::uuid,
  'fb370000-0000-4000-8000-000000000302'::uuid, 'evidence.period_coverage', 1, 'observation',
  'PERIOD_COVERAGE_INCOMPLETE', 'complete', repeat('2', 64));

insert into public.channel_recommendations (
  id, organization_id, channel_id, branch_id, analysis_run_id, window_start, window_end,
  period_grain, label, headline, detail, supported_actions, limitations, prompt_version,
  prompt_digest, output_digest, provider, model_id, result_digest
) values (
  'fb370000-0000-4000-8000-000000000722'::uuid, 'fb370000-0000-4000-8000-000000000202'::uuid,
  'fb370000-0000-4000-8000-000000000402'::uuid, 'fb370000-0000-4000-8000-000000000302'::uuid,
  'fb370000-0000-4000-8000-000000000622'::uuid, date '2026-01-01', date '2026-01-05', 'day',
  'observation', 'Outsider narration', 'Filed by the neighbouring tenant.',
  '[]'::jsonb, '[]'::jsonb, 1, repeat('3', 64), repeat('4', 64), 'openai', 'gpt-test', repeat('5', 64));

insert into public.channel_recommendation_decisions (
  organization_id, recommendation_id, decision, actor_id
) values (
  'fb370000-0000-4000-8000-000000000202'::uuid, 'fb370000-0000-4000-8000-000000000722'::uuid,
  'acknowledged', 'fb370000-0000-4000-8000-000000000002'::uuid);

-- Adapters are registered, projectable, and fenced --------------------------------

select extensions.has_function(
  'private', 'project_memory_channel_finding',
  'the finding projector exists where complete_ dispatches it');
select extensions.has_function(
  'private', 'project_memory_channel_recommendation',
  'so does the recommendation projector');
select extensions.has_function(
  'private', 'project_memory_channel_decision',
  'and the decision projector');
select extensions.has_function(
  'private', 'enqueue_memory_channel_findings',
  'the finding enqueue helper exists');
select extensions.has_function(
  'private', 'enqueue_memory_channel_recommendations',
  'so does the recommendation enqueue helper');
select extensions.has_function(
  'private', 'enqueue_memory_channel_decision',
  'and the decision enqueue helper');
select extensions.is(
  (select count(*)::integer from public.memory_capture_adapters
   where source_kind in ('channel_finding', 'channel_recommendation', 'channel_decision')
     and registered),
  3, 'all three channel kinds are registered');
select extensions.is(
  pg_temp.priv_of('service_role', 'public.complete_channel_analysis(uuid,uuid,uuid,text,jsonb)'),
  'true', 'the fenced analysis completion still belongs to the worker');
select extensions.is(
  pg_temp.priv_of('authenticated', 'public.complete_channel_analysis(uuid,uuid,uuid,text,jsonb)'),
  'false', 'members still cannot write findings directly');
select extensions.is(
  pg_temp.priv_of('authenticated', 'public.triage_channel_recommendation(uuid,uuid,text,text,uuid,timestamptz)'),
  'true', 'members still hold the triage path');
select extensions.is(
  pg_temp.priv_of('service_role', 'public.triage_channel_recommendation(uuid,uuid,text,text,uuid,timestamptz)'),
  'false', 'the worker still never triages on anyones behalf');
select extensions.is(
  pg_temp.priv_of('authenticated', 'private.project_memory_channel_finding(uuid,uuid)') || '/'
    || pg_temp.priv_of('authenticated', 'private.project_memory_channel_recommendation(uuid,uuid)') || '/'
    || pg_temp.priv_of('authenticated', 'private.project_memory_channel_decision(uuid,uuid)'),
  'false/false/false', 'no session reaches a projector directly');

-- Cross-tenant sources cannot back this organizations events ------------------------

select extensions.is(
  pg_temp.state_of($$ insert into public.memory_capture_events (
      id, organization_id, source_kind, channel_finding_id,
      source_revision, source_digest, correlation_id
    ) values (
      'fb370000-0000-4000-8000-0000000008d1', 'fb370000-0000-4000-8000-000000000201',
      'channel_finding', 'fb370000-0000-4000-8000-000000000721',
      1, repeat('a', 64), pg_catalog.gen_random_uuid()) $$),
  '23503', 'another organizations finding cannot back this organizations event');
select extensions.is(
  pg_temp.state_of($$ insert into public.memory_capture_events (
      id, organization_id, source_kind, channel_recommendation_id,
      source_revision, source_digest, correlation_id
    ) values (
      'fb370000-0000-4000-8000-0000000008d2', 'fb370000-0000-4000-8000-000000000201',
      'channel_recommendation', 'fb370000-0000-4000-8000-000000000722',
      1, repeat('b', 64), pg_catalog.gen_random_uuid()) $$),
  '23503', 'nor can another organizations recommendation');
select extensions.is(
  pg_temp.state_of($$ insert into public.memory_capture_events (
      id, organization_id, source_kind, channel_decision_id,
      source_revision, source_digest, correlation_id
    ) values (
      'fb370000-0000-4000-8000-0000000008d3', 'fb370000-0000-4000-8000-000000000201',
      'channel_decision', (select id from public.channel_recommendation_decisions
        where organization_id = 'fb370000-0000-4000-8000-000000000202'::uuid),
      1, repeat('c', 64), pg_catalog.gen_random_uuid()) $$),
  '23503', 'nor can another organizations decision');

-- Finding capture: completion enqueues, failure enqueues nothing ------------------

set local role service_role;

select extensions.is(
  (pg_temp.complete_analysis('fb370000-0000-4000-8000-000000000611',
    'fb370000-0000-4000-8000-0000000008a1',
    jsonb_build_array(
      pg_temp.finding('PERIOD_COVERAGE_INCOMPLETE', repeat('a', 64),
        'fb370000-0000-4000-8000-000000000401', 'fb370000-0000-4000-8000-000000000301',
        '2026-01-01', '2026-01-05'),
      pg_temp.finding('COVERAGE_SECOND_OBSERVATION', repeat('c', 64),
        'fb370000-0000-4000-8000-000000000401', 'fb370000-0000-4000-8000-000000000301',
        '2026-01-01', '2026-01-05')),
    repeat('b', 64)) ->> 'status'),
  'completed', 'the first run completes');
select extensions.is(
  (select count(*)::integer from public.memory_capture_events e
   where e.organization_id = 'fb370000-0000-4000-8000-000000000201'::uuid
     and e.source_kind = 'channel_finding' and e.event_kind = 'recorded'
     and e.channel_finding_id in (select f.id from public.channel_findings f
       where f.analysis_run_id = 'fb370000-0000-4000-8000-000000000611'::uuid)),
  2, 'completion enqueues exactly that runs findings');
select extensions.is(
  (select count(*)::integer from public.memory_capture_events e
   where e.organization_id = 'fb370000-0000-4000-8000-000000000201'::uuid
     and e.source_kind = 'channel_finding' and e.event_kind = 'recorded'
     and e.source_revision <> 1),
  0, 'first recordings start at revision one');
select extensions.ok(
  (pg_temp.complete_analysis('fb370000-0000-4000-8000-000000000611',
    'fb370000-0000-4000-8000-0000000008ff',
    jsonb_build_array(pg_temp.finding('PERIOD_COVERAGE_INCOMPLETE', repeat('a', 64),
      'fb370000-0000-4000-8000-000000000401', 'fb370000-0000-4000-8000-000000000301',
      '2026-01-01', '2026-01-05')),
    repeat('b', 64)) is null),
  'a claim token the worker does not hold writes nothing');

select extensions.is(
  (select count(*)::integer from public.memory_capture_events e
   where e.organization_id = 'fb370000-0000-4000-8000-000000000201'::uuid
     and e.source_kind = 'channel_finding' and e.event_kind = 'recorded'
     and e.channel_finding_id in (select f.id from public.channel_findings f
       where f.analysis_run_id = 'fb370000-0000-4000-8000-000000000611'::uuid)),
  2, 'the refused completion enqueues nothing');
select extensions.throws_ok(
  $$ select pg_temp.complete_analysis('fb370000-0000-4000-8000-000000000612',
    'fb370000-0000-4000-8000-0000000008a2',
    jsonb_build_array(pg_temp.finding('PERIOD_COVERAGE_INCOMPLETE', repeat('a', 64),
      'fb370000-0000-4000-8000-000000000401', 'fb370000-0000-4000-8000-000000000301',
      '2026-01-01', '2026-01-05') || '{"invented": 1}'::jsonb),
    repeat('c', 64)) $$,
  '22023', 'channel analysis finding is invalid',
  'an unknown field refuses the whole submission');
select extensions.is(
  (select count(*)::integer from public.memory_capture_events
   where organization_id = 'fb370000-0000-4000-8000-000000000201'::uuid
     and source_kind = 'channel_finding'),
  2, 'the rolled-back submission leaves no capture behind');
select extensions.is(
  pg_temp.state_of($$ select pg_temp.retry_finding_enqueue() $$),
  'no-error', 'the enqueue helper runs');
select extensions.is(
  (select count(*)::integer from public.memory_capture_events
   where organization_id = 'fb370000-0000-4000-8000-000000000201'::uuid
     and source_kind = 'channel_finding'),
  2, 'an unchanged re-completion mints no new revision');

-- Supersession withdraws; a new window stays history --------------------------------

select extensions.is(
  (pg_temp.complete_analysis('fb370000-0000-4000-8000-000000000612',
    'fb370000-0000-4000-8000-0000000008a2',
    jsonb_build_array(pg_temp.finding('COVERAGE_SUPERSEDING_VIEW', repeat('d', 64),
      'fb370000-0000-4000-8000-000000000401', 'fb370000-0000-4000-8000-000000000301',
      '2026-01-01', '2026-01-05')),
    repeat('c', 64)) ->> 'status'),
  'completed', 'the same-scope rerun completes');
select extensions.is(
  (select count(*)::integer from public.channel_findings
   where analysis_run_id = 'fb370000-0000-4000-8000-000000000611'::uuid
     and status = 'superseded'),
  2, 'its findings are superseded');
select extensions.is(
  (select count(*)::integer from public.memory_capture_events e
   where e.organization_id = 'fb370000-0000-4000-8000-000000000201'::uuid
     and e.source_kind = 'channel_finding' and e.event_kind = 'withdrawn'
     and e.channel_finding_id in (select f.id from public.channel_findings f
       where f.analysis_run_id = 'fb370000-0000-4000-8000-000000000611'::uuid)),
  2, 'supersession enqueues withdrawal for the superseded identities');
select extensions.is(
  (pg_temp.complete_analysis('fb370000-0000-4000-8000-000000000613',
    'fb370000-0000-4000-8000-0000000008a3',
    jsonb_build_array(
      pg_temp.finding('COVERAGE_EDGE_PRIMARY', repeat('e', 64),
        'fb370000-0000-4000-8000-000000000401', 'fb370000-0000-4000-8000-000000000301',
        '2026-02-01', '2026-02-05'),
      pg_temp.finding('COVERAGE_EDGE_SECONDARY', repeat('f', 64),
        'fb370000-0000-4000-8000-000000000401', 'fb370000-0000-4000-8000-000000000301',
        '2026-02-01', '2026-02-05'),
      pg_temp.finding('COVERAGE_EDGE_TERTIARY', repeat('9', 64),
        'fb370000-0000-4000-8000-000000000401', 'fb370000-0000-4000-8000-000000000301',
        '2026-02-01', '2026-02-05')),
    repeat('1', 64)) ->> 'status'),
  'completed', 'the later-window run completes');
select extensions.is(
  (select status from public.channel_findings
   where analysis_run_id = 'fb370000-0000-4000-8000-000000000612'::uuid),
  'open', 'a different reporting window is history, not supersession');
select extensions.is(
  (select count(*)::integer from public.memory_capture_events e
   where e.organization_id = 'fb370000-0000-4000-8000-000000000201'::uuid
     and e.source_kind = 'channel_finding' and e.event_kind = 'withdrawn'
     and e.channel_finding_id in (select f.id from public.channel_findings f
       where f.analysis_run_id = 'fb370000-0000-4000-8000-000000000612'::uuid)),
  0, 'so it enqueues no withdrawal');

-- Disabled capture stays silent; the source feature works as before -------------------

select pg_temp.set_capture(false);

select extensions.is(
  (pg_temp.complete_analysis('fb370000-0000-4000-8000-000000000614',
    'fb370000-0000-4000-8000-0000000008a4',
    jsonb_build_array(pg_temp.finding('COVERAGE_DISABLED_RUN', repeat('0', 64),
      'fb370000-0000-4000-8000-000000000401', 'fb370000-0000-4000-8000-000000000301',
      '2026-03-01', '2026-03-05')),
    repeat('2', 64)) ->> 'status'),
  'completed', 'analysis still completes while capture is disabled');
select extensions.is(
  (select count(*)::integer from public.memory_capture_events e
   where e.organization_id = 'fb370000-0000-4000-8000-000000000201'::uuid
     and e.channel_finding_id in (select f.id from public.channel_findings f
       where f.analysis_run_id = 'fb370000-0000-4000-8000-000000000614'::uuid)),
  0, 'but it enqueues nothing');

select pg_temp.set_capture(true);

select extensions.is(
  (pg_temp.complete_analysis('fb370000-0000-4000-8000-000000000615',
    'fb370000-0000-4000-8000-0000000008a5',
    jsonb_build_array(pg_temp.finding('COVERAGE_EMPTY_CITATION_RUN', repeat('8', 64),
      'fb370000-0000-4000-8000-000000000401', 'fb370000-0000-4000-8000-000000000301',
      '2026-04-01', '2026-04-05')),
    repeat('3', 64)) ->> 'status'),
  'completed', 'capture resumes once re-enabled');

-- Finding projection through the leased path ------------------------------------------

select extensions.is(
  (select public.claim_memory_capture_events('fb370000-0000-4000-8000-000000000201'::uuid,
    'fb370000-0000-4000-8000-0000000008c1'::uuid, 25, 120) ->> 'captureIds' is not null),
  true, 'due work claims');
select extensions.is(
  (select pg_temp.delivery_status('fb370000-0000-4000-8000-000000000201'::uuid,
    (select e.id from public.memory_capture_events e
     join public.channel_findings f on f.id = e.channel_finding_id
     where f.analysis_run_id = 'fb370000-0000-4000-8000-000000000613'::uuid
     order by f.id limit 1),
    'fb370000-0000-4000-8000-0000000008c1'::uuid)),
  'completed', 'the finding delivery projects');

select extensions.is(
  (select i.memory_type || '/' || i.origin || '/' || i.verification_state || '/' || i.knowledge_kind
   from public.memory_items i
   where i.capture_event_id = (select e.id from public.memory_capture_events e
     join public.channel_findings f on f.id = e.channel_finding_id
     where f.analysis_run_id = 'fb370000-0000-4000-8000-000000000613'::uuid
     order by f.id limit 1)),
  'episode/system_generated/unverified/observation', 'the item carries the finding contract');
select extensions.is(
  (select i.capture_event_id = e.id and e.projected_item_id = i.id
   from public.memory_items i
   join public.memory_capture_events e on e.id = i.capture_event_id
   join public.channel_findings f on f.id = e.channel_finding_id
   where f.analysis_run_id = 'fb370000-0000-4000-8000-000000000613'::uuid
   order by f.id limit 1),
  true, 'item and event link back to each other');
select extensions.is(
  (select i.branch_id from public.memory_items i
   join public.memory_capture_events e on e.id = i.capture_event_id
   join public.channel_findings f on f.id = e.channel_finding_id
   where f.analysis_run_id = 'fb370000-0000-4000-8000-000000000613'::uuid
   order by f.id limit 1),
  'fb370000-0000-4000-8000-000000000301'::uuid, 'the source branch scope survives projection');
select extensions.is(
  (select pg_temp.delivery_status('fb370000-0000-4000-8000-000000000201'::uuid,
    (select e.id from public.memory_capture_events e
     join public.channel_findings f on f.id = e.channel_finding_id
     where f.analysis_run_id = 'fb370000-0000-4000-8000-000000000613'::uuid
     order by f.id limit 1),
    'fb370000-0000-4000-8000-0000000008c1'::uuid)),
  'replayed', 'a duplicate delivery replays');
select extensions.is(
  (select count(*)::integer from public.memory_items i
   join public.memory_capture_events e on e.id = i.capture_event_id
   join public.channel_findings f on f.id = e.channel_finding_id
   where f.analysis_run_id = 'fb370000-0000-4000-8000-000000000613'::uuid),
  1, 'without a second row');
select extensions.is(
  (select pg_temp.delivery_status('fb370000-0000-4000-8000-000000000201'::uuid,
    (select e.id from public.memory_capture_events e
     join public.channel_findings f on f.id = e.channel_finding_id
     where f.analysis_run_id = 'fb370000-0000-4000-8000-000000000611'::uuid
       and e.event_kind = 'recorded'
     order by f.id limit 1),
    'fb370000-0000-4000-8000-0000000008c1'::uuid)),
  'obsolete', 'an older delivery after a newer revision goes obsolete');
select extensions.is(
  (select pg_temp.delivery_status('fb370000-0000-4000-8000-000000000201'::uuid,
    (select e.id from public.memory_capture_events e
     join public.channel_findings f on f.id = e.channel_finding_id
     where f.analysis_run_id = 'fb370000-0000-4000-8000-000000000611'::uuid
       and e.event_kind = 'withdrawn'
     order by f.id limit 1),
    'fb370000-0000-4000-8000-0000000008c1'::uuid)),
  'completed', 'the withdrawal itself completes');
select extensions.ok(
  (pg_temp.delivery_item('fb370000-0000-4000-8000-000000000201'::uuid,
    (select e.id from public.memory_capture_events e
     join public.channel_findings f on f.id = e.channel_finding_id
     where f.analysis_run_id = 'fb370000-0000-4000-8000-000000000611'::uuid
       and e.event_kind = 'withdrawn'
     order by f.id limit 1),
    'fb370000-0000-4000-8000-0000000008c1'::uuid) is null),
  'projecting no new item');

-- Recommendation capture: narration and gap-fill enqueue -------------------------------

select pg_temp.stage_rec_lease('fb370000-0000-4000-8000-000000000613', 'fb37-rec-613',
  'fb370000-0000-4000-8000-0000000008b1');

select extensions.is(
  (pg_temp.complete_recs('fb370000-0000-4000-8000-000000000613',
    'fb370000-0000-4000-8000-0000000008b1',
    jsonb_build_array(pg_temp.rec_item('fb37 edge primary advice', 'fb37 edge primary detail.',
      jsonb_build_array((select f.id::text from public.channel_findings f
        where f.analysis_run_id = 'fb370000-0000-4000-8000-000000000613'::uuid
        order by f.id limit 1)))),
    repeat('6', 64)) ->> 'recommendationCount'),
  '1', 'the narration files');
select extensions.is(
  (select count(*)::integer from public.memory_capture_events e
   where e.organization_id = 'fb370000-0000-4000-8000-000000000201'::uuid
     and e.source_kind = 'channel_recommendation' and e.event_kind = 'recorded'),
  1, 'one narration, one event');
select extensions.is(
  (select e.reuse_class from public.memory_capture_events e
   join public.channel_recommendations r on r.id = e.channel_recommendation_id
   where r.headline = 'fb37 edge primary advice'),
  'metadata_only', 'narrative bodies stay metadata_only until grounding is qualified');
select extensions.is(
  (select count(*)::integer from public.memory_capture_dependencies d
   join public.memory_capture_events e on e.id = d.capture_event_id
   join public.channel_recommendations r on r.id = e.channel_recommendation_id
   where r.headline = 'fb37 edge primary advice' and d.relation = 'derived_from'),
  1, 'the cited completed finding links as derived_from');

select pg_temp.stage_rec_lease('fb370000-0000-4000-8000-000000000613', 'fb37-rec-613-gapfill',
  'fb370000-0000-4000-8000-0000000008b2');

select extensions.is(
  (pg_temp.complete_recs('fb370000-0000-4000-8000-000000000613',
    'fb370000-0000-4000-8000-0000000008b2',
    jsonb_build_array(pg_temp.rec_item('fb37 edge secondary advice', 'fb37 edge secondary detail.',
      jsonb_build_array((select f.id::text from public.channel_findings f
        where f.analysis_run_id = 'fb370000-0000-4000-8000-000000000613'::uuid
        order by f.id limit 1 offset 1)))),
    repeat('7', 64)) ->> 'recommendationCount'),
  '1', 'the gap-fill files');
select extensions.is(
  (select count(*)::integer from public.memory_capture_events e
   where e.organization_id = 'fb370000-0000-4000-8000-000000000201'::uuid
     and e.source_kind = 'channel_recommendation' and e.event_kind = 'recorded'),
  2, 'the gap-fill addition enqueues; the earlier telling is not duplicated');
select extensions.is(
  (select count(*)::integer from public.memory_capture_dependencies d
   join public.memory_capture_events e on e.id = d.capture_event_id
   join public.channel_recommendations r on r.id = e.channel_recommendation_id
   where r.headline = 'fb37 edge secondary advice'),
  0, 'with no completed parent yet, no edge is forced');
select extensions.ok(
  (pg_temp.complete_recs('fb370000-0000-4000-8000-000000000613',
    'fb370000-0000-4000-8000-0000000008ff',
    jsonb_build_array(pg_temp.rec_item('fb37 edge tertiary advice', 'fb37 edge tertiary detail.',
      jsonb_build_array((select f.id::text from public.channel_findings f
        where f.analysis_run_id = 'fb370000-0000-4000-8000-000000000613'::uuid
        order by f.id limit 1 offset 2)))),
    repeat('9', 64)) is null),
  'a narration lease the worker does not hold files nothing');

select extensions.is(
  (select count(*)::integer from public.memory_capture_events e
   where e.organization_id = 'fb370000-0000-4000-8000-000000000201'::uuid
     and e.source_kind = 'channel_recommendation' and e.event_kind = 'recorded'),
  2, 'the refused narration enqueues nothing');
select extensions.throws_ok(
  $$ select pg_temp.complete_recs('fb370000-0000-4000-8000-000000000613',
    'fb370000-0000-4000-8000-0000000008b2',
    (select jsonb_agg(pg_temp.rec_item('fb37 overfull advice', 'fb37 overfull detail.', '[]'::jsonb))
     from generate_series(1, 9)),
    repeat('0', 64)) $$,
  'P0001', 'RECOMMENDATION_CAP_EXCEEDED',
  'the eight-item cap survives the capture slice');

-- The narration enqueued after the first claim; reclaim under a fresh token.
select public.claim_memory_capture_events('fb370000-0000-4000-8000-000000000201'::uuid,
  'fb370000-0000-4000-8000-0000000008c2'::uuid, 25, 120);

select extensions.is(
  (select pg_temp.delivery_status('fb370000-0000-4000-8000-000000000201'::uuid,
    (select e.id from public.memory_capture_events e
     join public.channel_recommendations r on r.id = e.channel_recommendation_id
     where r.headline = 'fb37 edge primary advice'),
    'fb370000-0000-4000-8000-0000000008c2'::uuid)),
  'completed', 'the recommendation delivery projects');
select extensions.is(
  (select i.memory_type || '/' || i.origin || '/' || i.verification_state || '/' || i.knowledge_kind
   from public.memory_items i
   join public.memory_capture_events e on e.id = i.capture_event_id
   join public.channel_recommendations r on r.id = e.channel_recommendation_id
   where r.headline = 'fb37 edge primary advice'),
  'episode/ai_proposed/unverified/recommendation', 'the item carries the recommendation contract');
select extensions.is(
  (select pg_catalog.strpos(i.body, 'fb37 edge primary detail.')
   from public.memory_items i
   join public.memory_capture_events e on e.id = i.capture_event_id
   join public.channel_recommendations r on r.id = e.channel_recommendation_id
   where r.headline = 'fb37 edge primary advice'),
  0, 'the narrative detail never reaches memory');
select extensions.is(
  (select i.capture_event_id = e.id and e.projected_item_id = i.id
   from public.memory_items i
   join public.memory_capture_events e on e.id = i.capture_event_id
   join public.channel_recommendations r on r.id = e.channel_recommendation_id
   where r.headline = 'fb37 edge primary advice'),
  true, 'recommendation item and event link back to each other');
select extensions.is(
  (select pg_temp.delivery_status('fb370000-0000-4000-8000-000000000201'::uuid,
    (select e.id from public.memory_capture_events e
     join public.channel_recommendations r on r.id = e.channel_recommendation_id
     where r.headline = 'fb37 edge primary advice'),
    'fb370000-0000-4000-8000-0000000008c2'::uuid)),
  'replayed', 'a duplicate recommendation delivery replays');
select extensions.is(
  (select count(*)::integer from public.memory_items i
   join public.memory_capture_events e on e.id = i.capture_event_id
   join public.channel_recommendations r on r.id = e.channel_recommendation_id
   where r.headline = 'fb37 edge primary advice'),
  1, 'without a second recommendation row');
select extensions.is(
  (select pg_temp.delivery_status('fb370000-0000-4000-8000-000000000201'::uuid,
    (select e.id from public.memory_capture_events e
     join public.channel_recommendations r on r.id = e.channel_recommendation_id
     where r.headline = 'fb37 edge secondary advice'),
    'fb370000-0000-4000-8000-0000000008c2'::uuid)),
  'completed', 'the gap-fill delivery projects too');

-- An uncited narration carries no provenance to project -------------------------------

select pg_temp.stage_rec_lease('fb370000-0000-4000-8000-000000000615', 'fb37-rec-615',
  'fb370000-0000-4000-8000-0000000008b3');

select extensions.is(
  (pg_temp.complete_recs('fb370000-0000-4000-8000-000000000615',
    'fb370000-0000-4000-8000-0000000008b3',
    jsonb_build_array(pg_temp.rec_item('fb37 uncited advice', 'fb37 uncited detail.', '[]'::jsonb)),
    repeat('8', 64)) ->> 'recommendationCount'),
  '1', 'a narration may still file with no citations');
select extensions.is(
  (select count(*)::integer from public.memory_capture_events e
   join public.channel_recommendations r on r.id = e.channel_recommendation_id
   where r.headline = 'fb37 uncited advice'),
  1, 'and it still enqueues');

-- The uncited event is newer than the last claim; claim it before delivery.
select public.claim_memory_capture_events('fb370000-0000-4000-8000-000000000201'::uuid,
  'fb370000-0000-4000-8000-0000000008c3'::uuid, 25, 120);

select extensions.is(
  pg_temp.state_of($$ select public.complete_memory_capture_event(
    'fb370000-0000-4000-8000-000000000201'::uuid,
    (select e.id from public.memory_capture_events e
     join public.channel_recommendations r on r.id = e.channel_recommendation_id
     where r.headline = 'fb37 uncited advice'),
    'fb370000-0000-4000-8000-0000000008c3'::uuid) $$),
  '23514', 'but projection refuses it without provenance');

-- Decision capture: triage appends exactly one event ------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'fb370000-0000-4000-8000-000000000001';

select extensions.lives_ok(
  $$ select public.triage_channel_recommendation('fb370000-0000-4000-8000-000000000201'::uuid,
    (select id from public.channel_recommendations where headline = 'fb37 edge primary advice'),
    'acknowledged', null, 'fb370000-0000-4000-8000-000000000001'::uuid, null) $$,
  'an owner acknowledges the narrated advice');
select extensions.is(
  pg_temp.decision_event_count(),
  1, 'the accepted append enqueues exactly one event');
select extensions.lives_ok(
  $$ select public.triage_channel_recommendation('fb370000-0000-4000-8000-000000000201'::uuid,
    (select id from public.channel_recommendations where headline = 'fb37 edge primary advice'),
    'planned', null, 'fb370000-0000-4000-8000-000000000001'::uuid, null) $$,
  'a later answer on the same target appends');
select extensions.is(
  pg_temp.decision_event_count(),
  2, 'as a new revision; history keeps both');
select extensions.lives_ok(
  $$ select public.record_channel_recommendation_feedback(
    'fb370000-0000-4000-8000-000000000201'::uuid,
    (select id from public.channel_recommendations where headline = 'fb37 edge primary advice'),
    true, 'fb370000-0000-4000-8000-000000000001'::uuid) $$,
  'a personal helpfulness vote still records');

reset role;
set local role service_role;

create temp table fb37_event_count as
select count(*)::integer as n from public.memory_capture_events
where organization_id = 'fb370000-0000-4000-8000-000000000201'::uuid;

select extensions.is(
  (select count(*)::integer from public.memory_capture_events
   where organization_id = 'fb370000-0000-4000-8000-000000000201'::uuid),
  (select n from fb37_event_count), 'the vote enqueues nothing');

-- The triage enqueued after the last claim; claim before delivery.
select public.claim_memory_capture_events('fb370000-0000-4000-8000-000000000201'::uuid,
  'fb370000-0000-4000-8000-0000000008c4'::uuid, 25, 120);

select extensions.is(
  (select pg_temp.delivery_status('fb370000-0000-4000-8000-000000000201'::uuid,
    (select e.id from public.memory_capture_events e
     join public.channel_recommendation_decisions d on d.id = e.channel_decision_id
     where d.organization_id = 'fb370000-0000-4000-8000-000000000201'::uuid
       and d.decision = 'acknowledged'
     order by d.created_at limit 1),
    'fb370000-0000-4000-8000-0000000008c4'::uuid)),
  'completed', 'the decision delivery projects');
select extensions.is(
  (select i.memory_type || '/' || i.origin || '/' || i.verification_state || '/' || i.knowledge_kind
   from public.memory_items i
   join public.memory_capture_events e on e.id = i.capture_event_id
   join public.channel_recommendation_decisions d on d.id = e.channel_decision_id
   where d.organization_id = 'fb370000-0000-4000-8000-000000000201'::uuid
     and d.decision = 'acknowledged'
   order by d.created_at limit 1),
  'decision/system_generated/unverified/operator_decision', 'the item carries the decision contract');
select extensions.ok(
  ((select pg_catalog.strpos(i.body, 'acknowledged')
    from public.memory_items i
    join public.memory_capture_events e on e.id = i.capture_event_id
    join public.channel_recommendation_decisions d on d.id = e.channel_decision_id
    where d.organization_id = 'fb370000-0000-4000-8000-000000000201'::uuid
      and d.decision = 'acknowledged'
    order by d.created_at limit 1) > 0),
  'the body carries the recorded decision value');
select extensions.is(
  (select i.capture_event_id = e.id and e.projected_item_id = i.id
   from public.memory_items i
   join public.memory_capture_events e on e.id = i.capture_event_id
   join public.channel_recommendation_decisions d on d.id = e.channel_decision_id
   where d.organization_id = 'fb370000-0000-4000-8000-000000000201'::uuid
     and d.decision = 'acknowledged'
   order by d.created_at limit 1),
  true, 'decision item and event link back to each other');
select extensions.is(
  (select pg_temp.delivery_status('fb370000-0000-4000-8000-000000000201'::uuid,
    (select e.id from public.memory_capture_events e
     join public.channel_recommendation_decisions d on d.id = e.channel_decision_id
     where d.organization_id = 'fb370000-0000-4000-8000-000000000201'::uuid
       and d.decision = 'acknowledged'
     order by d.created_at limit 1),
    'fb370000-0000-4000-8000-0000000008c4'::uuid)),
  'replayed', 'a duplicate decision delivery replays');
select extensions.is(
  (select count(*)::integer from public.memory_items i
   join public.memory_capture_events e on e.id = i.capture_event_id
   join public.channel_recommendation_decisions d on d.id = e.channel_decision_id
   where d.organization_id = 'fb370000-0000-4000-8000-000000000201'::uuid
     and d.decision = 'acknowledged'),
  1, 'without a second decision row');
select extensions.is(
  pg_temp.state_of($$ select pg_temp.project_finding(
    'fb370000-0000-4000-8000-000000000202'::uuid,
    (select e.id from public.memory_capture_events e
     join public.channel_findings f on f.id = e.channel_finding_id
     where f.analysis_run_id = 'fb370000-0000-4000-8000-000000000613'::uuid
     order by f.id limit 1)) $$),
  'P0002', 'another organization cannot project this organizations event');

select * from extensions.finish();

rollback;
