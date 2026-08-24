begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(38);

-- The human fence: the two RPCs through which a member answers what the
-- narrator said. Everything here is exercised as real member sessions --
-- `authenticated` carrying a jwt sub -- because the entire point of these
-- functions is who may call them and as whom: identity from the session, never
-- from an argument; authority from the caller's own role; and a recommendation
-- that resolves nowhere in their tenant resolving nowhere at all.

-- Structure -----------------------------------------------------------------------

select extensions.has_function('public', 'triage_channel_recommendation', 'the triage answer is database-owned');
select extensions.has_function('public', 'record_channel_recommendation_feedback', 'so is the helpfulness vote');

-- User-facing by design: members hold execute; the narrator's workers and the
-- anonymous public hold none. service_role especially must not be able to
-- triage on anyone's behalf -- these paths exist because a person answered.
select extensions.ok(pg_catalog.has_function_privilege('authenticated', 'public.triage_channel_recommendation(uuid,uuid,text,text,uuid)', 'execute'), 'members hold the triage path');
select extensions.ok(pg_catalog.has_function_privilege('authenticated', 'public.record_channel_recommendation_feedback(uuid,uuid,boolean,uuid)', 'execute'), 'and the feedback path');
select extensions.ok(not pg_catalog.has_function_privilege('anon', 'public.triage_channel_recommendation(uuid,uuid,text,text,uuid)', 'execute'), 'anonymous callers hold neither');
select extensions.ok(not pg_catalog.has_function_privilege('anon', 'public.record_channel_recommendation_feedback(uuid,uuid,boolean,uuid)', 'execute'), 'not the triage path');
select extensions.ok(not pg_catalog.has_function_privilege('service_role', 'public.triage_channel_recommendation(uuid,uuid,text,text,uuid)', 'execute'), 'nor the service worker');
select extensions.ok(not pg_catalog.has_function_privilege('service_role', 'public.record_channel_recommendation_feedback(uuid,uuid,boolean,uuid)', 'execute'), 'on either path');

-- Fixtures -----------------------------------------------------------------------

insert into auth.users (id) values
  ('fb220000-0000-4000-8000-000000000001'::uuid),
  ('fb220000-0000-4000-8000-000000000002'::uuid),
  ('fb220000-0000-4000-8000-000000000003'::uuid),
  ('fb220000-0000-4000-8000-000000000004'::uuid);
insert into public.accounts (id, name, slug, created_by) values
  ('fb220000-0000-4000-8000-000000000101'::uuid, 'Decisions verifier', 'decisions-verifier', 'fb220000-0000-4000-8000-000000000001'::uuid),
  ('fb220000-0000-4000-8000-000000000102'::uuid, 'Decisions outsider', 'decisions-outsider', 'fb220000-0000-4000-8000-000000000002'::uuid);
insert into public.organizations (id, account_id, name, slug, industry, country_code, base_currency, default_timezone, created_by) values
  ('fb220000-0000-4000-8000-000000000201'::uuid, 'fb220000-0000-4000-8000-000000000101'::uuid, 'Decisions verifier', 'decisions-verifier', 'testing', 'AE', 'AED', 'Asia/Dubai', 'fb220000-0000-4000-8000-000000000001'::uuid),
  ('fb220000-0000-4000-8000-000000000202'::uuid, 'fb220000-0000-4000-8000-000000000102'::uuid, 'Decisions outsider', 'decisions-outsider', 'testing', 'AE', 'AED', 'Asia/Dubai', 'fb220000-0000-4000-8000-000000000002'::uuid);
insert into public.account_memberships (account_id, user_id, account_role, default_organization_role) values
  ('fb220000-0000-4000-8000-000000000101'::uuid, 'fb220000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner'),
  ('fb220000-0000-4000-8000-000000000102'::uuid, 'fb220000-0000-4000-8000-000000000002'::uuid, 'owner', 'owner');

