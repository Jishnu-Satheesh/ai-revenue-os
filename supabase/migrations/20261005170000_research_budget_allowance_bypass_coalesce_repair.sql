-- Repair: unqualified COALESCE in the allowance-bypass reservations (ADR 0077).
--
-- The 20261005160000 bodies were copied from the superseded 20260908140000
-- text and carried its schema-qualified pg_catalog.coalesce(sum, 0) calls.
-- A qualified COALESCE is a real function lookup, and no such function
-- exists for (numeric, integer), so fresh reservations raised
-- `function pg_catalog.coalesce(numeric, integer) does not exist` on first
-- live call (caught by the new bypass pgTAP suite before any production
-- traffic). Plain coalesce(...) is syntax, not a lookup. The three bodies
-- below are otherwise identical to 20261005160000. No grant, RLS, table, or
-- semantic change: only the `pg_catalog.` prefix is dropped from the three
-- sum-COALESCE calls. This mirrors repairs 20260908150000, 20260909120000,
-- and 20260920150000.

-- reserve_research_pipeline_budget -------------------------------------------

drop function if exists public.reserve_research_pipeline_budget(uuid, uuid, bigint, text, boolean);

create function public.reserve_research_pipeline_budget(
  p_organization_id uuid,
  p_pipeline_id uuid,
  p_quote_micros_usd bigint,
  p_price_version text,
  p_skip_allowance boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  rpb_pipeline public.growth_intelligence_research_pipelines;
  rpb_existing private.growth_intelligence_research_budget_reservations;
  rpb_allowance_row private.growth_intelligence_research_day_allowances;
  rpb_allowance_day date;
  rpb_outstanding bigint;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role'
    and not private.has_organization_permission(p_organization_id, 'growth_intelligence.manage') then
    raise exception 'research_budget_forbidden' using errcode = '42501';
  end if;
  if coalesce(p_skip_allowance, false)
    and pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    raise exception 'research_budget_forbidden' using errcode = '42501';
  end if;
  if p_pipeline_id is null
    or p_quote_micros_usd is null
    or p_quote_micros_usd not between 1 and 1000000
    or pg_catalog.char_length(coalesce(p_price_version, '')) not between 1 and 80 then
    raise exception 'research_budget_quote_invalid' using errcode = '22023';
  end if;
  select pipeline.* into rpb_pipeline
  from public.growth_intelligence_research_pipelines pipeline
  where pipeline.organization_id = p_organization_id
    and pipeline.id = p_pipeline_id
  for update;
  if not found then
    raise exception 'research_budget_pipeline_not_found' using errcode = '42501';
  end if;
  if rpb_pipeline.stage in (
    'ready', 'partial', 'no_findings', 'research_failed', 'synthesis_failed', 'cancelled'
  ) then
    raise exception 'research_budget_pipeline_closed' using errcode = '23505';
  end if;
  perform private.assert_research_provider_qualified();
  select reservation.* into rpb_existing
  from private.growth_intelligence_research_budget_reservations reservation
  where reservation.organization_id = p_organization_id
    and reservation.pipeline_id = p_pipeline_id;
  if found then
    if rpb_existing.quote_micros_usd is distinct from p_quote_micros_usd
      or rpb_existing.price_version is distinct from p_price_version then
      raise exception 'research_budget_reservation_conflict' using errcode = '23505';
    end if;
    return pg_catalog.jsonb_build_object(
      'reservationId', rpb_existing.id,
      'organizationId', rpb_existing.organization_id,
      'pipelineId', rpb_existing.pipeline_id,
      'allowanceDay', rpb_existing.allowance_day,
      'quoteMicrosUsd', rpb_existing.quote_micros_usd,
      'priceVersion', rpb_existing.price_version,
      'replayed', true
    );
  end if;
  rpb_allowance_day := private.research_allowance_day(p_organization_id);
  insert into private.growth_intelligence_research_day_allowances (
    organization_id, allowance_day
  ) values (p_organization_id, rpb_allowance_day)
  on conflict do nothing;
  select allowance.* into rpb_allowance_row
  from private.growth_intelligence_research_day_allowances allowance
  where allowance.organization_id = p_organization_id
    and allowance.allowance_day = rpb_allowance_day
  for update;
  select coalesce(pg_catalog.sum(reservation.quote_micros_usd), 0)::bigint into rpb_outstanding
  from private.growth_intelligence_research_budget_reservations reservation
  where reservation.organization_id = p_organization_id
    and reservation.allowance_day = rpb_allowance_day
    and reservation.status = 'active';
  if not coalesce(p_skip_allowance, false)
    and rpb_outstanding + p_quote_micros_usd > 5000000 then
    raise exception 'research_budget_allowance_exceeded' using errcode = '23505';
  end if;
  insert into private.growth_intelligence_research_budget_reservations (
    organization_id, allowance_day, pipeline_id, quote_micros_usd, price_version
  ) values (
    p_organization_id, rpb_allowance_day, p_pipeline_id, p_quote_micros_usd, p_price_version
  ) returning * into rpb_existing;
  return pg_catalog.jsonb_build_object(
    'reservationId', rpb_existing.id,
    'organizationId', rpb_existing.organization_id,
    'pipelineId', rpb_existing.pipeline_id,
    'allowanceDay', rpb_existing.allowance_day,
    'quoteMicrosUsd', rpb_existing.quote_micros_usd,
    'priceVersion', rpb_existing.price_version,
    'replayed', false
  );
end;
$$;

revoke all on function public.reserve_research_pipeline_budget(uuid, uuid, bigint, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.reserve_research_pipeline_budget(uuid, uuid, bigint, text, boolean)
  to authenticated, service_role;

-- reserve_research_request_budget --------------------------------------------

drop function if exists public.reserve_research_request_budget(uuid, uuid, bigint, text, boolean);

create function public.reserve_research_request_budget(
  p_organization_id uuid,
  p_request_id uuid,
  p_quote_micros_usd bigint,
  p_price_version text,
  p_skip_allowance boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  rrb_request public.growth_intelligence_requests;
  rrb_existing private.growth_intelligence_research_budget_reservations;
  rrb_allowance_row private.growth_intelligence_research_day_allowances;
  rrb_allowance_day date;
  rrb_outstanding bigint;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role'
    and not private.has_organization_permission(p_organization_id, 'growth_intelligence.manage') then
    raise exception 'research_budget_forbidden' using errcode = '42501';
  end if;
  if coalesce(p_skip_allowance, false)
    and pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    raise exception 'research_budget_forbidden' using errcode = '42501';
  end if;
  if p_request_id is null
    or p_quote_micros_usd is null
    or p_quote_micros_usd not between 1 and 1000000
    or pg_catalog.char_length(coalesce(p_price_version, '')) not between 1 and 80 then
    raise exception 'research_budget_quote_invalid' using errcode = '22023';
  end if;
  select request.* into rrb_request
  from public.growth_intelligence_requests request
  where request.organization_id = p_organization_id
    and request.id = p_request_id
  for update;
  if not found then
    raise exception 'research_budget_request_not_found' using errcode = '42501';
  end if;
  if rrb_request.kind not in ('market_research', 'weekly_synthesis', 'business_evidence_changed') then
    raise exception 'research_budget_request_not_billable' using errcode = '22023';
  end if;
  if rrb_request.status in ('succeeded', 'failed', 'cancelled') then
    raise exception 'research_budget_request_closed' using errcode = '23505';
  end if;
  perform private.assert_research_provider_qualified();
  select reservation.* into rrb_existing
  from private.growth_intelligence_research_budget_reservations reservation
  where reservation.organization_id = p_organization_id
    and reservation.request_id = p_request_id;
  if found then
    if rrb_existing.quote_micros_usd is distinct from p_quote_micros_usd
      or rrb_existing.price_version is distinct from p_price_version then
      raise exception 'research_budget_reservation_conflict' using errcode = '23505';
    end if;
    return pg_catalog.jsonb_build_object(
      'reservationId', rrb_existing.id,
      'organizationId', rrb_existing.organization_id,
      'requestId', rrb_existing.request_id,
      'allowanceDay', rrb_existing.allowance_day,
      'quoteMicrosUsd', rrb_existing.quote_micros_usd,
      'priceVersion', rrb_existing.price_version,
      'replayed', true
    );
  end if;
  rrb_allowance_day := private.research_allowance_day(p_organization_id);
  insert into private.growth_intelligence_research_day_allowances (
    organization_id, allowance_day
  ) values (p_organization_id, rrb_allowance_day)
  on conflict do nothing;
  select allowance.* into rrb_allowance_row
  from private.growth_intelligence_research_day_allowances allowance
  where allowance.organization_id = p_organization_id
    and allowance.allowance_day = rrb_allowance_day
  for update;
  select coalesce(pg_catalog.sum(reservation.quote_micros_usd), 0)::bigint into rrb_outstanding
  from private.growth_intelligence_research_budget_reservations reservation
  where reservation.organization_id = p_organization_id
    and reservation.allowance_day = rrb_allowance_day
    and reservation.status = 'active';
  if not coalesce(p_skip_allowance, false)
    and rrb_outstanding + p_quote_micros_usd > 5000000 then
    raise exception 'research_budget_allowance_exceeded' using errcode = '23505';
  end if;
  insert into private.growth_intelligence_research_budget_reservations (
    organization_id, allowance_day, request_id, quote_micros_usd, price_version
  ) values (
    p_organization_id, rrb_allowance_day, p_request_id, p_quote_micros_usd, p_price_version
  ) returning * into rrb_existing;
  return pg_catalog.jsonb_build_object(
    'reservationId', rrb_existing.id,
    'organizationId', rrb_existing.organization_id,
    'requestId', rrb_existing.request_id,
    'allowanceDay', rrb_existing.allowance_day,
    'quoteMicrosUsd', rrb_existing.quote_micros_usd,
    'priceVersion', rrb_existing.price_version,
    'replayed', false
  );
end;
$$;

revoke all on function public.reserve_research_request_budget(uuid, uuid, bigint, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.reserve_research_request_budget(uuid, uuid, bigint, text, boolean)
  to authenticated, service_role;

-- reserve_monitoring_update_budget -------------------------------------------

drop function if exists public.reserve_monitoring_update_budget(uuid, uuid, bigint, text, boolean);

create function public.reserve_monitoring_update_budget(
  p_organization_id uuid,
  p_update_id uuid,
  p_quote_micros_usd bigint,
  p_price_version text,
  p_skip_allowance boolean default false
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
  if coalesce(p_skip_allowance, false)
    and pg_catalog.current_setting('role', true) is distinct from 'service_role' then
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
  if not coalesce(p_skip_allowance, false)
    and rub_outstanding + p_quote_micros_usd > 5000000 then
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

revoke all on function public.reserve_monitoring_update_budget(uuid, uuid, bigint, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.reserve_monitoring_update_budget(uuid, uuid, bigint, text, boolean)
  to authenticated, service_role;
