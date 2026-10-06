begin;

create extension if not exists pgtap with schema extensions;

select extensions.no_plan();

-- Covers `20260917130000_campaign_research_governed_cadence.sql` (Task 16,
-- Slice 4, C03, D06): the cadence that asks for research on its own, and the
-- receipts that prove each asking happened exactly once.
--
-- What matters here is all boundary: scheduled runs obey identical limits to
-- manual Asks (pending cap, per-run ceiling, window allowance, cooldown)
-- against the same policy row under the same lock; a repeated signal is
-- recognized as seen rather than re-evaluated at full cost; a due tick with
-- nothing warranting it stores its outcome and proposes nothing; and no
-- settings anywhere means no evaluation at all. Memory writes alone trigger
-- nothing — there is deliberately no trigger on any memory table in the
-- migration, only the polled scheduler — so that half is proven by the
-- migration containing no such trigger, not by a runtime case here.

select extensions.has_function(
  'public', 'read_campaign_research_schedule', array['uuid'],
  'the cadence is read through a governed reader'
);
select extensions.has_function(
  'public', 'save_campaign_research_schedule', array['uuid', 'jsonb'],
  'the cadence is written through a governed writer'
);
select extensions.has_function(
  'public', 'list_campaign_research_due_organizations', array[]::text[],
  'the sweep finds its tenants through a governed reader'
);
select extensions.has_function(
  'public', 'evaluate_campaign_research_schedule_due', array['uuid', 'jsonb'],
  'one tick for one organization runs in a single governed writer'
);

select extensions.has_table('public', 'campaign_research_schedules', 'the cadence has its own table');
select extensions.has_table(
  'public', 'campaign_research_schedule_receipts', 'every due evaluation leaves a receipt'
);

select extensions.ok(
  not exists (
    select 1
    from pg_catalog.pg_proc proc
    join pg_catalog.pg_namespace space on space.oid = proc.pronamespace
    where space.nspname = 'public'
      and proc.proname in (
        'read_campaign_research_schedule', 'save_campaign_research_schedule',
        'list_campaign_research_due_organizations',
        'evaluate_campaign_research_schedule_due'
      )
      and (not proc.prosecdef or proc.proconfig is null)
  ),
  'every new function is security definer with an explicit search path'
);

-- The policy table is not recreated and not altered by this migration: money,
-- cooldown and the pending cap stay exactly where Task 6 put them.
select extensions.ok(
  not exists (
    select 1
    from pg_catalog.pg_attribute attr
    join pg_catalog.pg_class cls on cls.oid = attr.attrelid
    join pg_catalog.pg_namespace space on space.oid = cls.relnamespace
    where space.nspname = 'public'
      and cls.relname = 'campaign_research_policies'
      and attr.attname in ('schedule_enabled', 'interval_days', 'qualifying_change_kinds')
  ),
  'the policy table carries no schedule columns'
);

-- ---------------------------------------------------------------------------
-- Fixtures: seven tenants plus a stranger.
--
-- A: schedule + policy on, generous purse, no cooldown — the happy path and
--    the dedup path.
-- B: policy off, no schedule — the tick finds no work.
-- C: schedule on with memory_revision only, generous purse — per-revision
--    admission and the no-warrant path.
-- D: window allowance equals one run — the exhausted-budget path, then the
--    unreadable-timezone path once its pointer moves.
-- E: cooldown of one hour, pending cap of one — the cooldown/pending path.
-- F/G: opposite sides of the date line — the timezone path.
-- ---------------------------------------------------------------------------

insert into auth.users (id) values
  ('db500000-0000-4000-8000-000000000001'::uuid),
  ('db500000-0000-4000-8000-000000000002'::uuid),
  ('db500000-0000-4000-8000-000000000003'::uuid),
  ('db500000-0000-4000-8000-000000000004'::uuid),
  ('db500000-0000-4000-8000-000000000005'::uuid),
  ('db500000-0000-4000-8000-000000000006'::uuid),
  ('db500000-0000-4000-8000-000000000007'::uuid),
  ('db500000-0000-4000-8000-000000000008'::uuid),
  ('db500000-0000-4000-8000-000000000009'::uuid);

insert into public.accounts (id, name, slug, created_by) values (
  'db5c0000-0000-4000-8000-000000000001'::uuid,
  'Cadence account', 'cadence-account',
  'db500000-0000-4000-8000-000000000001'::uuid
);