-- The viewer and the operator hold their roles through an explicit
-- organization membership alone, so the role gate below is exercised against
-- the real resolver rather than an account-level default.
insert into public.organization_memberships (organization_id, user_id, role) values
  ('fb220000-0000-4000-8000-000000000201'::uuid, 'fb220000-0000-4000-8000-000000000003'::uuid, 'viewer'),
  ('fb220000-0000-4000-8000-000000000201'::uuid, 'fb220000-0000-4000-8000-000000000004'::uuid, 'operator');

insert into public.branches (id, organization_id, name, slug, kind, timezone, currency)
values ('fb220000-0000-4000-8000-000000000301'::uuid, 'fb220000-0000-4000-8000-000000000201'::uuid, 'Dubai outlet', 'decisions-dubai', 'physical', 'Asia/Dubai', 'AED');
insert into public.organization_channels (id, organization_id, key, display_name, category, created_by)
values ('fb220000-0000-4000-8000-000000000401'::uuid, 'fb220000-0000-4000-8000-000000000201'::uuid, 'talabat', 'Talabat', 'marketplace', 'fb220000-0000-4000-8000-000000000001'::uuid);

-- The outsider organization gets real parents of its own -- branch, channel,
-- completed run, and a narrated recommendation -- so the cross-tenant refusals
-- below are exercised against rows another tenant actually owns rather than
-- invented ids.
insert into public.branches (id, organization_id, name, slug, kind, timezone, currency)
values ('fb220000-0000-4000-8000-000000000302'::uuid, 'fb220000-0000-4000-8000-000000000202'::uuid, 'Outsider outlet', 'decisions-outsider-outlet', 'physical', 'Asia/Dubai', 'AED');
insert into public.organization_channels (id, organization_id, key, display_name, category, created_by)
values ('fb220000-0000-4000-8000-000000000402'::uuid, 'fb220000-0000-4000-8000-000000000202'::uuid, 'talabat', 'Talabat', 'marketplace', 'fb220000-0000-4000-8000-000000000002'::uuid);

insert into public.channel_analysis_runs (
  id, organization_id, channel_id, branch_id, window_start, window_end, period_grain,
  window_timezone, registry_version, detector_versions, metric_versions, input_digest,
  status, result_digest, correlation_id, completed_at
) values
  ('fb220000-0000-4000-8000-000000000601'::uuid, 'fb220000-0000-4000-8000-000000000201'::uuid,
   'fb220000-0000-4000-8000-000000000401'::uuid, 'fb220000-0000-4000-8000-000000000301'::uuid,
   date '2026-01-01', date '2026-01-05', 'day', 'Asia/Dubai', 1,
   '[{"key":"evidence.period_coverage","calculationVersion":1}]'::jsonb, '[]'::jsonb,
   repeat('a', 64), 'completed', repeat('b', 64),
   'fb220000-0000-4000-8000-000000000700'::uuid, now()),
  ('fb220000-0000-4000-8000-000000000602'::uuid, 'fb220000-0000-4000-8000-000000000202'::uuid,
   'fb220000-0000-4000-8000-000000000402'::uuid, 'fb220000-0000-4000-8000-000000000302'::uuid,
   date '2026-01-01', date '2026-01-05', 'day', 'Asia/Dubai', 1,
   '[{"key":"evidence.period_coverage","calculationVersion":1}]'::jsonb, '[]'::jsonb,
   repeat('c', 64), 'completed', repeat('d', 64),
   'fb220000-0000-4000-8000-000000000702'::uuid, now());

