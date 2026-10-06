begin;

create extension if not exists pgtap with schema extensions;

select extensions.no_plan();

-- Covers `20260915190000_save_campaign_research_policy.sql` (Task 16, C03, D06).
--
-- Task 6 built the research machine against a policy table nothing could write.
-- This is the writer that makes it reachable, so what matters is that it does
-- not become a way around the fences the rest of that work put up: only someone
-- trusted to spend may set the ceiling, versions are added rather than edited,
-- the pointer and the version it names move together, and a policy missing any
-- threshold is refused rather than completed with a guess.

select extensions.has_function(
  'public', 'save_campaign_research_policy', array['uuid', 'jsonb'],
  'a policy is created through a governed writer'
);

select extensions.ok(
  not exists (
    select 1
    from pg_catalog.pg_proc proc
    join pg_catalog.pg_namespace space on space.oid = proc.pronamespace
    where space.nspname = 'public'
      and proc.proname = 'save_campaign_research_policy'
      and (not proc.prosecdef or proc.proconfig is null)
  ),
  'the policy writer is security definer with an explicit search path'
);

-- ---------------------------------------------------------------------------
-- Fixtures: one tenant with an owner, an operator and a stranger.
-- ---------------------------------------------------------------------------

insert into auth.users (id) values
  ('db400000-0000-4000-8000-000000000001'::uuid),
  ('db400000-0000-4000-8000-000000000002'::uuid),
  ('db400000-0000-4000-8000-000000000003'::uuid);

insert into public.accounts (id, name, slug, created_by) values (
  'db4c0000-0000-4000-8000-000000000001'::uuid,
  'Policy account', 'policy-account',
  'db400000-0000-4000-8000-000000000001'::uuid
);

insert into public.organizations (
  id, name, slug, industry, country_code, base_currency, default_timezone, created_by, account_id
) values
  ('db400000-0000-4000-8000-000000000101'::uuid, 'Policy A', 'policy-a',
   'testing', 'AE', 'AED', 'Asia/Dubai', 'db400000-0000-4000-8000-000000000001'::uuid,
   'db4c0000-0000-4000-8000-000000000001'::uuid),
  ('db400000-0000-4000-8000-000000000102'::uuid, 'Policy B', 'policy-b',
   'testing', 'AE', 'AED', 'Asia/Dubai', 'db400000-0000-4000-8000-000000000003'::uuid,
   'db4c0000-0000-4000-8000-000000000001'::uuid);

insert into public.organization_memberships (organization_id, user_id, role) values
  ('db400000-0000-4000-8000-000000000101'::uuid, 'db400000-0000-4000-8000-000000000001'::uuid, 'owner'),
  ('db400000-0000-4000-8000-000000000101'::uuid, 'db400000-0000-4000-8000-000000000002'::uuid, 'operator'),
  ('db400000-0000-4000-8000-000000000102'::uuid, 'db400000-0000-4000-8000-000000000003'::uuid, 'owner');

create temporary table policy_state (key text primary key, value jsonb not null);
grant select, insert, update on policy_state to authenticated;

-- A complete policy, used as the base for the refusals below.
create temporary table policy_input (body jsonb not null);
insert into policy_input (body) values (jsonb_build_object(
  'enabled', true,
  'schedule_timezone', 'Asia/Dubai',
  'evidence_qualification_rule_version', 'evidence-qualification@2',
  'evidence_max_age_days', 30,
  'cooldown_seconds', 3600,
  'max_pending_proposals', 5,
  'max_attempts', 3,
  'per_run_allowance_minor', 5000,
  'window_allowance_minor', 20000,
  'allowance_currency', 'AED',
  'window_days', 30
));
grant select on policy_input to authenticated;

-- ---------------------------------------------------------------------------
-- Only someone trusted to spend the allowance may set it.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'db400000-0000-4000-8000-000000000002';

select extensions.throws_ok(
  $$select public.save_campaign_research_policy(
      'db400000-0000-4000-8000-000000000101'::uuid,
      (select body from policy_input))$$,
  '42501',
  'campaign_research_forbidden',
  'an operator may draft proposals but may not set the research budget'
);

set local request.jwt.claim.sub = 'db400000-0000-4000-8000-000000000003';

select extensions.throws_ok(
  $$select public.save_campaign_research_policy(
      'db400000-0000-4000-8000-000000000101'::uuid,
      (select body from policy_input))$$,
  '42501',
  'campaign_research_forbidden',
  'another tenant''s owner sets nothing here'
);

-- ---------------------------------------------------------------------------
-- The owner saves the first version, and it binds immediately.
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = 'db400000-0000-4000-8000-000000000001';