insert into public.organizations (
  id, name, slug, industry, country_code, base_currency, default_timezone, created_by, account_id
) values
  ('db500000-0000-4000-8000-000000000101'::uuid, 'Cadence A', 'cadence-a',
   'testing', 'AE', 'AED', 'Asia/Dubai', 'db500000-0000-4000-8000-000000000001'::uuid,
   'db5c0000-0000-4000-8000-000000000001'::uuid),
  ('db500000-0000-4000-8000-000000000102'::uuid, 'Cadence B', 'cadence-b',
   'testing', 'AE', 'AED', 'Asia/Dubai', 'db500000-0000-4000-8000-000000000003'::uuid,
   'db5c0000-0000-4000-8000-000000000001'::uuid),
  ('db500000-0000-4000-8000-000000000103'::uuid, 'Cadence C', 'cadence-c',
   'testing', 'AE', 'AED', 'Asia/Dubai', 'db500000-0000-4000-8000-000000000004'::uuid,
   'db5c0000-0000-4000-8000-000000000001'::uuid),
  ('db500000-0000-4000-8000-000000000104'::uuid, 'Cadence D', 'cadence-d',
   'testing', 'AE', 'AED', 'Asia/Dubai', 'db500000-0000-4000-8000-000000000005'::uuid,
   'db5c0000-0000-4000-8000-000000000001'::uuid),
  ('db500000-0000-4000-8000-000000000105'::uuid, 'Cadence E', 'cadence-e',
   'testing', 'AE', 'AED', 'Asia/Dubai', 'db500000-0000-4000-8000-000000000006'::uuid,
   'db5c0000-0000-4000-8000-000000000001'::uuid),
  ('db500000-0000-4000-8000-000000000106'::uuid, 'Cadence F', 'cadence-f',
   'testing', 'AE', 'AED', 'Pacific/Kiritimati', 'db500000-0000-4000-8000-000000000007'::uuid,
   'db5c0000-0000-4000-8000-000000000001'::uuid),
  ('db500000-0000-4000-8000-000000000107'::uuid, 'Cadence G', 'cadence-g',
   'testing', 'AE', 'AED', 'Pacific/Midway', 'db500000-0000-4000-8000-000000000008'::uuid,
   'db5c0000-0000-4000-8000-000000000001'::uuid);

insert into public.organization_memberships (organization_id, user_id, role) values
  ('db500000-0000-4000-8000-000000000101'::uuid, 'db500000-0000-4000-8000-000000000001'::uuid, 'owner'),
  ('db500000-0000-4000-8000-000000000101'::uuid, 'db500000-0000-4000-8000-000000000002'::uuid, 'operator'),
  ('db500000-0000-4000-8000-000000000102'::uuid, 'db500000-0000-4000-8000-000000000003'::uuid, 'owner'),
  ('db500000-0000-4000-8000-000000000103'::uuid, 'db500000-0000-4000-8000-000000000004'::uuid, 'owner'),
  ('db500000-0000-4000-8000-000000000104'::uuid, 'db500000-0000-4000-8000-000000000005'::uuid, 'owner'),
  ('db500000-0000-4000-8000-000000000105'::uuid, 'db500000-0000-4000-8000-000000000006'::uuid, 'owner'),
  ('db500000-0000-4000-8000-000000000106'::uuid, 'db500000-0000-4000-8000-000000000007'::uuid, 'owner'),
  ('db500000-0000-4000-8000-000000000107'::uuid, 'db500000-0000-4000-8000-000000000008'::uuid, 'owner');

