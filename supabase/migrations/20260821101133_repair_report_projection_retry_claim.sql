-- A failed run keeps the package operation row for idempotency. A later
-- projection retry must replace that failed lease with a fresh run instead of
-- being reported as an already-completed projection.
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
  validation_row public.integration_report_validation_runs;
  projection_version public.report_projection_versions;
  projection_binding public.report_projection_bindings;
  operation private.integration_report_projection_operations;
  existing_run public.integration_report_projection_runs;
  object_row storage.objects;
  input_digest text;
begin
  if char_length(p_idempotency_key) not between 16 and 200 then raise exception 'idempotency key is invalid' using errcode = '22023'; end if;
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
    or package_row.schema_fingerprint <> projection_binding.schema_fingerprint
    or package_row.declared_currency <> projection_binding.declared_currency then
    return jsonb_build_object('outcome', 'not_ready');
  end if;
  select * into object_row from storage.objects where bucket_id = package_row.storage_bucket_id and name = package_row.storage_path;
  if not found or object_row.id <> package_row.storage_object_id or object_row.version <> package_row.storage_object_version then
    update public.integration_report_packages set status = 'projection_failed', safe_failure_code = 'OBJECT_IDENTITY_CHANGED', safe_failure_at = now(), correlation_id = p_correlation_id where organization_id = p_organization_id and id = p_report_package_id;
    return jsonb_build_object('outcome', 'object_mismatch');
  end if;
  input_digest := private.report_projection_input_digest(package_row, validation_row, projection_version, projection_binding);
  insert into public.integration_report_projection_runs (
    id, organization_id, report_package_id, report_contract_version_id, report_contract_binding_id,
    report_projection_version_id, report_projection_binding_id, validation_run_id, calculation_version,
    input_digest, status, correlation_id
  ) values (
    p_projection_run_id, p_organization_id, p_report_package_id, p_report_contract_version_id, validation_row.report_contract_binding_id,
    p_report_projection_version_id, projection_binding.id, validation_row.id, projection_version.calculation_version,
    input_digest, 'running', p_correlation_id
  );
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
