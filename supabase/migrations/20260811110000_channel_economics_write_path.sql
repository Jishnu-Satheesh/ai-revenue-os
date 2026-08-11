-- The ledger write path.
--
-- Recomputation is in scope for the ledger (specs/012 section 3.1): a rate
-- corrected today must reprice every period it was in force for. That makes the
-- write an upsert rather than an insert, and it has to replace an entry's
-- components along with the entry, or a period repriced from four components to
-- three would keep the fourth forever.
--
-- Three reasons this is a function rather than PostgREST calls:
--
--   1. The period identity index is on expressions -- coalesce(branch_id::text,
--      '') and coalesce(channel, '') -- so PostgREST cannot infer it for an
--      upsert. Only SQL can name it.
--   2. An entry and its components have to land together. Replacing components
--      from the client leaves a window where a margin has no waterfall, and a
--      crash in that window leaves it there permanently.
--   3. A day-grain year for one organization is a few thousand entries. One
--      call beats a few thousand.
--
-- Executable by service_role only. Entries are a decision input, and per
-- specs/012 section 4.4 an indicative one is blocked from decision use; a
-- browser write path would let an unaudited number in behind that check.

create or replace function public.record_channel_economics_entries(
  target_organization_id uuid,
  input_entries jsonb
)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  entry_payload jsonb;
  saved_entry_id uuid;
  written integer := 0;
begin
  for entry_payload in
    select value from jsonb_array_elements(coalesce(input_entries, '[]'::jsonb))
  loop
    insert into public.channel_economics_entries (
      organization_id, branch_id, grain, channel,
      period_start, period_end, period_timezone,
      gross_revenue_minor, transaction_count, unit_count, currency,
      margin_source, completeness_grade,
      contribution_margin_minor, at_most_minor, reported_quality_tier,
      source_reference, computed_at
    )
    values (
      target_organization_id,
      (entry_payload->>'branch_id')::uuid,
      entry_payload->>'grain',
      entry_payload->>'channel',
      (entry_payload->>'period_start')::timestamptz,
      (entry_payload->>'period_end')::timestamptz,
      entry_payload->>'period_timezone',
      (entry_payload->>'gross_revenue_minor')::bigint,
      coalesce((entry_payload->>'transaction_count')::integer, 0),
      (entry_payload->>'unit_count')::integer,
      entry_payload->>'currency',
      entry_payload->>'margin_source',
      entry_payload->>'completeness_grade',
      (entry_payload->>'contribution_margin_minor')::bigint,
      (entry_payload->>'at_most_minor')::bigint,
      entry_payload->>'reported_quality_tier',
      entry_payload->>'source_reference',
      now()
    )
    on conflict (
      organization_id,
      (coalesce(branch_id::text, '')),
      (coalesce(channel, '')),
      grain,
      period_start
    )
    do update set
      period_end = excluded.period_end,
      period_timezone = excluded.period_timezone,
      gross_revenue_minor = excluded.gross_revenue_minor,
      transaction_count = excluded.transaction_count,
      unit_count = excluded.unit_count,
      currency = excluded.currency,
      margin_source = excluded.margin_source,
      completeness_grade = excluded.completeness_grade,
      -- Assigned unconditionally, including to null. A period that was complete
      -- and is now indicative must lose its figure, not keep a stale one beside
      -- a ceiling that contradicts it.
      contribution_margin_minor = excluded.contribution_margin_minor,
      at_most_minor = excluded.at_most_minor,
      reported_quality_tier = excluded.reported_quality_tier,
      source_reference = excluded.source_reference,
      computed_at = excluded.computed_at
    returning id into saved_entry_id;

    -- Replaced wholesale rather than merged. A component that no longer applies
    -- -- because the channel changed, or the definition was deactivated -- has
    -- to disappear, and merging would leave it subtracting forever.
    delete from public.channel_economics_components components
    where components.entry_id = saved_entry_id;

    insert into public.channel_economics_components (
      organization_id, entry_id, definition_id, rate_id, amount_minor, quality_tier
    )
    select
      target_organization_id,
      saved_entry_id,
      (component->>'definition_id')::uuid,
      (component->>'rate_id')::uuid,
      (component->>'amount_minor')::bigint,
      component->>'quality_tier'
    from jsonb_array_elements(coalesce(entry_payload->'components', '[]'::jsonb))
      as elements(component);

    written := written + 1;
  end loop;

  return written;
end;
$$;

revoke all on function public.record_channel_economics_entries(uuid, jsonb) from public;
grant execute on function public.record_channel_economics_entries(uuid, jsonb) to service_role;