-- Policies are inserted directly, as the earlier research suites do: the
-- point here is the cadence writer, not the policy writer it leaves alone.
insert into public.campaign_research_policies (
  id, organization_id, version, enabled, schedule_timezone,
  evidence_qualification_rule_version, evidence_max_age_days,
  cooldown_seconds, max_pending_proposals, max_attempts,
  per_run_allowance_minor, window_allowance_minor, allowance_currency, window_days, created_by
) values
  ('db500000-0000-4000-8000-000000000201'::uuid,
   'db500000-0000-4000-8000-000000000101'::uuid, 1, true, 'Asia/Dubai',
   'evidence-qualification@2', 30, 0, 5, 3, 5000, 20000, 'AED', 30,
   'db500000-0000-4000-8000-000000000001'::uuid),
  ('db500000-0000-4000-8000-000000000202'::uuid,
   'db500000-0000-4000-8000-000000000102'::uuid, 1, false, 'Asia/Dubai',
   'evidence-qualification@2', 30, 0, 5, 3, 5000, 20000, 'AED', 30,
   'db500000-0000-4000-8000-000000000003'::uuid),
  ('db500000-0000-4000-8000-000000000203'::uuid,
   'db500000-0000-4000-8000-000000000103'::uuid, 1, true, 'Asia/Dubai',
   'evidence-qualification@2', 30, 0, 5, 3, 5000, 20000, 'AED', 30,
   'db500000-0000-4000-8000-000000000004'::uuid),
  ('db500000-0000-4000-8000-000000000204'::uuid,
   'db500000-0000-4000-8000-000000000104'::uuid, 1, true, 'Asia/Dubai',
   'evidence-qualification@2', 30, 0, 5, 3, 5000, 5000, 'AED', 30,
   'db500000-0000-4000-8000-000000000005'::uuid),
  ('db500000-0000-4000-8000-000000000205'::uuid,
   'db500000-0000-4000-8000-000000000105'::uuid, 1, true, 'Asia/Dubai',
   'evidence-qualification@2', 30, 3600, 1, 3, 5000, 20000, 'AED', 30,
   'db500000-0000-4000-8000-000000000006'::uuid),
  ('db500000-0000-4000-8000-000000000206'::uuid,
   'db500000-0000-4000-8000-000000000106'::uuid, 1, true, 'Pacific/Kiritimati',
   'evidence-qualification@2', 30, 0, 5, 3, 5000, 20000, 'AED', 30,
   'db500000-0000-4000-8000-000000000007'::uuid),
  ('db500000-0000-4000-8000-000000000207'::uuid,
   'db500000-0000-4000-8000-000000000107'::uuid, 1, true, 'Pacific/Midway',
   'evidence-qualification@2', 30, 0, 5, 3, 5000, 20000, 'AED', 30,
   'db500000-0000-4000-8000-000000000008'::uuid);

insert into public.campaign_research_policy_current (organization_id, policy_id, set_by) values
  ('db500000-0000-4000-8000-000000000101'::uuid,
   'db500000-0000-4000-8000-000000000201'::uuid,
   'db500000-0000-4000-8000-000000000001'::uuid),
  ('db500000-0000-4000-8000-000000000102'::uuid,
   'db500000-0000-4000-8000-000000000202'::uuid,
   'db500000-0000-4000-8000-000000000003'::uuid),
  ('db500000-0000-4000-8000-000000000103'::uuid,
   'db500000-0000-4000-8000-000000000203'::uuid,
   'db500000-0000-4000-8000-000000000004'::uuid),
  ('db500000-0000-4000-8000-000000000104'::uuid,
   'db500000-0000-4000-8000-000000000204'::uuid,
   'db500000-0000-4000-8000-000000000005'::uuid),
  ('db500000-0000-4000-8000-000000000105'::uuid,
   'db500000-0000-4000-8000-000000000205'::uuid,
   'db500000-0000-4000-8000-000000000006'::uuid),
  ('db500000-0000-4000-8000-000000000106'::uuid,
   'db500000-0000-4000-8000-000000000206'::uuid,
   'db500000-0000-4000-8000-000000000007'::uuid),
  ('db500000-0000-4000-8000-000000000107'::uuid,
   'db500000-0000-4000-8000-000000000207'::uuid,
   'db500000-0000-4000-8000-000000000008'::uuid);

-- Schedules for A (both kinds), C (memory only), D, E, F and G (cadence
-- only, so the purse and timezone paths below are reached without needing
-- new memory). B has none: no settings means no evaluation at all.
insert into public.campaign_research_schedules (
  organization_id, enabled, interval_days, qualifying_change_kinds, enabled_by
) values
  ('db500000-0000-4000-8000-000000000101'::uuid, true, 1,
   array['memory_revision', 'scheduled_cadence'],
   'db500000-0000-4000-8000-000000000001'::uuid),
  ('db500000-0000-4000-8000-000000000103'::uuid, true, 1,
   array['memory_revision'],
   'db500000-0000-4000-8000-000000000004'::uuid),
  ('db500000-0000-4000-8000-000000000104'::uuid, true, 1,
   array['scheduled_cadence'],
   'db500000-0000-4000-8000-000000000005'::uuid),
  ('db500000-0000-4000-8000-000000000105'::uuid, true, 1,
   array['scheduled_cadence'],
   'db500000-0000-4000-8000-000000000006'::uuid),
  ('db500000-0000-4000-8000-000000000106'::uuid, true, 1,
   array['scheduled_cadence'],
   'db500000-0000-4000-8000-000000000007'::uuid),
  ('db500000-0000-4000-8000-000000000107'::uuid, true, 1,
   array['scheduled_cadence'],
   'db500000-0000-4000-8000-000000000008'::uuid);

create temporary table cadence_state (key text primary key, value jsonb not null);
grant select, insert, update on cadence_state to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Only someone trusted to spend the allowance may set the rhythm — and
-- another tenant's owner sets nothing here.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'db500000-0000-4000-8000-000000000002';

