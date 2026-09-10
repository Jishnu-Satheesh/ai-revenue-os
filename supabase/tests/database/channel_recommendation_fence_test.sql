begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(66);

-- The narrator's fence (ADR 0037): three worker RPCs that are the only write
-- path into the recommendations tables. Exercised against real completed runs
-- with real leases, because everything worth checking here -- whether an
-- analysis actually finished, which findings belong to that very run, and
-- whether each finding's ledger evidence is still current -- resolves at
-- execution time and cannot be checked any other way.

select extensions.has_function('public', 'claim_channel_recommendations', 'the narration lease is database-owned');
select extensions.has_function('public', 'complete_channel_recommendations', 'so is the filing path');
select extensions.has_function('public', 'fail_channel_recommendations', 'and the failure path');
select extensions.ok(pg_catalog.has_function_privilege('service_role', 'public.claim_channel_recommendations(uuid,uuid,text,uuid)', 'execute'), 'service workers hold the fenced claim');
select extensions.ok(pg_catalog.has_function_privilege('service_role', 'public.complete_channel_recommendations(uuid,uuid,uuid,text,text,integer,text,text,text,jsonb)', 'execute'), 'and the fenced completion path');
select extensions.ok(pg_catalog.has_function_privilege('service_role', 'public.fail_channel_recommendations(uuid,uuid,uuid,text,text)', 'execute'), 'and the fenced failure path');
select extensions.ok(not pg_catalog.has_function_privilege('authenticated', 'public.claim_channel_recommendations(uuid,uuid,text,uuid)', 'execute'), 'members cannot claim narration leases');
select extensions.ok(not pg_catalog.has_function_privilege('authenticated', 'public.complete_channel_recommendations(uuid,uuid,uuid,text,text,integer,text,text,text,jsonb)', 'execute'), 'members cannot file narration');
select extensions.ok(not pg_catalog.has_function_privilege('authenticated', 'public.fail_channel_recommendations(uuid,uuid,uuid,text,text)', 'execute'), 'nor record narration failures');
select extensions.ok(not pg_catalog.has_function_privilege('anon', 'public.claim_channel_recommendations(uuid,uuid,text,uuid)', 'execute'), 'anonymous callers cannot claim either');
select extensions.ok(not pg_catalog.has_function_privilege('anon', 'public.complete_channel_recommendations(uuid,uuid,uuid,text,text,integer,text,text,text,jsonb)', 'execute'), 'nor file');
select extensions.ok(not pg_catalog.has_function_privilege('anon', 'public.fail_channel_recommendations(uuid,uuid,uuid,text,text)', 'execute'), 'nor fail a run');
select extensions.ok(not pg_catalog.has_table_privilege('authenticated', 'private.channel_recommendation_operations', 'select'), 'the lease table is invisible to sessions');

-- Fixtures -----------------------------------------------------------------------

insert into auth.users (id) values
  ('fa210000-0000-4000-8000-000000000001'::uuid),
  ('fa210000-0000-4000-8000-000000000002'::uuid);
insert into public.accounts (id, name, slug, created_by) values
  ('fa210000-0000-4000-8000-000000000101'::uuid, 'Recs fence verifier', 'recs-fence-verifier', 'fa210000-0000-4000-8000-000000000001'::uuid),
  ('fa210000-0000-4000-8000-000000000102'::uuid, 'Recs fence outsider', 'recs-fence-outsider', 'fa210000-0000-4000-8000-000000000002'::uuid);
insert into public.organizations (id, account_id, name, slug, industry, country_code, base_currency, default_timezone, created_by) values
  ('fa210000-0000-4000-8000-000000000201'::uuid, 'fa210000-0000-4000-8000-000000000101'::uuid, 'Recs fence verifier', 'recs-fence-verifier', 'testing', 'AE', 'AED', 'Asia/Dubai', 'fa210000-0000-4000-8000-000000000001'::uuid),
  ('fa210000-0000-4000-8000-000000000202'::uuid, 'fa210000-0000-4000-8000-000000000102'::uuid, 'Recs fence outsider', 'recs-fence-outsider', 'testing', 'AE', 'AED', 'Asia/Dubai', 'fa210000-0000-4000-8000-000000000002'::uuid);
insert into public.account_memberships (account_id, user_id, account_role, default_organization_role) values
  ('fa210000-0000-4000-8000-000000000101'::uuid, 'fa210000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner'),
  ('fa210000-0000-4000-8000-000000000102'::uuid, 'fa210000-0000-4000-8000-000000000002'::uuid, 'owner', 'owner');

