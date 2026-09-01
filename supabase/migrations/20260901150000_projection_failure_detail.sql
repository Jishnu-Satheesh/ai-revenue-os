-- Record why a projection failed, not only that it did.
--
-- A projection that fails for a reason the code did not anticipate records
-- `PROJECTION_PROCESSING_FAILED` and nothing else. The error's own name and
-- message go to `console.error` in the worker, where an operator cannot see
-- them and where a production run's logs are not reachable from a development
-- tool either. The failure is real, the cause is known at the moment it
-- happens, and the platform throws it away.
--
-- That cost hours on 2026-09-01: a Keeta order export failed to project twice,
-- deterministically, and every hop of the pipeline had to be re-run by hand
-- against staging to find out why -- while the worker had held the answer and
-- discarded it. An operator would have had strictly less to work with.
--
-- So the run keeps a short, bounded detail beside its code. Three hundred
-- characters, the same cap the log line already used, and the same rule the
-- comment beside it already stated: identifiers and the error's own name and
-- message, never workbook content.
--
-- The column is nullable and every existing row keeps a null: this records what
-- a failure knew about itself, and the failures already on record knew nothing.

alter table public.integration_report_projection_runs
  add column if not exists failure_detail text;

alter table public.integration_report_projection_runs
  drop constraint if exists integration_report_projection_runs_failure_detail_check;
alter table public.integration_report_projection_runs
  add constraint integration_report_projection_runs_failure_detail_check
  check (failure_detail is null or char_length(failure_detail) between 1 and 300);

-- Replaced rather than overloaded: two signatures differing only by a
-- defaulted argument make a six-argument call ambiguous, and the worker calls
-- this by name through PostgREST.
drop function if exists public.fail_governed_report_package_projection(uuid, uuid, uuid, uuid, text, text);

create function public.fail_governed_report_package_projection(
  p_organization_id uuid,
  p_report_package_id uuid,
  p_projection_run_id uuid,
  p_claim_token uuid,
  p_failure_code text,
  p_result_digest text,
  p_failure_detail text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  operation private.integration_report_projection_operations;
  run_row public.integration_report_projection_runs;
  package_row public.integration_report_packages;
  detail text;
begin
  if p_failure_code not in ('OBJECT_IDENTITY_CHANGED', 'OBJECT_UNAVAILABLE', 'PACKAGE_EXPIRED',
    'PROJECTION_VERSION_NOT_APPROVED', 'PROJECTION_BINDING_INACTIVE', 'PROJECTION_CONTEXT_MISMATCH',
    'UNREADABLE_WORKBOOK', 'CONTROL_TOTAL_MISMATCH', 'PROJECTION_OUTPUT_KIND_UNSUPPORTED',
    'TOTALS_ROW_NOT_RESOLVED', 'INVALID_LOCAL_DATE', 'PERIOD_OUT_OF_DECLARED_RANGE',
    'PROJECTION_PROCESSING_FAILED') or p_result_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'report projection failure is invalid' using errcode = '22023';
  end if;
  -- Truncated rather than refused. A failure that cannot be recorded because
  -- its own explanation is too long would lose the code as well as the reason.
  detail := nullif(btrim(left(coalesce(p_failure_detail, ''), 300)), '');
  select * into operation from private.integration_report_projection_operations
  where organization_id = p_organization_id and report_package_id = p_report_package_id for update;
  if not found or operation.projection_run_id <> p_projection_run_id or operation.claim_token <> p_claim_token or operation.lease_expires_at <= now() then return null; end if;
  select * into run_row from public.integration_report_projection_runs
  where organization_id = p_organization_id and id = p_projection_run_id and status = 'running' for update;
  if not found then return null; end if;
  update public.integration_report_projection_runs set status = 'failed', quality_state = 'failed', completeness_state = 'unavailable',
    result_digest = p_result_digest, error_codes = jsonb_build_array(p_failure_code), warning_codes = '[]'::jsonb,
    failure_detail = detail, completed_at = now()
  where organization_id = p_organization_id and id = p_projection_run_id;
  update public.integration_report_packages set status = 'projection_failed', safe_failure_code = p_failure_code, safe_failure_at = now()
  where organization_id = p_organization_id and id = p_report_package_id returning * into package_row;
  return to_jsonb(package_row);
end;
$$;

revoke all on function public.fail_governed_report_package_projection(uuid, uuid, uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.fail_governed_report_package_projection(uuid, uuid, uuid, uuid, text, text, text) to service_role;