select extensions.throws_ok(
  $$select public.save_campaign_research_schedule(
      'db500000-0000-4000-8000-000000000101'::uuid,
      '{"enabled": true, "interval_days": 7, "qualifying_change_kinds": ["memory_revision"]}'::jsonb)$$,
  '42501',
  'campaign_research_forbidden',
  'an operator may draft proposals but may not set the research rhythm'
);

set local request.jwt.claim.sub = 'db500000-0000-4000-8000-000000000003';

select extensions.throws_ok(
  $$select public.save_campaign_research_schedule(
      'db500000-0000-4000-8000-000000000101'::uuid,
      '{"enabled": true, "interval_days": 7, "qualifying_change_kinds": ["memory_revision"]}'::jsonb)$$,
  '42501',
  'campaign_research_forbidden',
  'another tenant''s owner sets nothing here'
);

-- An enabled schedule that names nothing, an interval outside 1..30 days,
-- and an unknown kind are all refused rather than completed with a guess.
set local request.jwt.claim.sub = 'db500000-0000-4000-8000-000000000001';

select extensions.throws_ok(
  $$select public.save_campaign_research_schedule(
      'db500000-0000-4000-8000-000000000101'::uuid,
      '{"enabled": true, "interval_days": 7, "qualifying_change_kinds": []}'::jsonb)$$,
  '22023',
  'campaign_research_invalid',
  'an enabled schedule must name what warrants research'
);

select extensions.throws_ok(
  $$select public.save_campaign_research_schedule(
      'db500000-0000-4000-8000-000000000101'::uuid,
      '{"enabled": true, "interval_days": 45, "qualifying_change_kinds": ["memory_revision"]}'::jsonb)$$,
  '22023',
  'campaign_research_invalid',
  'a 45-day rhythm is refused'
);

select extensions.throws_ok(
  $$select public.save_campaign_research_schedule(
      'db500000-0000-4000-8000-000000000101'::uuid,
      '{"enabled": true, "interval_days": 7, "qualifying_change_kinds": ["lunar_cycle"]}'::jsonb)$$,
  '22023',
  'campaign_research_invalid',
  'an unknown change kind is refused'
);

-- The owner pauses and resumes A's cadence through the writer; the rows the
-- suite below evaluates are resumed before it runs.
select extensions.is(
  public.save_campaign_research_schedule(
    'db500000-0000-4000-8000-000000000101'::uuid,
    '{"enabled": false, "interval_days": 7, "qualifying_change_kinds": ["memory_revision"]}'::jsonb
  ) ->> 'enabled',
  'false',
  'the owner may pause the cadence without losing its kinds'
);

insert into cadence_state (key, value)
select 'resumed', public.save_campaign_research_schedule(
  'db500000-0000-4000-8000-000000000101'::uuid,
  '{"enabled": true, "interval_days": 1, "qualifying_change_kinds": ["memory_revision", "scheduled_cadence"]}'::jsonb
);

-- Reading another tenant's cadence is denied the same way: B's owner reads
-- nothing of A's rhythm.
set local request.jwt.claim.sub = 'db500000-0000-4000-8000-000000000003';

select extensions.throws_ok(
  $$select public.read_campaign_research_schedule(
      'db500000-0000-4000-8000-000000000101'::uuid)$$,
  '42501',
  'campaign_research_forbidden',
  'another tenant''s owner reads nothing here'
);

-- ---------------------------------------------------------------------------
-- The sweep finds due tenants only: everyone but B, which has no schedule
-- and a disabled policy.
-- ---------------------------------------------------------------------------

reset role;
set local role service_role;

select extensions.ok(
  (select coalesce(
    (select jsonb_agg(value order by value) from jsonb_array_elements_text(
      public.list_campaign_research_due_organizations()
    ) as value),
    '[]'::jsonb
  ) = '["db500000-0000-4000-8000-000000000101", "db500000-0000-4000-8000-000000000103", "db500000-0000-4000-8000-000000000104", "db500000-0000-4000-8000-000000000105", "db500000-0000-4000-8000-000000000106", "db500000-0000-4000-8000-000000000107"]'::jsonb),
  'due tenants are listed, and only they are'
);

-- B's tick finds no work and writes nothing: no settings means no
-- evaluation, no receipt, no run.
insert into cadence_state (key, value)
select 'b-tick', public.evaluate_campaign_research_schedule_due(
  'db500000-0000-4000-8000-000000000102'::uuid,
  jsonb_build_object(
    'evidence_fingerprint', 'memory:' || repeat('b', 64),
    'candidate_revision', 'db500000-0000-4000-8000-000000000301',
    'request_digest', repeat('b', 64),
    'idempotency_key', 'cadence-b-first'
  )
);