insert into public.branches (id, organization_id, name, slug, kind, timezone, currency)
values ('fa210000-0000-4000-8000-000000000301'::uuid, 'fa210000-0000-4000-8000-000000000201'::uuid, 'Dubai outlet', 'recs-fence-dubai', 'physical', 'Asia/Dubai', 'AED');
insert into public.organization_channels (id, organization_id, key, display_name, category, created_by) values
  ('fa210000-0000-4000-8000-000000000401'::uuid, 'fa210000-0000-4000-8000-000000000201'::uuid, 'talabat', 'Talabat', 'marketplace', 'fa210000-0000-4000-8000-000000000001'::uuid);

-- The outsider gets real parents of its own so the refusals below are
-- exercised against rows another tenant actually owns.
insert into public.branches (id, organization_id, name, slug, kind, timezone, currency)
values ('fa210000-0000-4000-8000-000000000302'::uuid, 'fa210000-0000-4000-8000-000000000202'::uuid, 'Outsider outlet', 'recs-fence-outsider-outlet', 'physical', 'Asia/Dubai', 'AED');
insert into public.organization_channels (id, organization_id, key, display_name, category, created_by)
values ('fa210000-0000-4000-8000-000000000402'::uuid, 'fa210000-0000-4000-8000-000000000202'::uuid, 'talabat', 'Talabat', 'marketplace', 'fa210000-0000-4000-8000-000000000002'::uuid);

-- One current governed observation and one held for an owner's decision, so
-- the currency rule can be exercised against a real stale citation.
insert into public.normalized_metrics (
  id, organization_id, branch_id, channel_id, channel, metric_definition_id, value_kind, subject_kind,
  period_grain, period_start, period_end, period_timezone, value_numerator, currency, quality_tier,
  reconciliation_state, reconciliation_digest, observed_at
)
select observation_id::uuid, 'fa210000-0000-4000-8000-000000000201'::uuid,
  'fa210000-0000-4000-8000-000000000301'::uuid, 'fa210000-0000-4000-8000-000000000401'::uuid, 'talabat',
  (select id from public.metric_definitions where key = 'revenue.gross' and organization_id is null),
  'money', 'organization', 'day', period_start::timestamptz, period_end::timestamptz, 'Asia/Dubai',
  numerator, 'AED', 'measured', state, repeat('c', 64), period_end::timestamptz
from (values
  ('fa210000-0000-4000-8000-000000000511', '2026-01-01 00:00:00+04', '2026-01-02 00:00:00+04', 120000, 'current'),
  ('fa210000-0000-4000-8000-000000000512', '2026-01-02 00:00:00+04', '2026-01-03 00:00:00+04', 90000, 'blocked_overlap'),
  ('fa210000-0000-4000-8000-000000000513', '2026-01-08 00:00:00+04', '2026-01-09 00:00:00+04', 70000, 'current'),
  ('fa210000-0000-4000-8000-000000000514', '2026-02-01 00:00:00+04', '2026-02-02 00:00:00+04', 3863, 'current'),
  ('fa210000-0000-4000-8000-000000000515', '2026-02-02 00:00:00+04', '2026-02-03 00:00:00+04', 2, 'current')
) as observations(observation_id, period_start, period_end, numerator, state);

insert into public.channel_analysis_runs (
  id, organization_id, channel_id, branch_id, window_start, window_end, period_grain,
  window_timezone, registry_version, detector_versions, metric_versions, input_digest,
  status, safe_failure_code, result_digest, correlation_id, completed_at
) values
  ('fa210000-0000-4000-8000-000000000601'::uuid, 'fa210000-0000-4000-8000-000000000201'::uuid,
   'fa210000-0000-4000-8000-000000000401'::uuid, 'fa210000-0000-4000-8000-000000000301'::uuid,
   date '2026-01-01', date '2026-01-05', 'day', 'Asia/Dubai', 1,
   '[{"key":"evidence.period_coverage","calculationVersion":1}]'::jsonb, '[]'::jsonb,
   repeat('a', 64), 'running', null, null, 'fa210000-0000-4000-8000-000000000701'::uuid, null),
  ('fa210000-0000-4000-8000-000000000602'::uuid, 'fa210000-0000-4000-8000-000000000201'::uuid,
   'fa210000-0000-4000-8000-000000000401'::uuid, 'fa210000-0000-4000-8000-000000000301'::uuid,
   date '2026-01-01', date '2026-01-05', 'day', 'Asia/Dubai', 1,
   '[{"key":"evidence.period_coverage","calculationVersion":1}]'::jsonb, '[]'::jsonb,
   repeat('b', 64), 'completed', null, repeat('9', 64), 'fa210000-0000-4000-8000-000000000702'::uuid, now()),
  ('fa210000-0000-4000-8000-000000000604'::uuid, 'fa210000-0000-4000-8000-000000000201'::uuid,
   'fa210000-0000-4000-8000-000000000401'::uuid, 'fa210000-0000-4000-8000-000000000301'::uuid,
   date '2026-01-01', date '2026-01-05', 'day', 'Asia/Dubai', 1,
   '[{"key":"evidence.period_coverage","calculationVersion":1}]'::jsonb, '[]'::jsonb,
   repeat('d', 64), 'failed', 'EVIDENCE_UNAVAILABLE', repeat('8', 64),
   'fa210000-0000-4000-8000-000000000704'::uuid, now()),
  ('fa210000-0000-4000-8000-000000000605'::uuid, 'fa210000-0000-4000-8000-000000000201'::uuid,
   'fa210000-0000-4000-8000-000000000401'::uuid, 'fa210000-0000-4000-8000-000000000301'::uuid,
   date '2026-01-08', date '2026-01-12', 'day', 'Asia/Dubai', 1,
   '[{"key":"evidence.period_coverage","calculationVersion":1}]'::jsonb, '[]'::jsonb,
   repeat('e', 64), 'completed', null, repeat('7', 64), 'fa210000-0000-4000-8000-000000000705'::uuid, now()),
  ('fa210000-0000-4000-8000-000000000606'::uuid, 'fa210000-0000-4000-8000-000000000201'::uuid,
   'fa210000-0000-4000-8000-000000000401'::uuid, 'fa210000-0000-4000-8000-000000000301'::uuid,
   date '2026-02-01', date '2026-02-05', 'day', 'Asia/Dubai', 1,
   '[{"key":"funnel.stage_conversion","calculationVersion":1},{"key":"customer.new_share","calculationVersion":1}]'::jsonb, '[]'::jsonb,
   repeat('c', 64), 'completed', null, repeat('5', 64), 'fa210000-0000-4000-8000-000000000706'::uuid, now());

