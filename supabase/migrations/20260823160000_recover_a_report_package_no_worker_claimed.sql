-- Let an operator ask again for work that was queued and never ran.
--
-- Seven report packages have been uploaded to this project and not one has ever
-- reached `projected`. The reason is not a bug in any worker: the pilot client's
-- real Talabat export sat at `uploaded` for a day, and when its profiling task
-- was finally dispatched by hand it completed in under four seconds and moved
-- straight to `awaiting_contract`.
--
-- What actually happened is that the dispatch never ran. A package therefore
-- stops in a *waiting* state rather than a failed one -- nothing claimed it, so
-- nothing marked it failed -- and both recovery paths refuse a waiting package:
--
--   retry_governed_report_package_profiling   requires status = 'failed'
--   request_governed_report_package_projection  admits neither 'awaiting_projection'
--
-- So the parcel is accepted at the depot, the courier never comes, and the
-- tracking page offers no "try again" because it only offers one to parcels it
-- already knows went wrong.
--
-- This is the same defect that was already repaired for validation in
-- `20260821093114_governed_report_validation_retry_admission.sql`, which widened
-- its retry to admit `awaiting_validation`. The other two boundaries never got
-- the same treatment. This migration gives them it.
--
-- Nothing about authorization, idempotency, retention, or the claim path
-- changes. A waiting package becomes eligible to be asked for again; every
-- worker still re-checks every approval boundary when it claims.

create or replace function public.retry_governed_report_package_profiling(
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
  locked_package public.integration_report_packages;
  existing private.integration_report_write_operations;
  fingerprint text;
begin
  if (select auth.uid()) <> p_actor_id
    or not private.has_organization_permission(p_organization_id, 'report.retry') then
    raise exception 'report retry is not authorized' using errcode = '42501';
  end if;
  select * into locked_package from public.integration_report_packages
  where organization_id = p_organization_id and id = p_report_package_id
  for update;
  if not found then raise exception 'report package was not found' using errcode = 'P0002'; end if;
  fingerprint := pg_catalog.encode(extensions.digest(pg_catalog.concat_ws('|', p_report_package_id, locked_package.content_sha256), 'sha256'), 'hex');
  select * into existing from private.integration_report_write_operations
  where organization_id = p_organization_id and operation_kind = 'retry' and idempotency_key = p_idempotency_key
  for update;
  if found then
    if existing.fingerprint <> fingerprint or existing.report_package_id <> p_report_package_id then raise exception 'idempotency key conflicts with another retry' using errcode = '23505'; end if;
    return pg_catalog.to_jsonb(locked_package);
  end if;

  -- The change. `failed` is a package a worker claimed and could not read.
  -- `uploaded` is one nothing ever came for, and `profiling` is one whose worker
  -- took it and disappeared -- both of which an operator can only escape by
  -- asking again. The claim RPC already admits `uploaded` and `profiling`, so
  -- this widening lets the operator reach a path the database was always ready
  -- to serve.
  if locked_package.status not in ('failed', 'uploaded', 'profiling')
    or locked_package.storage_object_id is null then
    raise exception 'report package is not eligible for retry' using errcode = '23514';
  end if;
  update public.integration_report_packages set
    status = 'uploaded', safe_failure_code = null, safe_failure_at = null, correlation_id = p_correlation_id
  where id = locked_package.id returning * into locked_package;
  insert into private.integration_report_write_operations (
    organization_id, operation_kind, idempotency_key, fingerprint, report_package_id
  ) values (p_organization_id, 'retry', p_idempotency_key, fingerprint, locked_package.id);
  return pg_catalog.to_jsonb(locked_package);
end;
$$;

-- Replaced whole rather than patched, because plpgsql has no way to amend a
-- statement in place. Only the eligibility line differs from the version that
-- was running before this migration.
create or replace function public.request_governed_report_package_projection(
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
  validation_row public.integration_report_validation_runs;
  projection_binding public.report_projection_bindings;
  existing private.report_projection_write_operations;
  fingerprint text;
begin
  if (select auth.uid()) <> p_actor_id
    or not private.has_organization_permission(p_organization_id, 'report.retry') then
    raise exception 'report projection request is not authorized' using errcode = '42501';
  end if;
  if char_length(p_idempotency_key) not between 16 and 200 then raise exception 'idempotency key is invalid' using errcode = '22023'; end if;
  select * into package_row from public.integration_report_packages
  where organization_id = p_organization_id and id = p_report_package_id for update;
  if not found then raise exception 'report package was not found' using errcode = 'P0002'; end if;
  select * into validation_row from public.integration_report_validation_runs
  where organization_id = p_organization_id and report_package_id = p_report_package_id
    and status in ('validated', 'partially_validated')
  order by completed_at desc limit 1;
  select * into projection_binding from public.report_projection_bindings
  where organization_id = p_organization_id and report_contract_version_id = validation_row.report_contract_version_id and active;
  if not found then raise exception 'report projection binding is not active' using errcode = '23514'; end if;
  fingerprint := encode(extensions.digest(concat_ws('|', p_report_package_id, validation_row.id, validation_row.result_digest, projection_binding.id), 'sha256'), 'hex');
  select * into existing from private.report_projection_write_operations
  where organization_id = p_organization_id and operation_kind = 'request' and idempotency_key = p_idempotency_key for update;
  if found then
    if existing.fingerprint <> fingerprint or existing.reference_id <> p_report_package_id then raise exception 'idempotency key conflicts with another projection request' using errcode = '23505'; end if;
    return jsonb_build_object('reportPackage', to_jsonb(package_row), 'reportProjectionVersionId', projection_binding.report_projection_version_id);
  end if;

  -- The change. `awaiting_projection` is a package that was already asked for
  -- and whose dispatch never ran; refusing it left the only recorded example on
  -- this project stranded for two days with no way forward. The projection
  -- claim RPC already admits `awaiting_projection` and `projecting`.
  if package_row.status not in ('validated', 'partially_validated', 'projection_failed', 'awaiting_projection')
    or package_row.retained_until <= now() then
    raise exception 'report package is not eligible for projection' using errcode = '23514';
  end if;
  update public.integration_report_packages set status = 'awaiting_projection', safe_failure_code = null,
    safe_failure_at = null, correlation_id = p_correlation_id
  where organization_id = p_organization_id and id = p_report_package_id returning * into package_row;
  insert into private.report_projection_write_operations (
    organization_id, operation_kind, idempotency_key, fingerprint, reference_id
  ) values (p_organization_id, 'request', p_idempotency_key, fingerprint, p_report_package_id);
  return jsonb_build_object('reportPackage', to_jsonb(package_row), 'reportProjectionVersionId', projection_binding.report_projection_version_id);
end;
$$;

revoke all on function public.retry_governed_report_package_profiling(uuid, uuid, uuid, text, uuid) from public, anon;
revoke all on function public.request_governed_report_package_projection(uuid, uuid, uuid, text, uuid) from public, anon;
grant execute on function public.retry_governed_report_package_profiling(uuid, uuid, uuid, text, uuid) to authenticated;
grant execute on function public.request_governed_report_package_projection(uuid, uuid, uuid, text, uuid) to authenticated;
