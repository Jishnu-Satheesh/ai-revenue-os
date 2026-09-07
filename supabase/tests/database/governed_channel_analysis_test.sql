begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(69);

-- The fenced write path for deterministic channel findings. Exercised against
-- real runs with real leases, because everything worth checking here -- the
-- detector version tuple, the declared window, the run's scope, and the rule
-- that a finding may cite only current evidence -- is resolved at execution
-- time and cannot be checked any other way.

select extensions.has_function('public', 'claim_channel_analysis', 'the analysis lease is database-owned');
select extensions.has_function('public', 'complete_channel_analysis', 'so is the finding write path');
select extensions.has_function('public', 'fail_channel_analysis', 'and the failure path');
select extensions.ok(pg_catalog.has_function_privilege('service_role', 'public.complete_channel_analysis(uuid,uuid,uuid,text,jsonb)', 'execute'), 'service workers hold the fenced completion path');
select extensions.ok(not pg_catalog.has_function_privilege('authenticated', 'public.complete_channel_analysis(uuid,uuid,uuid,text,jsonb)', 'execute'), 'members cannot write findings directly');
select extensions.ok(not pg_catalog.has_function_privilege('anon', 'public.complete_channel_analysis(uuid,uuid,uuid,text,jsonb)', 'execute'), 'anonymous callers cannot write findings');
select extensions.ok(not pg_catalog.has_table_privilege('authenticated', 'public.channel_findings', 'insert'), 'findings are readable from a session, never writable');

-- Fixtures -----------------------------------------------------------------------

insert into auth.users (id) values
  ('f1000000-0000-4000-8000-000000000001'::uuid),
  ('f1000000-0000-4000-8000-000000000002'::uuid);
insert into public.accounts (id, name, slug, created_by) values
  ('f1000000-0000-4000-8000-000000000101'::uuid, 'Findings verifier', 'findings-verifier', 'f1000000-0000-4000-8000-000000000001'::uuid),
  ('f1000000-0000-4000-8000-000000000102'::uuid, 'Findings outsider', 'findings-outsider', 'f1000000-0000-4000-8000-000000000002'::uuid);

-- The organization default zone differs from the branch's on purpose: a window
-- bound to a branch is stated in the branch's own zone, per `specs/015` 4.4.
insert into public.organizations (id, account_id, name, slug, industry, country_code, base_currency, default_timezone, created_by) values
  ('f1000000-0000-4000-8000-000000000201'::uuid, 'f1000000-0000-4000-8000-000000000101'::uuid, 'Findings verifier', 'findings-verifier', 'testing', 'AE', 'AED', 'Asia/Riyadh', 'f1000000-0000-4000-8000-000000000001'::uuid),
  ('f1000000-0000-4000-8000-000000000202'::uuid, 'f1000000-0000-4000-8000-000000000102'::uuid, 'Findings outsider', 'findings-outsider', 'testing', 'AE', 'AED', 'Asia/Dubai', 'f1000000-0000-4000-8000-000000000002'::uuid);
insert into public.account_memberships (account_id, user_id, account_role, default_organization_role) values
  ('f1000000-0000-4000-8000-000000000101'::uuid, 'f1000000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner'),
  ('f1000000-0000-4000-8000-000000000102'::uuid, 'f1000000-0000-4000-8000-000000000002'::uuid, 'owner', 'owner');

insert into public.branches (id, organization_id, name, slug, kind, timezone, currency)
values ('f1000000-0000-4000-8000-000000000301'::uuid, 'f1000000-0000-4000-8000-000000000201'::uuid, 'Dubai outlet', 'dubai-outlet', 'physical', 'Asia/Dubai', 'AED');
insert into public.organization_channels (id, organization_id, key, display_name, category, created_by) values
  ('f1000000-0000-4000-8000-000000000401'::uuid, 'f1000000-0000-4000-8000-000000000201'::uuid, 'talabat', 'Talabat', 'marketplace', 'f1000000-0000-4000-8000-000000000001'::uuid),
  ('f1000000-0000-4000-8000-000000000402'::uuid, 'f1000000-0000-4000-8000-000000000201'::uuid, 'noon', 'Noon', 'marketplace', 'f1000000-0000-4000-8000-000000000001'::uuid),
  ('f1000000-0000-4000-8000-000000000403'::uuid, 'f1000000-0000-4000-8000-000000000202'::uuid, 'talabat', 'Talabat', 'marketplace', 'f1000000-0000-4000-8000-000000000002'::uuid);

