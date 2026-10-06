begin;

create extension if not exists pgtap with schema extensions;

select extensions.no_plan();

-- Covers `20260913120000_campaign_proposal_preparation_approval.sql`.
--
-- The thing under test is the first approval gate: approving a proposal
-- authorizes creative PREPARATION and nothing else. The tests below care most
-- about the ways that could quietly become untrue — an approval landing on a
-- revision nobody read, a second approval opening a second campaign, an
-- operator approving their own draft, a decision being edited afterwards, or
-- one tenant's proposal being visible to another.

select extensions.has_table('public', 'campaign_proposals', 'proposals have identity of their own');
select extensions.has_table('public', 'campaign_proposal_versions', 'each revision is its own immutable row');
select extensions.has_table('public', 'campaign_proposal_decisions', 'decisions are recorded, not implied by a flag');

select extensions.has_function(
  'public', 'request_campaign_proposal', array['uuid', 'jsonb'],
  'a proposal is opened through a governed writer'
);
select extensions.has_function(
  'public', 'complete_campaign_proposal_version', array['uuid', 'jsonb'],
  'a revision is written through a governed writer'
);
select extensions.has_function(
  'public', 'decide_campaign_proposal', array['uuid', 'jsonb'],
  'a decision is recorded through a governed writer'
);

select extensions.function_privs_are(
  'public', 'decide_campaign_proposal', array['uuid', 'jsonb'],
  'authenticated', array['EXECUTE'], 'a signed-in member decides through the governed writer'
);
select extensions.function_privs_are(
  'public', 'decide_campaign_proposal', array['uuid', 'jsonb'],
  'anon', array[]::text[], 'a signed-out request decides nothing'
);
select extensions.function_privs_are(
  'public', 'decide_campaign_proposal', array['uuid', 'jsonb'],
  'service_role', array[]::text[],
  'no worker approves a proposal on a person''s behalf'
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
        'request_campaign_proposal', 'complete_campaign_proposal_version', 'decide_campaign_proposal'
      )
      and (not proc.prosecdef or proc.proconfig is null)
  ),
  'every proposal writer is security definer with an explicit search path'
);

-- ---------------------------------------------------------------------------
-- Fixtures: two tenants. Tenant A has an owner who may approve and an operator
-- who may draft but must not approve. Tenant B exists only to be kept out.
-- ---------------------------------------------------------------------------

insert into auth.users (id) values
  ('d9300000-0000-4000-8000-000000000001'::uuid),
  ('d9300000-0000-4000-8000-000000000002'::uuid),
  ('d9300000-0000-4000-8000-000000000003'::uuid);

insert into public.accounts (id, name, slug, created_by) values (
  'd93c0000-0000-4000-8000-000000000001'::uuid,
  'Proposal approval account', 'proposal-approval-account',
  'd9300000-0000-4000-8000-000000000001'::uuid
);

insert into public.organizations (
  id, name, slug, industry, country_code, base_currency, default_timezone, created_by, account_id
) values
  ('d9300000-0000-4000-8000-000000000101'::uuid, 'Proposal A', 'proposal-approval-a',
   'testing', 'AE', 'AED', 'Asia/Dubai', 'd9300000-0000-4000-8000-000000000001'::uuid,
   'd93c0000-0000-4000-8000-000000000001'::uuid),
  ('d9300000-0000-4000-8000-000000000102'::uuid, 'Proposal B', 'proposal-approval-b',
   'testing', 'AE', 'AED', 'Asia/Dubai', 'd9300000-0000-4000-8000-000000000002'::uuid,
   'd93c0000-0000-4000-8000-000000000001'::uuid);

insert into public.organization_memberships (organization_id, user_id, role) values
  ('d9300000-0000-4000-8000-000000000101'::uuid, 'd9300000-0000-4000-8000-000000000001'::uuid, 'owner'),
  ('d9300000-0000-4000-8000-000000000101'::uuid, 'd9300000-0000-4000-8000-000000000003'::uuid, 'operator'),
  ('d9300000-0000-4000-8000-000000000102'::uuid, 'd9300000-0000-4000-8000-000000000002'::uuid, 'owner');

create temporary table proposal_state (key text primary key, value jsonb not null);
grant select, insert, update on proposal_state to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = 'd9300000-0000-4000-8000-000000000003';

