-- Recording a generation run that died before it was ever claimed.
--
-- Every campaign workflow claims its run as its first act, and from then on it
-- owns the outcome: it holds a claim token and a lease, and its failure handler
-- writes what went wrong. None of that exists while the worker is still
-- assembling the dependencies it will hand the workflow. An exception there
-- kills the attempt with the run row untouched.
--
-- That is exactly what happened to Trigger run `run_06g9cko3ehp1gemp1f1v6k6h01`
-- on 12 September 2026: FAILED after two attempts, while its domain run
-- `d2682f4c-…` still reads `queued`, `attempt = 0`, no lease, no failure code.
-- The platform's own record says the work is waiting to start. It is not
-- waiting; it is dead. A client reading that row is shown a spinner forever.
-- Audit finding F02.
--
-- This function is the missing write. It is deliberately *not* a claim: a
-- worker that died before it could claim anything must never be able to fence
-- out a worker that is currently succeeding at the same job. So it writes only
-- a run still sitting in `queued`, and answers without writing anything at all
-- when somebody else holds a live lease or the run has already finished.
--
-- Forward-only. No column is added: the distinction a reader needs is
-- "it never started" versus "it started and failed", and the `bootstrap:`
-- prefix on the existing failure code says that without every existing reader
-- having to learn a new column.

create function public.fail_campaign_generation_run_bootstrap(
  target_organization_id uuid,
  input_failure jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.campaign_generation_runs;
  supplied_code text := input_failure ->> 'failure_code';
begin
  -- Tenant identity is proven from the argument, never inferred from the
  -- payload alone. A worker holds a service-role client; a mismatch here is
  -- the only thing standing between one tenant's worker and another's run.
  if target_organization_id is null
    or input_failure ->> 'organization_id' is distinct from target_organization_id::text
  then
    raise exception 'campaign_generation_organization_mismatch' using errcode = '42501';
  end if;

  -- Only a bootstrap failure may be recorded here. Letting this function write
  -- an arbitrary code would make it a second, unfenced failure path for runs a
  -- worker legitimately claimed.
  if supplied_code is null or pg_catalog.left(supplied_code, 10) <> 'bootstrap:' then
    raise exception 'campaign_generation_bootstrap_code_required' using errcode = '22023';
  end if;

  if pg_catalog.char_length(supplied_code) > 120 then
    raise exception 'campaign_generation_bootstrap_code_too_long' using errcode = '22023';
  end if;

  select existing.* into run
  from public.campaign_generation_runs existing
  where existing.organization_id = target_organization_id
    and existing.id = (input_failure ->> 'run_id')::uuid
  for update;

  if not found then
    raise exception 'campaign_generation_run_not_found' using errcode = '42501';
  end if;

  -- Already done. A bootstrap failure arriving after the work finished is a
  -- late duplicate delivery, not a reason to rewrite history.
  if run.status in ('succeeded', 'failed', 'cancelled') then
    return pg_catalog.jsonb_build_object(
      'outcome', 'already_finished',
      'status', run.status
    );
  end if;

  -- Somebody is holding it. Whether their lease is live or lapsed, the run has
  -- reached a worker that got further than this one did, and the claim/lease
  -- takeover path already handles a dead holder. Writing here would clear a
  -- claim token this function never owned.
  if run.status = 'claimed' then
    return pg_catalog.jsonb_build_object('outcome', 'already_claimed');
  end if;

  update public.campaign_generation_runs
  set status = 'failed',
      failure_code = supplied_code,
      -- The attempt is counted. A row that reports attempt 0 after two real
      -- dispatches is the lie this whole migration exists to stop telling.
      attempt = run.attempt + 1,
      claim_token = null,
      lease_expires_at = null,
      -- Cost is left untouched, not zeroed. Nothing was spent that we measured,
      -- and writing 0 would claim a measurement nobody took.
      updated_at = pg_catalog.now()
  where organization_id = target_organization_id and id = run.id;

  return pg_catalog.jsonb_build_object(
    'outcome', 'recorded',
    'attempt', run.attempt + 1
  );
end;
$$;

revoke all on function public.fail_campaign_generation_run_bootstrap(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.fail_campaign_generation_run_bootstrap(uuid, jsonb)
  to service_role;