insert into public.channel_analysis_runs (
  id, organization_id, channel_id, branch_id, window_start, window_end, period_grain,
  window_timezone, registry_version, detector_versions, metric_versions, input_digest,
  status, result_digest, correlation_id, completed_at
) values (
  'fa210000-0000-4000-8000-000000000603'::uuid, 'fa210000-0000-4000-8000-000000000202'::uuid,
  'fa210000-0000-4000-8000-000000000402'::uuid, 'fa210000-0000-4000-8000-000000000302'::uuid,
  date '2026-01-01', date '2026-01-05', 'day', 'Asia/Dubai', 1,
  '[{"key":"evidence.period_coverage","calculationVersion":1}]'::jsonb, '[]'::jsonb,
  repeat('f', 64), 'completed', repeat('6', 64), 'fa210000-0000-4000-8000-000000000703'::uuid, now());

insert into public.channel_findings (
  id, organization_id, analysis_run_id, channel_id, branch_id, detector_key, detector_version,
  kind, code, quality_state, calculation_digest
) values
  ('fa210000-0000-4000-8000-000000000501'::uuid, 'fa210000-0000-4000-8000-000000000201'::uuid,
   'fa210000-0000-4000-8000-000000000602'::uuid, 'fa210000-0000-4000-8000-000000000401'::uuid,
   'fa210000-0000-4000-8000-000000000301'::uuid, 'evidence.period_coverage', 1, 'observation',
   'PERIOD_COVERAGE_INCOMPLETE', 'complete', repeat('1', 64)),
  ('fa210000-0000-4000-8000-000000000502'::uuid, 'fa210000-0000-4000-8000-000000000201'::uuid,
   'fa210000-0000-4000-8000-000000000602'::uuid, 'fa210000-0000-4000-8000-000000000401'::uuid,
   'fa210000-0000-4000-8000-000000000301'::uuid, 'evidence.revenue_movement', 1, 'observation',
   'REVENUE_PERIOD_MOVEMENT', 'complete', repeat('2', 64)),
  ('fa210000-0000-4000-8000-000000000503'::uuid, 'fa210000-0000-4000-8000-000000000201'::uuid,
   'fa210000-0000-4000-8000-000000000601'::uuid, 'fa210000-0000-4000-8000-000000000401'::uuid,
   'fa210000-0000-4000-8000-000000000301'::uuid, 'evidence.period_coverage', 1, 'observation',
   'PERIOD_COVERAGE_INCOMPLETE', 'complete', repeat('3', 64)),
  ('fa210000-0000-4000-8000-000000000505'::uuid, 'fa210000-0000-4000-8000-000000000201'::uuid,
   'fa210000-0000-4000-8000-000000000605'::uuid, 'fa210000-0000-4000-8000-000000000401'::uuid,
   'fa210000-0000-4000-8000-000000000301'::uuid, 'evidence.period_coverage', 1, 'observation',
   'PERIOD_COVERAGE_INCOMPLETE', 'complete', repeat('5', 64)),
  ('fa210000-0000-4000-8000-000000000506'::uuid, 'fa210000-0000-4000-8000-000000000201'::uuid,
   'fa210000-0000-4000-8000-000000000606'::uuid, 'fa210000-0000-4000-8000-000000000401'::uuid,
   'fa210000-0000-4000-8000-000000000301'::uuid, 'funnel.stage_conversion', 1, 'observation',
   'FUNNEL_STAGE_CONVERSION', 'complete', repeat('6', 64)),
  ('fa210000-0000-4000-8000-000000000507'::uuid, 'fa210000-0000-4000-8000-000000000201'::uuid,
   'fa210000-0000-4000-8000-000000000606'::uuid, 'fa210000-0000-4000-8000-000000000401'::uuid,
   'fa210000-0000-4000-8000-000000000301'::uuid, 'customer.new_share', 1, 'observation',
   'CUSTOMER_REPEAT_SHARE', 'complete', repeat('7', 64));

