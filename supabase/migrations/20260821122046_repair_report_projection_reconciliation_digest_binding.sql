-- `use_column` made the old `o.reconciliation_digest = reconciliation_digest`
-- predicate resolve to the same column twice. Recompile the already-applied
-- fenced worker function with local variables taking precedence. Its SQL uses
-- qualified table columns, so this changes only the intended digest binding.
do $$
declare
  function_definition text;
begin
  select pg_get_functiondef(
    'public.complete_governed_report_package_projection(uuid,uuid,uuid,uuid,text,jsonb,jsonb)'::regprocedure
  ) into function_definition;
  if position('#variable_conflict use_column' in function_definition) = 0 then
    raise exception 'expected report projection completion conflict policy is missing';
  end if;
  execute replace(function_definition, '#variable_conflict use_column', '#variable_conflict use_variable');
end;
$$;