-- Two current governed observations and one held for an owner's decision. The
-- held one exists so the rule that a finding may not cite it can be exercised
-- against a real row rather than against a made-up identifier.
insert into public.normalized_metrics (
  id, organization_id, branch_id, channel_id, channel, metric_definition_id, value_kind, subject_kind,
  period_grain, period_start, period_end, period_timezone, value_numerator, currency, quality_tier,
  reconciliation_state, reconciliation_digest, observed_at
)
select observation_id::uuid, 'f1000000-0000-4000-8000-000000000201'::uuid,
  'f1000000-0000-4000-8000-000000000301'::uuid, 'f1000000-0000-4000-8000-000000000401'::uuid, 'talabat',
  (select id from public.metric_definitions where key = 'revenue.gross' and organization_id is null),
  'money', 'organization', 'day', period_start::timestamptz, period_end::timestamptz, 'Asia/Dubai',
  numerator, 'AED', 'measured', state, repeat('c', 64), period_end::timestamptz
from (values
  ('f1000000-0000-4000-8000-000000000501', '2026-01-01 00:00:00+04', '2026-01-02 00:00:00+04', 120000, 'current'),
  ('f1000000-0000-4000-8000-000000000502', '2026-01-02 00:00:00+04', '2026-01-03 00:00:00+04', 90000, 'current'),
  ('f1000000-0000-4000-8000-000000000503', '2026-01-03 00:00:00+04', '2026-01-04 00:00:00+04', 70000, 'blocked_overlap')
) as observations(observation_id, period_start, period_end, numerator, state);

create or replace function pg_temp.claim(
  p_run text, p_key text, p_token text,
  p_channel text default 'f1000000-0000-4000-8000-000000000401',
  p_metrics jsonb default '["revenue.gross"]'::jsonb,
  p_detectors jsonb default '[{"key":"evidence.period_coverage","calculationVersion":1}]'::jsonb)
returns jsonb language sql as $$
  select public.claim_channel_analysis(
    'f1000000-0000-4000-8000-000000000201'::uuid, nullif(p_channel, '')::uuid,
    'f1000000-0000-4000-8000-000000000301'::uuid, date '2026-01-01', date '2026-01-05', 'day',
    p_run::uuid, 1, p_detectors, p_metrics, p_key, p_token::uuid,
    'f1000000-0000-4000-8000-000000000701'::uuid);
$$;

create or replace function pg_temp.claim_cached(p_run text, p_key text, p_token text, p_digest text, p_cache_key text)
returns jsonb language sql as $$
  select public.claim_channel_analysis(
    'f1000000-0000-4000-8000-000000000201'::uuid, 'f1000000-0000-4000-8000-000000000401'::uuid,
    'f1000000-0000-4000-8000-000000000301'::uuid, date '2026-01-01', date '2026-01-05', 'day',
    p_run::uuid, 1, '[{"key":"evidence.period_coverage","calculationVersion":1}]'::jsonb,
    '["revenue.gross"]'::jsonb, p_key, p_token::uuid,
    'f1000000-0000-4000-8000-000000000701'::uuid, p_digest, p_cache_key);
$$;

