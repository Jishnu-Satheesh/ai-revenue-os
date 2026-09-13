begin;

create extension if not exists pgtap with schema extensions;

select extensions.no_plan();

-- Covers `20260913150000_campaign_research_proposals.sql` (Task 6, C03, D06).
--
-- The thing under test is the money fence: research spends only what an
-- explicit, enabled, current policy allows, one admission at a time, with
-- every refusal naming its reason and every transition leaving a durable
-- identifier-only event. The tests below care most about the ways money could
-- quietly escape — a concurrent second admission, a stale policy, a cooldown
-- skipped, a window overrun, a worker completing after losing its lease, or
-- history rewritten by cancellation.

select extensions.has_table('public', 'campaign_research_policies', 'policies have immutable versions');
select extensions.has_table('public', 'campaign_research_policy_current', 'one pointer names the binding policy');
select extensions.has_table('public', 'campaign_research_runs', 'runs carry the full lifecycle');
select extensions.has_table('public', 'campaign_research_source_fingerprints', 'evaluated signals persist even when unwarranted');
select extensions.has_table('public', 'campaign_research_events', 'transitions leave durable events');

select extensions.has_function(
  'public', 'request_campaign_research_run', array['uuid', 'jsonb'],
  'a run is admitted through a governed writer'
);
select extensions.has_function(
  'public', 'claim_campaign_research_run', array['uuid', 'jsonb'],
  'a worker claims through a governed writer'
);
select extensions.has_function(
  'public', 'complete_campaign_research_run', array['uuid', 'jsonb'],
  'success is recorded through a governed writer'
);
select extensions.has_function(
  'public', 'fail_campaign_research_run', array['uuid', 'jsonb'],
  'failure keeps its measured cost through a governed writer'
);
select extensions.has_function(
  'public', 'cancel_campaign_research_run', array['uuid', 'jsonb'],
  'cancellation keeps history through a governed writer'
);
select extensions.has_function(
  'public', 'set_campaign_research_policy_current', array['uuid', 'jsonb'],
  'the pointer moves through a governed writer'
);

select extensions.function_privs_are(
  'public', 'request_campaign_research_run', array['uuid', 'jsonb'],
  'authenticated', array['EXECUTE'], 'a signed-in member requests through the governed writer'
);
select extensions.function_privs_are(
  'public', 'request_campaign_research_run', array['uuid', 'jsonb'],
  'anon', array[]::text[], 'a signed-out request admits nothing'
);
select extensions.function_privs_are(
  'public', 'claim_campaign_research_run', array['uuid', 'jsonb'],
  'authenticated', array[]::text[], 'no member claims a worker run'
);
select extensions.function_privs_are(
  'public', 'claim_campaign_research_run', array['uuid', 'jsonb'],
  'service_role', array['EXECUTE'], 'the worker claims through the governed writer'
);
select extensions.function_privs_are(
  'public', 'complete_campaign_research_run', array['uuid', 'jsonb'],
  'authenticated', array[]::text[], 'no member completes a worker run'
);
select extensions.function_privs_are(
  'public', 'fail_campaign_research_run', array['uuid', 'jsonb'],
  'service_role', array['EXECUTE'], 'the worker records failure through the governed writer'
);
select extensions.function_privs_are(
  'public', 'cancel_campaign_research_run', array['uuid', 'jsonb'],
  'service_role', array['EXECUTE'], 'the worker cancels through the governed writer'
);

-- Every writer must be security definer with an explicit search path, or a
-- caller could shadow the tables it reads.
select extensions.ok(
  not exists (
    select 1
    from pg_catalog.pg_proc proc
    join pg_catalog.pg_namespace space on space.oid = proc.pronamespace
    where space.nspname = 'public'
      and proc.proname in (
        'request_campaign_research_run', 'claim_campaign_research_run',
        'complete_campaign_research_run', 'fail_campaign_research_run',
        'cancel_campaign_research_run', 'set_campaign_research_policy_current'
      )
      and (not proc.prosecdef or proc.proconfig is null)
  ),
  'every research writer is security definer with an explicit search path'
);

