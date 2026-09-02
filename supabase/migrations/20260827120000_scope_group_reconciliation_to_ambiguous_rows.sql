-- Keep the grouped decision strictly inside the action the operator saw.
--
-- One projection output can contain both unresolved overlaps and harmless
-- non-overlapping rows. The first grouped resolver scoped its outer checks to
-- `ambiguous_overlap`, but twelve inner lock/update queries used only the
-- package/run/output identity. On a real mixed result that could try to update
-- a current non-overlap row. Repair those twelve scopes in the stored function
-- definition and refuse to run against any unexpected predecessor version.

do $repair$
declare
  resolver_definition text;
  missing_scope_pattern text :=
    E'(and reconciliation\\.projection_target = requested_reconciliation\\.projection_target\\n)(?![[:space:]]+and reconciliation\\.classification)([[:space:]]+)';
  missing_scope_count integer;
begin
  select pg_catalog.pg_get_functiondef(
    'public.resolve_governed_report_projection_overlap_group(uuid,uuid,uuid,text,text,uuid)'::regprocedure
  ) into resolver_definition;

  select count(*)::integer into missing_scope_count
  from pg_catalog.regexp_matches(resolver_definition, missing_scope_pattern, 'g');

  if missing_scope_count <> 12 then
    raise exception 'group reconciliation resolver is not the expected version'
      using errcode = '55000';
  end if;

  resolver_definition := pg_catalog.regexp_replace(
    resolver_definition,
    missing_scope_pattern,
    E'\\1\\2and reconciliation.classification = ''ambiguous_overlap''\n\\2',
    'g'
  );

  if resolver_definition ~ missing_scope_pattern then
    raise exception 'group reconciliation resolver scope repair was incomplete'
      using errcode = '55000';
  end if;

  execute resolver_definition;
end;
$repair$;
