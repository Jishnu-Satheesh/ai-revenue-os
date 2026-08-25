begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(14);

-- The judge's only write path: one admission RPC, worker-owned, atomic per
-- batch. The table arrived with the storage slice; what is proved here is
-- that verdicts land only through this door, only whole, and only once.

-- Structure -----------------------------------------------------------------------

select extensions.has_function('public', 'admit_channel_recommendation_evaluations',
  'the judge files through one admission function');

select extensions.ok(
  pg_catalog.has_function_privilege('service_role', 'public.admit_channel_recommendation_evaluations(uuid,uuid,text,text,integer,text,text,jsonb)', 'execute'),
  'the narrator''s evaluator holds execute');
select extensions.ok(
  not pg_catalog.has_function_privilege('anon', 'public.admit_channel_recommendation_evaluations(uuid,uuid,text,text,integer,text,text,jsonb)', 'execute'),
  'anonymous callers hold none');
select extensions.ok(
  not pg_catalog.has_function_privilege('authenticated', 'public.admit_channel_recommendation_evaluations(uuid,uuid,text,text,integer,text,text,jsonb)', 'execute'),
  'members hold none -- verdicts are worker machinery');

-- Fixtures: two tenants, each with a completed run and a narrated
-- recommendation, so cross-tenant refusals exercise rows another tenant
-- actually owns rather than invented ids.
insert into auth.users (id) values ('fb230000-0000-4000-8000-000000000001'::uuid);
insert into public.accounts (id, name, slug, created_by) values
  ('fb230000-0000-4000-8000-000000000101'::uuid, 'Evaluations verifier', 'evaluations-verifier', 'fb230000-0000-4000-8000-000000000001'::uuid),
  ('fb230000-0000-4000-8000-000000000102'::uuid, 'Evaluations outsider', 'evaluations-outsider', 'fb230000-0000-4000-8000-000000000001'::uuid);
insert into public.organizations (id, account_id, name, slug, industry, country_code, base_currency, default_timezone, created_by) values
  ('fb230000-0000-4000-8000-000000000201'::uuid, 'fb230000-0000-4000-8000-000000000101'::uuid, 'Evaluations verifier', 'evaluations-verifier', 'testing', 'AE', 'AED', 'Asia/Dubai', 'fb230000-0000-4000-8000-000000000001'::uuid),
  ('fb230000-0000-4000-8000-000000000202'::uuid, 'fb230000-0000-4000-8000-000000000102'::uuid, 'Evaluations outsider', 'evaluations-outsider', 'testing', 'AE', 'AED', 'Asia/Dubai', 'fb230000-0000-4000-8000-000000000001'::uuid);
insert into public.account_memberships (account_id, user_id, account_role, default_organization_role) values
  ('fb230000-0000-4000-8000-000000000101'::uuid, 'fb230000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner');

insert into public.branches (id, organization_id, name, slug, kind, timezone, currency)
values ('fb230000-0000-4000-8000-000000000301'::uuid, 'fb230000-0000-4000-8000-000000000201'::uuid, 'Dubai outlet', 'evaluations-dubai', 'physical', 'Asia/Dubai', 'AED');
insert into public.organization_channels (id, organization_id, key, display_name, category, created_by)
values ('fb230000-0000-4000-8000-000000000401'::uuid, 'fb230000-0000-4000-8000-000000000201'::uuid, 'talabat', 'Talabat', 'marketplace', 'fb230000-0000-4000-8000-000000000001'::uuid);
-- The outsider gets real parents of its own so cross-tenant refusals exercise
-- rows another tenant actually owns rather than invented ids.
insert into public.branches (id, organization_id, name, slug, kind, timezone, currency)
values ('fb230000-0000-4000-8000-000000000302'::uuid, 'fb230000-0000-4000-8000-000000000202'::uuid, 'Outsider outlet', 'evaluations-outsider', 'physical', 'Asia/Dubai', 'AED');
insert into public.organization_channels (id, organization_id, key, display_name, category, created_by)
values ('fb230000-0000-4000-8000-000000000402'::uuid, 'fb230000-0000-4000-8000-000000000202'::uuid, 'talabat', 'Talabat', 'marketplace', 'fb230000-0000-4000-8000-000000000001'::uuid);

insert into public.channel_analysis_runs (
  id, organization_id, channel_id, branch_id, window_start, window_end, period_grain,
  window_timezone, registry_version, detector_versions, metric_versions, input_digest,
  status, result_digest, correlation_id, completed_at
) values
  ('fb230000-0000-4000-8000-000000000601'::uuid, 'fb230000-0000-4000-8000-000000000201'::uuid,
   'fb230000-0000-4000-8000-000000000401'::uuid, 'fb230000-0000-4000-8000-000000000301'::uuid,
   date '2026-01-01', date '2026-01-05', 'day', 'Asia/Dubai', 1,
   '[{"key":"evidence.period_coverage","calculationVersion":1}]'::jsonb, '[]'::jsonb,
   repeat('a', 64), 'completed', repeat('b', 64),
   'fb230000-0000-4000-8000-000000000701'::uuid, now()),
  ('fb230000-0000-4000-8000-000000000602'::uuid, 'fb230000-0000-4000-8000-000000000202'::uuid,
   'fb230000-0000-4000-8000-000000000402'::uuid, 'fb230000-0000-4000-8000-000000000302'::uuid,
   date '2026-01-01', date '2026-01-05', 'day', 'Asia/Dubai', 1,
   '[{"key":"evidence.period_coverage","calculationVersion":1}]'::jsonb, '[]'::jsonb,
   repeat('c', 64), 'completed', repeat('d', 64),
   'fb230000-0000-4000-8000-000000000702'::uuid, now());

