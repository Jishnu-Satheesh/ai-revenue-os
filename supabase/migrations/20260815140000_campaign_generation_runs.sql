-- Durable generation runs.
--
-- Trigger.dev is execution only. A Trigger run id is not a record of what the
-- platform agreed to do, survives no redeploy reasoning, and cannot answer
-- "did this already run?" across a retry. This table is that record: the queue
-- can lose a message, restart a worker, or deliver twice, and the answer to
-- what happened comes from here.
--
-- Claiming is leased rather than locked. A worker that dies holding a lock
-- would block the campaign until someone noticed; a worker that dies holding a
-- lease simply stops renewing it, and the next attempt takes over once it
-- expires. The claim token is what fences the dead worker out if it wakes up.

create table public.campaign_generation_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null,
  source_snapshot_id uuid not null,
  kind text not null check (kind in ('generate', 'revise')),
  -- The caller's business key. Two requests carrying the same key are the same
  -- request, however many times the queue delivers them.
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  -- What was asked for. A replay carrying the same key but different content is
  -- a bug in the caller, not a retry, and must not silently reuse the result.
  request_digest text not null check (request_digest ~ '^[0-9a-f]{64}$'),
  correlation_id uuid not null,
  status text not null default 'queued' check (
    status in ('queued', 'claimed', 'succeeded', 'failed', 'cancelled')
  ),
  claim_token uuid,
  lease_expires_at timestamptz,
  attempt integer not null default 0 check (attempt >= 0),
  -- Revisions only: the version this run was written against.
  base_version_id uuid,
  base_digest text check (base_digest ~ '^[0-9a-f]{64}$'),
  -- Set once, on success.
  result_version_id uuid,
  failure_code text check (char_length(failure_code) between 1 and 120),
  -- Accumulated model cost, in the organization's currency minor units. Null
  -- means not measured; zero would claim the run was free.
  cost_minor bigint check (cost_minor >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  -- The replay key. One business request, one run row, forever.
  unique (organization_id, campaign_id, idempotency_key),
  foreign key (organization_id, campaign_id)
    references public.campaigns (organization_id, id) on delete cascade,
  foreign key (organization_id, source_snapshot_id)
    references public.campaign_source_snapshots (organization_id, id) on delete restrict,
  foreign key (organization_id, base_version_id)
    references public.campaign_bundle_versions (organization_id, id) on delete restrict,
  foreign key (organization_id, result_version_id)
    references public.campaign_bundle_versions (organization_id, id) on delete restrict,
  check ((kind = 'revise') = (base_version_id is not null)),
  check ((base_version_id is null) = (base_digest is null)),
  check ((status = 'claimed') = (claim_token is not null)),
  check ((claim_token is null) = (lease_expires_at is null)),
  check (status <> 'succeeded' or result_version_id is not null),
  check (status <> 'failed' or failure_code is not null)
);

create index campaign_generation_runs_campaign_idx
  on public.campaign_generation_runs (organization_id, campaign_id, created_at desc);
create index campaign_generation_runs_claimable_idx
  on public.campaign_generation_runs (status, lease_expires_at)
  where status in ('queued', 'claimed');
create index campaign_generation_runs_snapshot_idx
  on public.campaign_generation_runs (organization_id, source_snapshot_id);
create index campaign_generation_runs_base_version_idx
  on public.campaign_generation_runs (organization_id, base_version_id);
create index campaign_generation_runs_result_version_idx
  on public.campaign_generation_runs (organization_id, result_version_id);

alter table public.campaign_generation_runs enable row level security;
alter table public.campaign_generation_runs force row level security;

-- Members watch their own runs; nobody writes one from a browser.
create policy "members read campaign generation runs" on public.campaign_generation_runs
  for select to authenticated using (private.is_organization_member(organization_id));

revoke all on table public.campaign_generation_runs from anon;
revoke all on table public.campaign_generation_runs from authenticated;
grant select on table public.campaign_generation_runs to authenticated;

create trigger campaign_generation_runs_audit
  after insert or update on public.campaign_generation_runs
  for each row execute function private.audit_organization_change();

-- ---------------------------------------------------------------------------
-- Enqueue: the request path's only write
-- ---------------------------------------------------------------------------