select extensions.is(
  (select value ->> 'outcome' from cadence_state where key = 'b-tick'),
  'not_due',
  'a tenant without settings is not due'
);

select extensions.is(
  (select count(*) from public.campaign_research_schedule_receipts
   where organization_id = 'db500000-0000-4000-8000-000000000102'::uuid),
  0::bigint,
  'a not-due tick writes no receipt'
);

select extensions.is(
  (select count(*) from public.campaign_research_runs
   where organization_id = 'db500000-0000-4000-8000-000000000102'::uuid),
  0::bigint,
  'a not-due tick admits no run'
);

-- ---------------------------------------------------------------------------
-- A's first tick admits one scheduled run bound to the binding policy.
-- ---------------------------------------------------------------------------

insert into cadence_state (key, value)
select 'a-first', public.evaluate_campaign_research_schedule_due(
  'db500000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'evidence_fingerprint', 'memory:' || repeat('a', 64),
    'candidate_revision', 'db500000-0000-4000-8000-000000000311',
    'request_digest', repeat('a', 64),
    'idempotency_key', 'cadence-a-first-evidence'
  )
);

select extensions.is(
  (select value ->> 'outcome' from cadence_state where key = 'a-first'),
  'admitted',
  'new evidence on a due schedule admits a run'
);

select extensions.is(
  (select trigger_kind from public.campaign_research_runs
   where id = (select (value ->> 'run_id')::uuid from cadence_state where key = 'a-first')),
  'scheduled',
  'the run is bound to its trigger kind'
);

select extensions.is(
  (select policy_version from public.campaign_research_runs
   where id = (select (value ->> 'run_id')::uuid from cadence_state where key = 'a-first')),
  1,
  'the run is bound to the policy version that admitted it'
);

select extensions.is(
  (select budget_minor from public.campaign_research_runs
   where id = (select (value ->> 'run_id')::uuid from cadence_state where key = 'a-first')),
  5000::bigint,
  'the run reserves the per-run ceiling, like a manual Ask'
);

select extensions.is(
  (select requested_by from public.campaign_research_runs
   where id = (select (value ->> 'run_id')::uuid from cadence_state where key = 'a-first')),
  'db500000-0000-4000-8000-000000000001'::uuid,
  'the run is attributed to whoever switched the cadence on'
);

select extensions.is(
  (select count(*) from public.campaign_research_events
   where run_id = (select (value ->> 'run_id')::uuid from cadence_state where key = 'a-first')
     and event = 'campaign.proposal_requested'),
  1::bigint,
  'the admission is announced on the same event as a manual Ask'
);

select extensions.is(
  (select warranted from public.campaign_research_schedule_receipts
   where organization_id = 'db500000-0000-4000-8000-000000000101'::uuid),
  true,
  'the receipt records that the change warranted research'
);

-- A retry that crashed between the run insert and the response replays the
-- run it already admitted instead of opening a second one: idempotency wins
-- over due-ness.
insert into cadence_state (key, value)
select 'a-retry', public.evaluate_campaign_research_schedule_due(
  'db500000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'evidence_fingerprint', 'memory:' || repeat('a', 64),
    'candidate_revision', 'db500000-0000-4000-8000-000000000311',
    'request_digest', repeat('a', 64),
    'idempotency_key', 'cadence-a-first-evidence'
  )
);

select extensions.is(
  (select value ->> 'outcome' from cadence_state where key = 'a-retry'),
  'replayed',
  'the same evidence replays its run'
);

select extensions.is(
  (select value ->> 'run_id' from cadence_state where key = 'a-retry'),
  (select value ->> 'run_id' from cadence_state where key = 'a-first'),
  'the replay names the same run'
);

select extensions.is(
  (select count(*) from public.campaign_research_runs
   where organization_id = 'db500000-0000-4000-8000-000000000101'::uuid),
  1::bigint,
  'the retry admits no second run'
);

-- A repeated delivery of the same window with different evidence stands down
-- on the receipt: one evaluation per window, whatever arrives twice. The
-- watermark rewind below replays the racing second scheduler, which read its
-- due-ness before the first claim landed; the receipt — not the watermark —
-- is what stops the double evaluation.
reset role;
update public.campaign_research_schedules
set last_evaluated_at = now() - interval '2 days'
where organization_id = 'db500000-0000-4000-8000-000000000101'::uuid;
set local role service_role;

