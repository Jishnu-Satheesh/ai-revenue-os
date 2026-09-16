begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(9);

-- Covers `20260916150000_campaign_research_admission_restore_question.sql`.
--
-- `20260916120000` retyped `request_campaign_research_run` to record
-- `requested_by` and silently dropped the staged `research_question` and the
-- pinned `context_manifest_id` / `context_digest` pair that `20260913153000`
-- (question) and `20260913152000` (pin) had added: every new admission stored
-- NULLs whatever the app sent. The restore puts all three columns back while
-- keeping the requester attribution. The checks below admit one run carrying
-- a question and a pin, prove all four values land on the row and come back
-- through the claim-bound loader, prove an over-long question is still
-- refused, and prove another tenant still learns nothing.

-- ---------------------------------------------------------------------------
-- Fixtures: two tenants, one pinned manifest in A.
-- ---------------------------------------------------------------------------

insert into auth.users (id) values
  ('b5000001-0000-4000-8000-000000000001'::uuid),
  ('b5000001-0000-4000-8000-000000000002'::uuid);

insert into public.accounts (id, name, slug, created_by) values (
  'b5ac0001-0000-4000-8000-000000000001'::uuid,
  'Restore question account', 'restore-question-account',
  'b5000001-0000-4000-8000-000000000001'::uuid
);

insert into public.organizations (
  id, name, slug, industry, country_code, base_currency, default_timezone, created_by, account_id
) values
  ('b5000001-0000-4000-8000-000000000101'::uuid, 'Restore A', 'restore-a',
   'testing', 'AE', 'AED', 'Asia/Dubai', 'b5000001-0000-4000-8000-000000000001'::uuid,
   'b5ac0001-0000-4000-8000-000000000001'::uuid),
  ('b5000001-0000-4000-8000-000000000102'::uuid, 'Restore B', 'restore-b',
   'testing', 'AE', 'AED', 'Asia/Dubai', 'b5000001-0000-4000-8000-000000000002'::uuid,
   'b5ac0001-0000-4000-8000-000000000001'::uuid);

insert into public.organization_memberships (organization_id, user_id, role) values
  ('b5000001-0000-4000-8000-000000000101'::uuid, 'b5000001-0000-4000-8000-000000000001'::uuid, 'owner'),
  ('b5000001-0000-4000-8000-000000000102'::uuid, 'b5000001-0000-4000-8000-000000000002'::uuid, 'owner');

insert into public.campaign_research_policies (
  id, organization_id, version, enabled, schedule_timezone,
  evidence_qualification_rule_version, evidence_max_age_days,
  cooldown_seconds, max_pending_proposals, max_attempts,
  per_run_allowance_minor, window_allowance_minor, allowance_currency, window_days, created_by
) values
  ('b5b00001-0000-4000-8000-000000000001'::uuid,
   'b5000001-0000-4000-8000-000000000101'::uuid, 1, true, 'Asia/Dubai',
   'evidence-qualification@2', 30, 0, 5, 3, 5000, 20000, 'AED', 30,
   'b5000001-0000-4000-8000-000000000001'::uuid),
  ('b5b00001-0000-4000-8000-000000000002'::uuid,
   'b5000001-0000-4000-8000-000000000102'::uuid, 1, true, 'Asia/Dubai',
   'evidence-qualification@2', 30, 0, 5, 3, 5000, 20000, 'AED', 30,
   'b5000001-0000-4000-8000-000000000002'::uuid);

insert into public.campaign_research_policy_current (organization_id, policy_id, set_by) values
  ('b5000001-0000-4000-8000-000000000101'::uuid,
   'b5b00001-0000-4000-8000-000000000001'::uuid,
   'b5000001-0000-4000-8000-000000000001'::uuid),
  ('b5000001-0000-4000-8000-000000000102'::uuid,
   'b5b00001-0000-4000-8000-000000000002'::uuid,
   'b5000001-0000-4000-8000-000000000002'::uuid);

reset role;

insert into public.memory_write_operations (
  id, organization_id, idempotency_key, request_fingerprint, response
) values (
  'b5f00001-0000-4000-8000-000000000301'::uuid,
  'b5000001-0000-4000-8000-000000000101'::uuid,
  'restore-pin-op', repeat('c', 64), '{}'::jsonb
);

insert into public.memory_context_manifests (
  id, organization_id, purpose, policy_version, context_digest, correlation_id,
  status, attempt_key, subject_operation_id, selected_count, selected_bytes
) values (
  'b5f00001-0000-4000-8000-000000000302'::uuid,
  'b5000001-0000-4000-8000-000000000101'::uuid,
  'subject_drafting', 'shared-context-v1', repeat('b', 64),
  'b5f00001-0000-4000-8000-000000000303'::uuid, 'ready', 'restore-pin-attempt',
  'b5f00001-0000-4000-8000-000000000301'::uuid, 1, 60
);

