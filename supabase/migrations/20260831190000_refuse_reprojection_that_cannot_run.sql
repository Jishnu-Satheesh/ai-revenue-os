-- Do not send a package somewhere it cannot arrive.
--
-- 20260831170000 let a package stuck in `reconciliation_required` be asked for
-- again, and 20260831180000 let it move. Both were necessary and neither was
-- sufficient: `claim_governed_report_package_projection` returns `completed`
-- when a finished run already exists for the same package, contract version and
-- projection version. A package + contract + projection version projects exactly
-- once, which is what makes a retried dispatch safe.
--
-- So the request succeeded, the package moved to `awaiting_projection`, and no
-- worker would ever claim it. That is a worse state than the one it left:
-- `reconciliation_required` at least says truthfully that a person is needed.
--
-- Re-projection from `reconciliation_required` is still worth having -- it is
-- exactly what an operator wants after approving a revised mapping, and there
-- the projection version differs so the claim proceeds. This admits that case
-- and refuses the one that would stall, rather than removing the door.
--
-- The stale questions are still retracted on a re-request. That part solved a
-- real defect: a three-way overlap left 165 reconciliations naming rows that had
-- since moved, unresolvable by either resolver, shown to the operator as cards
-- that failed every click.
--
-- What is deliberately NOT changed: the once-per-version rule itself. Letting a
-- file be read again under the same mapping means deciding what makes a re-read
-- distinct from a replay -- plausibly a request recorded after the run it
-- replaces -- and that is the projection contract's backbone, not a detail to
-- adjust at the end of an afternoon.

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
as $function$
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

  -- `awaiting_projection` is a package that was already asked for and whose
  -- dispatch never ran; refusing it left the only recorded example on this
  -- project stranded for two days with no way forward. The projection claim RPC
  -- already admits `awaiting_projection` and `projecting`.
  --
  -- `reconciliation_required` is the same shape of dead end reached from the
  -- other side, and it is admitted only where a re-read can actually happen.
  if package_row.status not in (
      'validated', 'partially_validated', 'projection_failed', 'awaiting_projection',
      'reconciliation_required'
    )
    or package_row.retained_until <= now() then
    raise exception 'report package is not eligible for projection' using errcode = '23514';
  end if;

  -- The claim treats a finished run for this package, contract version and
  -- projection version as already done, and returns `completed` without work.
  -- Moving the package to `awaiting_projection` in that case parks it somewhere
  -- nothing will ever collect it, so refuse here instead. Approving a revised
  -- mapping changes the projection version and this check passes.
  if package_row.status = 'reconciliation_required'
    and exists (
      select 1 from public.integration_report_projection_runs run
      where run.organization_id = p_organization_id
        and run.report_package_id = p_report_package_id
        and run.report_contract_version_id = validation_row.report_contract_version_id
        and run.report_projection_version_id = projection_binding.report_projection_version_id
        and run.completed_at is not null
    ) then
    raise exception 'report package was already projected under this mapping' using errcode = '23514';
  end if;

  -- Retract the open questions about the reading being replaced. Resolved ones
  -- are left exactly as they are: they record a decision a person made, and
  -- re-reading the file does not unmake it.
  update public.report_projection_reconciliations reconciliation
  set withdrawn_at = now(), withdrawn_reason = 'package_reprojection_requested'
  where reconciliation.organization_id = p_organization_id
    and reconciliation.report_package_id = p_report_package_id
    and reconciliation.classification = 'ambiguous_overlap'
    and reconciliation.withdrawn_at is null
    and not exists (
      select 1 from public.report_projection_reconciliation_resolutions resolution
      where resolution.organization_id = reconciliation.organization_id
        and resolution.reconciliation_id = reconciliation.id
    );

  update public.integration_report_packages set status = 'awaiting_projection', safe_failure_code = null,
    safe_failure_at = null, correlation_id = p_correlation_id
  where organization_id = p_organization_id and id = p_report_package_id returning * into package_row;
  insert into private.report_projection_write_operations (
    organization_id, operation_kind, idempotency_key, fingerprint, reference_id
  ) values (p_organization_id, 'request', p_idempotency_key, fingerprint, p_report_package_id);
  return jsonb_build_object('reportPackage', to_jsonb(package_row), 'reportProjectionVersionId', projection_binding.report_projection_version_id);
end;
$function$;