create or replace function pg_temp.finding(p_overrides jsonb default '{}'::jsonb)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'detectorKey', 'evidence.period_coverage', 'detectorVersion', 1,
    'kind', 'observation', 'code', 'PERIOD_COVERAGE_INCOMPLETE',
    'channelId', 'f1000000-0000-4000-8000-000000000401',
    'branchId', 'f1000000-0000-4000-8000-000000000301',
    'metricKey', 'revenue.gross', 'periodStart', '2026-01-01', 'periodEnd', '2026-01-05',
    'valueKind', 'ratio', 'valueNumerator', '2', 'valueDenominator', '5',
    'expectedPeriodCount', 5, 'observedPeriodCount', 2, 'absentPeriodCount', 3,
    'qualityState', 'complete',
    'limitations', jsonb_build_array('A period is counted as covered when a current observation starts in it.'),
    'calculationDigest', repeat('a', 64),
    'evidence', jsonb_build_array(jsonb_build_object(
      'kind', 'normalized_metric', 'role', 'component', 'id', 'f1000000-0000-4000-8000-000000000501'))
  ) || p_overrides;
$$;

create or replace function pg_temp.complete(p_run text, p_token text, p_findings jsonb, p_digest text default repeat('b', 64))
returns jsonb language sql as $$
  select public.complete_channel_analysis(
    'f1000000-0000-4000-8000-000000000201'::uuid, p_run::uuid, p_token::uuid, p_digest, p_findings);
$$;

set local role service_role;

-- Claiming a run ------------------------------------------------------------------

select extensions.is((pg_temp.claim('f1000000-0000-4000-8000-000000000601', 'channel-analysis-run-000001', 'f1000000-0000-4000-8000-000000000801', 'f1000000-0000-4000-8000-000000000401', '["revenue.gross"]'::jsonb, '[{"key":"evidence.period_coverage","calculationVersion":1},{"key":"evidence.reconciliation_blocked","calculationVersion":1}]'::jsonb) ->> 'outcome'), 'acquired', 'a worker receives a lease through the fenced claim RPC');
select extensions.is((select window_timezone from public.channel_analysis_runs where id = 'f1000000-0000-4000-8000-000000000601'::uuid), 'Asia/Dubai', 'the branch timezone governs the window, not the organization default');
select extensions.is((select detector_versions from public.channel_analysis_runs where id = 'f1000000-0000-4000-8000-000000000601'::uuid), '[{"key":"evidence.period_coverage","calculationVersion":1},{"key":"evidence.reconciliation_blocked","calculationVersion":1}]'::jsonb, 'the run records exactly which detector versions it bound');
select extensions.is((select metric_versions -> 0 ->> 'key' from public.channel_analysis_runs where id = 'f1000000-0000-4000-8000-000000000601'::uuid), 'revenue.gross', 'and the metric definition the database resolved for it');
select extensions.is((select status from public.channel_analysis_runs where id = 'f1000000-0000-4000-8000-000000000601'::uuid), 'running', 'the run is open while the lease is held');
select extensions.is((pg_temp.claim('f1000000-0000-4000-8000-000000000601', 'channel-analysis-run-000099', 'f1000000-0000-4000-8000-000000000801') ->> 'outcome'), 'conflict', 'a second idempotency key on the same run is a conflict, not a second run');
select extensions.is((pg_temp.claim('f1000000-0000-4000-8000-000000000601', 'channel-analysis-run-000001', 'f1000000-0000-4000-8000-000000000801', 'f1000000-0000-4000-8000-000000000402') ->> 'outcome'), 'conflict', 'and so is resuming a run under a different question from the one it recorded');
select extensions.is((pg_temp.claim('f1000000-0000-4000-8000-000000000602', 'channel-analysis-run-000002', 'f1000000-0000-4000-8000-000000000802', 'f1000000-0000-4000-8000-000000000403') ->> 'outcome'), 'not_found', 'a channel belonging to another organization does not resolve');
select extensions.is((pg_temp.claim('f1000000-0000-4000-8000-000000000603', 'channel-analysis-run-000003', 'f1000000-0000-4000-8000-000000000803', 'f1000000-0000-4000-8000-000000000401', '["revenue.invented"]'::jsonb) ->> 'outcome'), 'not_ready', 'a run whose vocabulary does not resolve never starts');

-- Refusals first, while the lease is live and nothing has been written -------------

select extensions.is(pg_temp.complete('f1000000-0000-4000-8000-000000000601', 'f1000000-0000-4000-8000-0000000008ff', jsonb_build_array(pg_temp.finding())), null, 'a claim token the worker does not hold writes nothing');

