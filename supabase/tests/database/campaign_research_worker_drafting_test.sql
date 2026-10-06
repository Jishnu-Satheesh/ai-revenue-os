begin;

create extension if not exists pgtap with schema extensions;

select extensions.no_plan();

-- Covers `20260916120000_campaign_research_worker_drafting.sql` (Task 7, C02, C03).
--
-- The research worker could not write the proposal it exists to write: the
-- proposal writers were revoked from `service_role`, so every run died at
-- 42501. This migration opens drafting to the worker and nothing else.
--
-- What these tests are really protecting is the narrowness of that opening.
-- The worker gets no authority from being `service_role`. It gets exactly the
-- authority of the admitted run it holds a live claim on, and not one proposal
-- more. So the important assertions are the refusals: no claim, a stale claim,
-- someone else's claim, and — the one that matters most — a perfectly live
-- claim pointed at a proposal that run did not open.
--
-- Approval is untouched. A worker must never stand in for a person agreeing to
-- spend their own money, and the last assertion here is what keeps that true.

-- ---------------------------------------------------------------------------
-- Grants: drafting opens, deciding does not.
-- ---------------------------------------------------------------------------

select extensions.ok(
  has_function_privilege('service_role', 'public.request_campaign_proposal(uuid, jsonb)', 'EXECUTE'),
  'the worker may open a proposal'
);
select extensions.ok(
  has_function_privilege(
    'service_role', 'public.complete_campaign_proposal_version(uuid, jsonb)', 'EXECUTE'
  ),
  'the worker may write the proposal document'
);
select extensions.ok(
  not has_function_privilege('service_role', 'public.decide_campaign_proposal(uuid, jsonb)', 'EXECUTE'),
  'the worker may never approve, request changes on, snooze or dismiss a proposal'
);

select extensions.has_column(
  'public', 'campaign_research_runs', 'requested_by',
  'a run records who asked for it, so what it drafts can be attributed'
);

-- ---------------------------------------------------------------------------
-- Fixtures: one tenant, an owner who asks for research, a viewer who may not.
-- ---------------------------------------------------------------------------

insert into auth.users (id) values
  ('dc000000-0000-4000-8000-000000000001'::uuid),
  ('dc000000-0000-4000-8000-000000000002'::uuid);

insert into public.accounts (id, name, slug, created_by) values (
  'dcac0000-0000-4000-8000-000000000001'::uuid,
  'Worker drafting account', 'worker-drafting-account',
  'dc000000-0000-4000-8000-000000000001'::uuid
);

insert into public.organizations (
  id, name, slug, industry, country_code, base_currency, default_timezone, created_by, account_id
) values
  ('dc000000-0000-4000-8000-000000000101'::uuid, 'Drafting A', 'drafting-a',
   'testing', 'AE', 'AED', 'Asia/Dubai', 'dc000000-0000-4000-8000-000000000001'::uuid,
   'dcac0000-0000-4000-8000-000000000001'::uuid),
  ('dc000000-0000-4000-8000-000000000102'::uuid, 'Drafting B', 'drafting-b',
   'testing', 'AE', 'AED', 'Asia/Dubai', 'dc000000-0000-4000-8000-000000000001'::uuid,
   'dcac0000-0000-4000-8000-000000000001'::uuid);

insert into public.organization_memberships (organization_id, user_id, role) values
  ('dc000000-0000-4000-8000-000000000101'::uuid, 'dc000000-0000-4000-8000-000000000001'::uuid, 'owner'),
  ('dc000000-0000-4000-8000-000000000101'::uuid, 'dc000000-0000-4000-8000-000000000002'::uuid, 'viewer');

