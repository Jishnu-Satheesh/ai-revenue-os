-- A group resolver is replay-safe only when it replays the same decision.
--
-- Once every row in a group has an immutable resolution, the prior version
-- returned `completed` before comparing the submitted choice. That made an
-- opposite late click look successful even though it could not change the
-- ledger. Preserve a same-choice replay, but report the contrary choice as a
-- conflict so the caller can refresh the now-resolved action.

do $repair$
declare
  resolver_definition text;
  completed_pattern text := E'if existing_resolution_count = group_row_count then\\n[[:space:]]+return pg_catalog\\.jsonb_build_object\\(''outcome'', ''completed'', ''resolvedCount'', 0\\);\\n[[:space:]]+end if;';
  replacement text := $replacement$
if existing_resolution_count = group_row_count then
    if exists (
      select 1
      from public.report_projection_reconciliation_resolutions resolution
      join public.report_projection_reconciliations reconciliation
        on reconciliation.organization_id = resolution.organization_id
        and reconciliation.id = resolution.reconciliation_id
      where reconciliation.organization_id = p_organization_id
        and reconciliation.report_package_id = requested_reconciliation.report_package_id
        and reconciliation.projection_run_id = requested_reconciliation.projection_run_id
        and reconciliation.projection_output_key = requested_reconciliation.projection_output_key
        and reconciliation.projection_target = requested_reconciliation.projection_target
        and reconciliation.classification = 'ambiguous_overlap'
        and resolution.resolution <> p_resolution
    ) then
      return pg_catalog.jsonb_build_object('outcome', 'conflict', 'resolvedCount', 0);
    end if;
    return pg_catalog.jsonb_build_object('outcome', 'completed', 'resolvedCount', 0);
  end if;$replacement$;
  completed_pattern_count integer;
begin
  select pg_catalog.pg_get_functiondef(
    'public.resolve_governed_report_projection_overlap_group(uuid,uuid,uuid,text,text,uuid)'::regprocedure
  ) into resolver_definition;

  select count(*)::integer into completed_pattern_count
  from pg_catalog.regexp_matches(resolver_definition, completed_pattern, 'g');

  if completed_pattern_count <> 1 then
    raise exception 'group reconciliation resolver is not the expected version'
      using errcode = '55000';
  end if;

  resolver_definition := pg_catalog.regexp_replace(
    resolver_definition,
    completed_pattern,
    replacement
  );

  if resolver_definition ~ completed_pattern then
    raise exception 'group reconciliation replay repair was incomplete'
      using errcode = '55000';
  end if;

  execute resolver_definition;
end;
$repair$;