insert into public.channel_recommendations (
  id, organization_id, channel_id, branch_id, analysis_run_id, window_start, window_end,
  period_grain, label, headline, detail, supported_actions, limitations, prompt_version,
  prompt_digest, output_digest, provider, model_id, result_digest
) values
  ('fb220000-0000-4000-8000-000000000801'::uuid, 'fb220000-0000-4000-8000-000000000201'::uuid,
   'fb220000-0000-4000-8000-000000000401'::uuid, 'fb220000-0000-4000-8000-000000000301'::uuid,
   'fb220000-0000-4000-8000-000000000601'::uuid, date '2026-01-01', date '2026-01-05', 'day',
   'recommendation', 'Two days of Talabat revenue are missing from the window',
   'The window declares five days but evidence covers three, so movement figures compare unequal periods.',
   '[]'::jsonb, '[]'::jsonb, 1, repeat('e', 64), repeat('f', 64), 'openai', 'gpt-test', repeat('1', 64)),
  ('fb220000-0000-4000-8000-000000000802'::uuid, 'fb220000-0000-4000-8000-000000000202'::uuid,
   'fb220000-0000-4000-8000-000000000402'::uuid, 'fb220000-0000-4000-8000-000000000302'::uuid,
   'fb220000-0000-4000-8000-000000000602'::uuid, date '2026-01-01', date '2026-01-05', 'day',
   'observation', 'Outsider narration', 'Filed by the neighbouring tenant.',
   '[]'::jsonb, '[]'::jsonb, 1, repeat('0', 64), repeat('2', 64), 'openai', 'gpt-test', repeat('3', 64));

create or replace function pg_temp.triage(
  p_org text, p_rec text, p_decision text, p_reason text default null,
  p_actor text default 'fb220000-0000-4000-8000-000000000001')
returns void language sql as $$
  select public.triage_channel_recommendation(p_org::uuid, p_rec::uuid, p_decision, p_reason, p_actor::uuid);
$$;

create or replace function pg_temp.vote(
  p_org text, p_rec text, p_helpful boolean,
  p_actor text default 'fb220000-0000-4000-8000-000000000003')
returns void language sql as $$
  select public.record_channel_recommendation_feedback(p_org::uuid, p_rec::uuid, p_helpful, p_actor::uuid);
$$;

-- Triage -----------------------------------------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'fb220000-0000-4000-8000-000000000001';

select extensions.lives_ok(
  $$ select pg_temp.triage('fb220000-0000-4000-8000-000000000201', 'fb220000-0000-4000-8000-000000000801',
       'acknowledged') $$,
  'an owner acknowledges what the narrator said');

select extensions.is((
  select count(*)::integer from public.channel_recommendation_decisions
  where organization_id = 'fb220000-0000-4000-8000-000000000201'::uuid
    and recommendation_id = 'fb220000-0000-4000-8000-000000000801'::uuid
), 1, 'the answer landed in the decision log');

select extensions.is((
  select count(*)::integer from public.audit_events
  where entity_id = 'fb220000-0000-4000-8000-000000000801'::uuid
    and event_name = 'channel_recommendation.triaged'
    and payload ->> 'transition' = 'recorded'
    and payload ->> 'decision' = 'acknowledged'
), 1, 'and the storage trigger audited it as a recorded acknowledgement');

select extensions.ok((
  select bool_and(actor_id = 'fb220000-0000-4000-8000-000000000001'::uuid and payload ? 'decisionId')
  from public.audit_events
  where entity_id = 'fb220000-0000-4000-8000-000000000801'::uuid
    and event_name = 'channel_recommendation.triaged'
), 'the audit trail carries who answered and which decision row it was');

-- Append-only means answers accumulate: a second answer is history alongside
-- the first, never an overwrite of it.
select extensions.lives_ok(
  $$ select pg_temp.triage('fb220000-0000-4000-8000-000000000201', 'fb220000-0000-4000-8000-000000000801',
       'planned') $$,
  'the same owner may mark it planned afterwards, beside the acknowledgement');

select extensions.throws_ok(
  $$ select pg_temp.triage('fb220000-0000-4000-8000-000000000201', 'fb220000-0000-4000-8000-000000000801',
       'dismissed', null) $$,
  '23514', 'new row for relation "channel_recommendation_decisions" violates check constraint "channel_recommendation_decisions_check"',
  'dismissing without saying why is refused through the RPC too, by the table''s own rule');