-- ---------------------------------------------------------------------------
-- Fixtures: three tenants. A cools down between runs. B admits one run at a
-- time. C has room to prove the window and per-run caps.
-- ---------------------------------------------------------------------------

insert into auth.users (id) values
  ('d9400000-0000-4000-8000-000000000001'::uuid),
  ('d9400000-0000-4000-8000-000000000002'::uuid),
  ('d9400000-0000-4000-8000-000000000003'::uuid),
  ('d9400000-0000-4000-8000-000000000004'::uuid);

insert into public.accounts (id, name, slug, created_by) values (
  'd94c0000-0000-4000-8000-000000000001'::uuid,
  'Research account', 'research-account',
  'd9400000-0000-4000-8000-000000000001'::uuid
);

insert into public.organizations (
  id, name, slug, industry, country_code, base_currency, default_timezone, created_by, account_id
) values
  ('d9400000-0000-4000-8000-000000000101'::uuid, 'Research A', 'research-a',
   'testing', 'AE', 'AED', 'Asia/Dubai', 'd9400000-0000-4000-8000-000000000001'::uuid,
   'd94c0000-0000-4000-8000-000000000001'::uuid),
  ('d9400000-0000-4000-8000-000000000102'::uuid, 'Research B', 'research-b',
   'testing', 'AE', 'AED', 'Asia/Dubai', 'd9400000-0000-4000-8000-000000000002'::uuid,
   'd94c0000-0000-4000-8000-000000000001'::uuid),
  ('d9400000-0000-4000-8000-000000000103'::uuid, 'Research C', 'research-c',
   'testing', 'AE', 'AED', 'Asia/Dubai', 'd9400000-0000-4000-8000-000000000004'::uuid,
   'd94c0000-0000-4000-8000-000000000001'::uuid);

insert into public.organization_memberships (organization_id, user_id, role) values
  ('d9400000-0000-4000-8000-000000000101'::uuid, 'd9400000-0000-4000-8000-000000000001'::uuid, 'owner'),
  ('d9400000-0000-4000-8000-000000000101'::uuid, 'd9400000-0000-4000-8000-000000000003'::uuid, 'operator'),
  ('d9400000-0000-4000-8000-000000000102'::uuid, 'd9400000-0000-4000-8000-000000000002'::uuid, 'owner'),
  ('d9400000-0000-4000-8000-000000000103'::uuid, 'd9400000-0000-4000-8000-000000000004'::uuid, 'owner');

insert into public.campaign_research_policies (
  id, organization_id, version, enabled, schedule_timezone,
  evidence_qualification_rule_version, cooldown_seconds, max_pending_proposals,
  per_run_allowance_minor, window_allowance_minor, allowance_currency, window_days, created_by
) values
  ('d9400000-0000-4000-8000-000000000201'::uuid,
   'd9400000-0000-4000-8000-000000000101'::uuid, 1, true, 'Asia/Dubai',
   'evidence-qualification@2', 3600, 5, 5000, 20000, 'AED', 30,
   'd9400000-0000-4000-8000-000000000001'::uuid),
  ('d9400000-0000-4000-8000-000000000202'::uuid,
   'd9400000-0000-4000-8000-000000000102'::uuid, 1, true, 'Asia/Dubai',
   'evidence-qualification@2', 0, 1, 5000, 6000, 'AED', 30,
   'd9400000-0000-4000-8000-000000000002'::uuid),
  ('d9400000-0000-4000-8000-000000000203'::uuid,
   'd9400000-0000-4000-8000-000000000103'::uuid, 1, true, 'Asia/Dubai',
   'evidence-qualification@2', 0, 10, 5000, 6000, 'AED', 30,
   'd9400000-0000-4000-8000-000000000004'::uuid);

