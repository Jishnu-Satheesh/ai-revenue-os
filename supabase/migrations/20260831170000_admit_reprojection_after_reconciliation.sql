-- Give a package stuck in `reconciliation_required` a way forward.
--
-- The same file uploaded three times makes two later uploads name the same
-- earlier rows as their prior. Resolving either branch supersedes that shared
-- prior, and the other branch's reconciliations then point at a row that is no
-- longer current -- which both resolvers refuse, correctly. Order does not
-- help: whichever branch is resolved second is stranded. On this project that
-- left 165 rows unresolvable and package 1b36f856 stuck, because the only exits
-- from `reconciliation_required` were those two resolvers.
--
-- The way out is to read the file again. A re-read supersedes the earlier
-- reading of the same file, and its overlaps are computed against evidence that
-- is current now rather than evidence that was current when the first reading
-- landed.
--
-- Re-reading necessarily reconciles the package against its own earlier rows.
-- That is not a flaw to design around: `normalized_metrics_current_revision_idx`
-- admits exactly one current row per metric and period, so a second reading
-- cannot land as current without a decision superseding the first. The overlap
-- is the decision being asked for.
--
-- The stale questions have to go, or the operator is left with cards that fail
-- every time they are clicked. They are withdrawn rather than resolved: a
-- resolution in this schema carries exactly one prior and one result and means
-- "a person chose between these two figures". Nobody chose here. The question
-- was retracted because the reading it asked about is being replaced, and the
-- record says so.

alter table public.report_projection_reconciliations
  add column withdrawn_at timestamptz,
  add column withdrawn_reason text;

alter table public.report_projection_reconciliations
  add constraint report_projection_reconciliations_withdrawn_check
  check (
    (withdrawn_at is null and withdrawn_reason is null)
    or (withdrawn_at is not null and withdrawn_reason = 'package_reprojection_requested')
  );

comment on column public.report_projection_reconciliations.withdrawn_at is
  'When this question stopped being live, because the reading it asks about is being replaced by a re-projection of the same package. Not a decision: no figure was chosen.';

-- The listing and both resolvers all ask for open questions; give them an index
-- that matches, now that "open" means unwithdrawn as well as unresolved.
create index report_projection_reconciliations_open_idx
  on public.report_projection_reconciliations (organization_id, report_package_id)
  where classification = 'ambiguous_overlap' and withdrawn_at is null;

-- 1. Admit `reconciliation_required`, and retract that package's open questions
--    in the same statement that moves it back to `awaiting_projection`.
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
  -- other side: the reading landed, its overlaps cannot be resolved because the
  -- rows they name have moved, and no other transition leaves that status.
  if package_row.status not in (
      'validated', 'partially_validated', 'projection_failed', 'awaiting_projection',
      'reconciliation_required'
    )
    or package_row.retained_until <= now() then
    raise exception 'report package is not eligible for projection' using errcode = '23514';
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

-- 2. A withdrawn question is not offered, and not answerable. Both are repaired
--    from the live definitions rather than restated, and each refuses to run if
--    its anchor is not found exactly once.
do $repair$
declare
  definition text;
  hits integer;
  listing_anchor constant text :=
    E'      and reconciliation\\.classification = ''ambiguous_overlap''\\n      and not exists \\(';
begin
  select pg_catalog.pg_get_functiondef(
    'public.list_governed_report_projection_reconciliation_groups(uuid)'::regprocedure
  ) into definition;

  select count(*)::integer into hits
  from pg_catalog.regexp_matches(definition, listing_anchor, 'g');
  if hits <> 1 then
    raise exception 'group listing is not the expected version (anchors found: %)', hits
      using errcode = '55000';
  end if;

  definition := pg_catalog.regexp_replace(
    definition,
    listing_anchor,
    E'      and reconciliation.classification = ''ambiguous_overlap''\n      and reconciliation.withdrawn_at is null\n      and not exists ('
  );
  execute definition;
end;
$repair$;

do $repair$
declare
  definition text;
  hits integer;
  target text;
  guard constant text :=
    E'\\1  if requested_reconciliation.withdrawn_at is not null then\n    return pg_catalog.jsonb_build_object(''outcome'', ''conflict'', ''resolvedCount'', 0);\n  end if;\n';
  anchor constant text :=
    E'(if requested_reconciliation\\.classification <> ''ambiguous_overlap'' then\\n)';
begin
  foreach target in array array[
    'public.resolve_governed_report_projection_overlap(uuid,uuid,uuid,text,text,uuid)',
    'public.resolve_governed_report_projection_overlap_group(uuid,uuid,uuid,text,text,uuid)'
  ] loop
    select pg_catalog.pg_get_functiondef(target::regprocedure) into definition;

    select count(*)::integer into hits
    from pg_catalog.regexp_matches(definition, anchor, 'g');
    if hits <> 1 then
      raise exception '% is not the expected version (anchors found: %)', target, hits
        using errcode = '55000';
    end if;

    execute pg_catalog.regexp_replace(definition, anchor, guard);
  end loop;
end;
$repair$;