-- Two runs in the same organization, both claimed and both live. Two, because
-- the sharpest question here is whether one run's claim can reach the other
-- run's proposal.
insert into public.campaign_research_policies (
  id, organization_id, version, enabled, schedule_timezone,
  evidence_qualification_rule_version, evidence_max_age_days, cooldown_seconds,
  max_pending_proposals, max_attempts, per_run_allowance_minor,
  window_allowance_minor, allowance_currency, window_days, created_by
) values (
  'dcb00000-0000-4000-8000-000000000001'::uuid,
  'dc000000-0000-4000-8000-000000000101'::uuid, 1, true, 'Asia/Dubai',
  'evidence-qualification@2', 30, 0, 5, 3, 5000, 20000, 'AED', 30,
  'dc000000-0000-4000-8000-000000000001'::uuid
);

insert into public.campaign_research_runs (
  id, organization_id, trigger_kind, policy_version, status, claim_token,
  lease_expires_at, idempotency_key, request_digest, budget_minor,
  allowance_currency, started_at, requested_by
) values
  ('dcf00000-0000-4000-8000-00000000000a'::uuid,
   'dc000000-0000-4000-8000-000000000101'::uuid, 'manual_request', 1, 'claimed',
   'dcc00000-0000-4000-8000-00000000000a'::uuid, now() + interval '15 minutes',
   'worker-drafting-run-a', repeat('a', 64), 5000, 'AED', now(),
   'dc000000-0000-4000-8000-000000000001'::uuid),
  ('dcf00000-0000-4000-8000-00000000000b'::uuid,
   'dc000000-0000-4000-8000-000000000101'::uuid, 'manual_request', 1, 'claimed',
   'dcc00000-0000-4000-8000-00000000000b'::uuid, now() + interval '15 minutes',
   'worker-drafting-run-b', repeat('b', 64), 5000, 'AED', now(),
   'dc000000-0000-4000-8000-000000000001'::uuid),
  -- Lease already gone: the worker that held this one is presumed dead.
  ('dcf00000-0000-4000-8000-00000000000c'::uuid,
   'dc000000-0000-4000-8000-000000000101'::uuid, 'manual_request', 1, 'claimed',
   'dcc00000-0000-4000-8000-00000000000c'::uuid, now() - interval '1 minute',
   'worker-drafting-run-c', repeat('c', 64), 5000, 'AED', now(),
   'dc000000-0000-4000-8000-000000000001'::uuid),
  -- Admitted before requesters were recorded; nothing it drafts could be
  -- attributed to anyone.
  ('dcf00000-0000-4000-8000-00000000000d'::uuid,
   'dc000000-0000-4000-8000-000000000101'::uuid, 'manual_request', 1, 'claimed',
   'dcc00000-0000-4000-8000-00000000000d'::uuid, now() + interval '15 minutes',
   'worker-drafting-run-d', repeat('d', 64), 5000, 'AED', now(), null);

create temporary table worker_state (key text primary key, value jsonb not null);
-- Both roles write here: the suite drives the worker arm as `service_role` and
-- the member arm as `authenticated`.
grant select, insert on worker_state to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The worker arm, refused.
-- ---------------------------------------------------------------------------

set local role service_role;
set local request.jwt.claim.sub = '';

select extensions.throws_ok(
  $$select public.request_campaign_proposal(
      'dc000000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object('source_kind', 'manual_request'))$$,
  '42501',
  'campaign_proposal_forbidden',
  'a worker with no claim is refused exactly as before'
);

select extensions.throws_ok(
  $$select public.request_campaign_proposal(
      'dc000000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'source_kind', 'manual_request',
        'research_run_id', 'dcf00000-0000-4000-8000-00000000000a',
        'research_claim_token', 'dcc00000-0000-4000-8000-00000000000b'))$$,
  'P0002',
  'campaign_research_claim_lost',
  'another run''s claim token opens nothing'
);

select extensions.throws_ok(
  $$select public.request_campaign_proposal(
      'dc000000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'source_kind', 'manual_request',
        'research_run_id', 'dcf00000-0000-4000-8000-00000000000c',
        'research_claim_token', 'dcc00000-0000-4000-8000-00000000000c'))$$,
  'P0002',
  'campaign_research_claim_lost',
  'a lapsed lease is a lost claim, not a permission problem'
);

