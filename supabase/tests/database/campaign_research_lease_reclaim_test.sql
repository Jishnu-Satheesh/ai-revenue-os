begin;

create extension if not exists pgtap with schema extensions;

select extensions.no_plan();

-- Covers `20260915170000_campaign_research_lease_reclaim.sql` (Task 6, C03, D06).
--
-- The thing under test is recovery from a dead worker. Before this migration a
-- run claimed by a worker that then died was unreachable: `claim` takes only
-- `queued` rows, and `complete`/`fail` both demand a live lease. The row kept
-- its pending slot and its reserved budget for good.
--
-- So these tests care about four things. That an expired claim actually goes
-- back to the queue and can be claimed again. That a run which has used its
-- policy's attempts is given up on rather than cycling forever. That both
-- outcomes free the purse — the pending count and the window spend — because
-- freeing the row without freeing the money would fix nothing. And that a live
-- lease is never disturbed, since reclaiming a working run would let two
-- workers spend against one budget.

select extensions.has_function(
  'public', 'reclaim_campaign_research_runs', array['uuid'],
  'an expired claim is recovered through a governed writer'
);
select extensions.has_function(
  'public', 'list_campaign_research_lease_expiries', array[]::text[],
  'the sweep finds its tenants through a governed reader'
);

select extensions.has_function(
  'public', 'assert_campaign_research_claim', array['uuid', 'jsonb'],
  'the worker proves a live claim through a governed reader'
);

select extensions.has_column(
  'public', 'campaign_research_policies', 'max_attempts',
  'how many attempts a run may have is organization configuration'
);

-- The cap is a policy column with no default: a policy that does not say how
-- many attempts it allows must be refused, not guessed at (D06).
select extensions.col_not_null(
  'public', 'campaign_research_policies', 'max_attempts',
  'a policy must state its attempt cap'
);
select extensions.col_hasnt_default(
  'public', 'campaign_research_policies', 'max_attempts',
  'no attempt cap is assumed on an organization''s behalf'
);

select extensions.ok(
  not exists (
    select 1
    from pg_catalog.pg_proc proc
    join pg_catalog.pg_namespace space on space.oid = proc.pronamespace
    where space.nspname = 'public'
      and proc.proname in (
        'reclaim_campaign_research_runs', 'list_campaign_research_lease_expiries',
        'assert_campaign_research_claim'
      )
      and (not proc.prosecdef or proc.proconfig is null)
  ),
  'every new function is security definer with an explicit search path'
);

-- ---------------------------------------------------------------------------
-- Fixtures: one tenant whose policy allows two attempts, so the boundary
-- between "try again" and "give up" falls inside the suite.
-- ---------------------------------------------------------------------------

insert into auth.users (id) values
  ('da400000-0000-4000-8000-000000000001'::uuid),
  ('da400000-0000-4000-8000-000000000002'::uuid);

insert into public.accounts (id, name, slug, created_by) values (
  'da4c0000-0000-4000-8000-000000000001'::uuid,
  'Reclaim account', 'reclaim-account',
  'da400000-0000-4000-8000-000000000001'::uuid
);

insert into public.organizations (
  id, name, slug, industry, country_code, base_currency, default_timezone, created_by, account_id
) values
  ('da400000-0000-4000-8000-000000000101'::uuid, 'Reclaim A', 'reclaim-a',
   'testing', 'AE', 'AED', 'Asia/Dubai', 'da400000-0000-4000-8000-000000000001'::uuid,
   'da4c0000-0000-4000-8000-000000000001'::uuid),
  ('da400000-0000-4000-8000-000000000102'::uuid, 'Reclaim B', 'reclaim-b',
   'testing', 'AE', 'AED', 'Asia/Dubai', 'da400000-0000-4000-8000-000000000002'::uuid,
   'da4c0000-0000-4000-8000-000000000001'::uuid);

