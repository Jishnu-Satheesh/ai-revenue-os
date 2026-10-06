-- Task 5 repair: three runtime defects in the budget/retention slice.
--
-- 1. pg_catalog.coalesce does not exist. COALESCE is syntax, not a function,
--    so the schema-qualified call parses at CREATE time and fails on first
--    execution (42883) inside reserve_research_pipeline_budget,
--    reserve_research_request_budget and reserve_research_attempt. The reserve
--    path is the first thing every paid run touches, so nothing could reserve.
--    Fixed by calling COALESCE unqualified; bodies are otherwise identical.
-- 2. market_evidence_claims.paraphrase stayed NOT NULL, which contradicts the
--    text_withdrawn erasure contract (withdrawn claims must null their derived
--    text). The privileged erasure RPC would fail on the obligation path.
-- 3. Nothing refused a new supports-link to an erased source: the unique
--    index only raises a duplicate error when the same claim/source pair is
--    re-linked. A BEFORE INSERT eligibility check now refuses supports-links
--    to erased sources (22023). Never-erased unavailable/excluded sources
--    keep their existing admission behavior; synthesis-time eligibility for
--    those stays with its owning task.

alter table public.market_evidence_claims
  alter column paraphrase drop not null;

create function private.enforce_market_evidence_link_eligibility()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  link_eligibility_source public.market_evidence_sources;
begin
  if tg_op = 'INSERT'
    and new.relation = 'supports'
    and new.market_evidence_source_id is not null then
    select source.* into link_eligibility_source
    from public.market_evidence_sources source
    where source.organization_id = new.organization_id
      and source.id = new.market_evidence_source_id;
    if not found then
      raise exception 'market_evidence_link_source_missing' using errcode = '22023';
    end if;
    if link_eligibility_source.erased_at is not null then
      raise exception 'market_evidence_source_not_eligible' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

create trigger market_evidence_links_enforce_eligibility
before insert on public.market_evidence_links
for each row execute function private.enforce_market_evidence_link_eligibility();