select extensions.throws_ok(
  $$ select pg_temp.complete('f1000000-0000-4000-8000-000000000601', 'f1000000-0000-4000-8000-000000000801', jsonb_build_array(pg_temp.finding('{"invented": 1}'::jsonb))) $$,
  '22023', 'channel analysis finding is invalid',
  'a field the contract does not know is refused rather than ignored');

select extensions.throws_ok(
  $$ select pg_temp.complete('f1000000-0000-4000-8000-000000000601', 'f1000000-0000-4000-8000-000000000801', jsonb_build_array(pg_temp.finding('{"severity": "high"}'::jsonb))) $$,
  '22023', 'channel analysis finding severity is invalid',
  'an observation carrying a severity is refused, because that severity is a threshold nobody agreed to');

select extensions.throws_ok(
  $$ select pg_temp.complete('f1000000-0000-4000-8000-000000000601', 'f1000000-0000-4000-8000-000000000801', jsonb_build_array(pg_temp.finding('{"kind": "finding", "severity": "high"}'::jsonb))) $$,
  '22023', 'channel analysis finding severity is invalid',
  'and a quantified finding without a priority is refused too');

select extensions.throws_ok(
  $$ select pg_temp.complete('f1000000-0000-4000-8000-000000000601', 'f1000000-0000-4000-8000-000000000801', jsonb_build_array(pg_temp.finding('{"kind": "needs_data", "needsDataReason": "NO_GOVERNED_EVIDENCE_IN_WINDOW"}'::jsonb))) $$,
  '22023', 'channel analysis finding value is invalid',
  'needs_data cannot arrive carrying a number, because that is the opposite of what it means');

select extensions.throws_ok(
  $$ select pg_temp.complete('f1000000-0000-4000-8000-000000000601', 'f1000000-0000-4000-8000-000000000801', jsonb_build_array(pg_temp.finding('{"valueKind": "money", "valueNumerator": "12.34", "currency": "AED"}'::jsonb))) $$,
  '22023', 'channel analysis finding value is invalid',
  'money arrives as integer minor units or not at all');

select extensions.throws_ok(
  $$ select pg_temp.complete('f1000000-0000-4000-8000-000000000601', 'f1000000-0000-4000-8000-000000000801', jsonb_build_array(pg_temp.finding('{"detectorKey": "revenue.channel_share"}'::jsonb))) $$,
  '23514', 'channel analysis finding names a detector the run did not bind',
  'a detector the run never bound cannot have produced a finding');

select extensions.throws_ok(
  $$ select pg_temp.complete('f1000000-0000-4000-8000-000000000601', 'f1000000-0000-4000-8000-000000000801', jsonb_build_array(pg_temp.finding('{"detectorVersion": 2}'::jsonb))) $$,
  '23514', 'channel analysis finding names a detector the run did not bind',
  'nor can a version of it the run did not bind');

select extensions.throws_ok(
  $$ select pg_temp.complete('f1000000-0000-4000-8000-000000000601', 'f1000000-0000-4000-8000-000000000801', jsonb_build_array(pg_temp.finding('{"periodStart": "2025-12-28", "periodEnd": "2026-01-05"}'::jsonb))) $$,
  '23514', 'channel analysis finding period falls outside the declared window',
  'a figure filed outside the declared window is refused');

select extensions.throws_ok(
  $$ select pg_temp.complete('f1000000-0000-4000-8000-000000000601', 'f1000000-0000-4000-8000-000000000801', jsonb_build_array(pg_temp.finding('{"channelId": "f1000000-0000-4000-8000-000000000402"}'::jsonb))) $$,
  '23514', 'channel analysis finding falls outside the run scope',
  'a run bound to one channel cannot report about another');

select extensions.throws_ok(
  $$ select pg_temp.complete('f1000000-0000-4000-8000-000000000601', 'f1000000-0000-4000-8000-000000000801', jsonb_build_array(pg_temp.finding('{"metricKey": "transactions.count"}'::jsonb))) $$,
  '23514', 'channel analysis finding names a metric the run did not bind',
  'a metric outside the run''s bound vocabulary cannot reach a finding');