select extensions.throws_ok(
  $$ select pg_temp.triage('fb220000-0000-4000-8000-000000000201', 'fb220000-0000-4000-8000-000000000801',
       'maybe') $$,
  '23514', 'new row for relation "channel_recommendation_decisions" violates check constraint "channel_recommendation_decisions_decision_check"',
  'an off-vocabulary decision meets the same table''s enum, not a private one');

-- A recommendation that resolves in nobody's tenant here resolves nowhere.
select extensions.throws_ok(
  $$ select pg_temp.triage('fb220000-0000-4000-8000-000000000201', 'fb220000-0000-4000-8000-000000000802',
       'acknowledged') $$,
  'P0002', 'channel recommendation was not found',
  'another organization''s recommendation does not resolve, and is told so indistinguishably');

select extensions.throws_ok(
  $$ select pg_temp.triage('fb220000-0000-4000-8000-000000000201',
       'fb220000-0000-4000-8000-0000000008ff', 'acknowledged') $$,
  'P0002', 'channel recommendation was not found',
  'an invented id gets exactly the same refusal');

select extensions.throws_ok(
  $$ select pg_temp.triage('fb220000-0000-4000-8000-000000000201', 'fb220000-0000-4000-8000-000000000801',
       'acknowledged', null, 'fb220000-0000-4000-8000-000000000002') $$,
  '42501', 'channel recommendation triage is not authorized',
  'naming someone else as the actor is refused: the session is the actor');

-- An operator holds the triage tier; a viewer reads but does not answer.
set local request.jwt.claim.sub = 'fb220000-0000-4000-8000-000000000004';
select extensions.lives_ok(
  $$ select pg_temp.triage('fb220000-0000-4000-8000-000000000201', 'fb220000-0000-4000-8000-000000000801',
       'dismissed', 'Breakfast delivery is not part of our plan.',
       'fb220000-0000-4000-8000-000000000004') $$,
  'an operator answers too, stating why this one is dismissed');

set local request.jwt.claim.sub = 'fb220000-0000-4000-8000-000000000003';
select extensions.throws_ok(
  $$ select pg_temp.triage('fb220000-0000-4000-8000-000000000201', 'fb220000-0000-4000-8000-000000000801',
       'acknowledged', null, 'fb220000-0000-4000-8000-000000000003') $$,
  '42501', 'channel recommendation triage is not authorized',
  'a viewer reads the narration but does not triage it');

select extensions.is((
  select count(*)::integer from public.channel_recommendation_decisions
  where organization_id = 'fb220000-0000-4000-8000-000000000201'::uuid
), 3, 'every accepted answer sits in the log; every refused one stayed out');

-- Feedback -----------------------------------------------------------------------------

-- Grading takes less authority than answering: the viewer who may not triage
-- may still say whether the narration helped.
select extensions.lives_ok(
  $$ select pg_temp.vote('fb220000-0000-4000-8000-000000000201', 'fb220000-0000-4000-8000-000000000801', true) $$,
  'a viewer votes the narration helpful');

select extensions.is((
  select helpful::text from public.channel_recommendation_feedback
  where recommendation_id = 'fb220000-0000-4000-8000-000000000801'::uuid
    and actor_id = 'fb220000-0000-4000-8000-000000000003'::uuid
), 'true', 'the vote landed');

select extensions.lives_ok(
  $$ select pg_temp.vote('fb220000-0000-4000-8000-000000000201', 'fb220000-0000-4000-8000-000000000801', false) $$,
  'and changing their mind moves the same row rather than stacking votes');

select extensions.is((
  select helpful::text from public.channel_recommendation_feedback
  where recommendation_id = 'fb220000-0000-4000-8000-000000000801'::uuid
    and actor_id = 'fb220000-0000-4000-8000-000000000003'::uuid
), 'false', 'the upsert replaced the value in place');