-- The operator drafts. Drafting is deliberately an operator-level act.
insert into proposal_state (key, value)
select 'proposal', public.request_campaign_proposal(
  'd9300000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'source_kind', 'business_signal',
    'dedupe_fingerprint', 'weekday-lunch-decline-2026-09'
  )
);

select extensions.ok(
  (select value ->> 'outcome' from proposal_state where key = 'proposal') = 'saved',
  'an operator may open a proposal'
);

-- The same signal arriving again joins the open proposal instead of opening a
-- second one somebody would have to reconcile by hand.
insert into proposal_state (key, value)
select 'proposal_again', public.request_campaign_proposal(
  'd9300000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'source_kind', 'business_signal',
    'dedupe_fingerprint', 'weekday-lunch-decline-2026-09'
  )
);

select extensions.is(
  (select value ->> 'outcome' from proposal_state where key = 'proposal_again'),
  'replayed',
  'the same business signal joins the open proposal rather than opening a second'
);
select extensions.is(
  (select value ->> 'proposal_id' from proposal_state where key = 'proposal_again'),
  (select value ->> 'proposal_id' from proposal_state where key = 'proposal'),
  'and it is the same proposal, not a look-alike'
);

insert into proposal_state (key, value)
select 'version', public.complete_campaign_proposal_version(
  'd9300000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'proposal_id', (select value ->> 'proposal_id' from proposal_state where key = 'proposal'),
    'document', jsonb_build_object('schemaVersion', 1, 'title', 'Weekday lunch footfall'),
    'digest', repeat('a', 64),
    'state', 'ready_for_review'
  )
);

select extensions.is(
  (select (value ->> 'version')::int from proposal_state where key = 'version'),
  1,
  'the first revision is version one'
);

-- ---------------------------------------------------------------------------
-- The operator who drafted it may not approve it.
-- ---------------------------------------------------------------------------

select extensions.throws_ok(
  format(
    $$select public.decide_campaign_proposal(
        'd9300000-0000-4000-8000-000000000101'::uuid,
        jsonb_build_object(
          'proposal_id', %L, 'proposal_version_id', %L, 'proposal_digest', %L,
          'decision', 'approved_for_preparation', 'idempotency_key', 'operator-tries-11'
        ))$$,
    (select value ->> 'proposal_id' from proposal_state where key = 'proposal'),
    (select value ->> 'proposal_version_id' from proposal_state where key = 'version'),
    repeat('a', 64)
  ),
  '42501',
  'campaign_proposal_forbidden',
  'an operator may draft a proposal but may not approve it'
);

-- An operator may still ask for changes: that is ordinary review traffic.
select extensions.lives_ok(
  format(
    $$select public.decide_campaign_proposal(
        'd9300000-0000-4000-8000-000000000101'::uuid,
        jsonb_build_object(
          'proposal_id', %L, 'proposal_version_id', %L, 'proposal_digest', %L,
          'decision', 'changes_requested', 'reason', 'Needs the lunch covers baseline.',
          'idempotency_key', 'operator-changes-11'
        ))$$,
    (select value ->> 'proposal_id' from proposal_state where key = 'proposal'),
    (select value ->> 'proposal_version_id' from proposal_state where key = 'version'),
    repeat('a', 64)
  ),
  'an operator may ask for changes without holding approval authority'
);

-- ---------------------------------------------------------------------------
-- The owner approves, and exactly one campaign appears.
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = 'd9300000-0000-4000-8000-000000000001';

insert into proposal_state (key, value)
select 'approval', public.decide_campaign_proposal(
  'd9300000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'proposal_id', (select value ->> 'proposal_id' from proposal_state where key = 'proposal'),
    'proposal_version_id', (select value ->> 'proposal_version_id' from proposal_state where key = 'version'),
    'proposal_digest', repeat('a', 64),
    'decision', 'approved_for_preparation',
    'idempotency_key', 'owner-approves-11'
  )
);

select extensions.is(
  (select value ->> 'outcome' from proposal_state where key = 'approval'),
  'saved',
  'an owner may approve the revision on screen'
);

select extensions.isnt(
  (select value ->> 'linked_campaign_id' from proposal_state where key = 'approval'),
  null,
  'approval establishes the campaign the preparation belongs to'
);

