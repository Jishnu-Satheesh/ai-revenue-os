-- Two new ways an exact-range projection can fail, both of which an operator
-- can act on and neither of which should be flattened into the generic
-- processing failure.
--
--   CONTROL_TOTAL_MISMATCH            the rows did not add up to the total the
--                                     provider states on its own statement
--   PROJECTION_OUTPUT_KIND_UNSUPPORTED  the declaration projects into a target
--                                     this worker cannot write to yet
--
-- Additive and forward-only: the accepted set only grows, so no stored value
-- becomes invalid and nothing already recorded changes meaning. See ADR 0029.

alter table public.integration_report_packages
  drop constraint if exists integration_report_packages_safe_failure_code_check,
  add constraint integration_report_packages_safe_failure_code_check check (safe_failure_code is null or safe_failure_code in (
    'UPLOAD_EXPIRED', 'OBJECT_UNAVAILABLE', 'OBJECT_IDENTITY_CHANGED', 'INVALID_FILE_TYPE', 'FILE_TOO_LARGE',
    'TOO_MANY_SHEETS', 'TOO_MANY_ROWS', 'TOO_MANY_POPULATED_CELLS', 'EXPANDED_CONTENT_TOO_LARGE',
    'UNSAFE_WORKBOOK', 'UNREADABLE_WORKBOOK', 'PROFILE_FAILED', 'PACKAGE_EXPIRED',
    'CONTRACT_VERSION_NOT_APPROVED', 'CONTRACT_BINDING_INACTIVE', 'CONTRACT_CONTEXT_MISMATCH',
    'REQUIRED_SHEET_MISSING', 'REQUIRED_SOURCE_HEADER_MISSING', 'REQUIRED_FIELD_MISSING',
    'INVALID_INTEGER', 'INVALID_DECIMAL', 'INVALID_MONEY', 'INVALID_LOCAL_DATE', 'INVALID_TIMESTAMP',
    'INVALID_DURATION', 'INVALID_PERCENTAGE', 'INVALID_TEXT', 'INVALID_ENUM', 'FORMULA_REJECTED',
    'FORMULA_VALUE_UNSUPPORTED', 'MERGED_CELLS_REJECTED', 'CONTROL_MISMATCH',
    'UNDECLARED_SHEET_PRESENT', 'VALIDATION_PROCESSING_FAILED',
    'PROJECTION_VERSION_NOT_APPROVED', 'PROJECTION_BINDING_INACTIVE', 'PROJECTION_CONTEXT_MISMATCH',
    'PROJECTION_FIELD_VALUE_KIND_MISMATCH', 'REQUIRED_PROJECTED_VALUE_MISSING',
    'CONTROL_TOTAL_MISMATCH', 'PROJECTION_OUTPUT_KIND_UNSUPPORTED',
    'PROJECTION_PROCESSING_FAILED'
  ));

-- Replaced whole rather than patched, because plpgsql has no way to amend a
-- literal list in place. Only the accepted-code list differs from the version
-- installed by 20260821080933.
create or replace function public.fail_governed_report_package_projection(
  p_organization_id uuid,
  p_report_package_id uuid,
  p_projection_run_id uuid,
  p_claim_token uuid,
  p_failure_code text,
  p_result_digest text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  operation private.integration_report_projection_operations;
  run_row public.integration_report_projection_runs;
  package_row public.integration_report_packages;
begin
  if p_failure_code not in ('OBJECT_IDENTITY_CHANGED', 'OBJECT_UNAVAILABLE', 'PACKAGE_EXPIRED',
    'PROJECTION_VERSION_NOT_APPROVED', 'PROJECTION_BINDING_INACTIVE', 'PROJECTION_CONTEXT_MISMATCH',
    'UNREADABLE_WORKBOOK', 'CONTROL_TOTAL_MISMATCH', 'PROJECTION_OUTPUT_KIND_UNSUPPORTED',
    'PROJECTION_PROCESSING_FAILED') or p_result_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'report projection failure is invalid' using errcode = '22023';
  end if;
  select * into operation from private.integration_report_projection_operations
  where organization_id = p_organization_id and report_package_id = p_report_package_id for update;
  if not found or operation.projection_run_id <> p_projection_run_id or operation.claim_token <> p_claim_token or operation.lease_expires_at <= now() then return null; end if;
  select * into run_row from public.integration_report_projection_runs
  where organization_id = p_organization_id and id = p_projection_run_id and status = 'running' for update;
  if not found then return null; end if;
  update public.integration_report_projection_runs set status = 'failed', quality_state = 'failed', completeness_state = 'unavailable',
    result_digest = p_result_digest, error_codes = jsonb_build_array(p_failure_code), warning_codes = '[]'::jsonb, completed_at = now()
  where organization_id = p_organization_id and id = p_projection_run_id;
  update public.integration_report_packages set status = 'projection_failed', safe_failure_code = p_failure_code, safe_failure_at = now()
  where organization_id = p_organization_id and id = p_report_package_id returning * into package_row;
  return to_jsonb(package_row);
end;
$$;

-- `create or replace` keeps the existing ACL, but the grants are restated so
-- the function's reachable callers are readable in one place rather than only
-- in the migration that first created it.
revoke all on function public.fail_governed_report_package_projection(uuid, uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.fail_governed_report_package_projection(uuid, uuid, uuid, uuid, text, text) to service_role;