insert into policy_state (key, value)
select 'v1', public.save_campaign_research_policy(
  'db400000-0000-4000-8000-000000000101'::uuid,
  (select body from policy_input)
);

select extensions.is(
  (select (value ->> 'version')::int from policy_state where key = 'v1'),
  1,
  'the first policy an organization saves is version 1'
);

-- The ledger is what admission reads, and it reads through the current pointer.
-- A version nothing points at authorizes no spending, so seeing it here is what
-- proves the save bound it rather than merely recording it.
insert into policy_state (key, value)
select 'ledger', public.read_campaign_research_ledger('db400000-0000-4000-8000-000000000101'::uuid);

select extensions.is(
  (select (value -> 'policy' ->> 'version')::int from policy_state where key = 'ledger'),
  1,
  'saving a policy is what makes it the current one'
);

select extensions.is(
  (select (value -> 'policy' ->> 'maxAttempts')::int from policy_state where key = 'ledger'),
  3,
  'admission reads back every threshold that was saved'
);
select extensions.is(
  (select value -> 'policy' ->> 'enabled' from policy_state where key = 'ledger'),
  'true',
  'an enabled policy reads as enabled'
);

-- ---------------------------------------------------------------------------
-- A change is a new version, never an edit.
-- ---------------------------------------------------------------------------

insert into policy_state (key, value)
select 'v2', public.save_campaign_research_policy(
  'db400000-0000-4000-8000-000000000101'::uuid,
  (select body || jsonb_build_object('per_run_allowance_minor', 9000) from policy_input)
);

select extensions.is(
  (select (value ->> 'version')::int from policy_state where key = 'v2'),
  2,
  'a changed policy is a new version'
);

-- Every run records the version that admitted it, so editing one in place would
-- retroactively rewrite what earlier spending was allowed to be. Asserted
-- outside the member session, because these tables are closed to members.
reset role;

select extensions.is(
  (select per_run_allowance_minor from public.campaign_research_policies
   where organization_id = 'db400000-0000-4000-8000-000000000101'::uuid and version = 1),
  5000::bigint,
  'the earlier version keeps the ceiling it admitted runs under'
);

set local role authenticated;
set local request.jwt.claim.sub = 'db400000-0000-4000-8000-000000000001';

insert into policy_state (key, value)
select 'ledger2', public.read_campaign_research_ledger('db400000-0000-4000-8000-000000000101'::uuid);

select extensions.is(
  (select (value -> 'policy' ->> 'version')::int from policy_state where key = 'ledger2'),
  2,
  'the pointer follows the newest version'
);

-- ---------------------------------------------------------------------------
-- A policy that does not say is refused, never completed with a guess (D06).
-- ---------------------------------------------------------------------------

select extensions.throws_ok(
  $$select public.save_campaign_research_policy(
      'db400000-0000-4000-8000-000000000101'::uuid,
      (select body - 'max_attempts' from policy_input))$$,
  '23502',
  null,
  'a policy with no attempt cap is refused rather than given one'
);

select extensions.throws_ok(
  $$select public.save_campaign_research_policy(
      'db400000-0000-4000-8000-000000000101'::uuid,
      (select body - 'per_run_allowance_minor' from policy_input))$$,
  '23502',
  null,
  'a policy with no per-run allowance is refused rather than given one'
);

-- The table's own rule: a window may not allow less than a single run.
select extensions.throws_ok(
  $$select public.save_campaign_research_policy(
      'db400000-0000-4000-8000-000000000101'::uuid,
      (select body || jsonb_build_object('window_allowance_minor', 100) from policy_input))$$,
  '23514',
  null,
  'a window allowance below one run''s ceiling is refused'
);

-- A refused save leaves the previous version binding. A half-applied policy
-- would authorize spending nobody described.
insert into policy_state (key, value)
select 'ledger3', public.read_campaign_research_ledger('db400000-0000-4000-8000-000000000101'::uuid);

select extensions.is(
  (select (value -> 'policy' ->> 'version')::int from policy_state where key = 'ledger3'),
  2,
  'a refused save changes nothing that was already in force'
);

-- ---------------------------------------------------------------------------
-- Versions are per organization.
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = 'db400000-0000-4000-8000-000000000003';

insert into policy_state (key, value)
select 'other', public.save_campaign_research_policy(
  'db400000-0000-4000-8000-000000000102'::uuid,
  (select body from policy_input)
);

select extensions.is(
  (select (value ->> 'version')::int from policy_state where key = 'other'),
  1,
  'another organization''s first policy is its own version 1'
);


-- The tables stay closed to members. Everything above went through a function,
-- and this is why it had to.
select extensions.throws_ok(
  $$select count(*) from public.campaign_research_policies$$,
  '42501',
  null,
  'a signed-in owner reads no policy row directly'
);

rollback;
