-- `greatest` is PostgreSQL expression syntax rather than an ordinary function
-- in `pg_catalog`. The grouped resolver was stored successfully, but its first
-- period-grain call proved that schema-qualifying this expression defers a
-- missing-function error until execution. Rewrite only those two expressions
-- from the immediately preceding, immutable migration definition.

do $repair$
declare
  resolver_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.resolve_governed_report_projection_overlap_group(uuid,uuid,uuid,text,text,uuid)'::regprocedure
  ) into resolver_definition;

  if resolver_definition is null
    or pg_catalog.strpos(resolver_definition, 'pg_catalog.greatest(') = 0 then
    raise exception 'group reconciliation resolver is not the expected version'
      using errcode = '55000';
  end if;

  execute pg_catalog.replace(resolver_definition, 'pg_catalog.greatest(', 'greatest(');
end;
$repair$;
