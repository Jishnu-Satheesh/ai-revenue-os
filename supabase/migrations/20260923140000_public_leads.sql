-- Public lead capture from the Coming Soon site.
--
-- Anonymous visitors have no session and no tenant, so this table sits outside
-- the tenancy model on purpose: forced RLS, no policies, every session grant
-- revoked. The only writer is the fenced record RPC under the service role,
-- called by the public route after strict Zod validation.
--
-- The unique (email, intent) pair is the idempotency guard: a retried form
-- submission replays instead of duplicating, and a walkthrough request from an
-- address already on the early-access list is its own row, not a conflict.

create table public.marketing_leads (
  id uuid primary key default gen_random_uuid(),
  email text not null check (char_length(email) between 3 and 254),
  intent text not null check (intent in ('early-access', 'book-walkthrough')),
  name text check (name is null or char_length(name) between 1 and 120),
  source text not null default 'coming-soon' check (char_length(source) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (email, intent),
  check (position('@' in email) > 1),
  check (email = lower(email))
);

alter table public.marketing_leads enable row level security;
alter table public.marketing_leads force row level security;

revoke all on public.marketing_leads from anon, authenticated;

comment on table public.marketing_leads is
  'Anonymous marketing leads. Written by the public route under the service role through record_public_lead; unique (email, intent) is the replay guard. No tenant-scoped read policy exists because a lead has no tenant.';

-- Record a validated signup, or report that it is a replay ------------------
--
-- The insert and the duplicate check are the same statement, so two concurrent
-- submissions of the same signup cannot both pass a prior existence check.
create function public.record_public_lead(
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
  lead_name text := pg_catalog.nullif(pg_catalog.btrim(coalesce(input_lead ->> 'name', '')), '');
  lead_source text := coalesce(
    pg_catalog.nullif(pg_catalog.btrim(coalesce(input_lead ->> 'source', ''))),
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