-- The cross-tenant finding: same shape, another organization's run entirely.
insert into public.channel_findings (
  id, organization_id, analysis_run_id, channel_id, branch_id, detector_key, detector_version,
  kind, code, quality_state, calculation_digest
) values (
  'fa210000-0000-4000-8000-000000000504'::uuid, 'fa210000-0000-4000-8000-000000000202'::uuid,
  'fa210000-0000-4000-8000-000000000603'::uuid, 'fa210000-0000-4000-8000-000000000402'::uuid,
  'fa210000-0000-4000-8000-000000000302'::uuid, 'evidence.period_coverage', 1, 'observation',
  'PERIOD_COVERAGE_INCOMPLETE', 'complete', repeat('4', 64));

insert into public.channel_finding_evidence (
  organization_id, finding_id, evidence_kind, evidence_role, normalized_metric_id
) values
  ('fa210000-0000-4000-8000-000000000201'::uuid, 'fa210000-0000-4000-8000-000000000501'::uuid,
   'normalized_metric', 'component', 'fa210000-0000-4000-8000-000000000511'::uuid),
  ('fa210000-0000-4000-8000-000000000201'::uuid, 'fa210000-0000-4000-8000-000000000502'::uuid,
   'normalized_metric', 'component', 'fa210000-0000-4000-8000-000000000512'::uuid),
  ('fa210000-0000-4000-8000-000000000201'::uuid, 'fa210000-0000-4000-8000-000000000505'::uuid,
   'normalized_metric', 'component', 'fa210000-0000-4000-8000-000000000513'::uuid),
  ('fa210000-0000-4000-8000-000000000201'::uuid, 'fa210000-0000-4000-8000-000000000506'::uuid,
   'normalized_metric', 'component', 'fa210000-0000-4000-8000-000000000514'::uuid),
  ('fa210000-0000-4000-8000-000000000201'::uuid, 'fa210000-0000-4000-8000-000000000507'::uuid,
   'normalized_metric', 'component', 'fa210000-0000-4000-8000-000000000515'::uuid);

create or replace function pg_temp.claim(
  p_run text, p_correlation text, p_token text,
  p_org text default 'fa210000-0000-4000-8000-000000000201')
returns jsonb language sql as $$
  select public.claim_channel_recommendations(p_org::uuid, p_run::uuid, p_correlation, p_token::uuid);
$$;

create or replace function pg_temp.item(p_overrides jsonb default '{}'::jsonb)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'label', 'observation',
    'headline', 'Two days of Talabat revenue are missing from the window',
    'detail', 'The window declares five days but evidence covers three, so movement figures compare unequal periods.',
    'supportedActions', jsonb_build_array('Reconnect the Talabat integration to backfill the missing days.'),
    'limitations', jsonb_build_array('A period is counted as covered when a current observation starts in it.'),
    'citations', jsonb_build_array('fa210000-0000-4000-8000-000000000501')
  ) || p_overrides;
$$;

create or replace function pg_temp.complete(
  p_run text, p_token text, p_items jsonb, p_result_digest text default repeat('b', 64))
returns jsonb language sql as $$
  select public.complete_channel_recommendations(
    'fa210000-0000-4000-8000-000000000201'::uuid, p_run::uuid, p_token::uuid,
    'openai', 'gpt-test', 1, repeat('d', 64), repeat('e', 64), p_result_digest, p_items);
$$;

-- The lease row is writable by nobody, including service_role; these read and
-- adjust it through definer rights so expiry and bookkeeping can be staged.
create or replace function pg_temp.expire_recommendation_lease(p_run text)
returns void
language sql
security definer
set search_path = ''
as $$
  update private.channel_recommendation_operations
  set lease_expires_at = now() - interval '1 hour'
  where organization_id = 'fa210000-0000-4000-8000-000000000201'::uuid
    and analysis_run_id = p_run::uuid;
$$;

