-- A takeover must look like a claim to the rest of the pipeline.
--
-- The re-acquire branch of the projection claim (an expired lease on a run
-- still marked `running`) refreshed the operation's lease and token but left
-- the package wherever the previous failure had parked it. The completion
-- RPC admits only `projecting`, so every takeover -- the one path designed
-- to rescue a stuck projection -- filed its finished work into a guard that
-- silently returned null: the task reported `projected`, the ledger kept
-- nothing, and nothing anywhere said why.
--
-- The fresh-claim branch already sets this status; the re-acquire branch now
-- does too. No other line changes.

create or replace function public.claim_governed_report_package_projection(
  p_organization_id uuid,
  p_report_package_id uuid,
  p_report_contract_version_id uuid,
  p_report_projection_version_id uuid,
  p_projection_run_id uuid,
  p_idempotency_key text,
  p_claim_token uuid,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  package_row public.integration_report_packages;
  operation private.integration_report_projection_operations;
  existing_run public.integration_report_projection_runs;
  validation_row public.integration_report_validation_runs;
  projection_version public.report_projection_versions;
  projection_binding public.report_projection_bindings;
  input_digest text;
begin
  if (select auth.uid()) is not null then
    raise exception 'report projection claim is worker-only' using errcode = '42501';
  end if;

  select * into package_row from public.integration_report_packages
  where organization_id = p_organization_id and id = p_report_package_id for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;

  select * into operation from private.integration_report_projection_operations
  where organization_id = p_organization_id and report_package_id = p_report_package_id for update;
  if found then
    select * into existing_run from public.integration_report_projection_runs
    where organization_id = p_organization_id and id = operation.projection_run_id;
    if existing_run.report_contract_version_id <> p_report_contract_version_id or existing_run.report_projection_version_id <> p_report_projection_version_id then return jsonb_build_object('outcome', 'conflict'); end if;
    if existing_run.status in ('projected', 'partially_projected') then
      if operation.idempotency_key <> p_idempotency_key or operation.projection_run_id <> p_projection_run_id then return jsonb_build_object('outcome', 'conflict'); end if;
      return jsonb_build_object('outcome', 'completed', 'projectionRunId', existing_run.id);
    end if;
    if existing_run.status = 'running' then
      if operation.idempotency_key <> p_idempotency_key or operation.projection_run_id <> p_projection_run_id then return jsonb_build_object('outcome', 'conflict'); end if;
      if operation.claim_token <> p_claim_token and operation.lease_expires_at > now() then return jsonb_build_object('outcome', 'in_progress', 'projectionRunId', existing_run.id); end if;
      update private.integration_report_projection_operations set claim_token = p_claim_token,
        lease_expires_at = now() + interval '20 minutes', attempt_count = attempt_count + 1, updated_at = now()
      where organization_id = p_organization_id and report_package_id = p_report_package_id;
      -- THE FIX: a takeover re-enters the projecting state, exactly like a
      -- fresh claim, so the completion guard recognises it.
      update public.integration_report_packages set status = 'projecting', safe_failure_code = null,
        safe_failure_at = null, correlation_id = p_correlation_id
      where organization_id = p_organization_id and id = p_report_package_id;
      return jsonb_build_object('outcome', 'acquired', 'reportPackage', to_jsonb(package_row),
        'contractVersion', (select to_jsonb(v) from public.report_contract_versions v where v.organization_id = p_organization_id and v.id = existing_run.report_contract_version_id),
        'projectionVersion', (select to_jsonb(v) from public.report_projection_versions v where v.organization_id = p_organization_id and v.id = existing_run.report_projection_version_id));
    end if;
    if existing_run.status = 'failed' and package_row.status = 'awaiting_projection' then
      delete from private.integration_report_projection_operations
      where organization_id = p_organization_id and report_package_id = p_report_package_id;
    else
      return jsonb_build_object('outcome', 'not_ready');
    end if;
  end if;
  if package_row.status not in ('awaiting_projection', 'projecting') then return jsonb_build_object('outcome', 'not_ready'); end if;
  if package_row.retained_until <= now() then
    update public.integration_report_packages set status = 'projection_failed', safe_failure_code = 'PACKAGE_EXPIRED', safe_failure_at = now(), correlation_id = p_correlation_id where organization_id = p_organization_id and id = p_report_package_id;
    return jsonb_build_object('outcome', 'expired');
  end if;
  select * into validation_row from public.integration_report_validation_runs
  where organization_id = p_organization_id and report_package_id = p_report_package_id
    and report_contract_version_id = p_report_contract_version_id and status in ('validated', 'partially_validated')
  order by completed_at desc limit 1;
  select * into projection_version from public.report_projection_versions
  where organization_id = p_organization_id and id = p_report_projection_version_id and report_contract_version_id = p_report_contract_version_id;
  select * into projection_binding from public.report_projection_bindings
  where organization_id = p_organization_id and report_projection_version_id = p_report_projection_version_id
    and report_contract_version_id = p_report_contract_version_id and active for update;
  if not found or validation_row.id is null
    or projection_binding.report_contract_binding_id <> validation_row.report_contract_binding_id
    or projection_version.id is distinct from projection_binding.report_projection_version_id then
    return jsonb_build_object('outcome', 'not_ready');
  end if;
  input_digest := encode(extensions.digest(concat_ws('|', p_report_package_id, p_report_contract_version_id, p_report_projection_version_id, validation_row.id, validation_row.result_digest, projection_binding.id), 'sha256'), 'hex');
  insert into private.integration_report_projection_operations (
    organization_id, report_package_id, idempotency_key, input_digest, projection_run_id, claim_token, lease_expires_at
  ) values (
    p_organization_id, p_report_package_id, p_idempotency_key, input_digest, p_projection_run_id, p_claim_token, now() + interval '20 minutes'
  );
  update public.integration_report_packages set status = 'projecting', safe_failure_code = null, safe_failure_at = null, correlation_id = p_correlation_id
  where organization_id = p_organization_id and id = p_report_package_id;
  return jsonb_build_object('outcome', 'acquired', 'reportPackage', to_jsonb(package_row),
    'contractVersion', (select to_jsonb(v) from public.report_contract_versions v where v.organization_id = p_organization_id and v.id = p_report_contract_version_id),
    'projectionVersion', to_jsonb(projection_version));
end;
$$;

revoke all on function public.claim_governed_report_package_projection(uuid, uuid, uuid, uuid, uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_governed_report_package_projection(uuid, uuid, uuid, uuid, uuid, text, uuid, uuid) to service_role;
