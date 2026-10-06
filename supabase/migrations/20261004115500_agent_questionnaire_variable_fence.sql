-- Fix single-choice answer validation ambiguity without changing its contract.
create or replace function private.agent_challenge_answers_are_valid(p_fields jsonb,p_answers jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare field jsonb; answer_value jsonb; key_name text; answer_key text; kind_name text; allowed text[]; picked text;
begin
  if jsonb_typeof(p_answers)<>'object' or pg_column_size(p_answers)>4096 then return false; end if;
  for answer_key in select jsonb_object_keys(p_answers) loop
    if not exists(select 1 from jsonb_array_elements(p_fields) f where f->>'key'=answer_key) then return false; end if;
  end loop;
  for field in select v from jsonb_array_elements(p_fields) v loop
    key_name:=field->>'key'; kind_name:=field->>'kind'; answer_value:=p_answers->key_name;
    if answer_value is null then
      if field->>'required'='true' then return false; end if;
      continue;
    end if;
    if kind_name='text' then
      if jsonb_typeof(answer_value)<>'string' or length(btrim(answer_value #>> '{}')) not between 1 and 500 then return false; end if;
    elsif kind_name='date' then
      if jsonb_typeof(answer_value)<>'string' or (answer_value #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false; end if;
      begin
        perform (answer_value #>> '{}')::date;
      exception when invalid_datetime_format or datetime_field_overflow then return false;
      end;
    elsif kind_name='single_select' then
      if jsonb_typeof(answer_value)<>'string' or not exists(
        select 1 from jsonb_array_elements(field->'options') o where o->>'value'=answer_value #>> '{}'
      ) then return false; end if;
    elsif kind_name='multi_select' then
      if jsonb_typeof(answer_value)<>'array' or jsonb_array_length(answer_value)>12
        or (field->>'required'='true' and jsonb_array_length(answer_value)=0) then return false; end if;
      allowed:=array(select o->>'value' from jsonb_array_elements(field->'options') o);
      for picked in select x #>> '{}' from jsonb_array_elements(answer_value) x loop
        if picked is null or not picked=any(allowed) then return false; end if;
      end loop;
    elsif kind_name='confirm' then
      if jsonb_typeof(answer_value)<>'boolean' or (field->>'required'='true' and answer_value<>'true'::jsonb) then return false; end if;
    else return false;
    end if;
  end loop;
  return true;
end $$;
revoke all on function private.agent_challenge_answers_are_valid(jsonb,jsonb) from public,anon,authenticated,service_role;