create or replace function pg_temp.operation_row(p_org text, p_run text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select to_jsonb(o) from private.channel_recommendation_operations o
  where o.organization_id = p_org::uuid and o.analysis_run_id = p_run::uuid;
$$;

set local role service_role;

-- Claiming a completed run -----------------------------------------------------------

select extensions.is((pg_temp.claim('fa210000-0000-4000-8000-000000000999', 'channel-recs-correlation-000001', 'fa210000-0000-4000-8000-000000000801') ->> 'outcome'), 'not_found', 'an unknown run has nothing to narrate');
select extensions.is((pg_temp.claim('fa210000-0000-4000-8000-000000000603', 'channel-recs-correlation-000001', 'fa210000-0000-4000-8000-000000000801') ->> 'outcome'), 'not_found', 'another organization''s completed run does not resolve either');
select extensions.is((pg_temp.claim('fa210000-0000-4000-8000-000000000601', 'channel-recs-correlation-000001', 'fa210000-0000-4000-8000-000000000801') ->> 'outcome'), 'not_ready', 'a run whose analysis is still open is not ready to be narrated');
select extensions.is((pg_temp.claim('fa210000-0000-4000-8000-000000000604', 'channel-recs-correlation-000001', 'fa210000-0000-4000-8000-000000000801') ->> 'outcome'), 'not_ready', 'and neither is one whose analysis failed');
select extensions.is((pg_temp.claim('fa210000-0000-4000-8000-000000000602', 'channel-recs-correlation-000001', 'fa210000-0000-4000-8000-000000000801') ->> 'outcome'), 'acquired', 'a completed analysis run hands its narration lease over');
select extensions.is((pg_temp.claim('fa210000-0000-4000-8000-000000000602', 'channel-recs-correlation-000001', 'fa210000-0000-4000-8000-000000000801') ->> 'windowStart'), '2026-01-01', 'the lease echoes the window the run declared');
select extensions.is((pg_temp.claim('fa210000-0000-4000-8000-000000000602', 'channel-recs-correlation-000001', 'fa210000-0000-4000-8000-000000000801') ->> 'windowEnd'), '2026-01-05', 'both edges of it');
select extensions.is((pg_temp.claim('fa210000-0000-4000-8000-000000000602', 'channel-recs-correlation-000001', 'fa210000-0000-4000-8000-000000000801') ->> 'periodGrain'), 'day', 'and the grain the figures were cut by');
select extensions.is((pg_temp.claim('fa210000-0000-4000-8000-000000000602', 'channel-recs-correlation-000002', 'fa210000-0000-4000-8000-000000000802') ->> 'outcome'), 'conflict', 'a different workflow trying to narrate the same run is a conflict, not a second answer');
select extensions.is((pg_temp.claim('fa210000-0000-4000-8000-000000000602', 'channel-recs-correlation-000001', 'fa210000-0000-4000-8000-000000000802') ->> 'outcome'), 'in_progress', 'the same workflow under a fresh token waits while the live lease holds');
select extensions.lives_ok(
  $$ select pg_temp.expire_recommendation_lease('fa210000-0000-4000-8000-000000000602') $$,
  'time passes; a lease expires');
select extensions.is((pg_temp.claim('fa210000-0000-4000-8000-000000000602', 'channel-recs-correlation-000001', 'fa210000-0000-4000-8000-000000000802') ->> 'outcome'), 'acquired', 'the same workflow resumes its own expired lease');
select extensions.ok(((pg_temp.operation_row('fa210000-0000-4000-8000-000000000201', 'fa210000-0000-4000-8000-000000000602') ->> 'attempt_count')::integer > 1), 'and the retry budget counts the resumption');

-- Refusals first, while the lease is live and nothing has been written -----------------

select extensions.is(pg_temp.complete('fa210000-0000-4000-8000-000000000602', 'fa210000-0000-4000-8000-0000000008ff', jsonb_build_array(pg_temp.item())), null, 'a claim token the worker does not hold writes nothing');

select extensions.throws_ok(
  $$ select pg_temp.complete('fa210000-0000-4000-8000-000000000602', 'fa210000-0000-4000-8000-000000000802',
       coalesce((select jsonb_agg(pg_temp.item()) from generate_series(1, 9)), '[]'::jsonb)) $$,
  'P0001', 'RECOMMENDATION_CAP_EXCEEDED',
  'nine narrated answers for six chapters and two data gaps is one too many, and is refused outright');

select extensions.throws_ok(
  $$ select pg_temp.complete('fa210000-0000-4000-8000-000000000602', 'fa210000-0000-4000-8000-000000000802', '[]'::jsonb) $$,
  '22023', 'channel recommendation submission is invalid',
  'an empty submission narrates nothing and records nothing');

select extensions.throws_ok(
  $$ select public.complete_channel_recommendations(
       'fa210000-0000-4000-8000-000000000201'::uuid, 'fa210000-0000-4000-8000-000000000602'::uuid,
       'fa210000-0000-4000-8000-000000000802'::uuid, 'openai', 'gpt-test', 1,
       repeat('d', 64), null, repeat('b', 64), jsonb_build_array(pg_temp.item())) $$,
  '22023', 'channel recommendation submission is invalid',
  'a submission whose output digest is missing is refused, because unattributed words teach nothing');

select extensions.throws_ok(
  $$ select pg_temp.complete('fa210000-0000-4000-8000-000000000602', 'fa210000-0000-4000-8000-000000000802', jsonb_build_array(pg_temp.item('{"invented": true}'::jsonb))) $$,
  '22023', 'channel recommendation item is invalid',
  'a field the contract does not know is refused rather than ignored');

select extensions.throws_ok(
  $$ select pg_temp.complete('fa210000-0000-4000-8000-000000000602', 'fa210000-0000-4000-8000-000000000802', jsonb_build_array(pg_temp.item('{"supportedActions": [42]}'::jsonb))) $$,
  '22023', 'channel recommendation action is invalid',
  'a supported action is prose a human can read, not a number');

select extensions.throws_ok(
  $$ select pg_temp.complete('fa210000-0000-4000-8000-000000000602', 'fa210000-0000-4000-8000-000000000802', jsonb_build_array(pg_temp.item('{"citations": ["fa210000-0000-4000-8000-000000000503"]}'::jsonb))) $$,
  'P0001', 'CITATION_NOT_IN_RUN',
  'prose may not cite a finding the narrated run never produced');

select extensions.throws_ok(
  $$ select pg_temp.complete('fa210000-0000-4000-8000-000000000602', 'fa210000-0000-4000-8000-000000000802', jsonb_build_array(pg_temp.item('{"citations": ["fa210000-0000-4000-8000-000000000504"]}'::jsonb))) $$,
  'P0001', 'CITATION_NOT_IN_RUN',
  'and least of all a finding that belongs to another organization');

select extensions.throws_ok(
  $$ select pg_temp.complete('fa210000-0000-4000-8000-000000000602', 'fa210000-0000-4000-8000-000000000802', jsonb_build_array(pg_temp.item('{"citations": ["fa210000-0000-4000-8000-000000000502"]}'::jsonb))) $$,
  '23514', 'channel analysis cites metric evidence that is not current',
  'narration built on a held figure is held prose, and is refused by the same rule the detector path enforces');

select extensions.throws_ok(
  $$ select pg_temp.complete('fa210000-0000-4000-8000-000000000602', 'fa210000-0000-4000-8000-000000000802', jsonb_build_array(pg_temp.item('{"label": "actionable_insight"}'::jsonb))) $$,
  '23514', 'new row for relation "channel_recommendations" violates check constraint "channel_recommendations_label_check"',
  'the label meets the storage table''s own enum, and nothing else gets past it');

select extensions.is((select count(*)::integer from public.channel_recommendations where organization_id = 'fa210000-0000-4000-8000-000000000201'::uuid), 0, 'every refusal so far has written nothing');

-- The successful filing ---------------------------------------------------------------

select extensions.is((pg_temp.complete('fa210000-0000-4000-8000-000000000602', 'fa210000-0000-4000-8000-000000000802', jsonb_build_array(
  pg_temp.item(),
  pg_temp.item('{"label": "needs_data", "headline": "The evidence cannot yet support a recommendation", "detail": "Every detector outcome in this window is an observation without a value, so there is nothing actionable to propose.", "supportedActions": []}'::jsonb)
)) ->> 'recommendationCount'), '2', 'two schema-shaped recommendations land under their lease');

select extensions.is((pg_temp.complete('fa210000-0000-4000-8000-000000000602', 'fa210000-0000-4000-8000-000000000802', jsonb_build_array(
  pg_temp.item(),
  pg_temp.item('{"label": "needs_data", "headline": "The evidence cannot yet support a recommendation", "detail": "Every detector outcome in this window is an observation without a value, so there is nothing actionable to propose.", "supportedActions": []}'::jsonb)
)) ->> 'citationCount'), '2', 'and the same submission replayed reports the stored citations instead of duplicating them');

select extensions.is((select count(*)::integer from public.channel_recommendations where analysis_run_id = 'fa210000-0000-4000-8000-000000000602'::uuid), 2, 'the replay filed no duplicate rows');
select extensions.ok((
  select bool_and(r.channel_id = 'fa210000-0000-4000-8000-000000000401'::uuid
    and r.branch_id = 'fa210000-0000-4000-8000-000000000301'::uuid
    and r.window_start = date '2026-01-01' and r.window_end = date '2026-01-05'
    and r.period_grain = 'day')
  from public.channel_recommendations r
  where r.analysis_run_id = 'fa210000-0000-4000-8000-000000000602'::uuid
), 'every recommendation inherits the run''s own scope, never the caller''s word');
select extensions.is((select count(*)::integer from public.channel_recommendation_citations c join public.channel_recommendations r on r.id = c.recommendation_id where r.analysis_run_id = 'fa210000-0000-4000-8000-000000000602'::uuid), 2, 'each cited finding resolves to the row it came from');
select extensions.is(pg_temp.operation_row('fa210000-0000-4000-8000-000000000201', 'fa210000-0000-4000-8000-000000000602'), null, 'an acknowledged submission releases its lease');

select extensions.throws_ok(
  $$ select pg_temp.complete('fa210000-0000-4000-8000-000000000602', 'fa210000-0000-4000-8000-000000000802', jsonb_build_array(pg_temp.item()), repeat('3', 64)) $$,
  '23514', 'channel recommendations were already filed for this analysis run',
  'a second answer under one run''s identity is refused; regeneration belongs to a new analysis run');
select extensions.is((pg_temp.claim('fa210000-0000-4000-8000-000000000602', 'channel-recs-correlation-000001', 'fa210000-0000-4000-8000-000000000803') ->> 'outcome'), 'gapfill_acquired', 'a narrated run with an uncited finding leases its one gap-fill instead of reporting done');

-- Failing a run ------------------------------------------------------------------------

select extensions.is(public.fail_channel_recommendations(
    'fa210000-0000-4000-8000-000000000201'::uuid, 'fa210000-0000-4000-8000-000000000605'::uuid,
    'fa210000-0000-4000-8000-000000000805'::uuid, 'NARRATION_PROCESSING_FAILED', repeat('7', 64)), null,
  'a failure reported without a live lease records nothing');
select extensions.is((pg_temp.claim('fa210000-0000-4000-8000-000000000605', 'channel-recs-correlation-000003', 'fa210000-0000-4000-8000-000000000805') ->> 'outcome'), 'acquired', 'a fresh completed run hands out its own lease');
select extensions.throws_ok(
  $$ select public.fail_channel_recommendations(
       'fa210000-0000-4000-8000-000000000201'::uuid, 'fa210000-0000-4000-8000-000000000605'::uuid,
       'fa210000-0000-4000-8000-000000000805'::uuid, 'EXPLODED_MESSILY', repeat('7', 64)) $$,
  '22023', 'channel recommendation failure is invalid',
  'a failure code an operator cannot read is refused');
select extensions.lives_ok(
  $$ select public.fail_channel_recommendations(
       'fa210000-0000-4000-8000-000000000201'::uuid, 'fa210000-0000-4000-8000-000000000605'::uuid,
       'fa210000-0000-4000-8000-000000000805'::uuid, 'NARRATION_PROCESSING_FAILED', repeat('7', 64)) $$,
  'a narration that could not be produced fails safely');
select extensions.is((pg_temp.operation_row('fa210000-0000-4000-8000-000000000201', 'fa210000-0000-4000-8000-000000000605') ->> 'failure_code'), 'NARRATION_PROCESSING_FAILED', 'and says why');
select extensions.is((pg_temp.operation_row('fa210000-0000-4000-8000-000000000201', 'fa210000-0000-4000-8000-000000000605') ->> 'result_digest'), repeat('7', 64), 'with the digest of the submission that failed, and nothing deleted');
select extensions.is((select count(*)::integer from public.channel_recommendations where analysis_run_id = 'fa210000-0000-4000-8000-000000000605'::uuid), 0, 'a failed narration leaves no recommendation behind');
select extensions.is((pg_temp.claim('fa210000-0000-4000-8000-000000000605', 'channel-recs-correlation-000003', 'fa210000-0000-4000-8000-000000000806') ->> 'outcome'), 'acquired', 'and the run may be claimed again within its retry budget');

-- The Amendment C cap: eight items file ---------------------------------------------

select extensions.is((pg_temp.complete('fa210000-0000-4000-8000-000000000605', 'fa210000-0000-4000-8000-000000000806',
  coalesce((select jsonb_agg(pg_temp.item('{"citations": ["fa210000-0000-4000-8000-000000000505"]}'::jsonb)) from generate_series(1, 8)), '[]'::jsonb)
) ->> 'recommendationCount'), '8', 'eight items — six chapters plus two data gaps — file under the raised cap');

-- The gap-fill lifecycle (Amendment C, ADR 0053) --------------------------------------

select extensions.is((pg_temp.claim('fa210000-0000-4000-8000-000000000606', 'channel-recs-correlation-000004', 'fa210000-0000-4000-8000-000000000807') ->> 'outcome'), 'acquired', 'a run with no narration yet claims its first lease');
select extensions.is((pg_temp.complete('fa210000-0000-4000-8000-000000000606', 'fa210000-0000-4000-8000-000000000807',
  jsonb_build_array(pg_temp.item('{"citations": ["fa210000-0000-4000-8000-000000000506"]}'::jsonb))) ->> 'recommendationCount'), '1', 'the first narration cites the funnel finding only');
select extensions.is((pg_temp.claim('fa210000-0000-4000-8000-000000000606', 'channel-recs-correlation-000005', 'fa210000-0000-4000-8000-000000000807') ->> 'outcome'), 'gapfill_acquired', 'a narrated run with an uncited finding leases its one gap-fill');
select extensions.throws_ok(
  $$ select pg_temp.complete('fa210000-0000-4000-8000-000000000606', 'fa210000-0000-4000-8000-000000000807', jsonb_build_array(
       pg_temp.item('{"citations": ["fa210000-0000-4000-8000-000000000507"]}'::jsonb),
       pg_temp.item('{"citations": ["fa210000-0000-4000-8000-000000000506"]}'::jsonb)), repeat('e', 64)) $$,
  '23514', 'GAPFILL_CITES_FILED_FINDING',
  'a gap-fill mixing an uncited finding with an already-cited one is refused outright');
select extensions.throws_ok(
  $$ select pg_temp.complete('fa210000-0000-4000-8000-000000000606', 'fa210000-0000-4000-8000-000000000807',
       coalesce((select jsonb_agg(pg_temp.item('{"citations": ["fa210000-0000-4000-8000-000000000507"]}'::jsonb)) from generate_series(1, 8)), '[]'::jsonb), repeat('f', 64)) $$,
  'P0001', 'RECOMMENDATION_CAP_EXCEEDED',
  'one filed plus eight more would pass the per-run budget of eight');
select extensions.is((pg_temp.complete('fa210000-0000-4000-8000-000000000606', 'fa210000-0000-4000-8000-000000000807',
  jsonb_build_array(pg_temp.item('{"citations": ["fa210000-0000-4000-8000-000000000507"]}'::jsonb)), repeat('c', 64)) ->> 'recommendationCount'), '1', 'the gap-fill files the bare retention finding');
select extensions.is((pg_temp.claim('fa210000-0000-4000-8000-000000000606', 'channel-recs-correlation-000006', 'fa210000-0000-4000-8000-000000000807') ->> 'outcome'), 'completed', 'a twice-narrated run is done: no third lease');
select extensions.throws_ok(
  $$ select pg_temp.complete('fa210000-0000-4000-8000-000000000606', 'fa210000-0000-4000-8000-000000000807',
       jsonb_build_array(pg_temp.item('{"citations": ["fa210000-0000-4000-8000-000000000507"]}'::jsonb)), repeat('d', 64)) $$,
  '23514', 'channel recommendations were already filed for this analysis run',
  're-citing a filed finding after the gap-fill is still a second answer');

-- Session denial -------------------------------------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'fa210000-0000-4000-8000-000000000002';

select extensions.throws_ok(
  $$ select public.claim_channel_recommendations(
       'fa210000-0000-4000-8000-000000000201'::uuid, 'fa210000-0000-4000-8000-000000000602'::uuid,
       'channel-recs-correlation-000009', 'fa210000-0000-4000-8000-000000000809'::uuid) $$,
  '42501', 'permission denied for function claim_channel_recommendations',
  'a member session cannot claim the narration lease');
select extensions.throws_ok(
  $$ select public.complete_channel_recommendations(
       'fa210000-0000-4000-8000-000000000201'::uuid, 'fa210000-0000-4000-8000-000000000602'::uuid,
       'fa210000-0000-4000-8000-000000000809'::uuid, 'openai', 'gpt-test', 1,
       repeat('d', 64), repeat('e', 64), repeat('b', 64), jsonb_build_array(pg_temp.item())) $$,
  '42501', 'permission denied for function complete_channel_recommendations',
  'nor file narration');
select extensions.throws_ok(
  $$ select public.fail_channel_recommendations(
       'fa210000-0000-4000-8000-000000000201'::uuid, 'fa210000-0000-4000-8000-000000000602'::uuid,
       'fa210000-0000-4000-8000-000000000809'::uuid, 'NARRATION_PROCESSING_FAILED', repeat('7', 64)) $$,
  '42501', 'permission denied for function fail_channel_recommendations',
  'nor record a narration failure');

select extensions.is((select count(*)::integer from public.channel_recommendations
  where organization_id = 'fa210000-0000-4000-8000-000000000201'::uuid), 0,
  'another organization''s member sees none of the narration that was filed');

select * from extensions.finish();

rollback;
