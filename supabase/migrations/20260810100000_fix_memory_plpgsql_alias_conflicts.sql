-- The affected PL/pgSQL functions intentionally use row variables (`run` and
-- `proposal`) and table aliases with the same names. PostgreSQL's default
-- ambiguity policy rejects those qualified column references at first call.
-- `plpgsql.variable_conflict` is superuser-only on Supabase, so recreate each
-- existing definition with PL/pgSQL's supported per-function directive. The
-- catalog-generated source retains the body, security-definer mode, fixed
-- search path, and existing grants; this migration changes only parsing of the
-- conflicting table-alias columns. All function inputs use p_* names.
do $repair$
declare
  function_identifier regprocedure;
  function_definition text;
begin
  for function_identifier in
    select unnest(array[
      'public.project_google_business_profile_record(uuid, uuid, uuid, text, text, uuid, text, text, jsonb, text, timestamptz, jsonb)'::regprocedure,
      'public.confirm_memory_fact_proposal(uuid, uuid, uuid, boolean, text, uuid)'::regprocedure,
      'public.reject_memory_proposal(uuid, uuid, uuid, text, text, uuid)'::regprocedure
    ])
  loop
    function_definition := pg_catalog.pg_get_functiondef(function_identifier);
    function_definition := pg_catalog.regexp_replace(
      function_definition,
      '(AS \$[^$]*\$\n)',
      pg_catalog.chr(92) || '1#variable_conflict use_column' || pg_catalog.chr(10)
    );
    if function_definition not like '%#variable_conflict use_column%' then
      raise exception 'memory function directive injection failed for %', function_identifier
        using errcode = 'P0001';
    end if;
    execute function_definition;
  end loop;
end;
$repair$;
