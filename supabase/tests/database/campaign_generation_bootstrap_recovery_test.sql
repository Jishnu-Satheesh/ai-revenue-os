begin;

create extension if not exists pgtap with schema extensions;

select extensions.no_plan();

-- ---------------------------------------------------------------------------
-- Grants: the bootstrap writer is a worker, never a browser
-- ---------------------------------------------------------------------------

select extensions.has_function(
  'public', 'fail_campaign_generation_run_bootstrap', array['uuid', 'jsonb'],
  'the pre-claim failure writer exists'
);

select extensions.ok(
  not exists (
    select 1
    from pg_catalog.pg_proc proc
    join pg_catalog.pg_namespace space on space.oid = proc.pronamespace
    where space.nspname = 'public'
      and proc.proname = 'fail_campaign_generation_run_bootstrap'
      and (
        pg_catalog.has_function_privilege('anon', proc.oid, 'execute')
        or pg_catalog.has_function_privilege('authenticated', proc.oid, 'execute')
        or pg_catalog.has_function_privilege('public', proc.oid, 'execute')
      )
  ),
  'no browser role may record a bootstrap failure'
);

select extensions.ok(
  (
    select pg_catalog.has_function_privilege('service_role', proc.oid, 'execute')
    from pg_catalog.pg_proc proc
    join pg_catalog.pg_namespace space on space.oid = proc.pronamespace
    where space.nspname = 'public'
      and proc.proname = 'fail_campaign_generation_run_bootstrap'
  ),
  'the worker role may record a bootstrap failure'
);

-- ---------------------------------------------------------------------------
-- Fixtures: two tenants, so isolation is proved against a real foreign row
-- ---------------------------------------------------------------------------

insert into auth.users (id)
values
  ('cb100000-0000-4000-8000-000000000001'::uuid),
  ('cb100000-0000-4000-8000-000000000002'::uuid);

insert into public.accounts (id, name, slug, created_by)
values (
  'cb1c0000-0000-4000-8000-000000000001'::uuid,
  'Bootstrap recovery fixture agency',
  'bootstrap-recovery-fixture-agency',
  'cb100000-0000-4000-8000-000000000001'::uuid
);

insert into public.organizations (
  id, name, slug, industry, country_code, base_currency, default_timezone, created_by, account_id
)
values
  (
    'cb100000-0000-4000-8000-000000000101'::uuid,
    'Bootstrap tenant A', 'bootstrap-tenant-a', 'testing', 'AE', 'AED', 'Asia/Dubai',
    'cb100000-0000-4000-8000-000000000001'::uuid,
    'cb1c0000-0000-4000-8000-000000000001'::uuid
  ),
  (
    'cb100000-0000-4000-8000-000000000102'::uuid,
    'Bootstrap tenant B', 'bootstrap-tenant-b', 'testing', 'AE', 'AED', 'Asia/Dubai',
    'cb100000-0000-4000-8000-000000000002'::uuid,
    'cb1c0000-0000-4000-8000-000000000001'::uuid
  );

insert into public.organization_memberships (organization_id, user_id, role)
values
  (
    'cb100000-0000-4000-8000-000000000101'::uuid,
    'cb100000-0000-4000-8000-000000000001'::uuid,
    'operator'
  ),
  (
    'cb100000-0000-4000-8000-000000000102'::uuid,
    'cb100000-0000-4000-8000-000000000002'::uuid,
    'operator'
  );

insert into public.campaign_briefs (id, organization_id, objective, audience, created_by)
values
  (
    'cb100000-0000-4000-8000-000000000401'::uuid,
    'cb100000-0000-4000-8000-000000000101'::uuid,
    'Sell the weekday lunch', 'Nearby office workers',
    'cb100000-0000-4000-8000-000000000001'::uuid
  ),
  (
    'cb100000-0000-4000-8000-000000000402'::uuid,
    'cb100000-0000-4000-8000-000000000102'::uuid,
    'Foreign objective', 'Foreign audience',
    'cb100000-0000-4000-8000-000000000002'::uuid
  );

insert into public.campaigns (id, organization_id, title, source_kind, brief_id, created_by)
values
  (
    'cb100000-0000-4000-8000-000000000501'::uuid,
    'cb100000-0000-4000-8000-000000000101'::uuid,
    'Local campaign', 'manual_brief',
    'cb100000-0000-4000-8000-000000000401'::uuid,
    'cb100000-0000-4000-8000-000000000001'::uuid
  ),
  (
    'cb100000-0000-4000-8000-000000000502'::uuid,
    'cb100000-0000-4000-8000-000000000102'::uuid,
    'Foreign campaign', 'manual_brief',
    'cb100000-0000-4000-8000-000000000402'::uuid,
    'cb100000-0000-4000-8000-000000000002'::uuid
  );