insert into public.campaign_research_policy_current (organization_id, policy_id, set_by) values
  ('d9400000-0000-4000-8000-000000000101'::uuid,
   'd9400000-0000-4000-8000-000000000201'::uuid,
   'd9400000-0000-4000-8000-000000000001'::uuid),
  ('d9400000-0000-4000-8000-000000000102'::uuid,
   'd9400000-0000-4000-8000-000000000202'::uuid,
   'd9400000-0000-4000-8000-000000000002'::uuid),
  ('d9400000-0000-4000-8000-000000000103'::uuid,
   'd9400000-0000-4000-8000-000000000203'::uuid,
   'd9400000-0000-4000-8000-000000000004'::uuid);

create temporary table research_state (key text primary key, value jsonb not null);
grant select, insert, update on research_state to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Capability first: the drafter who may write proposals may not commission
-- paid research.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'd9400000-0000-4000-8000-000000000003';

select extensions.throws_ok(
  $$select public.request_campaign_research_run(
      'd9400000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'trigger_kind', 'manual_request', 'budget_minor', 1000,
        'allowance_currency', 'AED', 'request_digest', repeat('a', 64),
        'idempotency_key', 'operator-tries-research'
      ))$$,
  '42501',
  'campaign_research_forbidden',
  'an operator may draft proposals but may not commission research'
);

-- A stranger to the tenant is refused the same way, without learning whether
-- a policy exists.
set local request.jwt.claim.sub = 'd9400000-0000-4000-8000-000000000002';

select extensions.throws_ok(
  $$select public.request_campaign_research_run(
      'd9400000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'trigger_kind', 'manual_request', 'budget_minor', 1000,
        'allowance_currency', 'AED', 'request_digest', repeat('a', 64),
        'idempotency_key', 'stranger-tries-research'
      ))$$,
  '42501',
  'campaign_research_forbidden',
  'another tenant''s owner learns nothing about this tenant''s research'
);

-- ---------------------------------------------------------------------------
-- Tenant A: admission, replay, then the cooldown bites.
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = 'd9400000-0000-4000-8000-000000000001';

insert into research_state (key, value)
select 'run_a1', public.request_campaign_research_run(
  'd9400000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'trigger_kind', 'manual_request', 'budget_minor', 1000,
    'allowance_currency', 'AED', 'request_digest', repeat('b', 64),
    'idempotency_key', 'research-a-first-run',
    'known_policy_version', 1
  )
);

select extensions.is(
  (select value ->> 'outcome' from research_state where key = 'run_a1'),
  'saved',
  'an owner with a current enabled policy may admit research'
);

-- The events table is closed to members, so its contents are asserted as the
-- session owner rather than as the tenant under test.
reset role;

select extensions.ok(
  exists (
    select 1 from public.campaign_research_events event
    where event.run_id = (select (value ->> 'run_id')::uuid from research_state where key = 'run_a1')
      and event.event = 'campaign.proposal_requested'
  ),
  'admission leaves a durable requested event in the same transaction'
);

select extensions.ok(
  (select payload ?& array['run_id', 'trigger_kind', 'policy_version', 'budget_minor', 'allowance_currency']
   from public.campaign_research_events event
   where event.run_id = (select (value ->> 'run_id')::uuid from research_state where key = 'run_a1')
     and event.event = 'campaign.proposal_requested'),
  'the requested event carries identifiers only'
);

set local role authenticated;
set local request.jwt.claim.sub = 'd9400000-0000-4000-8000-000000000001';

-- The same staged request arriving twice joins the open run.
insert into research_state (key, value)
select 'run_a1_again', public.request_campaign_research_run(
  'd9400000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'trigger_kind', 'manual_request', 'budget_minor', 1000,
    'allowance_currency', 'AED', 'request_digest', repeat('b', 64),
    'idempotency_key', 'research-a-first-run',
    'known_policy_version', 1
  )
);

select extensions.is(
  (select value ->> 'outcome' from research_state where key = 'run_a1_again'),
  'replayed',
  'a repeated staged request replays rather than double-spending'
);
select extensions.is(
  (select value ->> 'run_id' from research_state where key = 'run_a1_again'),
  (select value ->> 'run_id' from research_state where key = 'run_a1'),
  'and it is the same run, not a look-alike'
);

