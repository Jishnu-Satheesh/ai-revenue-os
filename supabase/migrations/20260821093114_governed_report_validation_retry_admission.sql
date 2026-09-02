-- A dispatch outage can leave a package awaiting_validation without a run.
-- Allow an authorized operator to safely re-claim that state and re-dispatch
-- the deterministic worker. The private retry ledger still owns idempotency.
create or replace function public.retry_governed_report_package_validation(
  p_organization_id uuid,
  p_actor_id uuid,
  p_report_package_id uuid,
  p_idempotency_key text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  package_row public.integration_report_packages;
  existing private.integration_report_write_operations;
  fingerprint text;
begin
  if (select auth.uid()) <> p_actor_id
    or not private.has_organization_permission(p_organization_id, 'report.retry') then
    raise exception 'report validation retry is not authorized' using errcode = '42501';
  end if;
  if char_length(p_idempotency_key) not between 16 and 200 then
    raise exception 'idempotency key is invalid' using errcode = '22023';
  end if;
  select * into package_row from public.integration_report_packages
  where organization_id = p_organization_id and id = p_report_package_id for update;
  if not found then raise exception 'report package was not found' using errcode = 'P0002'; end if;
  fingerprint := encode(extensions.digest(concat_ws('|', p_report_package_id, package_row.content_sha256, package_row.schema_fingerprint), 'sha256'), 'hex');
  select * into existing from private.integration_report_write_operations
  where organization_id = p_organization_id and operation_kind = 'retry' and idempotency_key = p_idempotency_key for update;
  if found then
    if existing.fingerprint <> fingerprint or existing.report_package_id <> p_report_package_id then
      raise exception 'idempotency key conflicts with another retry' using errcode = '23505';
    end if;
    return to_jsonb(package_row);
  end if;
  if package_row.status not in ('validation_failed', 'awaiting_validation') or package_row.retained_until <= now() then
    raise exception 'report package is not eligible for validation retry' using errcode = '23514';
  end if;
  update public.integration_report_packages set status = 'awaiting_validation', safe_failure_code = null,
    safe_failure_at = null, correlation_id = p_correlation_id
  where organization_id = p_organization_id and id = p_report_package_id returning * into package_row;
  insert into private.integration_report_write_operations (
    organization_id, operation_kind, idempotency_key, fingerprint, report_package_id
  ) values (p_organization_id, 'retry', p_idempotency_key, fingerprint, p_report_package_id);
  return to_jsonb(package_row);
end;
$$;
