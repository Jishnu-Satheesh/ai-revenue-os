-- Forward fix for record_public_lead: untyped empty literals in nullif.
--
-- The 20260923140000 body called pg_catalog.nullif(text_value, '') with an
-- untyped empty literal, and Postgres resolves nullif as a function call with
-- no (text, unknown) overload, so the first real invocation failed with
-- "function pg_catalog.nullif(text, unknown) does not exist". The body below
-- is otherwise identical; only the two empty literals gain a ::text cast.

create or replace function public.record_public_lead(
  input_lead jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(input_lead ->> 'email', '')));
  lead_intent text := coalesce(input_lead ->> 'intent', 'early-access');
  lead_name text := nullif(pg_catalog.btrim(coalesce(input_lead ->> 'name', '')), ''::text);
  lead_source text := coalesce(
    nullif(pg_catalog.btrim(coalesce(input_lead ->> 'source', '')), ''::text),
    'coming-soon'
  );
  saved_id uuid;
begin
  insert into public.marketing_leads (email, intent, name, source)
  values (normalized_email, lead_intent, lead_name, lead_source)
  on conflict (email, intent) do nothing
  returning id into saved_id;

  if saved_id is null then
    -- Already captured. Not an error: browsers retry, visitors double-click,
    -- and the honest answer is that this signup already exists. A replay that
    -- now carries a name enriches the stored row rather than dropping it.
    update public.marketing_leads
    set name = coalesce(lead_name, public.marketing_leads.name),
        updated_at = pg_catalog.now()
    where email = normalized_email and intent = lead_intent
    returning id into saved_id;

    return pg_catalog.jsonb_build_object('outcome', 'replayed', 'lead_id', saved_id);
  end if;

  return pg_catalog.jsonb_build_object('outcome', 'recorded', 'lead_id', saved_id);
end;
$$;

revoke all on function public.record_public_lead(jsonb) from public, anon, authenticated;
grant execute on function public.record_public_lead(jsonb) to service_role;