-- A new request inside the cooldown window is refused, whoever asks.
select extensions.throws_ok(
  $$select public.request_campaign_research_run(
      'd9400000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'trigger_kind', 'business_signal', 'budget_minor', 500,
        'allowance_currency', 'AED', 'request_digest', repeat('c', 64),
        'idempotency_key', 'research-a-too-soon'
      ))$$,
  'P0001',
  'campaign_research_cooldown',
  'a signal inside the cooldown window waits its turn'
);

-- ---------------------------------------------------------------------------
-- Tenant B: one run at a time.
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = 'd9400000-0000-4000-8000-000000000002';

insert into research_state (key, value)
select 'run_b1', public.request_campaign_research_run(
  'd9400000-0000-4000-8000-000000000102'::uuid,
  jsonb_build_object(
    'trigger_kind', 'scheduled', 'budget_minor', 5000,
    'allowance_currency', 'AED', 'request_digest', repeat('d', 64),
    'idempotency_key', 'research-b-first-run'
  )
);

select extensions.is(
  (select value ->> 'outcome' from research_state where key = 'run_b1'),
  'saved',
  'a scheduled run with no seen version still binds the current policy'
);

select extensions.throws_ok(
  $$select public.request_campaign_research_run(
      'd9400000-0000-4000-8000-000000000102'::uuid,
      jsonb_build_object(
        'trigger_kind', 'manual_request', 'budget_minor', 100,
        'allowance_currency', 'AED', 'request_digest', repeat('e', 64),
        'idempotency_key', 'research-b-second-run'
      ))$$,
  'P0001',
  'campaign_research_pending_limit',
  'a second run waits while the first is still open'
);

-- ---------------------------------------------------------------------------
-- Tenant C: the purse caps, the currency gate, and the stale-policy refusal.
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = 'd9400000-0000-4000-8000-000000000004';

insert into research_state (key, value)
select 'run_c1', public.request_campaign_research_run(
  'd9400000-0000-4000-8000-000000000103'::uuid,
  jsonb_build_object(
    'trigger_kind', 'manual_request', 'budget_minor', 5000,
    'allowance_currency', 'AED', 'request_digest', repeat('f', 64),
    'idempotency_key', 'research-c-first-run'
  )
);

select extensions.throws_ok(
  $$select public.request_campaign_research_run(
      'd9400000-0000-4000-8000-000000000103'::uuid,
      jsonb_build_object(
        'trigger_kind', 'manual_request', 'budget_minor', 2000,
        'allowance_currency', 'AED', 'request_digest', repeat('a', 64),
        'idempotency_key', 'research-c-window-run'
      ))$$,
  'P0001',
  'campaign_research_allowance_exceeded',
  'the window allowance refuses what it cannot cover'
);

select extensions.throws_ok(
  $$select public.request_campaign_research_run(
      'd9400000-0000-4000-8000-000000000103'::uuid,
      jsonb_build_object(
        'trigger_kind', 'manual_request', 'budget_minor', 5001,
        'allowance_currency', 'AED', 'request_digest', repeat('b', 64),
        'idempotency_key', 'research-c-per-run'
      ))$$,
  'P0001',
  'campaign_research_allowance_exceeded',
  'one run may not reserve more than its per-run allowance'
);

select extensions.throws_ok(
  $$select public.request_campaign_research_run(
      'd9400000-0000-4000-8000-000000000103'::uuid,
      jsonb_build_object(
        'trigger_kind', 'manual_request', 'budget_minor', 100,
        'allowance_currency', 'USD', 'request_digest', repeat('c', 64),
        'idempotency_key', 'research-c-currency'
      ))$$,
  'P0001',
  'campaign_research_currency_mismatch',
  'a currency the policy never authorized is refused outright'
);

