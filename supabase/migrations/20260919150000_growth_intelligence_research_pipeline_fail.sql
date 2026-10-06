-- Research pipeline failure handoff.
--
-- The success path moves a bound pipeline through complete_market_research_pipeline,
-- but no failure counterpart existed: a worker that failed its request (blocked
-- provider, unavailable extraction, invalid scope) left the pipeline row in
-- queued/researching forever, so the workspace kept reporting "research is still
-- running" with no safe code. This closes that half of the handoff.
--
-- fail_market_research_pipeline fails the run's request through the existing
-- fail_growth_intelligence_request (lease-fenced, replay-safe) and moves a
-- non-terminal bound pipeline to research_failed with the worker's safe code,
-- plus a research_failed audit event. A terminal pipeline replays identically.
-- Scope currency is deliberately NOT re-checked: failure settlement must land
-- even for superseded scopes, mirroring fail_market_synthesis_pipeline.
-- Additive: one function, no table or constraint changes.

create function public.fail_market_research_pipeline(
  p_organization_id uuid,
  p_pipeline_id uuid,
  p_request_id uuid,
  p_claim_token uuid,
  p_market_research_run_id uuid,
  p_safe_failure_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  frmp_pipeline public.growth_intelligence_research_pipelines;
  frmp_request public.growth_intelligence_requests;
  frmp_run public.market_research_runs;
  frmp_inner jsonb;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    raise exception 'market_research_pipeline_worker_forbidden' using errcode = '42501';
  end if;
  if p_pipeline_id is null
    or p_request_id is null
    or p_claim_token is null
    or p_safe_failure_code is null
    or p_safe_failure_code !~ '^[A-Z][A-Z0-9_]{2,80}$' then
    raise exception 'market_research_pipeline_failure_invalid' using errcode = '22023';
  end if;

  -- Duplicate deliveries serialize on the pipeline, mirroring the completion
  -- path so a redelivered failure converges instead of double-settling.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.concat_ws(
      '|', 'growth_intelligence', 'research_pipeline_fail',
      p_organization_id, p_pipeline_id
    ),
    0
  ));

  select pipeline.* into frmp_pipeline
  from public.growth_intelligence_research_pipelines pipeline
  where pipeline.organization_id = p_organization_id
    and pipeline.id = p_pipeline_id
  for update;
  if not found then
    raise exception 'market_research_pipeline_not_found' using errcode = '42501';
  end if;
  if frmp_pipeline.stage not in ('queued', 'researching') then
    return pg_catalog.jsonb_build_object(
      'pipelineStage', frmp_pipeline.stage,
      'replayed', true
    );
  end if;

  select request.* into frmp_request
  from public.growth_intelligence_requests request
  where request.organization_id = p_organization_id
    and request.id = p_request_id
  for update;
  if not found
    or frmp_request.pipeline_id is distinct from p_pipeline_id
    or frmp_request.phase is distinct from 'research' then
    raise exception 'market_research_pipeline_request_mismatch' using errcode = '42501';
  end if;

  -- Pre-begin failures carry no run row; a supplied run id is ownership
  -- evidence only, never state the worker already settled.
  if p_market_research_run_id is not null then
    select run.* into frmp_run
    from public.market_research_runs run
    where run.organization_id = p_organization_id
      and run.id = p_market_research_run_id
      and run.growth_intelligence_request_id = p_request_id;
    if not found then
      raise exception 'market_research_run_not_found' using errcode = '42501';
    end if;
  end if;

  frmp_inner := public.fail_growth_intelligence_request(
    p_organization_id, p_request_id, p_claim_token, p_safe_failure_code
  );
  if frmp_inner ->> 'outcome' = 'claim_lost' then
    raise exception 'market_research_claim_lost' using errcode = '42501';
  end if;
  if frmp_inner ->> 'outcome' not in ('failed', 'already_finished') then
    raise exception 'market_research_request_failure_failed' using errcode = '42501';
  end if;

  update public.growth_intelligence_research_pipelines pipeline
  set stage = 'research_failed',
      safe_failure_code = p_safe_failure_code,
      stage_changed_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  where pipeline.organization_id = p_organization_id
    and pipeline.id = p_pipeline_id
  returning * into frmp_pipeline;

  insert into public.audit_events (
    organization_id, event_name, actor_type, actor_id, entity_type, entity_id,
    correlation_id, payload
  ) values (
    p_organization_id,
    'growth_intelligence.research_failed',
    'system'::public.audit_actor_type,
    null,
    'growth_intelligence_research_pipeline',
    p_pipeline_id,
    frmp_request.correlation_id,
    pg_catalog.jsonb_build_object(
      'pipelineId', p_pipeline_id,
      'stage', 'research_failed',
      'researchRequestId', p_request_id,
      'reason', p_safe_failure_code
    )
  );

  return pg_catalog.jsonb_build_object(
    'pipelineStage', 'research_failed',
    'replayed', false
  );
end;
$$;

revoke all on function public.fail_market_research_pipeline(
  uuid, uuid, uuid, uuid, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.fail_market_research_pipeline(
  uuid, uuid, uuid, uuid, uuid, text
) to service_role;
