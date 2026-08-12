-- Forward-only repair for both fixture mutation RPCs. COALESCE is SQL syntax,
-- not a pg_catalog function, so the qualified call in 20260812100000 aborts
-- before the fixture admission checks can run.
do $repair$
declare
  function_signature regprocedure;
  function_definition text;
  repaired_definition text;
begin
  foreach function_signature in array array[
    'public.connect_fixture_integration_with_grants(uuid,uuid,text,text,text,text,text[],text,uuid,jsonb)'::regprocedure,
    'public.replace_integration_mappings_with_grants(uuid,uuid,uuid,uuid,text,jsonb,jsonb)'::regprocedure
  ] loop
    select pg_catalog.pg_get_functiondef(function_signature)
    into function_definition;

    if function_definition is null
      or pg_catalog.strpos(function_definition, 'pg_catalog.coalesce') = 0 then
      raise exception 'expected integration RPC repair target is unavailable: %', function_signature
        using errcode = '55000';
    end if;

    repaired_definition := pg_catalog.replace(
      function_definition,
      'pg_catalog.coalesce',
      'coalesce'
    );
    execute repaired_definition;
  end loop;
end;
$repair$;

revoke all on function public.connect_fixture_integration_with_grants(
  uuid, uuid, text, text, text, text, text[], text, uuid, jsonb
) from public, anon;
grant execute on function public.connect_fixture_integration_with_grants(
  uuid, uuid, text, text, text, text, text[], text, uuid, jsonb
) to authenticated;
revoke all on function public.replace_integration_mappings_with_grants(
  uuid, uuid, uuid, uuid, text, jsonb, jsonb
) from public, anon;
grant execute on function public.replace_integration_mappings_with_grants(
  uuid, uuid, uuid, uuid, text, jsonb, jsonb
) to authenticated;
