-- Carry the variant count through enqueue and claim.
--
-- `20260818090000` added the column and the kind; these two functions predate
-- it and would silently drop the number on the way in and on the way out. A
-- variant run whose size never reached the worker would produce nothing and
-- look like a worker fault rather than a plumbing one.

create or replace function public.enqueue_campaign_generation_run(
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
    request_digest, correlation_id, base_version_id, base_digest, variants_per_direction
  ) values (
    target_organization_id,
    (input_run ->> 'campaign_id')::uuid,
    (input_run ->> 'source_snapshot_id')::uuid,
    input_run ->> 'kind',
    input_run ->> 'idempotency_key',
    supplied_digest,
    (input_run ->> 'correlation_id')::uuid,
    (input_run ->> 'base_version_id')::uuid,
    input_run ->> 'base_digest',
    (input_run ->> 'variants_per_direction')::integer
  )
  returning id into saved_id;

  return pg_catalog.jsonb_build_object('run_id', saved_id, 'status', 'queued', 'replayed', false);
end;
$$;

create or replace function public.claim_campaign_generation_run(
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
    'correlation_id', run.correlation_id,
    -- Read back from the row rather than the task payload, so a redelivery
    -- reproduces the size the first attempt asked for.
    'variants_per_direction', run.variants_per_direction
  );
end;
$$;

revoke all on function public.enqueue_campaign_generation_run(uuid, jsonb) from public, anon;
grant execute on function public.enqueue_campaign_generation_run(uuid, jsonb) to authenticated;

revoke all on function public.claim_campaign_generation_run(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.claim_campaign_generation_run(uuid, jsonb) to service_role;