select extensions.throws_ok(
  $$ select pg_temp.complete('f1000000-0000-4000-8000-000000000601', 'f1000000-0000-4000-8000-000000000801', jsonb_build_array(pg_temp.finding(jsonb_build_object('evidence', jsonb_build_array(jsonb_build_object('kind','normalized_metric','role','component','id','f1000000-0000-4000-8000-000000000503')))))) $$,
  '23514', 'channel analysis cites metric evidence that is not current',
  'held evidence is not fact, and a finding may not cite it as though it were');

select extensions.throws_ok(
  $$ select pg_temp.complete('f1000000-0000-4000-8000-000000000601', 'f1000000-0000-4000-8000-000000000801', jsonb_build_array(pg_temp.finding('{"evidence": []}'::jsonb))) $$,
  '23514', 'channel analysis finding states a value it cites no evidence for',
  'a figure derived from ledger rows has to name them');

select extensions.is((select count(*)::integer from public.channel_findings where organization_id = 'f1000000-0000-4000-8000-000000000201'::uuid), 0, 'every refusal so far has written nothing');

-- The successful write ------------------------------------------------------------

select extensions.lives_ok(
  $$ select pg_temp.complete('f1000000-0000-4000-8000-000000000601', 'f1000000-0000-4000-8000-000000000801', jsonb_build_array(
    pg_temp.finding('{"valueNumerator":"34216.93333333327","valueDenominator":"70798.99999999983"}'::jsonb),
    pg_temp.finding('{"detectorKey":"evidence.reconciliation_blocked","kind":"finding","code":"EVIDENCE_HELD_FOR_DECISION","severity":"high","priority":10,"valueKind":"count","valueNumerator":"1","valueDenominator":null,"calculationDigest":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","evidence":[]}'::jsonb),
    pg_temp.finding('{"kind":"needs_data","code":"REVENUE_PERIOD_MOVEMENT_UNAVAILABLE","needsDataReason":"PRIOR_PERIOD_ABSENT","valueKind":null,"valueNumerator":null,"valueDenominator":null,"calculationDigest":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","evidence":[]}'::jsonb)
  )) $$,
  'a bound detector''s outcomes complete into findings');

select extensions.is((select status from public.channel_analysis_runs where id = 'f1000000-0000-4000-8000-000000000601'::uuid), 'completed', 'the run closes');
select extensions.is((select finding_count from public.channel_analysis_runs where id = 'f1000000-0000-4000-8000-000000000601'::uuid), 1, 'quantified findings are counted separately');
select extensions.is((select observation_count from public.channel_analysis_runs where id = 'f1000000-0000-4000-8000-000000000601'::uuid), 1, 'from authoritative observations');
select extensions.is((select needs_data_count from public.channel_analysis_runs where id = 'f1000000-0000-4000-8000-000000000601'::uuid), 1, 'and from the outcomes that needed data, which are recorded rather than left silent');
select extensions.is((select count(*)::integer from public.channel_findings where analysis_run_id = 'f1000000-0000-4000-8000-000000000601'::uuid), 3, 'every outcome is stored');
select extensions.is((select value_numerator::text from public.channel_findings where analysis_run_id = 'f1000000-0000-4000-8000-000000000601'::uuid and code = 'PERIOD_COVERAGE_INCOMPLETE'), '34216.93333333327', 'a provider-measured decimal ratio numerator is preserved exactly');
select extensions.is((select value_denominator::text from public.channel_findings where analysis_run_id = 'f1000000-0000-4000-8000-000000000601'::uuid and code = 'PERIOD_COVERAGE_INCOMPLETE'), '70798.99999999983', 'and its provider-measured decimal denominator is preserved exactly');
select extensions.is((select severity from public.channel_findings where analysis_run_id = 'f1000000-0000-4000-8000-000000000601'::uuid and kind = 'observation'), null, 'an observation carries no severity');
select extensions.is((select count(*)::integer from public.channel_finding_evidence e join public.channel_findings f on f.id = e.finding_id where f.analysis_run_id = 'f1000000-0000-4000-8000-000000000601'::uuid), 1, 'and every cited figure resolves to the row it came from');
select extensions.is((select count(*)::integer from public.audit_events where entity_id = 'f1000000-0000-4000-8000-000000000601'::uuid and event_name = 'channel_analysis.completed'), 1, 'the completed analysis is audited');
select extensions.is(pg_temp.complete('f1000000-0000-4000-8000-000000000601', 'f1000000-0000-4000-8000-000000000801', jsonb_build_array(pg_temp.finding())), null, 'a completed run writes nothing on a second call');