create or replace function public.reserve_research_pipeline_budget(
  p_organization_id uuid,
  p_pipeline_id uuid,
  p_quote_micros_usd bigint,
  p_price_version text
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
  if rpb_outstanding + p_quote_micros_usd > 5000000 then
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

revoke all on function public.reserve_research_pipeline_budget(uuid, uuid, bigint, text)
  from public, anon, authenticated, service_role;
grant execute on function public.reserve_research_pipeline_budget(uuid, uuid, bigint, text)
  to authenticated, service_role;

create or replace function public.reserve_research_request_budget(
  p_organization_id uuid,
  p_request_id uuid,
  p_quote_micros_usd bigint,
  p_price_version text
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
  if rrb_outstanding + p_quote_micros_usd > 5000000 then
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

revoke all on function public.reserve_research_request_budget(uuid, uuid, bigint, text)
  from public, anon, authenticated, service_role;
grant execute on function public.reserve_research_request_budget(uuid, uuid, bigint, text)
  to authenticated, service_role;

create or replace function public.reserve_research_attempt(
  p_organization_id uuid,
  p_work_scope jsonb,
  p_phase text,
  p_slot_key text,
  p_attempt_index integer,
  p_maximum_micros_usd bigint,
  p_claim_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  rat_scope_id uuid;
  rat_reservation private.growth_intelligence_research_budget_reservations;
  rat_worker_request public.growth_intelligence_requests;
  rat_worker_request_id uuid;
  rat_existing private.growth_intelligence_research_attempt_ledger;
  rat_liability bigint;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role'
    and not private.has_organization_permission(p_organization_id, 'growth_intelligence.manage') then
    raise exception 'research_budget_forbidden' using errcode = '42501';
  end if;
  if not private.jsonb_object_has_exact_keys(p_work_scope, array['kind', 'id']::text[])
    or (p_work_scope ->> 'kind') not in ('pipeline', 'request')
    or coalesce(p_work_scope ->> 'id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_phase, '') not in ('research', 'synthesis')
    or pg_catalog.char_length(coalesce(p_slot_key, '')) not between 1 and 160
    or p_attempt_index is null
    or p_attempt_index not between 0 and 100
    or p_maximum_micros_usd is null
    or p_maximum_micros_usd not between 1 and 1000000
    or p_claim_token is null then
    raise exception 'research_budget_attempt_invalid' using errcode = '22023';
  end if;
  rat_scope_id := (p_work_scope ->> 'id')::uuid;
  if p_work_scope ->> 'kind' = 'pipeline' then
    select reservation.* into rat_reservation
    from private.growth_intelligence_research_budget_reservations reservation
    where reservation.organization_id = p_organization_id
      and reservation.pipeline_id = rat_scope_id
    for update;
    if not found then
      raise exception 'research_budget_no_reservation' using errcode = '42501';
    end if;
    select
      case when p_phase = 'research'
        then pipeline.research_request_id
        else pipeline.synthesis_request_id
      end into rat_worker_request_id
    from public.growth_intelligence_research_pipelines pipeline
    where pipeline.organization_id = p_organization_id
      and pipeline.id = rat_scope_id;
    if rat_worker_request_id is null then
      raise exception 'research_budget_no_worker_request' using errcode = '42501';
    end if;
  else
    select reservation.* into rat_reservation
    from private.growth_intelligence_research_budget_reservations reservation
    where reservation.organization_id = p_organization_id
      and reservation.request_id = rat_scope_id
    for update;
    if not found then
      raise exception 'research_budget_no_reservation' using errcode = '42501';
    end if;
    rat_worker_request_id := rat_scope_id;
  end if;
  if rat_reservation.status <> 'active' then
    raise exception 'research_budget_reservation_released' using errcode = '23505';
  end if;
  select request.* into rat_worker_request
  from public.growth_intelligence_requests request
  where request.organization_id = p_organization_id
    and request.id = rat_worker_request_id;
  if not found
    or rat_worker_request.status <> 'claimed'
    or rat_worker_request.claim_token is distinct from p_claim_token
    or rat_worker_request.lease_expires_at <= pg_catalog.now() then
    raise exception 'research_budget_lease_stale' using errcode = '42501';
  end if;
  if exists (
    select 1 from private.growth_intelligence_research_attempt_ledger attempt
    where attempt.organization_id = p_organization_id
      and attempt.reservation_id = rat_reservation.id
      and attempt.actual_micros_usd is not null
      and attempt.actual_micros_usd > attempt.maximum_micros_usd
  ) then
    raise exception 'research_budget_overrun_blocked' using errcode = '23505';
  end if;
  select attempt.* into rat_existing
  from private.growth_intelligence_research_attempt_ledger attempt
  where attempt.organization_id = p_organization_id
    and attempt.reservation_id = rat_reservation.id
    and attempt.phase = p_phase
    and attempt.slot_key = p_slot_key
    and attempt.attempt_index = p_attempt_index;
  if found then
    if rat_existing.maximum_micros_usd is distinct from p_maximum_micros_usd then
      raise exception 'research_budget_attempt_conflict' using errcode = '23505';
    end if;
    return pg_catalog.jsonb_build_object(
      'attemptId', rat_existing.id,
      'reservationId', rat_reservation.id,
      'allowanceDay', rat_reservation.allowance_day,
      'maximumMicrosUsd', rat_existing.maximum_micros_usd,
      'replayed', true
    );
  end if;
  select coalesce(pg_catalog.sum(
    case
      when attempt.status = 'reserved'
        or attempt.settlement_kind = 'unknown' then attempt.maximum_micros_usd
      else attempt.actual_micros_usd
    end
  ), 0)::bigint into rat_liability
  from private.growth_intelligence_research_attempt_ledger attempt
  where attempt.organization_id = p_organization_id
    and attempt.reservation_id = rat_reservation.id;
  if rat_liability + p_maximum_micros_usd > rat_reservation.quote_micros_usd then
    raise exception 'research_budget_reservation_exceeded' using errcode = '23505';
  end if;
  insert into private.growth_intelligence_research_attempt_ledger (
    organization_id, reservation_id, phase, slot_key, attempt_index, maximum_micros_usd
  ) values (
    p_organization_id, rat_reservation.id, p_phase, p_slot_key, p_attempt_index, p_maximum_micros_usd
  ) returning * into rat_existing;
  return pg_catalog.jsonb_build_object(
    'attemptId', rat_existing.id,
    'reservationId', rat_reservation.id,
    'allowanceDay', rat_reservation.allowance_day,
    'maximumMicrosUsd', rat_existing.maximum_micros_usd,
    'replayed', false
  );
end;
$$;

revoke all on function public.reserve_research_attempt(uuid, jsonb, text, text, integer, bigint, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.reserve_research_attempt(uuid, jsonb, text, text, integer, bigint, uuid)
  to authenticated, service_role;