select extensions.is(
  (select count(*)::int from public.campaigns
    where organization_id = 'd9300000-0000-4000-8000-000000000101'::uuid
      and proposal_id = (select (value ->> 'proposal_id')::uuid from proposal_state where key = 'proposal')),
  1,
  'exactly one campaign exists for the approved proposal'
);

select extensions.is(
  (select source_kind from public.campaigns
    where proposal_id = (select (value ->> 'proposal_id')::uuid from proposal_state where key = 'proposal')),
  'campaign_proposal',
  'and it records honestly that a proposal caused it'
);

-- The campaign starts as a draft. Approving the proposal did not approve the
-- campaign, did not schedule it, and certainly did not publish it.
select extensions.is(
  (select state from public.campaigns
    where proposal_id = (select (value ->> 'proposal_id')::uuid from proposal_state where key = 'proposal')),
  'draft',
  'preparation approval leaves the campaign a draft, authorizing nothing public'
);

-- ---------------------------------------------------------------------------
-- A second click is a replay, not a second approval.
-- ---------------------------------------------------------------------------

insert into proposal_state (key, value)
select 'approval_again', public.decide_campaign_proposal(
  'd9300000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'proposal_id', (select value ->> 'proposal_id' from proposal_state where key = 'proposal'),
    'proposal_version_id', (select value ->> 'proposal_version_id' from proposal_state where key = 'version'),
    'proposal_digest', repeat('a', 64),
    'decision', 'approved_for_preparation',
    'idempotency_key', 'owner-approves-11'
  )
);

select extensions.is(
  (select value ->> 'outcome' from proposal_state where key = 'approval_again'),
  'replayed',
  'clicking approve twice replays the committed decision'
);

select extensions.is(
  (select count(*)::int from public.campaign_proposal_decisions
    where proposal_id = (select (value ->> 'proposal_id')::uuid from proposal_state where key = 'proposal')
      and decision = 'approved_for_preparation'),
  1,
  'and leaves exactly one approval on the record'
);

select extensions.is(
  (select count(*)::int from public.campaigns
    where proposal_id = (select (value ->> 'proposal_id')::uuid from proposal_state where key = 'proposal')),
  1,
  'and still exactly one campaign, not two'
);

-- Different content under a key already used is refused rather than overwritten.
select extensions.throws_ok(
  format(
    $$select public.decide_campaign_proposal(
        'd9300000-0000-4000-8000-000000000101'::uuid,
        jsonb_build_object(
          'proposal_id', %L, 'proposal_version_id', %L, 'proposal_digest', %L,
          'decision', 'dismissed', 'idempotency_key', 'owner-approves-11'
        ))$$,
    (select value ->> 'proposal_id' from proposal_state where key = 'proposal'),
    (select value ->> 'proposal_version_id' from proposal_state where key = 'version'),
    repeat('a', 64)
  ),
  '23505',
  'campaign_proposal_idempotency_conflict',
  'the same key carrying a different decision is a conflict, never an overwrite'
);

-- ---------------------------------------------------------------------------
-- An approval cannot land on content its approver never read.
-- ---------------------------------------------------------------------------

select extensions.throws_ok(
  format(
    $$select public.decide_campaign_proposal(
        'd9300000-0000-4000-8000-000000000101'::uuid,
        jsonb_build_object(
          'proposal_id', %L, 'proposal_version_id', %L, 'proposal_digest', %L,
          'decision', 'approved_for_preparation', 'idempotency_key', 'wrong-digest-11'
        ))$$,
    (select value ->> 'proposal_id' from proposal_state where key = 'proposal'),
    (select value ->> 'proposal_version_id' from proposal_state where key = 'version'),
    repeat('b', 64)
  ),
  '22023',
  'campaign_proposal_stale_version',
  'a decision naming the right revision but the wrong content is refused'
);

-- ---------------------------------------------------------------------------
-- Adding a third source kind must not widen what the generic Decision path can
-- execute. It does not, and the reason is structural rather than a rule
-- somebody has to remember: the Decision path finds its work by
-- `opportunity_id`, and the source-link constraint forbids a proposal-sourced
-- campaign from carrying one at all.
-- ---------------------------------------------------------------------------

select extensions.is(
  (select count(*)::int from public.campaigns
    where proposal_id is not null
      and (opportunity_id is not null or brief_id is not null)),
  0,
  'a proposal-sourced campaign carries no opportunity and no brief, so the Decision path cannot see it'
);

