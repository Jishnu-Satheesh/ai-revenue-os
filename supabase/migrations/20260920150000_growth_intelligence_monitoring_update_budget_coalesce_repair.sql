-- Repair: schema-qualified COALESCE in the monitoring-update budget functions.
--
-- `pg_catalog.coalesce(...)` is a real function lookup, and no such function
-- exists for (numeric, integer), so both reserve functions below raised
-- `function pg_catalog.coalesce(numeric, integer) does not exist` on their
-- first live call. Plain `coalesce(...)` is syntax, not a lookup, so the
-- unknown literal coerces and the expression works. This mirrors the earlier
-- request-scope repair (20260908150000) and the synthesis coalesce repair
-- (20260909120000), which both use unqualified coalesce.
--
-- The two bodies are otherwise byte-identical to 20260920140000. No grant,
-- RLS, table, or semantic change: only the `pg_catalog.` prefix is dropped
-- from the two COALESCE calls.

create or replace function public.reserve_monitoring_update_budget(
  p_organization_id uuid,
  p_update_id uuid,
  p_quote_micros_usd bigint,
  p_price_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  rub_update public.growth_intelligence_monitoring_updates;
  rub_existing private.growth_intelligence_research_budget_reservations;
  rub_allowance_row private.growth_intelligence_research_day_allowances;
  rub_allowance_day date;
  rub_outstanding bigint;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role'
    and not private.has_organization_permission(p_organization_id, 'growth_intelligence.manage') then
    raise exception 'research_budget_forbidden' using errcode = '42501';
  end if;
  if p_update_id is null
    or p_quote_micros_usd is null
    or p_quote_micros_usd not between 1 and 1000000
    or pg_catalog.char_length(coalesce(p_price_version, '')) not between 1 and 80 then
    raise exception 'research_budget_quote_invalid' using errcode = '22023';
  end if;
  select update_row.* into rub_update
  from public.growth_intelligence_monitoring_updates update_row
  where update_row.organization_id = p_organization_id
    and update_row.update_id = p_update_id
  for update;
  if not found then
    raise exception 'research_budget_update_not_found' using errcode = '42501';
  end if;
  if rub_update.stage in (
    'ready', 'partial', 'empty', 'no_findings',
    'research_failed', 'synthesis_failed', 'cancelled'
  ) then
    raise exception 'research_budget_update_closed' using errcode = '23505';
  end if;
  perform private.assert_research_provider_qualified_for('tinyfish');
  select reservation.* into rub_existing
  from private.growth_intelligence_research_budget_reservations reservation
  where reservation.organization_id = p_organization_id
    and reservation.update_id = p_update_id;
  if found then
    if rub_existing.quote_micros_usd is distinct from p_quote_micros_usd
      or rub_existing.price_version is distinct from p_price_version then
      raise exception 'research_budget_reservation_conflict' using errcode = '23505';
    end if;
    return pg_catalog.jsonb_build_object(
      'reservationId', rub_existing.id,
      'organizationId', rub_existing.organization_id,
      'updateId', rub_existing.update_id,
      'allowanceDay', rub_existing.allowance_day,
      'quoteMicrosUsd', rub_existing.quote_micros_usd,
      'priceVersion', rub_existing.price_version,
      'replayed', true
    );
  end if;
  rub_allowance_day := private.research_allowance_day(p_organization_id);
  insert into private.growth_intelligence_research_day_allowances (
    organization_id, allowance_day
  ) values (p_organization_id, rub_allowance_day)
  on conflict do nothing;
  select allowance.* into rub_allowance_row
  from private.growth_intelligence_research_day_allowances allowance
  where allowance.organization_id = p_organization_id
    and allowance.allowance_day = rub_allowance_day
  for update;
  select coalesce(pg_catalog.sum(reservation.quote_micros_usd), 0)::bigint into rub_outstanding
  from private.growth_intelligence_research_budget_reservations reservation
  where reservation.organization_id = p_organization_id
    and reservation.allowance_day = rub_allowance_day
    and reservation.status = 'active';
  if rub_outstanding + p_quote_micros_usd > 5000000 then
    raise exception 'research_budget_allowance_exceeded' using errcode = '23505';
  end if;
  insert into private.growth_intelligence_research_budget_reservations (
    organization_id, allowance_day, update_id, quote_micros_usd, price_version
  ) values (
    p_organization_id, rub_allowance_day, p_update_id, p_quote_micros_usd, p_price_version
  ) returning * into rub_existing;
  return pg_catalog.jsonb_build_object(
    'reservationId', rub_existing.id,
    'organizationId', rub_existing.organization_id,
    'updateId', rub_existing.update_id,
    'allowanceDay', rub_existing.allowance_day,
    'quoteMicrosUsd', rub_existing.quote_micros_usd,
    'priceVersion', rub_existing.price_version,
    'replayed', false
  );
end;
$$;

create or replace function public.reserve_monitoring_update_attempt(
  p_organization_id uuid,
  p_update_id uuid,
  p_phase text,
  p_slot_key text,
  p_attempt_index integer,
  p_maximum_micros_usd bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  rua_update public.growth_intelligence_monitoring_updates;
  rua_reservation private.growth_intelligence_research_budget_reservations;
  rua_existing private.growth_intelligence_research_attempt_ledger;
  rua_liability bigint;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role'
    and not private.has_organization_permission(p_organization_id, 'growth_intelligence.manage') then
    raise exception 'research_budget_forbidden' using errcode = '42501';
  end if;
  if p_update_id is null
    or coalesce(p_phase, '') not in ('research', 'synthesis')
    or pg_catalog.char_length(coalesce(p_slot_key, '')) not between 1 and 160
    or p_attempt_index is null
    or p_attempt_index not between 0 and 100
    or p_maximum_micros_usd is null
    or p_maximum_micros_usd not between 1 and 1000000 then
    raise exception 'research_budget_attempt_invalid' using errcode = '22023';
  end if;
  select reservation.* into rua_reservation
  from private.growth_intelligence_research_budget_reservations reservation
  where reservation.organization_id = p_organization_id
    and reservation.update_id = p_update_id
  for update;
  if not found then
    raise exception 'research_budget_no_reservation' using errcode = '42501';
  end if;
  if rua_reservation.status <> 'active' then
    raise exception 'research_budget_reservation_released' using errcode = '23505';
  end if;
  -- Row-state fence (no claim token reaches the researcher): spend requires
  -- the lifecycle row to exist for this organization and to be non-terminal.
  -- A redelivered run books nothing new after settle; a stale run that
  -- spends under a rival's live lease still books against the same capped
  -- reservation, never beyond the admitted quote.
  select update_row.* into rua_update
  from public.growth_intelligence_monitoring_updates update_row
  where update_row.organization_id = p_organization_id
    and update_row.update_id = p_update_id
  for update;
  if not found then
    raise exception 'research_budget_update_not_found' using errcode = '42501';
  end if;
  if rua_update.stage in (
    'ready', 'partial', 'empty', 'no_findings',
    'research_failed', 'synthesis_failed', 'cancelled'
  ) then
    raise exception 'research_budget_update_closed' using errcode = '23505';
  end if;
  if exists (
    select 1 from private.growth_intelligence_research_attempt_ledger attempt
    where attempt.organization_id = p_organization_id
      and attempt.reservation_id = rua_reservation.id
      and attempt.actual_micros_usd is not null
      and attempt.actual_micros_usd > attempt.maximum_micros_usd
  ) then
    raise exception 'research_budget_overrun_blocked' using errcode = '23505';
  end if;
  select attempt.* into rua_existing
  from private.growth_intelligence_research_attempt_ledger attempt
  where attempt.organization_id = p_organization_id
    and attempt.reservation_id = rua_reservation.id
    and attempt.phase = p_phase
    and attempt.slot_key = p_slot_key
    and attempt.attempt_index = p_attempt_index;
  if found then
    if rua_existing.maximum_micros_usd is distinct from p_maximum_micros_usd then
      raise exception 'research_budget_attempt_conflict' using errcode = '23505';
    end if;
    return pg_catalog.jsonb_build_object(
      'attemptId', rua_existing.id,
      'reservationId', rua_reservation.id,
      'allowanceDay', rua_reservation.allowance_day,
      'maximumMicrosUsd', rua_existing.maximum_micros_usd,
      'replayed', true
    );
  end if;
  select coalesce(pg_catalog.sum(
    case
      when attempt.status = 'reserved'
        or attempt.settlement_kind = 'unknown' then attempt.maximum_micros_usd
      else attempt.actual_micros_usd
    end
  ), 0)::bigint into rua_liability
  from private.growth_intelligence_research_attempt_ledger attempt
  where attempt.organization_id = p_organization_id
    and attempt.reservation_id = rua_reservation.id;
  if rua_liability + p_maximum_micros_usd > rua_reservation.quote_micros_usd then
    raise exception 'research_budget_reservation_exceeded' using errcode = '23505';
  end if;
  insert into private.growth_intelligence_research_attempt_ledger (
    organization_id, reservation_id, phase, slot_key, attempt_index, maximum_micros_usd
  ) values (
    p_organization_id, rua_reservation.id, p_phase, p_slot_key, p_attempt_index, p_maximum_micros_usd
  ) returning * into rua_existing;
  return pg_catalog.jsonb_build_object(
    'attemptId', rua_existing.id,
    'reservationId', rua_reservation.id,
    'allowanceDay', rua_reservation.allowance_day,
    'maximumMicrosUsd', rua_existing.maximum_micros_usd,
    'replayed', false
  );
end;
$$;
