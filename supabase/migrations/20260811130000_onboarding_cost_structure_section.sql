-- Cost structure capture during onboarding.
--
-- specs/012 section 6 names manual capture as the primary path for cost rates
-- initially, because no marketplace API hands over a commission tier. This is
-- that path: a new onboarding section, and a write path from it into
-- public.cost_component_rates.
--
-- The section is placed after historical performance, where the operator has
-- just stated revenue and margin, so "and what does an order cost you" is the
-- next question rather than a new subject.

-- Section key ------------------------------------------------------------------

-- Uploads and extraction candidates keep their narrower allow-lists. Reading a
-- commission tier out of a contract is specs/012 section 8 work and arrives
-- with the fact-proposal path; until then a rate is typed, not extracted.

alter table public.onboarding_sessions
  drop constraint onboarding_sessions_current_section_key_check;

alter table public.onboarding_sessions
  add constraint onboarding_sessions_current_section_key_check check (
    current_section_key in (
      'business_identity', 'branches_operations', 'products_services', 'channels_presence',
      'historical_performance', 'cost_structure', 'customers_consent', 'brand_assets',
      'governance', 'integrations_uploads', 'review_readiness'
    )
  );

alter table public.onboarding_section_states
  drop constraint onboarding_section_states_section_key_check;

alter table public.onboarding_section_states
  add constraint onboarding_section_states_section_key_check check (
    section_key in (
      'business_identity', 'branches_operations', 'products_services', 'channels_presence',
      'historical_performance', 'cost_structure', 'customers_consent', 'brand_assets',
      'governance', 'integrations_uploads', 'review_readiness'
    )
  );

alter table public.onboarding_requests
  drop constraint onboarding_requests_section_key_check;

alter table public.onboarding_requests
  add constraint onboarding_requests_section_key_check check (
    section_key in (
      'business_identity', 'branches_operations', 'products_services', 'channels_presence',
      'historical_performance', 'cost_structure', 'customers_consent', 'brand_assets',
      'governance', 'integrations_uploads', 'review_readiness'
    )
  );

-- Rate capture -----------------------------------------------------------------

-- Saving the section again on the same date must update the rate rather than
-- collide. The no-overlap index is on coalesce expressions -- one rate per
-- definition, branch, channel and start date -- which PostgREST cannot infer
-- for an upsert, so the conflict target is named here in SQL.
--
-- An operator revising a typed figure on the same effective date is correcting
-- a mistake, not opening a new commission tier. A real tier change carries a
-- new date and lands as a new row, leaving every margin already priced against
-- the old one untouched, which is what specs/012 section 4.5 requires.
--
-- This is the governed rate-editing RPC the ledger migration anticipated. It
-- runs from the operator's own request rather than a worker, so it is
-- `security definer` with an explicit role check in place of RLS, following
-- the memory write operations. Owners and admins only: specs/012 section 9
-- treats cost structure as confidential, and the table's read policy already
-- limits it to the same two roles.

create or replace function public.record_cost_component_rates(
  target_organization_id uuid,
  input_rates jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  rate_payload jsonb;
  actor_id uuid := (select auth.uid());
  written integer := 0;
begin
  if not private.has_organization_role(
    target_organization_id,
    array['owner', 'admin']::public.organization_role[]
  ) then
    raise exception 'cost_rate_authorization_denied' using errcode = '42501';
  end if;

  for rate_payload in
    -- coalesce is a SQL construct rather than a schema-qualified function, so
    -- it stays bare even under an empty search_path.
    select value from pg_catalog.jsonb_array_elements(coalesce(input_rates, '[]'::jsonb))
  loop
    insert into public.cost_component_rates (
      organization_id, definition_id, branch_id, channel,
      amount_minor, rate_of_revenue, currency,
      quality_tier, source_reference, effective_from, created_by
    )
    values (
      target_organization_id,
      (rate_payload->>'definition_id')::uuid,
      (rate_payload->>'branch_id')::uuid,
      rate_payload->>'channel',
      (rate_payload->>'amount_minor')::bigint,
      (rate_payload->>'rate_of_revenue')::numeric,
      rate_payload->>'currency',
      rate_payload->>'quality_tier',
      rate_payload->>'source_reference',
      (rate_payload->>'effective_from')::date,
      -- Taken from the session, never from the payload. A caller cannot
      -- attribute their own typed figure to somebody else.
      actor_id
    )
    on conflict (
      organization_id,
      definition_id,
      (coalesce(branch_id::text, '')),
      (coalesce(channel, '')),
      effective_from
    )
    do update set
      -- Assigned unconditionally, including to null. A rate corrected from a
      -- flat fee to a percentage must lose the fee, not keep both and fail the
      -- check that allows only one of them.
      amount_minor = excluded.amount_minor,
      rate_of_revenue = excluded.rate_of_revenue,
      currency = excluded.currency,
      quality_tier = excluded.quality_tier,
      source_reference = excluded.source_reference,
      updated_at = pg_catalog.now();

    written := written + 1;
  end loop;

  return written;
end;
$$;

revoke all on function public.record_cost_component_rates(uuid, jsonb) from public;
grant execute on function public.record_cost_component_rates(uuid, jsonb) to authenticated;