insert into public.organization_memberships (organization_id, user_id, role) values
  ('da400000-0000-4000-8000-000000000101'::uuid, 'da400000-0000-4000-8000-000000000001'::uuid, 'owner'),
  ('da400000-0000-4000-8000-000000000102'::uuid, 'da400000-0000-4000-8000-000000000002'::uuid, 'owner');

insert into public.campaign_research_policies (
  id, organization_id, version, enabled, schedule_timezone,
  evidence_qualification_rule_version, evidence_max_age_days,
  cooldown_seconds, max_pending_proposals, max_attempts,
  per_run_allowance_minor, window_allowance_minor, allowance_currency, window_days, created_by
) values
  ('da400000-0000-4000-8000-000000000201'::uuid,
   'da400000-0000-4000-8000-000000000101'::uuid, 1, true, 'Asia/Dubai',
   'evidence-qualification@2', 30, 0, 2, 2, 5000, 20000, 'AED', 30,
   'da400000-0000-4000-8000-000000000001'::uuid),
  ('da400000-0000-4000-8000-000000000202'::uuid,
   'da400000-0000-4000-8000-000000000102'::uuid, 1, true, 'Asia/Dubai',
   'evidence-qualification@2', 30, 0, 2, 2, 5000, 20000, 'AED', 30,
   'da400000-0000-4000-8000-000000000002'::uuid);

insert into public.campaign_research_policy_current (organization_id, policy_id, set_by) values
  ('da400000-0000-4000-8000-000000000101'::uuid,
   'da400000-0000-4000-8000-000000000201'::uuid,
   'da400000-0000-4000-8000-000000000001'::uuid),
  ('da400000-0000-4000-8000-000000000102'::uuid,
   'da400000-0000-4000-8000-000000000202'::uuid,
   'da400000-0000-4000-8000-000000000002'::uuid);

create temporary table reclaim_state (key text primary key, value jsonb not null);
grant select, insert, update on reclaim_state to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A run is admitted and claimed, then its worker dies.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'da400000-0000-4000-8000-000000000001';

insert into reclaim_state (key, value)
select 'run', public.request_campaign_research_run(
  'da400000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'trigger_kind', 'manual_request', 'budget_minor', 1000,
    'allowance_currency', 'AED', 'request_digest', repeat('c', 64),
    'idempotency_key', 'reclaim-first-run',
    'known_policy_version', 1
  )
);

reset role;
set local role service_role;

insert into reclaim_state (key, value)
select 'claim1', public.claim_campaign_research_run(
  'da400000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'run_id', (select value ->> 'run_id' from reclaim_state where key = 'run'),
    'lease_seconds', 300
  )
);

select extensions.is(
  (select value ->> 'outcome' from reclaim_state where key = 'claim1'),
  'claimed',
  'the first worker claims the queued run'
);

-- Nothing is expired yet, so the sweep must leave a working run alone. This is
-- the case that matters most: reclaiming a live claim would put two workers on
-- one budget.
select extensions.is(
  public.list_campaign_research_lease_expiries(),
  '[]'::jsonb,
  'a live lease is not offered to the sweep'
);

select extensions.is(
  public.reclaim_campaign_research_runs('da400000-0000-4000-8000-000000000101'::uuid),
  jsonb_build_object('reclaimed', 0, 'abandoned', 0),
  'a live claim is never disturbed'
);

select extensions.is(
  (select status from public.campaign_research_runs
   where id = (select (value ->> 'run_id')::uuid from reclaim_state where key = 'run')),
  'claimed',
  'the working run keeps its claim'
);

-- The second fence on the worker's service-client reads: business context,
-- pinned memory and Growth evidence are all read with RLS bypassed, so the
-- worker has to show a live claim immediately before that read.
select extensions.is(
  public.assert_campaign_research_claim(
    'da400000-0000-4000-8000-000000000101'::uuid,
    jsonb_build_object(
      'run_id', (select value ->> 'run_id' from reclaim_state where key = 'run'),
      'claim_token', (select value ->> 'claim_token' from reclaim_state where key = 'claim1')
    )
  ),
  jsonb_build_object('live', true),
  'a worker holding its claim may read'
);