insert into public.campaign_source_snapshots (
  id, organization_id, campaign_id, facts, assertions
)
values
  (
    'cb100000-0000-4000-8000-000000000601'::uuid,
    'cb100000-0000-4000-8000-000000000101'::uuid,
    'cb100000-0000-4000-8000-000000000501'::uuid,
    '{}'::jsonb, '[]'::jsonb
  ),
  (
    'cb100000-0000-4000-8000-000000000602'::uuid,
    'cb100000-0000-4000-8000-000000000102'::uuid,
    'cb100000-0000-4000-8000-000000000502'::uuid,
    '{}'::jsonb, '[]'::jsonb
  );

-- Four runs. The first reproduces the stranded row from the 12 September
-- incident: enqueued, never claimed, attempt zero.
insert into public.campaign_generation_runs (
  id, organization_id, campaign_id, source_snapshot_id, kind, idempotency_key,
  request_digest, correlation_id, status, attempt
)
values
  (
    'cb100000-0000-4000-8000-000000000a01'::uuid,
    'cb100000-0000-4000-8000-000000000101'::uuid,
    'cb100000-0000-4000-8000-000000000501'::uuid,
    'cb100000-0000-4000-8000-000000000601'::uuid,
    'generate', 'bootstrap-fixture-queued-01', pg_catalog.repeat('a', 64),
    'cb100000-0000-4000-8000-000000000b01'::uuid, 'queued', 0
  ),
  (
    'cb100000-0000-4000-8000-000000000a02'::uuid,
    'cb100000-0000-4000-8000-000000000101'::uuid,
    'cb100000-0000-4000-8000-000000000501'::uuid,
    'cb100000-0000-4000-8000-000000000601'::uuid,
    'generate', 'bootstrap-fixture-queued-02', pg_catalog.repeat('b', 64),
    'cb100000-0000-4000-8000-000000000b02'::uuid, 'queued', 0
  ),
  (
    'cb100000-0000-4000-8000-000000000a03'::uuid,
    'cb100000-0000-4000-8000-000000000101'::uuid,
    'cb100000-0000-4000-8000-000000000501'::uuid,
    'cb100000-0000-4000-8000-000000000601'::uuid,
    'generate', 'bootstrap-fixture-queued-03', pg_catalog.repeat('c', 64),
    'cb100000-0000-4000-8000-000000000b03'::uuid, 'queued', 0
  ),
  -- The foreign tenant's run, used to prove isolation against a real row.
  (
    'cb100000-0000-4000-8000-000000000a04'::uuid,
    'cb100000-0000-4000-8000-000000000102'::uuid,
    'cb100000-0000-4000-8000-000000000502'::uuid,
    'cb100000-0000-4000-8000-000000000602'::uuid,
    'generate', 'bootstrap-fixture-foreign-01', pg_catalog.repeat('d', 64),
    'cb100000-0000-4000-8000-000000000b04'::uuid, 'queued', 0
  );

-- A run another worker is actively holding.
update public.campaign_generation_runs
set status = 'claimed',
    claim_token = 'cb100000-0000-4000-8000-000000000c02'::uuid,
    lease_expires_at = pg_catalog.now() + interval '30 minutes',
    attempt = 1
where id = 'cb100000-0000-4000-8000-000000000a02'::uuid;

-- A run that finished while this attempt was dying.
update public.campaign_generation_runs
set status = 'cancelled'
where id = 'cb100000-0000-4000-8000-000000000a03'::uuid;

set local role service_role;

-- ---------------------------------------------------------------------------
-- The repair: a run that never started stops reading as queued
-- ---------------------------------------------------------------------------

select extensions.is(
  public.fail_campaign_generation_run_bootstrap(
    'cb100000-0000-4000-8000-000000000101'::uuid,
    jsonb_build_object(
      'organization_id', 'cb100000-0000-4000-8000-000000000101',
      'run_id', 'cb100000-0000-4000-8000-000000000a01',
      'failure_code', 'bootstrap:provider_contract_expired',
      'task_id', 'campaign.generate-bundle'
    )
  ),
  jsonb_build_object('outcome', 'recorded', 'attempt', 1),
  'a queued run that never reached a worker is recorded as failed, counting the attempt'
);

select extensions.is(
  (
    select status || '|' || failure_code || '|' || attempt::text
    from public.campaign_generation_runs
    where id = 'cb100000-0000-4000-8000-000000000a01'::uuid
  ),
  'failed|bootstrap:provider_contract_expired|1',
  'the stranded row now states what happened instead of waiting forever'
);

select extensions.ok(
  (
    select claim_token is null and lease_expires_at is null and cost_minor is null
    from public.campaign_generation_runs
    where id = 'cb100000-0000-4000-8000-000000000a01'::uuid
  ),
  'a run that never started holds no claim, no lease and no measured cost'
);

-- ---------------------------------------------------------------------------
-- What it refuses to do
-- ---------------------------------------------------------------------------

select extensions.is(
  public.fail_campaign_generation_run_bootstrap(
    'cb100000-0000-4000-8000-000000000101'::uuid,
    jsonb_build_object(
      'organization_id', 'cb100000-0000-4000-8000-000000000101',
      'run_id', 'cb100000-0000-4000-8000-000000000a02',
      'failure_code', 'bootstrap:worker_start_failed',
      'task_id', 'campaign.generate-bundle'
    )
  ),
  jsonb_build_object('outcome', 'already_claimed'),
  'a run another worker holds is reported, never overwritten'
);

