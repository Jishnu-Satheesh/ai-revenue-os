-- Keep the figure the operator's own export stated, when a derived margin
-- took precedence over it.
--
-- specs/012 section 4.4.1 requires the ledger to raise a disagreement between
-- the two rather than reconcile them silently. It was computing the difference
-- and throwing it away: the recompute worker logged a warning and nothing
-- reached the entry, so the operator view showed a derived margin with no hint
-- that the client's own export said something else. A number contradicted by
-- the source it came from, presented as settled, is the silent reconciliation
-- that section forbids.

alter table public.channel_economics_entries
  add column reported_margin_minor bigint;

-- Only meaningful where a derived figure won. On a `reported` entry the stated
-- figure already *is* contribution_margin_minor, and holding it twice invites
-- the two copies to drift -- which is precisely the failure this column exists
-- to make visible.
alter table public.channel_economics_entries
  add constraint channel_economics_entries_reported_margin_check check (
    reported_margin_minor is null or margin_source = 'derived'
  );

comment on column public.channel_economics_entries.reported_margin_minor is
  'What the source reported for this period, kept only when a derived margin took precedence. The difference is derived on read so the two cannot drift.';

-- The difference is deliberately not stored. It is arithmetic over two columns
-- in the same row, and a stored copy is one more thing that can disagree.

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
      reported_margin_minor, source_reference, computed_at
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
      (entry_payload->>'reported_margin_minor')::bigint,
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
      -- a ceiling that contradicts it. The reported figure follows the same
      -- rule: a rate correction that resolves a disagreement must clear it.
      contribution_margin_minor = excluded.contribution_margin_minor,
      at_most_minor = excluded.at_most_minor,
      reported_quality_tier = excluded.reported_quality_tier,
      reported_margin_minor = excluded.reported_margin_minor,
      source_reference = excluded.source_reference,
      computed_at = excluded.computed_at
    returning id into saved_entry_id;

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