select extensions.throws_ok(
  $$select public.request_campaign_research_run(
      'd9400000-0000-4000-8000-000000000103'::uuid,
      jsonb_build_object(
        'trigger_kind', 'manual_request', 'budget_minor', 100,
        'allowance_currency', 'AED', 'request_digest', repeat('d', 64),
        'idempotency_key', 'research-c-stale',
        'known_policy_version', 99
      ))$$,
  'P0001',
  'campaign_research_stale_policy',
  'a requester on yesterday''s policy re-reads it first'
);

-- ---------------------------------------------------------------------------
-- The worker lifecycle: claim, complete with measured cost, fail keeps cost,
-- cancel keeps history, a lost lease completes nothing.
-- ---------------------------------------------------------------------------

set local role service_role;

insert into research_state (key, value)
select 'claim_c1', public.claim_campaign_research_run(
  'd9400000-0000-4000-8000-000000000103'::uuid,
  jsonb_build_object(
    'run_id', (select value ->> 'run_id' from research_state where key = 'run_c1'),
    'lease_seconds', 3600
  )
);

select extensions.is(
  (select value ->> 'outcome' from research_state where key = 'claim_c1'),
  'claimed',
  'the worker claims the queued run'
);

select extensions.is(
  (select value ->> 'policy_version' from research_state where key = 'claim_c1'),
  '1',
  'the claim carries the binding policy version for the pre-work recheck'
);

insert into research_state (key, value)
select 'complete_c1', public.complete_campaign_research_run(
  'd9400000-0000-4000-8000-000000000103'::uuid,
  jsonb_build_object(
    'run_id', (select value ->> 'run_id' from research_state where key = 'run_c1'),
    'claim_token', (select value ->> 'claim_token' from research_state where key = 'claim_c1'),
    'qualified_research_request_ids', jsonb_build_array(),
    'actual_cost_minor', 1200,
    'outcome', 'proposal_prepared'
  )
);

select extensions.is(
  (select value ->> 'outcome' from research_state where key = 'complete_c1'),
  'completed',
  'the worker completes with its measured cost'
);

select extensions.ok(
  exists (
    select 1 from public.campaign_research_events event
    where event.run_id = (select (value ->> 'run_id')::uuid from research_state where key = 'run_c1')
      and event.event = 'campaign.proposal_prepared'
      and (event.payload ->> 'actual_cost_minor') = '1200'
  ),
  'completion leaves a durable prepared event with the measured cost'
);

-- A completion on a finished run finds no claim and records nothing.
select extensions.throws_ok(
  format(
    $$select public.complete_campaign_research_run(
        'd9400000-0000-4000-8000-000000000103'::uuid,
        jsonb_build_object(
          'run_id', %L, 'claim_token', %L,
          'actual_cost_minor', 0, 'outcome', 'proposal_prepared'
        ))$$,
    (select value ->> 'run_id' from research_state where key = 'run_c1'),
    (select value ->> 'claim_token' from research_state where key = 'claim_c1')
  ),
  'P0002',
  'campaign_research_claim_lost',
  'a worker that lost its lease completes nothing'
);

-- Tenant B's run fails with its measured spend preserved.
insert into research_state (key, value)
select 'claim_b1', public.claim_campaign_research_run(
  'd9400000-0000-4000-8000-000000000102'::uuid,
  jsonb_build_object(
    'run_id', (select value ->> 'run_id' from research_state where key = 'run_b1'),
    'lease_seconds', 3600
  )
);

insert into research_state (key, value)
select 'fail_b1', public.fail_campaign_research_run(
  'd9400000-0000-4000-8000-000000000102'::uuid,
  jsonb_build_object(
    'run_id', (select value ->> 'run_id' from research_state where key = 'run_b1'),
    'claim_token', (select value ->> 'claim_token' from research_state where key = 'claim_b1'),
    'actual_cost_minor', 450,
    'failure_code', 'evidence_unavailable'
  )
);

select extensions.is(
  (select value ->> 'outcome' from research_state where key = 'fail_b1'),
  'failed',
  'failure is recorded rather than hidden'
);

select extensions.is(
  (select actual_cost_minor from public.campaign_research_runs run
   where run.id = (select (value ->> 'run_id')::uuid from research_state where key = 'run_b1')),
  450::bigint,
  'failed spend stays visible instead of being zeroed'
);

