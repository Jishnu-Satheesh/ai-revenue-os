begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(34);

-- Spec 023 §16 backfill (swarm 5): missed source versions are enqueued later
-- through the SAME revision allocator the live capture uses — the public
-- `reconcile_memory_channel_*` wrappers, which call the private enqueue
-- helpers. The script `scripts/backfill-business-memory-capture.mjs` drives
-- exactly these RPCs. Vehicle here is channel_finding (registered, live);
-- growth/campaign kinds have no enqueue RPC yet and are out of scope.
--
-- Covered: idempotent re-reconcile, revision ordering (recorded rev 1 before
-- withdrawn rev 2, never reused), resumable across separate calls,
-- live-capture overlap (reconcile after live adds nothing), changed-away-and-
-- back as a new ordered revision, disabled organizations (settings-absent or
-- off), quarantine with safe codes, tenant isolation, and no invented memory
-- items (backfill enqueues; only the worker's projection mints items).

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
    'limitations', jsonb_build_array('fb44 bounded limitation.'),
    'calculationDigest', p_calc,
    'evidence', '[]'::jsonb);
$$;

create or replace function pg_temp.complete_analysis(p_run text, p_token text, p_findings jsonb, p_digest text)
returns jsonb language sql as $$
  select public.complete_channel_analysis(
    'fb440000-0000-4000-8000-000000000201'::uuid, p_run::uuid, p_token::uuid, p_digest, p_findings);
$$;

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