-- Tenancy: a live claim in one organization reaches nothing in another.
select extensions.throws_ok(
  $$select public.request_campaign_proposal(
      'dc000000-0000-4000-8000-000000000102'::uuid,
      jsonb_build_object(
        'source_kind', 'manual_request',
        'research_run_id', 'dcf00000-0000-4000-8000-00000000000a',
        'research_claim_token', 'dcc00000-0000-4000-8000-00000000000a'))$$,
  'P0002',
  'campaign_research_claim_lost',
  'a claim is good only in the organization that admitted it'
);

select extensions.throws_ok(
  $$select public.request_campaign_proposal(
      'dc000000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'source_kind', 'manual_request',
        'research_run_id', 'dcf00000-0000-4000-8000-00000000000d',
        'research_claim_token', 'dcc00000-0000-4000-8000-00000000000d'))$$,
  '22023',
  'campaign_research_requester_unknown',
  'a run that cannot say who asked drafts nothing rather than an unattributed proposal'
);

-- ---------------------------------------------------------------------------
-- The worker arm, admitted.
-- ---------------------------------------------------------------------------

insert into worker_state (key, value)
select 'opened_a', public.request_campaign_proposal(
  'dc000000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'source_kind', 'manual_request',
    'research_run_id', 'dcf00000-0000-4000-8000-00000000000a',
    'research_claim_token', 'dcc00000-0000-4000-8000-00000000000a')
);

insert into worker_state (key, value)
select 'opened_b', public.request_campaign_proposal(
  'dc000000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'source_kind', 'manual_request',
    'research_run_id', 'dcf00000-0000-4000-8000-00000000000b',
    'research_claim_token', 'dcc00000-0000-4000-8000-00000000000b')
);

select extensions.is(
  (select value ->> 'outcome' from worker_state where key = 'opened_a'),
  'saved',
  'a live claim opens the proposal its run was admitted to produce'
);

reset role;

select extensions.is(
  (select created_by from public.campaign_proposals
   where id = (select (value ->> 'proposal_id')::uuid from worker_state where key = 'opened_a')),
  'dc000000-0000-4000-8000-000000000001'::uuid,
  'the proposal is attributed to the person who asked for the research'
);

select extensions.is(
  (select proposal_id from public.campaign_research_runs
   where id = 'dcf00000-0000-4000-8000-00000000000a'::uuid),
  (select (value ->> 'proposal_id')::uuid from worker_state where key = 'opened_a'),
  'the run is bound to its proposal at once, not at completion'
);

set local role service_role;
set local request.jwt.claim.sub = '';

-- ---------------------------------------------------------------------------
-- The check that keeps a claim narrow.
-- ---------------------------------------------------------------------------

select extensions.throws_ok(
  format(
    $$select public.complete_campaign_proposal_version(
        'dc000000-0000-4000-8000-000000000101'::uuid,
        jsonb_build_object(
          'proposal_id', %L,
          'document', '{}'::jsonb,
          'digest', %L,
          'research_run_id', 'dcf00000-0000-4000-8000-00000000000a',
          'research_claim_token', 'dcc00000-0000-4000-8000-00000000000a'))$$,
    (select value ->> 'proposal_id' from worker_state where key = 'opened_b'),
    repeat('e', 64)
  ),
  '42501',
  'campaign_proposal_forbidden',
  'a live claim on one run writes nothing into another run''s proposal'
);

insert into worker_state (key, value)
select 'version_a', public.complete_campaign_proposal_version(
  'dc000000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'proposal_id', (select value ->> 'proposal_id' from worker_state where key = 'opened_a'),
    'document', jsonb_build_object('schemaVersion', 1, 'title', 'Drafted by the worker'),
    'digest', repeat('f', 64),
    'research_run_id', 'dcf00000-0000-4000-8000-00000000000a',
    'research_claim_token', 'dcc00000-0000-4000-8000-00000000000a')
);

