-- A package validation admitted under a standing admission can be projected.
--
-- ADR 0046 says the validation claim "and the projection claim accept either
-- a contract version proposed against the exact package, as today, or a
-- matching active admission". Validation got its second path in
-- 20260902176000; projection never did. The result in production: a Talabat
-- May export with identical columns to the approved March file sailed
-- through profiling and validation, then the projection claim refused it
-- with `not_ready` -- because the schema fingerprint hashes the worksheet
-- tab name, and Talabat names the tab after the month. The package sat in
-- `awaiting_projection` with no failure code, no analysis, and no
-- recommendations, and "Retry projection" re-entered the same refusal.
--
-- Forward-replaces public.claim_governed_report_package_projection,
-- carrying the live body verbatim apart from: declaring admission_row;
-- reading the admission the package records (null on the ordinary path);
-- scoping the schema_fingerprint comparison to the per-package path only;
-- and asserting structure_fingerprint and declared_currency against the
-- admission in its place, exactly as the validation claim already does.
-- The `not found` test on the binding select becomes an explicit
-- `projection_binding.id is null` test -- equivalent (id is the primary
-- key), required because the admission lookup is the last SELECT INTO now.
-- Every other check -- binding, validation run, currency, channel, object
-- identity, expiry, the operation ledger, the worker-only guard -- is
-- untouched and runs on both paths.
CREATE OR REPLACE FUNCTION public.claim_governed_report_package_projection(p_organization_id uuid, p_report_package_id uuid, p_report_contract_version_id uuid, p_report_projection_version_id uuid, p_projection_run_id uuid, p_idempotency_key text, p_claim_token uuid, p_correlation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  package_row public.integration_report_packages;
  validation_row public.integration_report_validation_runs;
  projection_version public.report_projection_versions;
  projection_binding public.report_projection_bindings;
  admission_row public.report_structure_admissions;
  operation private.integration_report_projection_operations;
  existing_run public.integration_report_projection_runs;
  object_row storage.objects;
  input_digest text;
begin
  if (select auth.uid()) is not null then
    raise exception 'report projection claim is worker-only' using errcode = '42501';
  end if;
  if char_length(p_idempotency_key) not between 16 and 200 then raise exception 'idempotency key is invalid' using errcode = '22023'; end if;
  select * into package_row from public.integration_report_packages
  where organization_id = p_organization_id and id = p_report_package_id for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  select * into operation from private.integration_report_projection_operations
  where organization_id = p_organization_id and report_package_id = p_report_package_id for update;
  if found then
    select * into existing_run from public.integration_report_projection_runs
    where organization_id = p_organization_id and id = operation.projection_run_id;
    if existing_run.status in ('projected', 'partially_projected') then
      if existing_run.report_contract_version_id <> p_report_contract_version_id or existing_run.report_projection_version_id <> p_report_projection_version_id then return jsonb_build_object('outcome', 'conflict'); end if;
      if operation.idempotency_key <> p_idempotency_key or operation.projection_run_id <> p_projection_run_id then return jsonb_build_object('outcome', 'conflict'); end if;
      return jsonb_build_object('outcome', 'completed', 'projectionRunId', existing_run.id);
    end if;
    if existing_run.status = 'running' then
      if existing_run.report_contract_version_id <> p_report_contract_version_id or existing_run.report_projection_version_id <> p_report_projection_version_id then return jsonb_build_object('outcome', 'conflict'); end if;
      if operation.idempotency_key <> p_idempotency_key or operation.projection_run_id <> p_projection_run_id then return jsonb_build_object('outcome', 'conflict'); end if;
      if operation.claim_token <> p_claim_token and operation.lease_expires_at > now() then return jsonb_build_object('outcome', 'in_progress', 'projectionRunId', existing_run.id); end if;
      update private.integration_report_projection_operations set claim_token = p_claim_token,
        lease_expires_at = now() + interval '20 minutes', attempt_count = attempt_count + 1, updated_at = now()
      where organization_id = p_organization_id and report_package_id = p_report_package_id;
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
  -- The authorisation that admitted this package, when validation admitted it
  -- under a standing admission rather than a per-package mapping. Null for
  -- every package that took the ordinary human-approval path. Read without a
  -- lock: only immutable identity columns are compared below, and the
  -- permission itself was live-checked (admission active) when validation
  -- claimed. A revocation therefore returns the structure to per-upload
  -- approval for future uploads without stranding a package that already
  -- validated -- there is no second approval a validated package could take.
  select * into admission_row from public.report_structure_admissions
  where organization_id = p_organization_id and id = package_row.admitted_under_admission_id;
  if projection_binding.id is null or validation_row.id is null
    or projection_binding.report_contract_binding_id <> validation_row.report_contract_binding_id
    or (admission_row.id is null and package_row.schema_fingerprint <> projection_binding.schema_fingerprint)
    or (admission_row.id is not null and package_row.structure_fingerprint is distinct from admission_row.structure_fingerprint)
    or (admission_row.id is not null and package_row.declared_currency is distinct from admission_row.declared_currency)
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
$function$

-- Grants are unchanged by CREATE OR REPLACE and are not restated.