set local role postgres;

-- The generic creator cannot manufacture one either: it never sets proposal_id,
-- so the constraint refuses the row rather than producing a campaign that looks
-- proposal-sourced but is linked to nothing.
select extensions.throws_ok(
  format(
    $$insert into public.campaigns
        (organization_id, title, source_kind, brief_id, opportunity_id, created_by)
      values ('d9300000-0000-4000-8000-000000000101'::uuid, 'Smuggled', 'campaign_proposal',
              null, null, 'd9300000-0000-4000-8000-000000000001'::uuid)$$
  ),
  '23514',
  'new row for relation "campaigns" violates check constraint "campaigns_source_link_check"',
  'a campaign claiming a proposal source but linked to no proposal is refused'
);

-- And the reverse: a decision-sourced campaign cannot quietly carry a proposal.
select extensions.throws_ok(
  format(
    $$insert into public.campaigns
        (organization_id, title, source_kind, proposal_id, created_by)
      values ('d9300000-0000-4000-8000-000000000101'::uuid, 'Mixed', 'decision_opportunity',
              %L, 'd9300000-0000-4000-8000-000000000001'::uuid)$$,
    (select value ->> 'proposal_id' from proposal_state where key = 'proposal')
  ),
  '23514',
  'new row for relation "campaigns" violates check constraint "campaigns_source_link_check"',
  'a campaign cannot claim one source kind while linked to another'
);

set local role authenticated;
set local request.jwt.claim.sub = 'd9300000-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------------------
-- The record cannot be rewritten after the fact.
-- ---------------------------------------------------------------------------

set local role postgres;

select extensions.throws_ok(
  $$update public.campaign_proposal_decisions set reason = 'something else'$$,
  '42501',
  'campaign_proposal_decision_immutable',
  'a recorded decision cannot be edited afterwards'
);

select extensions.throws_ok(
  $$delete from public.campaign_proposal_decisions$$,
  '42501',
  'campaign_proposal_decision_immutable',
  'nor deleted to hide it'
);

select extensions.throws_ok(
  $$update public.campaign_proposal_versions set document = '{}'::jsonb$$,
  '42501',
  'campaign_proposal_version_immutable',
  'an approved revision cannot be edited out from under its approval'
);

-- ---------------------------------------------------------------------------
-- Tenancy.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'd9300000-0000-4000-8000-000000000002';

select extensions.is(
  (select count(*)::int from public.campaign_proposals
    where organization_id = 'd9300000-0000-4000-8000-000000000101'::uuid),
  0,
  'another tenant cannot see this organization''s proposals at all'
);

select extensions.throws_ok(
  format(
    $$select public.decide_campaign_proposal(
        'd9300000-0000-4000-8000-000000000101'::uuid,
        jsonb_build_object(
          'proposal_id', %L, 'proposal_version_id', %L, 'proposal_digest', %L,
          'decision', 'dismissed', 'idempotency_key', 'foreign-actor-11'
        ))$$,
    (select value ->> 'proposal_id' from proposal_state where key = 'proposal'),
    (select value ->> 'proposal_version_id' from proposal_state where key = 'version'),
    repeat('a', 64)
  ),
  '42501',
  'campaign_proposal_forbidden',
  'and cannot decide it either'
);

-- A signed-out caller reaches nothing.
set local role anon;

-- Stronger than seeing zero rows: `anon` holds no SELECT grant at all, so the
-- read is refused outright rather than quietly returning an empty result.
select extensions.throws_ok(
  $$select count(*) from public.campaign_proposals$$,
  '42501',
  'permission denied for table campaign_proposals',
  'a signed-out caller cannot read the proposal table at all'
);

select extensions.throws_ok(
  $$insert into public.campaign_proposal_decisions (
      organization_id, proposal_id, proposal_version_id, proposal_digest,
      actor_id, decision, idempotency_key
    ) values (
      'd9300000-0000-4000-8000-000000000101'::uuid, gen_random_uuid(), gen_random_uuid(),
      repeat('a', 64), 'd9300000-0000-4000-8000-000000000001'::uuid,
      'approved_for_preparation', 'forged-approval-11'
    )$$,
  '42501',
  'permission denied for table campaign_proposal_decisions',
  'a decision cannot be written directly, only through the governed writer'
);

select * from extensions.finish();

rollback;
