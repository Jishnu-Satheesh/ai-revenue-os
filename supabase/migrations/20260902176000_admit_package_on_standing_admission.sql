-- A package with no per-package contract version can still be validated
-- when its channel, structure and currency match an active standing
-- admission a person already granted. See ADR 0046.
--
-- Forward-replaces public.claim_governed_report_package_validation, carrying
-- the live body (20260821065806_governed_report_package_validation.sql,
-- unchanged since) verbatim apart from: declaring admission_row; the
-- fallback version resolution when no per-package version is found; scoping
-- the two schema_fingerprint comparisons to the per-package path only (they
-- legitimately differ under an admission -- a provider renaming a worksheet
-- is the entire reason this path exists); asserting structure_fingerprint
-- and declared_currency against the admission in their place; and recording
-- admitted_under_admission_id on the package once claimed through it. Every
-- other check -- the binding lookup, channel, report type, outlet grain,
-- object identity, content digest, expiry, the operation/idempotency ledger
-- and the status precondition -- is untouched and runs on both paths.
create or replace function public.claim_governed_report_package_validation(p_organization_id uuid, p_report_package_id uuid, p_report_contract_version_id uuid, p_validation_run_id uuid, p_idempotency_key text, p_claim_token uuid, p_correlation_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  package_row public.integration_report_packages;
  version_row public.report_contract_versions;
  binding_row public.report_contract_bindings;
  admission_row public.report_structure_admissions;
  operation private.integration_report_validation_operations;
  existing_run public.integration_report_validation_runs;
  object_row storage.objects;
  input_digest text;
begin
  if char_length(p_idempotency_key) not between 16 and 200 then
    raise exception 'idempotency key is invalid' using errcode = '22023';
  end if;
  select * into package_row from public.integration_report_packages
  where organization_id = p_organization_id and id = p_report_package_id for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  select * into operation from private.integration_report_validation_operations
  where organization_id = p_organization_id and report_package_id = p_report_package_id for update;
  if found then
    if operation.idempotency_key <> p_idempotency_key or operation.validation_run_id <> p_validation_run_id then
      return jsonb_build_object('outcome', 'conflict');
    end if;
    select * into existing_run from public.integration_report_validation_runs
    where organization_id = p_organization_id and id = operation.validation_run_id;
    if existing_run.report_contract_version_id <> p_report_contract_version_id then
      return jsonb_build_object('outcome', 'conflict');
    end if;
    if existing_run.status <> 'running' then return jsonb_build_object('outcome', 'completed', 'validationRunId', existing_run.id); end if;
    if operation.claim_token <> p_claim_token and operation.lease_expires_at > now() then
      return jsonb_build_object('outcome', 'in_progress', 'validationRunId', existing_run.id);
    end if;
    update private.integration_report_validation_operations set claim_token = p_claim_token,
      lease_expires_at = now() + interval '20 minutes', attempt_count = attempt_count + 1, updated_at = now()
    where organization_id = p_organization_id and report_package_id = p_report_package_id;
    select * into version_row from public.report_contract_versions
    where organization_id = p_organization_id and id = existing_run.report_contract_version_id;
    return jsonb_build_object('outcome', 'acquired', 'reportPackage', to_jsonb(package_row),
      'contractVersion', to_jsonb(version_row),
      'sheetManifests', coalesce((select jsonb_agg(to_jsonb(m) order by m.sheet_position) from public.integration_report_sheet_manifests m where m.organization_id = p_organization_id and m.report_package_id = p_report_package_id), '[]'::jsonb));
  end if;
  if package_row.status not in ('awaiting_validation', 'validating') then
    return jsonb_build_object('outcome', 'not_ready');
  end if;
  if package_row.retained_until <= now() then
    update public.integration_report_packages set status = 'validation_failed', safe_failure_code = 'PACKAGE_EXPIRED', safe_failure_at = now(), correlation_id = p_correlation_id
    where organization_id = p_organization_id and id = p_report_package_id;
    return jsonb_build_object('outcome', 'expired');
  end if;
  select * into version_row from public.report_contract_versions
  where organization_id = p_organization_id and id = p_report_contract_version_id and report_package_id = p_report_package_id;
  if not found or not exists (select 1 from public.report_contract_decisions d where d.organization_id = p_organization_id and d.report_contract_version_id = p_report_contract_version_id and d.decision = 'approved') then
    -- Second admissible path. Either a mapping approved against this exact
    -- upload, as before, or a standing admission a person granted for this
    -- structure. See ADR 0046. Everything below this point is unchanged: the
    -- binding, currency, channel, report type and object identity checks all
    -- still run, so an admission shortens the ceremony and loosens no invariant.
    select * into admission_row from public.report_structure_admissions
    where organization_id = p_organization_id
      and channel_id = package_row.channel_id
      and structure_fingerprint = package_row.structure_fingerprint
      and declared_currency = package_row.declared_currency
      and outlet_grain = 'branch'
      and active;
    if not found or package_row.structure_fingerprint is null then
      return jsonb_build_object('outcome', 'not_ready');
    end if;
    select * into version_row from public.report_contract_versions
    where organization_id = p_organization_id and id = admission_row.report_contract_version_id;
    if not found then return jsonb_build_object('outcome', 'not_ready'); end if;
  end if;
  select * into binding_row from public.report_contract_bindings
  where organization_id = p_organization_id and report_contract_version_id = version_row.id and active for update;
  if not found
    or (admission_row.id is null and package_row.schema_fingerprint is distinct from version_row.schema_fingerprint)
    or (admission_row.id is null and package_row.schema_fingerprint is distinct from binding_row.schema_fingerprint)
    or (admission_row.id is not null and package_row.structure_fingerprint is distinct from admission_row.structure_fingerprint)
    or (admission_row.id is not null and package_row.declared_currency is distinct from admission_row.declared_currency)
    or package_row.declared_currency is distinct from version_row.declared_currency
    or package_row.declared_currency is distinct from binding_row.declared_currency
    or package_row.channel_id is distinct from binding_row.channel_id
    or package_row.report_type is distinct from binding_row.report_type
    or binding_row.outlet_grain <> 'branch'
    or package_row.content_sha256 is null
    or package_row.storage_object_id is null
    or package_row.storage_object_version is null then
    return jsonb_build_object('outcome', 'not_ready');
  end if;
  select * into object_row from storage.objects where bucket_id = package_row.storage_bucket_id and name = package_row.storage_path;
  if not found or object_row.id <> package_row.storage_object_id or object_row.version <> package_row.storage_object_version then
    update public.integration_report_packages set status = 'validation_failed', safe_failure_code = 'OBJECT_IDENTITY_CHANGED', safe_failure_at = now(), correlation_id = p_correlation_id
    where organization_id = p_organization_id and id = p_report_package_id;
    return jsonb_build_object('outcome', 'object_mismatch');
  end if;
  input_digest := private.report_validation_input_digest(package_row, version_row, binding_row);
  insert into public.integration_report_validation_runs (
    id, organization_id, report_package_id, report_contract_version_id, report_contract_binding_id,
    validator_version, input_digest, status, correlation_id
  ) values (
    p_validation_run_id, p_organization_id, p_report_package_id, version_row.id, binding_row.id,
    1, input_digest, 'running', p_correlation_id
  );
  insert into private.integration_report_validation_operations (
    organization_id, report_package_id, idempotency_key, input_digest, validation_run_id, claim_token, lease_expires_at, attempt_count
  ) values (
    p_organization_id, p_report_package_id, p_idempotency_key, input_digest, p_validation_run_id, p_claim_token, now() + interval '20 minutes', 1
  );
  -- admission_row.id is populated only on the admission path (uninitialized
  -- otherwise), and coalesced with the package's own prior value so a retry
  -- that happens to take the per-package path second never overwrites what a
  -- first successful admission-path claim already recorded -- the column is
  -- write-once (private.prevent_report_package_mutation), so writing NULL
  -- over an existing value would raise rather than silently no-op.
  update public.integration_report_packages set status = 'validating', safe_failure_code = null, safe_failure_at = null, correlation_id = p_correlation_id,
    admitted_under_admission_id = coalesce(admission_row.id, package_row.admitted_under_admission_id)
  where organization_id = p_organization_id and id = p_report_package_id;
  return jsonb_build_object('outcome', 'acquired', 'reportPackage', to_jsonb(package_row),
    'contractVersion', to_jsonb(version_row),
    'sheetManifests', coalesce((select jsonb_agg(to_jsonb(m) order by m.sheet_position) from public.integration_report_sheet_manifests m where m.organization_id = p_organization_id and m.report_package_id = p_report_package_id), '[]'::jsonb));
end;
$function$;

-- Forward-replaces private.prevent_report_package_mutation, carrying the
-- live body (20260902175000_report_structure_admissions.sql) verbatim apart
-- from adding the one transition an admitted package needs: it skips
-- awaiting_approval entirely, because a person approved this structure
-- already and there is nothing left for them to approve on this upload.
create or replace function private.prevent_report_package_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.organization_id is distinct from old.organization_id
    or new.channel_id is distinct from old.channel_id
    or new.branch_id is distinct from old.branch_id
    or new.report_type is distinct from old.report_type
    or new.declared_period_start is distinct from old.declared_period_start
    or new.declared_period_end is distinct from old.declared_period_end
    or new.declared_currency is distinct from old.declared_currency
    or new.period_timezone is distinct from old.period_timezone
    or new.file_kind is distinct from old.file_kind
    or new.original_filename is distinct from old.original_filename
    or new.declared_content_type is distinct from old.declared_content_type
    or new.declared_content_length is distinct from old.declared_content_length
    or new.storage_bucket_id is distinct from old.storage_bucket_id
    or new.storage_path is distinct from old.storage_path
    or new.parser_version is distinct from old.parser_version
    or new.fingerprint_version is distinct from old.fingerprint_version
    or new.structure_version is distinct from old.structure_version
    or new.created_by is distinct from old.created_by
    or new.retained_until is distinct from old.retained_until then
    raise exception 'report_package_context_is_immutable' using errcode = '23514';
  end if;
  if old.content_sha256 is not null and new.content_sha256 is distinct from old.content_sha256 then
    raise exception 'report_package_digest_is_immutable' using errcode = '23514';
  end if;
  if old.schema_fingerprint is not null and new.schema_fingerprint is distinct from old.schema_fingerprint then
    raise exception 'report_package_schema_fingerprint_is_immutable' using errcode = '23514';
  end if;
  if old.structure_fingerprint is not null
    and new.structure_fingerprint is distinct from old.structure_fingerprint then
    raise exception 'report_package_structure_fingerprint_is_immutable' using errcode = '23514';
  end if;
  if old.admitted_under_admission_id is not null
    and new.admitted_under_admission_id is distinct from old.admitted_under_admission_id then
    raise exception 'report_package_admission_is_immutable' using errcode = '23514';
  end if;
  if old.storage_object_id is not null and (
    new.storage_object_id is distinct from old.storage_object_id
    or new.storage_object_version is distinct from old.storage_object_version
  ) then
    raise exception 'report_package_object_identity_is_immutable' using errcode = '23514';
  end if;
  if not (
    (old.status = 'awaiting_upload' and new.status in ('awaiting_upload', 'uploaded', 'failed'))
    or (old.status = 'uploaded' and new.status in ('uploaded', 'profiling', 'failed'))
    or (old.status = 'profiling' and new.status in ('profiling', 'awaiting_contract', 'failed'))
    or (old.status = 'awaiting_contract' and new.status in ('awaiting_contract', 'awaiting_approval', 'awaiting_validation'))
    or (old.status = 'awaiting_approval' and new.status in ('awaiting_approval', 'awaiting_contract', 'awaiting_validation'))
    or (old.status = 'awaiting_validation' and new.status in ('awaiting_validation', 'validating', 'validation_failed'))
    or (old.status = 'validating' and new.status in ('validating', 'validated', 'partially_validated', 'validation_failed'))
    or (old.status in ('validated', 'partially_validated') and new.status in (old.status, 'awaiting_projection'))
    or (old.status = 'awaiting_projection' and new.status in ('awaiting_projection', 'projecting'))
    or (old.status = 'projecting' and new.status in ('projecting', 'projected', 'partially_projected', 'reconciliation_required', 'projection_failed'))
    or (old.status = 'reconciliation_required' and new.status in ('reconciliation_required', 'projected', 'partially_projected', 'awaiting_projection'))
    or (old.status = 'projection_failed' and new.status in ('projection_failed', 'awaiting_projection'))
    or (old.status = 'validation_failed' and new.status in ('validation_failed', 'awaiting_validation'))
    or (old.status = 'failed' and new.status in ('failed', 'uploaded'))
    or (old.status in ('projected', 'partially_projected') and new.status = old.status)
  ) then
    raise exception 'report_package_status_transition_is_invalid' using errcode = '23514';
  end if;
  return new;
end;
$function$;