-- Member sessions hold no grant on the queue tables, so fenced reads and the
-- registry toggle go through definer rights.
create or replace function pg_temp.set_registry(p_kind text, p_on boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.memory_capture_adapters set registered = p_on where source_kind = p_kind;
$$;

create or replace function pg_temp.captured_item_count()
returns integer
language sql
security definer
set search_path = ''
as $$
  select count(*)::integer from public.memory_items
  where organization_id = 'fb440000-0000-4000-8000-000000000201'::uuid
    and capture_event_id is not null;
$$;

-- Fixtures -----------------------------------------------------------------------

insert into auth.users (id) values
  ('fb440000-0000-4000-8000-000000000001'::uuid),
  ('fb440000-0000-4000-8000-000000000002'::uuid);
insert into public.accounts (id, name, slug, created_by) values
  ('fb440000-0000-4000-8000-000000000101'::uuid, 'Backfill verifier', 'backfill-verifier', 'fb440000-0000-4000-8000-000000000001'::uuid),
  ('fb440000-0000-4000-8000-000000000102'::uuid, 'Backfill outsider', 'backfill-outsider', 'fb440000-0000-4000-8000-000000000002'::uuid);
insert into public.organizations (id, account_id, name, slug, industry, country_code, base_currency, default_timezone, created_by) values
  ('fb440000-0000-4000-8000-000000000201'::uuid, 'fb440000-0000-4000-8000-000000000101'::uuid, 'Backfill verifier', 'backfill-verifier', 'testing', 'AE', 'AED', 'Asia/Dubai', 'fb440000-0000-4000-8000-000000000001'::uuid),
  ('fb440000-0000-4000-8000-000000000202'::uuid, 'fb440000-0000-4000-8000-000000000102'::uuid, 'Backfill outsider', 'backfill-outsider', 'testing', 'AE', 'AED', 'Asia/Dubai', 'fb440000-0000-4000-8000-000000000002'::uuid);
insert into public.account_memberships (account_id, user_id, account_role, default_organization_role) values
  ('fb440000-0000-4000-8000-000000000101'::uuid, 'fb440000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner'),
  ('fb440000-0000-4000-8000-000000000102'::uuid, 'fb440000-0000-4000-8000-000000000002'::uuid, 'owner', 'owner');

insert into public.branches (id, organization_id, name, slug, kind, timezone, currency)
values ('fb440000-0000-4000-8000-000000000301'::uuid, 'fb440000-0000-4000-8000-000000000201'::uuid, 'Dubai outlet', 'backfill-dubai', 'physical', 'Asia/Dubai', 'AED');
insert into public.organization_channels (id, organization_id, key, display_name, category, created_by) values
  ('fb440000-0000-4000-8000-000000000401'::uuid, 'fb440000-0000-4000-8000-000000000201'::uuid, 'talabat', 'Talabat', 'marketplace', 'fb440000-0000-4000-8000-000000000001'::uuid);

-- No settings row yet: run 611 completes while capture is disabled, exactly
-- the missed version a backfill must later repair.
insert into public.channel_analysis_runs (
  id, organization_id, channel_id, branch_id, window_start, window_end, period_grain,
  window_timezone, registry_version, detector_versions, metric_versions, input_digest,
  status, correlation_id
) values
  ('fb440000-0000-4000-8000-000000000611'::uuid, 'fb440000-0000-4000-8000-000000000201'::uuid,
   'fb440000-0000-4000-8000-000000000401'::uuid, 'fb440000-0000-4000-8000-000000000301'::uuid,
   date '2026-01-01', date '2026-01-05', 'day', 'Asia/Dubai', 1,
   '[{"key":"evidence.period_coverage","calculationVersion":1}]'::jsonb, '[]'::jsonb,
   repeat('a', 64), 'running', 'fb440000-0000-4000-8000-000000000911'::uuid),
  ('fb440000-0000-4000-8000-000000000612'::uuid, 'fb440000-0000-4000-8000-000000000201'::uuid,
   'fb440000-0000-4000-8000-000000000401'::uuid, 'fb440000-0000-4000-8000-000000000301'::uuid,
   date '2026-01-01', date '2026-01-05', 'day', 'Asia/Dubai', 1,
   '[{"key":"evidence.period_coverage","calculationVersion":1}]'::jsonb, '[]'::jsonb,
   repeat('b', 64), 'running', 'fb440000-0000-4000-8000-000000000912'::uuid),
  ('fb440000-0000-4000-8000-000000000614'::uuid, 'fb440000-0000-4000-8000-000000000201'::uuid,
   'fb440000-0000-4000-8000-000000000401'::uuid, 'fb440000-0000-4000-8000-000000000301'::uuid,
   date '2026-01-01', date '2026-01-05', 'day', 'Asia/Dubai', 1,
   '[{"key":"evidence.period_coverage","calculationVersion":1}]'::jsonb, '[]'::jsonb,
   repeat('d', 64), 'running', 'fb440000-0000-4000-8000-000000000914'::uuid);

insert into private.channel_analysis_operations (
  organization_id, analysis_run_id, idempotency_key, input_digest, claim_token, lease_expires_at
) values
  ('fb440000-0000-4000-8000-000000000201'::uuid, 'fb440000-0000-4000-8000-000000000611'::uuid,
   'fb44-analysis-run-611', repeat('a', 64), 'fb440000-0000-4000-8000-0000000008a1'::uuid, now() + interval '1 hour'),
  ('fb440000-0000-4000-8000-000000000201'::uuid, 'fb440000-0000-4000-8000-000000000612'::uuid,
   'fb44-analysis-run-612', repeat('b', 64), 'fb440000-0000-4000-8000-0000000008a2'::uuid, now() + interval '1 hour'),
  ('fb440000-0000-4000-8000-000000000201'::uuid, 'fb440000-0000-4000-8000-000000000614'::uuid,
   'fb44-analysis-run-614', repeat('d', 64), 'fb440000-0000-4000-8000-0000000008a4'::uuid, now() + interval '1 hour');

-- Outsider org: a completed run with a finding, but no settings row, so the
-- backfill must refuse it rather than capture across the tenant boundary.
insert into public.channel_analysis_runs (
  id, organization_id, window_start, window_end, period_grain,
  window_timezone, registry_version, detector_versions, metric_versions, input_digest,
  status, result_digest, correlation_id, completed_at
) values (
  'fb440000-0000-4000-8000-000000000622'::uuid, 'fb440000-0000-4000-8000-000000000202'::uuid,
  date '2026-01-01', date '2026-01-05', 'day', 'Asia/Dubai', 1,
  '[{"key":"evidence.period_coverage","calculationVersion":1}]'::jsonb, '[]'::jsonb,
  repeat('f', 64), 'completed', repeat('1', 64),
  'fb440000-0000-4000-8000-000000000922'::uuid, now());
insert into public.channel_findings (
  id, organization_id, analysis_run_id, detector_key, detector_version,
  kind, code, quality_state, calculation_digest
) values (
  'fb440000-0000-4000-8000-000000000721'::uuid, 'fb440000-0000-4000-8000-000000000202'::uuid,
  'fb440000-0000-4000-8000-000000000622'::uuid, 'evidence.period_coverage', 1,
  'observation', 'PERIOD_COVERAGE_INCOMPLETE', 'complete', repeat('2', 64));

-- Backfill contract ---------------------------------------------------------------

select extensions.has_function(
  'public', 'reconcile_memory_channel_findings',
  'the findings reconcile wrapper exists');
select extensions.has_function(
  'public', 'reconcile_memory_channel_recommendations',
  'the recommendations reconcile wrapper exists');
select extensions.has_function(
  'public', 'reconcile_memory_channel_decision',
  'the decision reconcile wrapper exists');
select extensions.is(
  (select count(*)::integer from public.memory_capture_adapters
   where source_kind in ('channel_finding', 'channel_recommendation', 'channel_decision')
     and registered),
  3, 'all three channel kinds are registered');

set local role service_role;

-- A completion while capture is disabled enqueues nothing: the missed version
-- a backfill must later repair.
select extensions.is(
  (pg_temp.complete_analysis('fb440000-0000-4000-8000-000000000611',
    'fb440000-0000-4000-8000-0000000008a1',
    jsonb_build_array(
      pg_temp.finding('PERIOD_COVERAGE_INCOMPLETE', repeat('a', 64),
        'fb440000-0000-4000-8000-000000000401', 'fb440000-0000-4000-8000-000000000301',
        '2026-01-01', '2026-01-05'),
      pg_temp.finding('COVERAGE_SECOND_OBSERVATION', repeat('c', 64),
        'fb440000-0000-4000-8000-000000000401', 'fb440000-0000-4000-8000-000000000301',
        '2026-01-01', '2026-01-05')),
    repeat('b', 64)) ->> 'status'),
  'completed', 'the missed run still completes while capture is disabled');
select extensions.is(
  (select count(*)::integer from public.memory_capture_events
   where organization_id = 'fb440000-0000-4000-8000-000000000201'::uuid),
  0, 'the disabled completion leaves no capture behind');

-- Enabling capture, then reconciling, repairs exactly the missed run.
insert into public.memory_integration_settings (organization_id, capture_enabled) values
  ('fb440000-0000-4000-8000-000000000201'::uuid, true);

select extensions.is(
  (select public.reconcile_memory_channel_findings(
    'fb440000-0000-4000-8000-000000000201'::uuid, 'fb440000-0000-4000-8000-000000000611'::uuid)),
  2, 'the backfill pass enqueues the two missed findings');
select extensions.is(
  (select count(*)::integer from public.memory_capture_events e
   where e.organization_id = 'fb440000-0000-4000-8000-000000000201'::uuid
     and e.source_kind = 'channel_finding' and e.event_kind = 'recorded'
     and e.channel_finding_id in (select f.id from public.channel_findings f
       where f.analysis_run_id = 'fb440000-0000-4000-8000-000000000611'::uuid)),
  2, 'reconciled counts match the eligible source versions, not history totals');
select extensions.is(
  (select count(*)::integer from public.memory_capture_events e
   where e.organization_id = 'fb440000-0000-4000-8000-000000000201'::uuid
     and e.source_kind = 'channel_finding' and e.source_revision <> 1),
  0, 'first recordings start at revision one');

-- Idempotent: a second pass over the same run mints nothing.
select extensions.is(
  (select public.reconcile_memory_channel_findings(
    'fb440000-0000-4000-8000-000000000201'::uuid, 'fb440000-0000-4000-8000-000000000611'::uuid)),
  0, 're-reconciling the same run enqueues nothing');
select extensions.is(
  (select count(*)::integer from public.memory_capture_events
   where organization_id = 'fb440000-0000-4000-8000-000000000201'::uuid
     and source_kind = 'channel_finding'),
  2, 'the re-run leaves no duplicate behind');

-- Live overlap: the same-scope rerun completes through the live path,
-- supersedes the backfilled findings, and a later reconcile adds nothing.
select extensions.is(
  (pg_temp.complete_analysis('fb440000-0000-4000-8000-000000000612',
    'fb440000-0000-4000-8000-0000000008a2',
    jsonb_build_array(pg_temp.finding('COVERAGE_SUPERSEDING_VIEW', repeat('d', 64),
      'fb440000-0000-4000-8000-000000000401', 'fb440000-0000-4000-8000-000000000301',
      '2026-01-01', '2026-01-05')),
    repeat('c', 64)) ->> 'status'),
  'completed', 'the live rerun completes after the backfill');
select extensions.is(
  (select count(*)::integer from public.channel_findings
   where analysis_run_id = 'fb440000-0000-4000-8000-000000000611'::uuid
     and status = 'superseded'),
  2, 'the live rerun supersedes the backfilled findings');
select extensions.is(
  (select count(*)::integer from public.memory_capture_events e
   where e.organization_id = 'fb440000-0000-4000-8000-000000000201'::uuid
     and e.source_kind = 'channel_finding' and e.event_kind = 'withdrawn'
     and e.channel_finding_id in (select f.id from public.channel_findings f
       where f.analysis_run_id = 'fb440000-0000-4000-8000-000000000611'::uuid)),
  2, 'supersession enqueues withdrawal for the backfilled identities');
select extensions.is(
  (select count(*)::integer from public.memory_capture_events e
   where e.organization_id = 'fb440000-0000-4000-8000-000000000201'::uuid
     and e.source_kind = 'channel_finding' and e.event_kind = 'withdrawn'
     and e.source_revision = 2),
  2, 'withdrawals arrive as revision two, ordered after the recording');
select extensions.is(
  (select count(*)::integer from public.memory_capture_events e
   where e.organization_id = 'fb440000-0000-4000-8000-000000000201'::uuid
     and e.source_kind = 'channel_finding' and e.event_kind = 'recorded'
     and e.channel_finding_id in (select f.id from public.channel_findings f
       where f.analysis_run_id = 'fb440000-0000-4000-8000-000000000612'::uuid)),
  1, 'the live path recorded the rerun itself');
select extensions.is(
  (select public.reconcile_memory_channel_findings(
    'fb440000-0000-4000-8000-000000000201'::uuid, 'fb440000-0000-4000-8000-000000000612'::uuid)),
  0, 'reconciling the live run afterwards adds nothing');

-- An older recorded delivery arriving after the withdrawal cannot replace the
-- newer current state.
select extensions.is(
  (select (public.claim_memory_capture_events(
    'fb440000-0000-4000-8000-000000000201'::uuid,
    'fb440000-0000-4000-8000-0000000008c1'::uuid, 25, 120) ->> 'captureIds') is not null),
  true, 'the worker claims the due backlog');
select extensions.is(
  pg_temp.delivery_status('fb440000-0000-4000-8000-000000000201'::uuid,
    (select e.id from public.memory_capture_events e
     join public.channel_findings f on f.id = e.channel_finding_id
     where f.analysis_run_id = 'fb440000-0000-4000-8000-000000000611'::uuid
       and e.event_kind = 'recorded' order by f.id limit 1),
    'fb440000-0000-4000-8000-0000000008c1'::uuid),
  'obsolete', 'the stale recording is obsolete, never projected');
select extensions.is(
  (select e.safe_failure_code from public.memory_capture_events e
   join public.channel_findings f on f.id = e.channel_finding_id
   where f.analysis_run_id = 'fb440000-0000-4000-8000-000000000611'::uuid
     and e.event_kind = 'recorded' order by f.id limit 1),
  'OBSOLETE_SUPERSEDED', 'the obsolete delivery carries its safe code');
select extensions.is(
  (select count(*)::integer from public.memory_capture_events e
   join public.channel_findings f on f.id = e.channel_finding_id
   where f.analysis_run_id = 'fb440000-0000-4000-8000-000000000611'::uuid
     and e.event_kind = 'recorded'),
  2, 'the obsolete delivery updates in place instead of minting a row');

-- Quarantine: with the kind unregistered, delivery quarantines with a safe
-- code instead of projecting; the registry is restored in the same test.
select pg_temp.set_registry('channel_finding', false);
select extensions.is(
  pg_temp.delivery_status('fb440000-0000-4000-8000-000000000201'::uuid,
    (select e.id from public.memory_capture_events e
     join public.channel_findings f on f.id = e.channel_finding_id
     where f.analysis_run_id = 'fb440000-0000-4000-8000-000000000611'::uuid
       and e.event_kind = 'withdrawn' order by f.id limit 1),
    'fb440000-0000-4000-8000-0000000008c1'::uuid),
  'quarantined', 'an unregistered kind quarantines instead of projecting');
select extensions.is(
  (select e.safe_failure_code from public.memory_capture_events e
   join public.channel_findings f on f.id = e.channel_finding_id
   where f.analysis_run_id = 'fb440000-0000-4000-8000-000000000611'::uuid
     and e.event_kind = 'withdrawn' order by f.id limit 1),
  'QUARANTINE_UNREGISTERED_ADAPTER', 'quarantine carries its safe code');
select pg_temp.set_registry('channel_finding', true);
select extensions.is(
  (select count(*)::integer from public.memory_capture_adapters
   where source_kind in ('channel_finding', 'channel_recommendation', 'channel_decision')
     and registered),
  3, 'the registry is restored for the runs that follow');

-- Changed-away-and-back: restoring the original codes mints new identities at
-- new revisions; no revision is ever reused for a changed-back state.
select extensions.is(
  (pg_temp.complete_analysis('fb440000-0000-4000-8000-000000000614',
    'fb440000-0000-4000-8000-0000000008a4',
    jsonb_build_array(
      pg_temp.finding('PERIOD_COVERAGE_INCOMPLETE', repeat('a', 64),
        'fb440000-0000-4000-8000-000000000401', 'fb440000-0000-4000-8000-000000000301',
        '2026-01-01', '2026-01-05'),
      pg_temp.finding('COVERAGE_SECOND_OBSERVATION', repeat('c', 64),
        'fb440000-0000-4000-8000-000000000401', 'fb440000-0000-4000-8000-000000000301',
        '2026-01-01', '2026-01-05')),
    repeat('e', 64)) ->> 'status'),
  'completed', 'the restore run completes');
select extensions.is(
  (select count(*)::integer from public.memory_capture_events e
   where e.organization_id = 'fb440000-0000-4000-8000-000000000201'::uuid
     and e.source_kind = 'channel_finding' and e.event_kind = 'recorded'
     and e.channel_finding_id in (select f.id from public.channel_findings f
       where f.analysis_run_id = 'fb440000-0000-4000-8000-000000000614'::uuid)),
  2, 'the restored state records as new identities, not revived rows');
select extensions.is(
  (select count(*)::integer from public.memory_capture_events e
   where e.organization_id = 'fb440000-0000-4000-8000-000000000201'::uuid
     and e.source_kind = 'channel_finding' and e.event_kind = 'withdrawn'
     and e.channel_finding_id in (select f.id from public.channel_findings f
       where f.analysis_run_id = 'fb440000-0000-4000-8000-000000000612'::uuid)),
  1, 'the restore withdraws the superseding run it replaced');
select extensions.is(
  (select max(e.source_revision)::integer from public.memory_capture_events e
   join public.channel_findings f on f.id = e.channel_finding_id
   where f.analysis_run_id = 'fb440000-0000-4000-8000-000000000612'::uuid),
  2, 'the superseded run peaks at revision two');
select extensions.is(
  (select max(e.source_revision)::integer from public.memory_capture_events e
   join public.channel_findings f on f.id = e.channel_finding_id
   where f.analysis_run_id = 'fb440000-0000-4000-8000-000000000611'::uuid),
  2, 'the original identities never return to revision one');
select extensions.is(
  (select public.reconcile_memory_channel_findings(
    'fb440000-0000-4000-8000-000000000201'::uuid, 'fb440000-0000-4000-8000-000000000614'::uuid)),
  0, 'resuming after the restore reconciles nothing new');

-- Disabled organizations: settings-absent outsiders and cross-tenant runs
-- enqueue nothing.
select extensions.is(
  (select public.reconcile_memory_channel_findings(
    'fb440000-0000-4000-8000-000000000202'::uuid, 'fb440000-0000-4000-8000-000000000622'::uuid)),
  0, 'a settings-absent organization backfills nothing');
select extensions.is(
  (select count(*)::integer from public.memory_capture_events
   where organization_id = 'fb440000-0000-4000-8000-000000000202'::uuid),
  0, 'the outsider tenant holds no captures');
select extensions.is(
  (select public.reconcile_memory_channel_findings(
    'fb440000-0000-4000-8000-000000000202'::uuid, 'fb440000-0000-4000-8000-000000000611'::uuid)),
  0, 'a cross-tenant run id backfills nothing');

-- Backfill enqueues; it never mints memory items. Projection stays the
-- worker's job, and no seed row is treated as a real outcome.
select extensions.is(
  pg_temp.captured_item_count(),
  0, 'backfill plus refused deliveries mint no memory items');

select * from extensions.finish();

rollback;