-- Tenant A's run is cancelled while queued; history stays.
insert into research_state (key, value)
select 'cancel_a1', public.cancel_campaign_research_run(
  'd9400000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'run_id', (select value ->> 'run_id' from research_state where key = 'run_a1')
  )
);

select extensions.is(
  (select status from public.campaign_research_runs run
   where run.id = (select (value ->> 'run_id')::uuid from research_state where key = 'run_a1')),
  'cancelled',
  'cancellation stops the run but keeps its row'
);

select extensions.ok(
  exists (
    select 1 from public.campaign_research_events event
    where event.run_id = (select (value ->> 'run_id')::uuid from research_state where key = 'run_a1')
      and event.event = 'campaign.research_cancelled'
  ),
  'cancellation leaves a durable cancelled event'
);

-- ---------------------------------------------------------------------------
-- The pointer moves forward by version, through the capability, and the old
-- version stops admitting.
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'd9400000-0000-4000-8000-000000000003';

select extensions.throws_ok(
  $$select public.set_campaign_research_policy_current(
      'd9400000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object('policy_id', 'd9400000-0000-4000-8000-000000000201')
    )$$,
  '42501',
  'campaign_research_forbidden',
  'an operator moves no policy pointer'
);

reset role;

insert into public.campaign_research_policies (
  id, organization_id, version, enabled, schedule_timezone,
  evidence_qualification_rule_version, cooldown_seconds, max_pending_proposals,
  per_run_allowance_minor, window_allowance_minor, allowance_currency, window_days, created_by
) values (
  'd9400000-0000-4000-8000-000000000204'::uuid,
  'd9400000-0000-4000-8000-000000000101'::uuid, 2, true, 'Asia/Dubai',
  'evidence-qualification@3', 3600, 5, 5000, 20000, 'AED', 30,
  'd9400000-0000-4000-8000-000000000001'::uuid
);

set local role authenticated;
set local request.jwt.claim.sub = 'd9400000-0000-4000-8000-000000000001';

insert into research_state (key, value)
select 'pointer_a2', public.set_campaign_research_policy_current(
  'd9400000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object('policy_id', 'd9400000-0000-4000-8000-000000000204')
);

select extensions.is(
  (select (value ->> 'version')::int from research_state where key = 'pointer_a2'),
  2,
  'an owner moves the pointer to the new version'
);

select extensions.throws_ok(
  $$select public.request_campaign_research_run(
      'd9400000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'trigger_kind', 'manual_request', 'budget_minor', 100,
        'allowance_currency', 'AED', 'request_digest', repeat('e', 64),
        'idempotency_key', 'research-a-stale-version',
        'known_policy_version', 1
      ))$$,
  'P0001',
  'campaign_research_stale_policy',
  'yesterday''s policy version admits nothing after the pointer moves'
);

-- ---------------------------------------------------------------------------
-- Evaluated signals persist whether or not they warranted research.
-- ---------------------------------------------------------------------------

reset role;

insert into public.campaign_research_source_fingerprints (
  organization_id, fingerprint, candidate_revision, warranted, run_id
) values (
  'd9400000-0000-4000-8000-000000000101'::uuid,
  'weekday-lunch-decline-2026-09', 'rev-42', false, null
);

select extensions.ok(
  exists (
    select 1 from public.campaign_research_source_fingerprints fp
    where fp.organization_id = 'd9400000-0000-4000-8000-000000000101'::uuid
      and fp.fingerprint = 'weekday-lunch-decline-2026-09'
      and not fp.warranted
  ),
  'an unwarranted signal is remembered as seen, not re-evaluated at full cost'
);

-- Signed-in members read no research table directly: every read travels
-- through a scoped function or a service-owned reader.
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'd9400000-0000-4000-8000-000000000001';

select extensions.throws_ok(
  $$select count(*) from public.campaign_research_runs$$,
  '42501',
  null,
  'a signed-in member reads no run row directly'
);

rollback;