create temporary table restore_state (key text primary key, value jsonb not null);
grant select, insert on restore_state to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Admission carries the staged question, the pin, and the requester.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'b5000001-0000-4000-8000-000000000001';

insert into restore_state (key, value)
select 'run_r1', public.request_campaign_research_run(
  'b5000001-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'trigger_kind', 'manual_request', 'budget_minor', 100,
    'allowance_currency', 'AED', 'request_digest', repeat('a', 64),
    'idempotency_key', 'restore-question-run',
    'research_question', 'why did weekday lunch decline?',
    'context_manifest_id', 'b5f00001-0000-4000-8000-000000000302',
    'context_digest', repeat('b', 64)
  )
);

select extensions.is(
  (select value ->> 'outcome' from restore_state where key = 'run_r1'),
  'saved',
  'a run staged with a question and a pin is admitted'
);

-- The run table is closed to members, so the stored row is asserted as the
-- session owner rather than as the tenant under test.
reset role;

select extensions.is(
  (select research_question from public.campaign_research_runs run
   where run.id = (select (value ->> 'run_id')::uuid from restore_state where key = 'run_r1')),
  'why did weekday lunch decline?',
  'the staged question is stored on the run row'
);

select extensions.is(
  (select context_manifest_id from public.campaign_research_runs run
   where run.id = (select (value ->> 'run_id')::uuid from restore_state where key = 'run_r1')),
  'b5f00001-0000-4000-8000-000000000302'::uuid,
  'the staged manifest pin is stored on the run row'
);

select extensions.is(
  (select context_digest from public.campaign_research_runs run
   where run.id = (select (value ->> 'run_id')::uuid from restore_state where key = 'run_r1')),
  repeat('b', 64),
  'the staged pin digest is stored alongside the manifest id'
);

select extensions.is(
  (select requested_by from public.campaign_research_runs run
   where run.id = (select (value ->> 'run_id')::uuid from restore_state where key = 'run_r1')),
  'b5000001-0000-4000-8000-000000000001'::uuid,
  'the requester attribution from 16120000 still lands on the row'
);

-- ---------------------------------------------------------------------------
-- The claim-bound loader serves the restored question and pin back.
-- ---------------------------------------------------------------------------

set local role service_role;
set local request.jwt.claim.sub = '';

insert into restore_state (key, value)
select 'claim_r1', public.claim_campaign_research_run(
  'b5000001-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'run_id', (select value ->> 'run_id' from restore_state where key = 'run_r1'),
    'lease_seconds', 3600
  )
);

insert into restore_state (key, value)
select 'load_r1', public.load_campaign_research_context(
  'b5000001-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'run_id', (select value ->> 'run_id' from restore_state where key = 'run_r1'),
    'claim_token', (select value ->> 'claim_token' from restore_state where key = 'claim_r1')
  )
);

select extensions.is(
  (select value ->> 'research_question' from restore_state where key = 'load_r1'),
  'why did weekday lunch decline?',
  'the loader serves the admitted question with the pin'
);

select extensions.is(
  (select value ->> 'context_manifest_id' from restore_state where key = 'load_r1'),
  'b5f00001-0000-4000-8000-000000000302',
  'the loader serves the admitted manifest pin'
);

-- ---------------------------------------------------------------------------
-- Refusals: an over-long question, and another tenant, admit nothing.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'b5000001-0000-4000-8000-000000000001';

select extensions.throws_ok(
  $$select public.request_campaign_research_run(
      'b5000001-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'trigger_kind', 'manual_request', 'budget_minor', 100,
        'allowance_currency', 'AED', 'request_digest', repeat('f', 64),
        'idempotency_key', 'restore-long-question',
        'research_question', repeat('q', 2001)
      ))$$,
  '22023',
  'campaign_research_invalid',
  'a question longer than the bound admits nothing'
);

set local request.jwt.claim.sub = 'b5000001-0000-4000-8000-000000000002';

select extensions.throws_ok(
  $$select public.request_campaign_research_run(
      'b5000001-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'trigger_kind', 'manual_request', 'budget_minor', 100,
        'allowance_currency', 'AED', 'request_digest', repeat('e', 64),
        'idempotency_key', 'restore-foreign-run',
        'research_question', 'what is tenant A asking?'
      ))$$,
  '42501',
  'campaign_research_forbidden',
  'another tenant''s owner admits nothing in this tenant'
);

select * from extensions.finish();

rollback;