insert into cadence_state (key, value)
select 'a-repeat-window', public.evaluate_campaign_research_schedule_due(
  'db500000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'evidence_fingerprint', 'memory:' || repeat('c', 64),
    'candidate_revision', 'db500000-0000-4000-8000-000000000312',
    'request_digest', repeat('c', 64),
    'idempotency_key', 'cadence-a-other-evidence'
  )
);

select extensions.is(
  (select value ->> 'outcome' from cadence_state where key = 'a-repeat-window'),
  'already_evaluated',
  'a second evaluation in the same window stands down on the receipt'
);

select extensions.is(
  (select count(*) from public.campaign_research_runs
   where organization_id = 'db500000-0000-4000-8000-000000000101'::uuid),
  1::bigint,
  'the repeated window admits no second run'
);

-- ---------------------------------------------------------------------------
-- C proves the per-revision rule: one proposal per material evidence
-- revision, and a repeated capture of the same root revision warrants
-- nothing while still storing its outcome. (Watermark resets and receipt
-- clears below replay later windows; the runner owns those tables, so the
-- role steps out and back in around each one.)
-- ---------------------------------------------------------------------------

insert into cadence_state (key, value)
select 'c-first', public.evaluate_campaign_research_schedule_due(
  'db500000-0000-4000-8000-000000000103'::uuid,
  jsonb_build_object(
    'evidence_fingerprint', 'memory:' || repeat('d', 64),
    'candidate_revision', 'db500000-0000-4000-8000-000000000331',
    'request_digest', repeat('d', 64),
    'idempotency_key', 'cadence-c-first-evidence'
  )
);

select extensions.is(
  (select value ->> 'outcome' from cadence_state where key = 'c-first'),
  'admitted',
  'C admits on its first material revision'
);

reset role;
update public.campaign_research_schedules
set last_evaluated_at = now() - interval '2 days'
where organization_id = 'db500000-0000-4000-8000-000000000103'::uuid;
delete from public.campaign_research_schedule_receipts
where organization_id = 'db500000-0000-4000-8000-000000000103'::uuid;
set local role service_role;

-- Same digest, same revision: seen, not re-evaluated at full cost.
insert into cadence_state (key, value)
select 'c-repeat', public.evaluate_campaign_research_schedule_due(
  'db500000-0000-4000-8000-000000000103'::uuid,
  jsonb_build_object(
    'evidence_fingerprint', 'memory:' || repeat('d', 64),
    'candidate_revision', 'db500000-0000-4000-8000-000000000331',
    'request_digest', repeat('e', 64),
    'idempotency_key', 'cadence-c-repeat-evidence'
  )
);

select extensions.is(
  (select value ->> 'outcome' from cadence_state where key = 'c-repeat'),
  'already_evaluated',
  'a repeated capture of the same root revision is recognized as seen'
);

select extensions.is(
  (select count(*) from public.campaign_research_runs
   where organization_id = 'db500000-0000-4000-8000-000000000103'::uuid),
  1::bigint,
  'the repeated revision admits no second run'
);

select extensions.is(
  (select warranted from public.campaign_research_source_fingerprints
   where organization_id = 'db500000-0000-4000-8000-000000000103'::uuid
     and fingerprint = 'memory:' || repeat('d', 64)),
  true,
  'the evaluated source keeps its warranted receipt'
);

-- A material new revision under a memory-only cadence admits exactly one run.
reset role;
update public.campaign_research_schedules
set last_evaluated_at = now() - interval '2 days'
where organization_id = 'db500000-0000-4000-8000-000000000103'::uuid;
delete from public.campaign_research_schedule_receipts
where organization_id = 'db500000-0000-4000-8000-000000000103'::uuid;
set local role service_role;

insert into cadence_state (key, value)
select 'c-second', public.evaluate_campaign_research_schedule_due(
  'db500000-0000-4000-8000-000000000103'::uuid,
  jsonb_build_object(
    'evidence_fingerprint', 'memory:' || repeat('f', 64),
    'candidate_revision', 'db500000-0000-4000-8000-000000000332',
    'request_digest', repeat('f', 64),
    'idempotency_key', 'cadence-c-second-evidence'
  )
);

select extensions.is(
  (select value ->> 'outcome' from cadence_state where key = 'c-second'),
  'admitted',
  'a material new revision admits one run'
);

select extensions.is(
  (select count(*) from public.campaign_research_runs
   where organization_id = 'db500000-0000-4000-8000-000000000103'::uuid),
  2::bigint,
  'one run per material revision, no more'
);

-- ---------------------------------------------------------------------------
-- D: an exhausted window refuses by name, stores the refusal, and proposes
-- nothing. The reservation is atomic: the second-in-line loses under the
-- schedule lock exactly as a concurrent manual Ask would under the pointer
-- lock (true concurrency needs two sessions; the lock plus the unique
-- receipt is the mechanism, and this proves the loser refuses cleanly).
-- ---------------------------------------------------------------------------

