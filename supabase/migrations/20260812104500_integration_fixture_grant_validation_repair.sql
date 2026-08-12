-- Forward-only portability repair for the strict fixture helper. PostgreSQL
-- exposes jsonb_object_keys(), not jsonb_object_length().
do $repair$
declare
  function_signature regprocedure :=
    'private.assert_google_fixture_grants(jsonb,text,text)'::regprocedure;
  function_definition text;
  repaired_definition text;
begin
  select pg_catalog.pg_get_functiondef(function_signature)
  into function_definition;

  if function_definition is null
    or pg_catalog.strpos(
      function_definition,
      'pg_catalog.jsonb_object_length(grant_payload) <> 7'
    ) = 0 then
    raise exception 'expected fixture grant validator repair target is unavailable'
      using errcode = '55000';
  end if;

  repaired_definition := pg_catalog.replace(
    function_definition,
    'pg_catalog.jsonb_object_length(grant_payload) <> 7',
    '(select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(grant_payload)) <> 7'
  );
  execute repaired_definition;
end;
$repair$;

revoke all on function private.assert_google_fixture_grants(jsonb, text, text) from public;