select extensions.is(
  (select (value ->> 'version')::int from worker_state where key = 'version_a'),
  1,
  'the worker writes the first version of its own proposal'
);

reset role;

select extensions.is(
  (select created_by from public.campaign_proposal_versions
   where id = (select (value ->> 'proposal_version_id')::uuid from worker_state where key = 'version_a')),
  'dc000000-0000-4000-8000-000000000001'::uuid,
  'the document is attributed to the requester too, never to nobody'
);

select extensions.is(
  (select state from public.campaign_proposals
   where id = (select (value ->> 'proposal_id')::uuid from worker_state where key = 'opened_a')),
  'ready_for_review',
  'a written proposal becomes something a person can decide'
);

-- ---------------------------------------------------------------------------
-- The member path is exactly as it was.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'dc000000-0000-4000-8000-000000000002';

select extensions.throws_ok(
  $$select public.request_campaign_proposal(
      'dc000000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object('source_kind', 'manual_request'))$$,
  '42501',
  'campaign_proposal_forbidden',
  'a viewer still cannot open a proposal'
);

-- A claim token in a member''s hands changes nothing: the member arm is chosen
-- by having a session actor, and it asks the same permission it always did.
select extensions.throws_ok(
  $$select public.request_campaign_proposal(
      'dc000000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'source_kind', 'manual_request',
        'research_run_id', 'dcf00000-0000-4000-8000-00000000000a',
        'research_claim_token', 'dcc00000-0000-4000-8000-00000000000a'))$$,
  '42501',
  'campaign_proposal_forbidden',
  'a member cannot borrow a worker''s claim to get past their own permissions'
);

set local request.jwt.claim.sub = 'dc000000-0000-4000-8000-000000000001';

insert into worker_state (key, value)
select 'member_opened', public.request_campaign_proposal(
  'dc000000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object('source_kind', 'manual_request')
);

select extensions.is(
  (select value ->> 'outcome' from worker_state where key = 'member_opened'),
  'saved',
  'an owner still opens a proposal with no claim at all'
);

reset role;

select extensions.is(
  (select created_by from public.campaign_proposals
   where id = (select (value ->> 'proposal_id')::uuid from worker_state where key = 'member_opened')),
  'dc000000-0000-4000-8000-000000000001'::uuid,
  'a member-opened proposal is still attributed to the member'
);

-- ---------------------------------------------------------------------------
-- A new version onto a snoozed proposal clears the snooze.
--
-- The table checks `(state = 'snoozed') = (snoozed_until is not null)`, so a
-- version writer that left the horizon behind would break the row. Asserted
-- because an earlier draft of this migration dropped exactly that line.
-- ---------------------------------------------------------------------------

update public.campaign_proposals
set state = 'snoozed', snoozed_until = now() + interval '7 days'
where id = (select (value ->> 'proposal_id')::uuid from worker_state where key = 'opened_b');

set local role service_role;
set local request.jwt.claim.sub = '';

insert into worker_state (key, value)
select 'version_b', public.complete_campaign_proposal_version(
  'dc000000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'proposal_id', (select value ->> 'proposal_id' from worker_state where key = 'opened_b'),
    'document', jsonb_build_object('schemaVersion', 1, 'title', 'Rewritten after a snooze'),
    'digest', repeat('0', 63) || '1',
    'research_run_id', 'dcf00000-0000-4000-8000-00000000000b',
    'research_claim_token', 'dcc00000-0000-4000-8000-00000000000b')
);

reset role;

select extensions.is(
  (select snoozed_until from public.campaign_proposals
   where id = (select (value ->> 'proposal_id')::uuid from worker_state where key = 'opened_b')),
  null,
  'writing a new version clears the snooze it replaces'
);

rollback;