insert into cadence_state (key, value)
select 'd-first', public.evaluate_campaign_research_schedule_due(
  'db500000-0000-4000-8000-000000000104'::uuid,
  jsonb_build_object(
    'evidence_fingerprint', 'memory:' || repeat('1', 64),
    'candidate_revision', 'db500000-0000-4000-8000-000000000341',
    'request_digest', repeat('1', 64),
    'idempotency_key', 'cadence-d-first-evidence'
  )
);

select extensions.is(
  (select value ->> 'outcome' from cadence_state where key = 'd-first'),
  'admitted',
  'D admits while the window has room'
);

reset role;
update public.campaign_research_schedules
set last_evaluated_at = now() - interval '2 days'
where organization_id = 'db500000-0000-4000-8000-000000000104'::uuid;
delete from public.campaign_research_schedule_receipts
where organization_id = 'db500000-0000-4000-8000-000000000104'::uuid;
set local role service_role;

insert into cadence_state (key, value)
select 'd-second', public.evaluate_campaign_research_schedule_due(
  'db500000-0000-4000-8000-000000000104'::uuid,
  jsonb_build_object(
    'evidence_fingerprint', 'memory:' || repeat('2', 64),
    'candidate_revision', 'db500000-0000-4000-8000-000000000342',
    'request_digest', repeat('2', 64),
    'idempotency_key', 'cadence-d-second-evidence'
  )
);

select extensions.is(
  (select value ->> 'outcome' from cadence_state where key = 'd-second'),
  'refused',
  'an exhausted window refuses rather than overrunning'
);

select extensions.is(
  (select value ->> 'reason' from cadence_state where key = 'd-second'),
  'allowance_exceeded',
  'the refusal names the purse in the admission vocabulary'
);

select extensions.is(
  (select count(*) from public.campaign_research_runs
   where organization_id = 'db500000-0000-4000-8000-000000000104'::uuid),
  1::bigint,
  'the refused evaluation proposes nothing'
);

select extensions.is(
  (select (outcome = 'refused' and refusal_reason = 'allowance_exceeded' and warranted)
   from public.campaign_research_schedule_receipts
   where organization_id = 'db500000-0000-4000-8000-000000000104'::uuid),
  true,
  'the refusal is stored with its reason: warranted, but no money'
);

-- ---------------------------------------------------------------------------
-- E: the pending cap binds scheduled runs exactly as it binds manual Asks.
-- ---------------------------------------------------------------------------

insert into cadence_state (key, value)
select 'e-first', public.evaluate_campaign_research_schedule_due(
  'db500000-0000-4000-8000-000000000105'::uuid,
  jsonb_build_object(
    'evidence_fingerprint', 'memory:' || repeat('3', 64),
    'candidate_revision', 'db500000-0000-4000-8000-000000000351',
    'request_digest', repeat('3', 64),
    'idempotency_key', 'cadence-e-first-evidence'
  )
);

select extensions.is(
  (select value ->> 'outcome' from cadence_state where key = 'e-first'),
  'admitted',
  'E admits its first run'
);

reset role;
update public.campaign_research_schedules
set last_evaluated_at = now() - interval '2 days'
where organization_id = 'db500000-0000-4000-8000-000000000105'::uuid;
delete from public.campaign_research_schedule_receipts
where organization_id = 'db500000-0000-4000-8000-000000000105'::uuid;
set local role service_role;

-- The first run is still queued, so the pending cap of one fires before the
-- cooldown is even reached: identical order to the manual writer.
insert into cadence_state (key, value)
select 'e-second', public.evaluate_campaign_research_schedule_due(
  'db500000-0000-4000-8000-000000000105'::uuid,
  jsonb_build_object(
    'evidence_fingerprint', 'memory:' || repeat('4', 64),
    'candidate_revision', 'db500000-0000-4000-8000-000000000352',
    'request_digest', repeat('4', 64),
    'idempotency_key', 'cadence-e-second-evidence'
  )
);

select extensions.is(
  (select value ->> 'reason' from cadence_state where key = 'e-second'),
  'pending_limit',
  'a full pending queue refuses the scheduled run first'
);

-- ---------------------------------------------------------------------------
-- F and G: the window follows the policy's midnight, not UTC's.
-- Pacific/Kiritimati (UTC+14) and Pacific/Midway (UTC-11) are 25 hours
-- apart, so their local dates always differ whatever instant the suite runs
-- at — the two receipts' windows must differ too.
-- ---------------------------------------------------------------------------