select extensions.throws_ok(
  format(
    $fmt$select public.assert_campaign_research_claim(
      'da400000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object('run_id', %L, 'claim_token', %L))$fmt$,
    (select value ->> 'run_id' from reclaim_state where key = 'run'),
    '00000000-0000-4000-8000-000000000000'
  ),
  'P0002',
  'campaign_research_claim_lost',
  'a forged claim token reads nothing'
);

-- Another tenant's id with a real run id and a real token: the organization
-- predicate, not the token, is what refuses this.
select extensions.throws_ok(
  format(
    $fmt$select public.assert_campaign_research_claim(
      'da400000-0000-4000-8000-000000000102'::uuid,
      jsonb_build_object('run_id', %L, 'claim_token', %L))$fmt$,
    (select value ->> 'run_id' from reclaim_state where key = 'run'),
    (select value ->> 'claim_token' from reclaim_state where key = 'claim1')
  ),
  'P0002',
  'campaign_research_claim_lost',
  'a live claim proves nothing under another tenant'
);

-- The worker dies. Postgres decides the run is dead by the lease alone; there
-- is no heartbeat to miss and no liveness signal to fake.
update public.campaign_research_runs
set lease_expires_at = now() - interval '1 minute'
where id = (select (value ->> 'run_id')::uuid from reclaim_state where key = 'run');

select extensions.is(
  public.list_campaign_research_lease_expiries(),
  jsonb_build_array('da400000-0000-4000-8000-000000000101'::uuid),
  'the sweep is pointed at the tenant holding an expired claim'
);

select extensions.throws_ok(
  format(
    $fmt$select public.assert_campaign_research_claim(
      'da400000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object('run_id', %L, 'claim_token', %L))$fmt$,
    (select value ->> 'run_id' from reclaim_state where key = 'run'),
    (select value ->> 'claim_token' from reclaim_state where key = 'claim1')
  ),
  'P0002',
  'campaign_research_claim_lost',
  'a lapsed lease stops proving a claim, so the dead worker reads no further'
);

-- ---------------------------------------------------------------------------
-- Attempt 1 of 2: back to the queue, and claimable again.
-- ---------------------------------------------------------------------------

select extensions.is(
  public.reclaim_campaign_research_runs('da400000-0000-4000-8000-000000000101'::uuid),
  jsonb_build_object('reclaimed', 1, 'abandoned', 0),
  'an expired claim under its attempt cap returns to the queue'
);

select extensions.is(
  (select status from public.campaign_research_runs
   where id = (select (value ->> 'run_id')::uuid from reclaim_state where key = 'run')),
  'queued',
  'the reclaimed run is queued again'
);

-- The table's own invariants tie status, token and lease together; a reclaim
-- that cleared only one of them would have been rejected outright.
select extensions.ok(
  (select claim_token is null and lease_expires_at is null
   from public.campaign_research_runs
   where id = (select (value ->> 'run_id')::uuid from reclaim_state where key = 'run')),
  'the dead claim leaves behind no token and no lease'
);

select extensions.is(
  (select attempt from public.campaign_research_runs
   where id = (select (value ->> 'run_id')::uuid from reclaim_state where key = 'run')),
  1,
  'reclaiming does not itself count as an attempt'
);

select extensions.ok(
  exists (
    select 1 from public.campaign_research_events
    where run_id = (select (value ->> 'run_id')::uuid from reclaim_state where key = 'run')
      and event = 'campaign.research_lease_reclaimed'
  ),
  'the reclaim leaves a durable event'
);

-- The point of returning it to the queue: another worker can pick it up.
insert into reclaim_state (key, value)
select 'claim2', public.claim_campaign_research_run(
  'da400000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'run_id', (select value ->> 'run_id' from reclaim_state where key = 'run'),
    'lease_seconds', 300
  )
);

select extensions.is(
  (select value ->> 'outcome' from reclaim_state where key = 'claim2'),
  'claimed',
  'a second worker takes over the reclaimed run'
);

select extensions.is(
  (select attempt from public.campaign_research_runs
   where id = (select (value ->> 'run_id')::uuid from reclaim_state where key = 'run')),
  2,
  'the takeover is the second attempt'
);

-- ---------------------------------------------------------------------------
-- Attempt 2 of 2: the cap is reached, so the run is given up on by name.
-- ---------------------------------------------------------------------------

update public.campaign_research_runs
set lease_expires_at = now() - interval '1 minute'
where id = (select (value ->> 'run_id')::uuid from reclaim_state where key = 'run');

select extensions.is(
  public.reclaim_campaign_research_runs('da400000-0000-4000-8000-000000000101'::uuid),
  jsonb_build_object('reclaimed', 0, 'abandoned', 1),
  'a run that has used its attempts is abandoned, not cycled'
);

select extensions.is(
  (select status from public.campaign_research_runs
   where id = (select (value ->> 'run_id')::uuid from reclaim_state where key = 'run')),
  'failed',
  'the abandoned run is failed'
);

select extensions.is(
  (select failure_code from public.campaign_research_runs
   where id = (select (value ->> 'run_id')::uuid from reclaim_state where key = 'run')),
  'lease_expired',
  'the failure names the lease, not a guessed provider cause'
);

select extensions.ok(
  (select ended_at is not null from public.campaign_research_runs
   where id = (select (value ->> 'run_id')::uuid from reclaim_state where key = 'run')),
  'the abandoned run is ended, which is what releases its window spend'
);

select extensions.ok(
  exists (
    select 1 from public.campaign_research_events
    where run_id = (select (value ->> 'run_id')::uuid from reclaim_state where key = 'run')
      and event = 'campaign.research_lease_abandoned'
  ),
  'giving up leaves its own event, distinct from a reclaim'
);

-- The purse is the reason this function exists. A pending slot and a reserved
-- budget both had to come back, or a dead worker would still cost the
-- organization its next research run.
set local role authenticated;
set local request.jwt.claim.sub = 'da400000-0000-4000-8000-000000000001';

insert into reclaim_state (key, value)
select 'ledger', public.read_campaign_research_ledger('da400000-0000-4000-8000-000000000101'::uuid);

select extensions.is(
  (select (value ->> 'pending_count')::int from reclaim_state where key = 'ledger'),
  0,
  'the abandoned run no longer holds a pending slot'
);

select extensions.is(
  (select (value ->> 'window_spent_minor')::bigint from reclaim_state where key = 'ledger'),
  0::bigint,
  'the abandoned run no longer reserves its budget'
);

select extensions.is(
  (select (value -> 'policy' ->> 'maxAttempts')::int from reclaim_state where key = 'ledger'),
  2,
  'the ledger carries the attempt cap for the settings surface'
);

-- ---------------------------------------------------------------------------
-- The sweep is tenant-scoped, and closed to members.
-- ---------------------------------------------------------------------------

reset role;
set local role service_role;

-- Tenant B has no expired claim of its own, so sweeping it changes nothing —
-- proving the reclaim is scoped by the organization it was given, not global.
select extensions.is(
  public.reclaim_campaign_research_runs('da400000-0000-4000-8000-000000000102'::uuid),
  jsonb_build_object('reclaimed', 0, 'abandoned', 0),
  'sweeping one tenant does not reach into another'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'da400000-0000-4000-8000-000000000001';

select extensions.throws_ok(
  $$select public.reclaim_campaign_research_runs('da400000-0000-4000-8000-000000000101'::uuid)$$,
  '42501',
  null,
  'a signed-in owner cannot reclaim a lease by hand'
);

select extensions.throws_ok(
  $$select public.list_campaign_research_lease_expiries()$$,
  '42501',
  null,
  'a signed-in owner cannot enumerate tenants with expired claims'
);

select extensions.throws_ok(
  $$select public.assert_campaign_research_claim(
      'da400000-0000-4000-8000-000000000101'::uuid, '{}'::jsonb)$$,
  '42501',
  null,
  'a signed-in owner cannot probe claim liveness'
);

rollback;