-- Findings are append-only ---------------------------------------------------------

select extensions.throws_ok(
  $$ update public.channel_findings set value_numerator = 99 where analysis_run_id = 'f1000000-0000-4000-8000-000000000601'::uuid $$,
  '55000', 'channel_finding_is_append_only',
  'a figure already recorded cannot be edited into a different one');
select extensions.throws_ok(
  $$ delete from public.channel_findings where analysis_run_id = 'f1000000-0000-4000-8000-000000000601'::uuid $$,
  '55000', 'channel_finding_is_append_only',
  'nor deleted');
select extensions.throws_ok(
  $$ delete from public.channel_analysis_runs where id = 'f1000000-0000-4000-8000-000000000601'::uuid $$,
  '55000', 'channel_analysis_evidence_is_append_only',
  'and neither can the run that produced it');

-- A later answer supersedes the earlier one, and the earlier one stays readable ------

select extensions.is((pg_temp.claim('f1000000-0000-4000-8000-000000000604', 'channel-analysis-run-000004', 'f1000000-0000-4000-8000-000000000804') ->> 'outcome'), 'acquired', 'the same window can be analysed again when new evidence lands');
select extensions.lives_ok(
  $$ select pg_temp.complete('f1000000-0000-4000-8000-000000000604', 'f1000000-0000-4000-8000-000000000804', jsonb_build_array(pg_temp.finding('{"calculationDigest":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"}'::jsonb)), repeat('9', 64)) $$,
  'the second pass completes');
select extensions.is((select count(*)::integer from public.channel_findings where analysis_run_id = 'f1000000-0000-4000-8000-000000000601'::uuid and detector_key = 'evidence.period_coverage' and status = 'superseded'), 2, 'the earlier answer is superseded rather than overwritten');
select extensions.is((select count(*)::integer from public.channel_findings where analysis_run_id = 'f1000000-0000-4000-8000-000000000601'::uuid and detector_key = 'evidence.reconciliation_blocked' and status = 'open'), 1, 'and a detector the second pass did not carry keeps its own findings open');
select extensions.is((select status from public.channel_findings where analysis_run_id = 'f1000000-0000-4000-8000-000000000604'::uuid), 'open', 'the newer answer is the open one');

-- Failing a run --------------------------------------------------------------------

select extensions.is((pg_temp.claim('f1000000-0000-4000-8000-000000000605', 'channel-analysis-run-000005', 'f1000000-0000-4000-8000-000000000805') ->> 'outcome'), 'acquired', 'a third run receives its own lease');
select extensions.throws_ok(
  $$ select public.fail_channel_analysis('f1000000-0000-4000-8000-000000000201'::uuid, 'f1000000-0000-4000-8000-000000000605'::uuid, 'f1000000-0000-4000-8000-000000000805'::uuid, 'SOMETHING_WENT_WRONG', repeat('7', 64)) $$,
  '22023', 'channel analysis failure is invalid',
  'a failure code an operator cannot read is refused');
select extensions.lives_ok(
  $$ select public.fail_channel_analysis('f1000000-0000-4000-8000-000000000201'::uuid, 'f1000000-0000-4000-8000-000000000605'::uuid, 'f1000000-0000-4000-8000-000000000805'::uuid, 'EVIDENCE_UNAVAILABLE', repeat('7', 64)) $$,
  'a run that could not read its evidence fails safely');