insert into public.channel_recommendations (
  id, organization_id, channel_id, branch_id, analysis_run_id, window_start, window_end,
  period_grain, label, headline, detail, supported_actions, limitations, prompt_version,
  prompt_digest, output_digest, provider, model_id, result_digest
) values
  ('fb230000-0000-4000-8000-000000000801'::uuid, 'fb230000-0000-4000-8000-000000000201'::uuid,
   'fb230000-0000-4000-8000-000000000401'::uuid, 'fb230000-0000-4000-8000-000000000301'::uuid,
   'fb230000-0000-4000-8000-000000000601'::uuid, date '2026-01-01', date '2026-01-05', 'day',
   'recommendation', 'Verifier narration', 'Filed by the owning tenant.',
   '[]'::jsonb, '[]'::jsonb, 1, repeat('e', 64), repeat('f', 64), 'openai', 'gpt-test', repeat('1', 64)),
  ('fb230000-0000-4000-8000-000000000802'::uuid, 'fb230000-0000-4000-8000-000000000202'::uuid,
   'fb230000-0000-4000-8000-000000000402'::uuid, 'fb230000-0000-4000-8000-000000000302'::uuid,
   'fb230000-0000-4000-8000-000000000602'::uuid, date '2026-01-01', date '2026-01-05', 'day',
   'observation', 'Outsider narration', 'Filed by the neighbouring tenant.',
   '[]'::jsonb, '[]'::jsonb, 1, repeat('0', 64), repeat('2', 64), 'openai', 'gpt-test', repeat('3', 64));

create or replace function pg_temp.admit(
  p_org text, p_batch text, p_evaluations jsonb)
returns jsonb language sql as $$
  select public.admit_channel_recommendation_evaluations(
    p_org::uuid, p_batch::uuid, 'google', 'gemini-test', 1, repeat('9', 64), repeat('8', 64), p_evaluations);
$$;

-- Admission -----------------------------------------------------------------------

reset role;
set local role service_role;

select extensions.lives_ok(
  $$ select pg_temp.admit('fb230000-0000-4000-8000-000000000201', 'fb230000-0000-4000-8000-000000000901',
       '[{"recommendationId":"fb230000-0000-4000-8000-000000000801","citationFaithful":true,"labelAppropriate":true,"inventedValueDetected":false,"uncertaintyHonest":true,"score":4,"issues":[],"notes":"cites its own run"}]') $$,
  'a well-formed verdict lands');

select extensions.is((
  select count(*)::integer from public.channel_recommendation_evaluations
), 1, 'exactly one verdict row exists');

select extensions.is((
  select organization_id from public.channel_recommendation_evaluations
    where recommendation_id = 'fb230000-0000-4000-8000-000000000801'::uuid
), 'fb230000-0000-4000-8000-000000000201'::uuid,
  'the verdict inherits its recommendation''s tenant, not an argument''s word');

select extensions.throws_ok(
  $$ select pg_temp.admit('fb230000-0000-4000-8000-000000000201', 'fb230000-0000-4000-8000-000000000902',
       '[{"recommendationId":"fb230000-0000-4000-8000-000000000801","citationFaithful":true,"labelAppropriate":true,"inventedValueDetected":false,"uncertaintyHonest":true,"score":3,"issues":[],"notes":"again"}]') $$,
  'P0002', 'EVALUATION_TARGET_NOT_FOUND',
  'a second verdict for a judged recommendation refuses');

select extensions.throws_ok(
  $$ select pg_temp.admit('fb230000-0000-4000-8000-000000000201', 'fb230000-0000-4000-8000-000000000903',
       '[{"recommendationId":"fb230000-0000-4000-8000-000000000801","citationFaithful":true,"labelAppropriate":true,"inventedValueDetected":false,"uncertaintyHonest":true,"score":6,"issues":[],"notes":"too sure"}]') $$,
  '23514', null,
  'a score beyond the five-point scale refuses at the check constraint');

select extensions.throws_ok(
  $$ select pg_temp.admit('fb230000-0000-4000-8000-000000000201', 'fb230000-0000-4000-8000-000000000904',
       $j$[{"recommendationId":"fb230000-0000-4000-8000-000000000802","citationFaithful":true,"labelAppropriate":true,"inventedValueDetected":false,"uncertaintyHonest":true,"score":4,"issues":[],"notes":"cross"}]$j$) $$,
  'P0002', 'EVALUATION_TARGET_NOT_FOUND',
  -- The composite FK turns another tenant's real recommendation id into the
  -- same refusal as an invented one.
  'a verdict naming the neighbour''s recommendation refuses like an unknown id');

select extensions.throws_ok(
  $$ select pg_temp.admit('fb230000-0000-4000-8000-000000000201', null, '[{"recommendationId":"fb230000-0000-4000-8000-000000000801","citationFaithful":true,"labelAppropriate":true,"inventedValueDetected":false,"uncertaintyHonest":true,"score":4,"issues":[],"notes":"x"}]') $$,
  '22023', 'BATCH_ID_REQUIRED',
  'a batch without an id refuses');

select extensions.throws_ok(
  $$ select pg_temp.admit('fb230000-0000-4000-8000-000000000201', 'fb230000-0000-4000-8000-000000000905', '{"nope":1}') $$,
  '22023', 'EVALUATIONS_MUST_BE_ARRAY',
  'a non-array batch refuses');

-- Isolation -----------------------------------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'fb230000-0000-4000-8000-000000000001';

select extensions.is((
  select count(*)::integer from public.channel_recommendation_evaluations
), 1, 'a member of one tenant sees only their own verdicts');

rollback;
