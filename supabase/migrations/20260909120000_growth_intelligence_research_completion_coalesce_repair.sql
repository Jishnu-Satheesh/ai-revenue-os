-- Task 8 repair 3: COALESCE is syntax, not a catalog function.
--
-- The retry liability query called pg_catalog.coalesce, which does not
-- exist (COALESCE cannot be schema-qualified). CREATE FUNCTION does not
-- plan plpgsql bodies, so the push succeeded and the call failed at
-- runtime. This replacement uses bare COALESCE like every other fenced
-- RPC. No other behavior changes.

create or replace function public.retry_market_research_synthesis(
  p_organization_id uuid,
  p_pipeline_id uuid,
  p_actor_id uuid,
  p_idempotency_key text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  rmrs_pipeline public.growth_intelligence_research_pipelines;
  rmrs_child public.growth_intelligence_requests;
  rmrs_operation private.growth_intelligence_write_operations;
  rmrs_fingerprint text;
  rmrs_reservation private.growth_intelligence_research_budget_reservations;
  rmrs_liability bigint;
  rmrs_fresh integer;
begin
  if (select auth.uid()) is distinct from p_actor_id
    or not private.has_organization_permission(p_organization_id, 'growth_intelligence.manage') then
    raise exception 'growth_intelligence_retry_forbidden' using errcode = '42501';
  end if;
  if p_pipeline_id is null
    or pg_catalog.char_length(p_idempotency_key) not between 16 and 200
    or p_correlation_id is null then
    raise exception 'growth_intelligence_retry_invalid' using errcode = '22023';
  end if;

  rmrs_fingerprint := pg_catalog.encode(
    extensions.digest(
      'market_research_synthesis_retry|' || p_pipeline_id::text,
      'sha256'
    ),
    'hex'
  );
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.concat_ws(
      '|', 'growth_intelligence', 'retry_synthesis', p_organization_id, p_idempotency_key
    ),
    0
  ));
  select stored.* into rmrs_operation
  from private.growth_intelligence_write_operations stored
  where stored.organization_id = p_organization_id
    and stored.operation_kind = 'retry_request'
    and stored.idempotency_key = p_idempotency_key
  for update;
  if found then
    if rmrs_operation.operation_fingerprint is distinct from rmrs_fingerprint then
      raise exception 'growth_intelligence_retry_idempotency_conflict' using errcode = '23505';
    end if;
    select request.* into rmrs_child
    from public.growth_intelligence_requests request
    where request.organization_id = p_organization_id
      and request.id = rmrs_operation.request_id;
    return pg_catalog.jsonb_build_object(
      'requestId', rmrs_child.id, 'status', rmrs_child.status,
      'outcome', 'retried', 'replayed', true
    );
  end if;

  select pipeline.* into rmrs_pipeline
  from public.growth_intelligence_research_pipelines pipeline
  where pipeline.organization_id = p_organization_id
    and pipeline.id = p_pipeline_id
  for update;
  if not found then
    raise exception 'market_research_pipeline_not_found' using errcode = '42501';
  end if;
  if rmrs_pipeline.stage <> 'synthesis_failed' then
    raise exception 'market_research_synthesis_not_retryable' using errcode = '23514';
  end if;

  select request.* into rmrs_child
  from public.growth_intelligence_requests request
  where request.organization_id = p_organization_id
    and request.pipeline_id = p_pipeline_id
    and request.phase = 'synthesis'
  for update;
  if not found then
    raise exception 'market_research_synthesis_retry_invalid' using errcode = '55000';
  end if;
  if rmrs_child.status <> 'failed' then
    raise exception 'market_research_synthesis_not_retryable' using errcode = '23514';
  end if;

  -- A retry reuses the pipeline's scope and evidence: a moved profile or
  -- fully stale evidence requires new research, not another analysis call.
  if rmrs_child.market_profile_version_id is distinct from
    rmrs_pipeline.market_profile_version_id then
    raise exception 'market_research_pipeline_scope_mismatch' using errcode = '42501';
  end if;
  perform private.assert_research_pipeline_scope(p_organization_id, rmrs_pipeline);
  select pg_catalog.count(*)::integer into rmrs_fresh
  from public.market_evidence_claims claim
  where claim.organization_id = p_organization_id
    and claim.market_profile_version_id = rmrs_pipeline.market_profile_version_id
    and public.market_evidence_claim_current_state(
      p_organization_id, claim.id
    ) = 'current';
  if rmrs_fresh < 1 then
    raise exception 'market_research_synthesis_evidence_stale' using errcode = '42501';
  end if;

  -- The retry's second synthesis call rides the pipeline's prequoted
  -- reservation: qualification, an active quote, no recorded overrun, and
  -- unconsumed headroom. The per-call fence at reserve time stays
  -- authoritative for the actual call.
  perform private.assert_research_provider_qualified();
  select reservation.* into rmrs_reservation
  from private.growth_intelligence_research_budget_reservations reservation
  where reservation.organization_id = p_organization_id
    and reservation.pipeline_id = p_pipeline_id
  for update;
  if not found or rmrs_reservation.status <> 'active' then
    raise exception 'market_research_synthesis_retry_not_prequoted' using errcode = '42501';
  end if;
  if exists (
    select 1 from private.growth_intelligence_research_attempt_ledger attempt
    where attempt.organization_id = p_organization_id
      and attempt.reservation_id = rmrs_reservation.id
      and attempt.actual_micros_usd is not null
      and attempt.actual_micros_usd > attempt.maximum_micros_usd
  ) then
    raise exception 'market_research_synthesis_retry_budget_exhausted' using errcode = '23505';
  end if;
  select coalesce(sum(
    case
      when attempt.status = 'reserved'
        or attempt.settlement_kind = 'unknown' then attempt.maximum_micros_usd
      else coalesce(attempt.actual_micros_usd, attempt.maximum_micros_usd)
    end
  ), 0)::bigint into rmrs_liability
  from private.growth_intelligence_research_attempt_ledger attempt
  where attempt.organization_id = p_organization_id
    and attempt.reservation_id = rmrs_reservation.id;
  if rmrs_liability >= rmrs_reservation.quote_micros_usd then
    raise exception 'market_research_synthesis_retry_budget_exhausted' using errcode = '23505';
  end if;

  update public.growth_intelligence_requests
  set status = 'pending', due_at = pg_catalog.now(), safe_failure_code = null,
      failed_at = null, claim_token = null, lease_expires_at = null,
      last_dispatch_attempt_at = null,
      last_transition_actor_type = 'user', last_transition_actor_id = p_actor_id,
      correlation_id = p_correlation_id
  where organization_id = p_organization_id and id = rmrs_child.id
  returning * into rmrs_child;

  update public.growth_intelligence_research_pipelines pipeline
  set stage = 'preparing_insights',
      stage_changed_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  where pipeline.organization_id = p_organization_id
    and pipeline.id = p_pipeline_id
  returning * into rmrs_pipeline;

  insert into private.growth_intelligence_write_operations (
    organization_id, operation_kind, idempotency_key, operation_fingerprint, request_id
  ) values (
    p_organization_id, 'retry_request', p_idempotency_key, rmrs_fingerprint, rmrs_child.id
  );

  insert into public.audit_events (
    organization_id, event_name, actor_type, actor_id, entity_type, entity_id,
    correlation_id, payload
  ) values (
    p_organization_id,
    'growth_intelligence.research_retried',
    'user'::public.audit_actor_type,
    p_actor_id,
    'growth_intelligence_research_pipeline',
    p_pipeline_id,
    p_correlation_id,
    pg_catalog.jsonb_build_object(
      'pipelineId', p_pipeline_id,
      'stage', 'preparing_insights',
      'synthesisRequestId', rmrs_child.id
    )
  );

  return pg_catalog.jsonb_build_object(
    'requestId', rmrs_child.id, 'status', rmrs_child.status,
    'outcome', 'retried', 'replayed', false
  );
end;
$$;

revoke all on function public.retry_market_research_synthesis(uuid, uuid, uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.retry_market_research_synthesis(uuid, uuid, uuid, text, uuid)
  to authenticated;