select extensions.is(
  ((now() at time zone 'Pacific/Kiritimati')::date
    = (now() at time zone 'Pacific/Midway')::date),
  false,
  'the two probe timezones never share a local date'
);

insert into cadence_state (key, value)
select 'f-first', public.evaluate_campaign_research_schedule_due(
  'db500000-0000-4000-8000-000000000106'::uuid,
  jsonb_build_object(
    'evidence_fingerprint', 'memory:' || repeat('5', 64),
    'candidate_revision', 'db500000-0000-4000-8000-000000000361',
    'request_digest', repeat('5', 64),
    'idempotency_key', 'cadence-f-first-evidence'
  )
);

insert into cadence_state (key, value)
select 'g-first', public.evaluate_campaign_research_schedule_due(
  'db500000-0000-4000-8000-000000000107'::uuid,
  jsonb_build_object(
    'evidence_fingerprint', 'memory:' || repeat('6', 64),
    'candidate_revision', 'db500000-0000-4000-8000-000000000371',
    'request_digest', repeat('6', 64),
    'idempotency_key', 'cadence-g-first-evidence'
  )
);

select extensions.is(
  (select value ->> 'outcome' from cadence_state where key = 'f-first'),
  'admitted',
  'F admits in its own midnight'
);

select extensions.is(
  (select value ->> 'outcome' from cadence_state where key = 'g-first'),
  'admitted',
  'G admits in its own midnight'
);

select extensions.ok(
  (select f.window_start from public.campaign_research_schedule_receipts f
   where f.organization_id = 'db500000-0000-4000-8000-000000000106'::uuid)
  is distinct from
  (select g.window_start from public.campaign_research_schedule_receipts g
   where g.organization_id = 'db500000-0000-4000-8000-000000000107'::uuid),
  'the two windows follow their own midnights'
);

-- ---------------------------------------------------------------------------
-- D again, now pointed at an unreadable timezone: config corruption raises
-- rather than being guessed at.
-- ---------------------------------------------------------------------------

reset role;
insert into public.campaign_research_policies (
  id, organization_id, version, enabled, schedule_timezone,
  evidence_qualification_rule_version, evidence_max_age_days,
  cooldown_seconds, max_pending_proposals, max_attempts,
  per_run_allowance_minor, window_allowance_minor, allowance_currency, window_days, created_by
) values
  ('db500000-0000-4000-8000-000000000208'::uuid,
   'db500000-0000-4000-8000-000000000104'::uuid, 2, true, 'Not/AZone',
   'evidence-qualification@2', 30, 0, 5, 3, 5000, 20000, 'AED', 30,
   'db500000-0000-4000-8000-000000000005'::uuid);
update public.campaign_research_policy_current
set policy_id = 'db500000-0000-4000-8000-000000000208'::uuid
where organization_id = 'db500000-0000-4000-8000-000000000104'::uuid;
update public.campaign_research_schedules
set last_evaluated_at = now() - interval '2 days'
where organization_id = 'db500000-0000-4000-8000-000000000104'::uuid;
delete from public.campaign_research_schedule_receipts
where organization_id = 'db500000-0000-4000-8000-000000000104'::uuid;
set local role service_role;

select extensions.throws_ok(
  $$select public.evaluate_campaign_research_schedule_due(
      'db500000-0000-4000-8000-000000000104'::uuid,
      jsonb_build_object(
        'evidence_fingerprint', 'memory:' || repeat('7', 64),
        'candidate_revision', 'db500000-0000-4000-8000-000000000343',
        'request_digest', repeat('7', 64),
        'idempotency_key', 'cadence-d-bad-timezone'
      ))$$,
  '22023',
  'campaign_research_invalid',
  'an unreadable timezone raises instead of bucketing by a guess'
);

-- ---------------------------------------------------------------------------
-- The worker functions stay worker-only: the grant is the gate.
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'db500000-0000-4000-8000-000000000001';

select extensions.throws_ok(
  $$select public.list_campaign_research_due_organizations()$$,
  '42501',
  null,
  'the due list is not readable from a session'
);

select extensions.throws_ok(
  format(
    $fmt$select public.evaluate_campaign_research_schedule_due(
      'db500000-0000-4000-8000-000000000101'::uuid,
      %L::jsonb)$fmt$,
    jsonb_build_object(
      'evidence_fingerprint', 'memory:' || repeat('z', 64),
      'request_digest', repeat('z', 64),
      'idempotency_key', 'cadence-a-session-attempt'
    )::text
  ),
  '42501',
  null,
  'a session cannot evaluate a schedule directly'
);

rollback;