create function public.enqueue_campaign_generation_run(
  target_organization_id uuid,
  input_run jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.campaign_generation_runs;
  saved_id uuid;
  supplied_digest text := input_run ->> 'request_digest';
begin
  if target_organization_id is null
    or input_run ->> 'organization_id' is distinct from target_organization_id::text
  then
    raise exception 'campaign_generation_organization_mismatch' using errcode = '42501';
  end if;

  if auth.uid() is null or not private.has_organization_role(
    target_organization_id,
    array['owner', 'admin', 'operator']::public.organization_role[]
  ) then
    raise exception 'campaign_generation_forbidden' using errcode = '42501';
  end if;

  select run.* into existing
  from public.campaign_generation_runs run
  where run.organization_id = target_organization_id
    and run.campaign_id = (input_run ->> 'campaign_id')::uuid
    and run.idempotency_key = input_run ->> 'idempotency_key';

  if found then
    -- Same key, different request. Returning the old run would answer a
    -- question nobody asked; creating a new one would break the key's promise.
    if existing.request_digest is distinct from supplied_digest then
      raise exception 'campaign_generation_idempotency_conflict' using errcode = '22023';
    end if;
    return pg_catalog.jsonb_build_object(
      'run_id', existing.id, 'status', existing.status, 'replayed', true
    );
  end if;

  insert into public.campaign_generation_runs (
    organization_id, campaign_id, source_snapshot_id, kind, idempotency_key,
    request_digest, correlation_id, base_version_id, base_digest
  ) values (
    target_organization_id,
    (input_run ->> 'campaign_id')::uuid,
    (input_run ->> 'source_snapshot_id')::uuid,
    input_run ->> 'kind',
    input_run ->> 'idempotency_key',
    supplied_digest,
    (input_run ->> 'correlation_id')::uuid,
    (input_run ->> 'base_version_id')::uuid,
    input_run ->> 'base_digest'
  )
  returning id into saved_id;

  return pg_catalog.jsonb_build_object('run_id', saved_id, 'status', 'queued', 'replayed', false);
end;
$$;

revoke all on function public.enqueue_campaign_generation_run(uuid, jsonb) from public, anon;
grant execute on function public.enqueue_campaign_generation_run(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Worker-only lifecycle
-- ---------------------------------------------------------------------------

create function public.claim_campaign_generation_run(
  target_organization_id uuid,
  input_claim jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.campaign_generation_runs;
  token uuid := gen_random_uuid();
  lease interval := pg_catalog.make_interval(secs => coalesce((input_claim ->> 'lease_seconds')::integer, 300));
begin
  if target_organization_id is null
    or input_claim ->> 'organization_id' is distinct from target_organization_id::text
  then
    raise exception 'campaign_generation_organization_mismatch' using errcode = '42501';
  end if;

  select existing.* into run
  from public.campaign_generation_runs existing
  where existing.organization_id = target_organization_id
    and existing.id = (input_claim ->> 'run_id')::uuid
  for update;

  if not found then
    raise exception 'campaign_generation_run_not_found' using errcode = '42501';
  end if;

  -- Already finished. A retry that arrives after the work is done replays the
  -- outcome instead of doing it again.
  if run.status in ('succeeded', 'failed', 'cancelled') then
    return pg_catalog.jsonb_build_object(
      'outcome', 'already_finished',
      'status', run.status,
      'result_version_id', run.result_version_id,
      'failure_code', run.failure_code
    );
  end if;

  -- Someone else holds a live lease. Not an error: the other worker is doing
  -- the job, and this one should stop rather than duplicate it.
  if run.status = 'claimed' and run.lease_expires_at > pg_catalog.now() then
    return pg_catalog.jsonb_build_object('outcome', 'already_claimed');
  end if;

  update public.campaign_generation_runs
  set status = 'claimed',
      claim_token = token,
      lease_expires_at = pg_catalog.now() + lease,
      attempt = attempt + 1,
      updated_at = pg_catalog.now()
  where organization_id = target_organization_id and id = run.id;

  return pg_catalog.jsonb_build_object(
    'outcome', 'claimed',
    'claim_token', token,
    'attempt', run.attempt + 1,
    'campaign_id', run.campaign_id,
    'source_snapshot_id', run.source_snapshot_id,
    'kind', run.kind,
    'base_version_id', run.base_version_id,
    'base_digest', run.base_digest,
    'correlation_id', run.correlation_id
  );
end;
$$;

/**
 * Fences a stale worker.
 *
 * Every terminal write carries the claim token. A worker that lost its lease,
 * finished late, and tried to publish would otherwise overwrite the result of
 * the worker that replaced it.
 */
create function private.assert_campaign_generation_claim(
  target_organization_id uuid,
  target_run_id uuid,
  supplied_token uuid
)
returns public.campaign_generation_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.campaign_generation_runs;
begin
  select existing.* into run
  from public.campaign_generation_runs existing
  where existing.organization_id = target_organization_id
    and existing.id = target_run_id
  for update;

  if not found then
    raise exception 'campaign_generation_run_not_found' using errcode = '42501';
  end if;

  if run.claim_token is distinct from supplied_token then
    raise exception 'campaign_generation_claim_lost' using errcode = '42501';
  end if;

  if run.status <> 'claimed' then
    raise exception 'campaign_generation_run_not_claimed' using errcode = '22023';
  end if;

  return run;
end;
$$;

create function public.complete_campaign_generation_run(
  target_organization_id uuid,
  input_completion jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.campaign_generation_runs;
  produced_version uuid := (input_completion ->> 'result_version_id')::uuid;
begin
  run := private.assert_campaign_generation_claim(
    target_organization_id,
    (input_completion ->> 'run_id')::uuid,
    (input_completion ->> 'claim_token')::uuid
  );

  -- The version must belong to the campaign this run was for. A run that
  -- published into a different campaign would be untraceable afterwards.
  if not exists (
    select 1 from public.campaign_bundle_versions version
    where version.organization_id = target_organization_id
      and version.id = produced_version
      and version.campaign_id = run.campaign_id
  ) then
    raise exception 'campaign_generation_version_mismatch' using errcode = '22023';
  end if;

  update public.campaign_generation_runs
  set status = 'succeeded',
      result_version_id = produced_version,
      claim_token = null,
      lease_expires_at = null,
      cost_minor = (input_completion ->> 'cost_minor')::bigint,
      updated_at = pg_catalog.now()
  where organization_id = target_organization_id and id = run.id;
end;
$$;

create function public.fail_campaign_generation_run(
  target_organization_id uuid,
  input_failure jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.campaign_generation_runs;
begin
  run := private.assert_campaign_generation_claim(
    target_organization_id,
    (input_failure ->> 'run_id')::uuid,
    (input_failure ->> 'claim_token')::uuid
  );

  update public.campaign_generation_runs
  set status = 'failed',
      failure_code = input_failure ->> 'failure_code',
      claim_token = null,
      lease_expires_at = null,
      cost_minor = (input_failure ->> 'cost_minor')::bigint,
      updated_at = pg_catalog.now()
  where organization_id = target_organization_id and id = run.id;
end;
$$;

/**
 * Cancellation fences future work without rewriting what already happened.
 *
 * A run that has already succeeded stays succeeded: the version it published
 * exists, and calling it cancelled afterwards would make the record disagree
 * with the database.
 */
create function public.cancel_campaign_generation_run(
  target_organization_id uuid,
  input_cancel jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.campaign_generation_runs;
begin
  select existing.* into run
  from public.campaign_generation_runs existing
  where existing.organization_id = target_organization_id
    and existing.id = (input_cancel ->> 'run_id')::uuid
  for update;

  if not found then
    raise exception 'campaign_generation_run_not_found' using errcode = '42501';
  end if;

  if run.status in ('succeeded', 'failed', 'cancelled') then
    return pg_catalog.jsonb_build_object('outcome', 'already_finished', 'status', run.status);
  end if;

  update public.campaign_generation_runs
  set status = 'cancelled',
      claim_token = null,
      lease_expires_at = null,
      updated_at = pg_catalog.now()
  where organization_id = target_organization_id and id = run.id;

  return pg_catalog.jsonb_build_object('outcome', 'cancelled', 'status', 'cancelled');
end;
$$;

revoke all on function public.claim_campaign_generation_run(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.complete_campaign_generation_run(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.fail_campaign_generation_run(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.cancel_campaign_generation_run(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.assert_campaign_generation_claim(uuid, uuid, uuid) from public, anon, authenticated;

grant execute on function public.claim_campaign_generation_run(uuid, jsonb) to service_role;
grant execute on function public.complete_campaign_generation_run(uuid, jsonb) to service_role;
grant execute on function public.fail_campaign_generation_run(uuid, jsonb) to service_role;
grant execute on function public.cancel_campaign_generation_run(uuid, jsonb) to service_role;