select extensions.is((select safe_failure_code from public.channel_analysis_runs where id = 'f1000000-0000-4000-8000-000000000605'::uuid), 'EVIDENCE_UNAVAILABLE', 'and says why');
select extensions.is((select count(*)::integer from public.channel_findings where analysis_run_id = 'f1000000-0000-4000-8000-000000000605'::uuid), 0, 'a failed run leaves no finding behind');

-- Content-addressed reuse ----------------------------------------------------------

select extensions.is((pg_temp.claim_cached('f1000000-0000-4000-8000-000000000606', 'channel-analysis-run-000006', 'f1000000-0000-4000-8000-000000000806', repeat('1', 64), repeat('2', 64)) ->> 'outcome'), 'acquired', 'a run carrying an evidence digest and cache key is claimed normally');
select extensions.is((select evidence_digest from public.channel_analysis_runs where id = 'f1000000-0000-4000-8000-000000000606'::uuid), repeat('1', 64), 'the claim stores the evidence digest it was given');
select extensions.is((select cache_key from public.channel_analysis_runs where id = 'f1000000-0000-4000-8000-000000000606'::uuid), repeat('2', 64), 'and the cache key');
select extensions.lives_ok(
  $$ select pg_temp.complete('f1000000-0000-4000-8000-000000000606', 'f1000000-0000-4000-8000-000000000806', jsonb_build_array(pg_temp.finding())) $$,
  'the digest-carrying run completes');
select extensions.is((pg_temp.claim_cached('f1000000-0000-4000-8000-000000000607', 'channel-analysis-run-000007', 'f1000000-0000-4000-8000-000000000807', repeat('1', 64), repeat('2', 64)) ->> 'outcome'), 'cached', 'an identical cache key reuses the completed run instead of starting a new one');
select extensions.is((pg_temp.claim_cached('f1000000-0000-4000-8000-000000000607', 'channel-analysis-run-000007', 'f1000000-0000-4000-8000-000000000807', repeat('1', 64), repeat('2', 64)) ->> 'analysisRunId'), 'f1000000-0000-4000-8000-000000000606', 'and names the run it reuses');
select extensions.is((select count(*)::integer from public.channel_analysis_runs where id = 'f1000000-0000-4000-8000-000000000607'::uuid), 0, 'a cache hit writes no new run row');
select extensions.is((pg_temp.claim_cached('f1000000-0000-4000-8000-000000000608', 'channel-analysis-run-000008', 'f1000000-0000-4000-8000-000000000808', repeat('3', 64), repeat('4', 64)) ->> 'outcome'), 'acquired', 'changed evidence misses the cache and starts a new run');
select extensions.throws_ok(
  $$ select pg_temp.claim_cached('f1000000-0000-4000-8000-000000000609', 'channel-analysis-run-000009', 'f1000000-0000-4000-8000-000000000809', 'not-a-digest', repeat('2', 64)) $$,
  '22023', 'channel analysis request is invalid',
  'a digest that is not hex is refused before any run exists');

-- Tenant isolation -------------------------------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'f1000000-0000-4000-8000-000000000001';
select extensions.is((select count(*)::integer from public.channel_findings where organization_id = 'f1000000-0000-4000-8000-000000000201'::uuid), 5, 'an owner reads their own findings, including the cache-test run above');

set local request.jwt.claim.sub = 'f1000000-0000-4000-8000-000000000002';
select extensions.is((select count(*)::integer from public.channel_analysis_runs where organization_id = 'f1000000-0000-4000-8000-000000000201'::uuid), 0, 'a member of another organization cannot read these runs');
select extensions.is((select count(*)::integer from public.channel_findings where organization_id = 'f1000000-0000-4000-8000-000000000201'::uuid), 0, 'nor the findings');
select extensions.is((select count(*)::integer from public.channel_finding_evidence where organization_id = 'f1000000-0000-4000-8000-000000000201'::uuid), 0, 'nor what those findings cite');
select extensions.throws_ok(
  $$ select pg_temp.complete('f1000000-0000-4000-8000-000000000604', 'f1000000-0000-4000-8000-000000000804', jsonb_build_array(pg_temp.finding())) $$,
  '42501');

select * from extensions.finish();

rollback;