select extensions.is((
  select count(*)::integer from public.channel_recommendation_feedback
  where organization_id = 'fb220000-0000-4000-8000-000000000201'::uuid
), 1, 'one voter, one row, however many opinions');

select extensions.throws_ok(
  $$ select pg_temp.vote('fb220000-0000-4000-8000-000000000201', 'fb220000-0000-4000-8000-000000000801', true,
       'fb220000-0000-4000-8000-000000000002') $$,
  '42501', 'channel recommendation feedback is not authorized',
  'someone with no role in this organization does not vote in it');

select extensions.throws_ok(
  $$ select pg_temp.vote('fb220000-0000-4000-8000-000000000201', 'fb220000-0000-4000-8000-000000000801', false,
       'fb220000-0000-4000-8000-000000000001') $$,
  '42501', 'channel recommendation feedback is not authorized',
  'nor may a session vote under another user''s name');

select extensions.throws_ok(
  $$ select pg_temp.vote('fb220000-0000-4000-8000-000000000201', 'fb220000-0000-4000-8000-000000000802', true) $$,
  'P0002', 'channel recommendation was not found',
  'the neighbours'' narration cannot be voted on from here either');

select extensions.throws_ok(
  $$ select pg_temp.vote('fb220000-0000-4000-8000-000000000201', 'fb220000-0000-4000-8000-000000000801', null) $$,
  '22023', 'channel recommendation feedback is invalid',
  'an abstention is not a vote');

-- Session denial -------------------------------------------------------------------------

reset role;
set local role anon;

select extensions.throws_ok(
  $$ select pg_temp.triage('fb220000-0000-4000-8000-000000000201', 'fb220000-0000-4000-8000-000000000801',
       'acknowledged', null, 'fb220000-0000-4000-8000-000000000003') $$,
  '42501', 'permission denied for function triage_channel_recommendation',
  'an anonymous caller cannot reach triage at all');

select extensions.throws_ok(
  $$ select pg_temp.vote('fb220000-0000-4000-8000-000000000201', 'fb220000-0000-4000-8000-000000000801', true) $$,
  '42501', 'permission denied for function record_channel_recommendation_feedback',
  'nor the feedback path');

set local role service_role;

select extensions.throws_ok(
  $$ select pg_temp.triage('fb220000-0000-4000-8000-000000000201', 'fb220000-0000-4000-8000-000000000801',
       'acknowledged', null, 'fb220000-0000-4000-8000-000000000003') $$,
  '42501', 'permission denied for function triage_channel_recommendation',
  'the service worker cannot triage on a member''s behalf either');

select extensions.throws_ok(
  $$ select pg_temp.vote('fb220000-0000-4000-8000-000000000201', 'fb220000-0000-4000-8000-000000000801', true) $$,
  '42501', 'permission denied for function record_channel_recommendation_feedback',
  'nor vote for one');

-- Tenant isolation ------------------------------------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'fb220000-0000-4000-8000-000000000002';

select extensions.is((select count(*)::integer from public.channel_recommendation_decisions
  where organization_id = 'fb220000-0000-4000-8000-000000000201'::uuid), 0,
  'another organization''s member sees none of these answers');
select extensions.is((select count(*)::integer from public.channel_recommendation_feedback
  where organization_id = 'fb220000-0000-4000-8000-000000000201'::uuid), 0,
  'nor how they were voted');

set local request.jwt.claim.sub = 'fb220000-0000-4000-8000-000000000001';

select extensions.is((select count(*)::integer from public.channel_recommendation_decisions
  where organization_id = 'fb220000-0000-4000-8000-000000000201'::uuid), 3,
  'while the organization''s own members read every answer');
select extensions.is((select count(*)::integer from public.channel_recommendation_feedback
  where organization_id = 'fb220000-0000-4000-8000-000000000201'::uuid), 1,
  'and the vote standing against them');

select * from extensions.finish();

rollback;