select extensions.is(
  (
    select status || '|' || claim_token::text
    from public.campaign_generation_runs
    where id = 'cb100000-0000-4000-8000-000000000a02'::uuid
  ),
  'claimed|cb100000-0000-4000-8000-000000000c02',
  'the live claim and its token survive the failed bootstrap of a second worker'
);

select extensions.is(
  public.fail_campaign_generation_run_bootstrap(
    'cb100000-0000-4000-8000-000000000101'::uuid,
    jsonb_build_object(
      'organization_id', 'cb100000-0000-4000-8000-000000000101',
      'run_id', 'cb100000-0000-4000-8000-000000000a03',
      'failure_code', 'bootstrap:worker_start_failed',
      'task_id', 'campaign.generate-bundle'
    )
  ),
  jsonb_build_object('outcome', 'already_finished', 'status', 'cancelled'),
  'a run that reached a terminal state is reported, not rewritten'
);

select extensions.is(
  (
    select status
    from public.campaign_generation_runs
    where id = 'cb100000-0000-4000-8000-000000000a03'::uuid
  ),
  'cancelled',
  'a concurrently finished run keeps the outcome it reached'
);

-- A repeated delivery of the same bootstrap failure is idempotent in effect:
-- the run is already failed, so the second call reports that and writes nothing.
select extensions.is(
  public.fail_campaign_generation_run_bootstrap(
    'cb100000-0000-4000-8000-000000000101'::uuid,
    jsonb_build_object(
      'organization_id', 'cb100000-0000-4000-8000-000000000101',
      'run_id', 'cb100000-0000-4000-8000-000000000a01',
      'failure_code', 'bootstrap:provider_contract_expired',
      'task_id', 'campaign.generate-bundle'
    )
  ),
  jsonb_build_object('outcome', 'already_finished', 'status', 'failed'),
  'a redelivered bootstrap failure does not inflate the attempt count'
);

-- ---------------------------------------------------------------------------
-- Identity and code discipline
-- ---------------------------------------------------------------------------

select extensions.throws_ok(
  $$
    select public.fail_campaign_generation_run_bootstrap(
      'cb100000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', 'cb100000-0000-4000-8000-000000000102',
        'run_id', 'cb100000-0000-4000-8000-000000000a04',
        'failure_code', 'bootstrap:worker_start_failed',
        'task_id', 'campaign.generate-bundle'
      )
    )
  $$,
  '42501', null,
  'a payload naming a different organization than the argument is refused'
);

select extensions.throws_ok(
  $$
    select public.fail_campaign_generation_run_bootstrap(
      'cb100000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', 'cb100000-0000-4000-8000-000000000101',
        'run_id', 'cb100000-0000-4000-8000-000000000a04',
        'failure_code', 'bootstrap:worker_start_failed',
        'task_id', 'campaign.generate-bundle'
      )
    )
  $$,
  '42501', null,
  'another tenant''s run is not visible to this tenant''s worker'
);

select extensions.is(
  (
    select status
    from public.campaign_generation_runs
    where id = 'cb100000-0000-4000-8000-000000000a04'::uuid
  ),
  'queued',
  'the foreign run is untouched by the refused call'
);

-- The prefix is what keeps this function from becoming a second, unfenced
-- failure path for runs a worker legitimately claimed.
select extensions.throws_ok(
  $$
    select public.fail_campaign_generation_run_bootstrap(
      'cb100000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', 'cb100000-0000-4000-8000-000000000101',
        'run_id', 'cb100000-0000-4000-8000-000000000a02',
        'failure_code', 'needs_data:no_declared_subject',
        'task_id', 'campaign.generate-bundle'
      )
    )
  $$,
  '22023', null,
  'only a bootstrap-prefixed failure code may be written here'
);

select extensions.throws_ok(
  $$
    select public.fail_campaign_generation_run_bootstrap(
      'cb100000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', 'cb100000-0000-4000-8000-000000000101',
        'run_id', '00000000-0000-4000-8000-0000000000ff',
        'failure_code', 'bootstrap:worker_start_failed',
        'task_id', 'campaign.generate-bundle'
      )
    )
  $$,
  '42501', null,
  'a run that does not exist is refused rather than silently ignored'
);

reset role;

-- A browser session must not be able to call it at all.
set local role authenticated;
set local request.jwt.claims = '{"sub": "cb100000-0000-4000-8000-000000000001"}';

select extensions.throws_ok(
  $$
    select public.fail_campaign_generation_run_bootstrap(
      'cb100000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', 'cb100000-0000-4000-8000-000000000101',
        'run_id', 'cb100000-0000-4000-8000-000000000a01',
        'failure_code', 'bootstrap:worker_start_failed',
        'task_id', 'campaign.generate-bundle'
      )
    )
  $$,
  '42501', null,
  'an operator in a browser cannot mark a worker run failed'
);

reset role;

select * from extensions.finish();
rollback;
