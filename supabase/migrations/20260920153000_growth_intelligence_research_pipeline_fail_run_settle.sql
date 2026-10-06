-- Bound-run failure settlement through the pipeline handoff.
--
-- Live canary run_06gc3fnb6ct9j50qcoegvrfl01 proved the fail path strands
-- bound work: the worker's failRun calls evidence.fail
-- (fail_market_research_run) first, but that legacy RPC refuses
-- pipeline-bound requests with market_research_pipeline_bypass_forbidden.
-- The throw lands inside failRun before requests.fail or failPipeline run,
-- so the request stays claimed and the pipeline stays queued forever. The
-- complete path is fine (it already uses completePipeline); only fail was
-- broken.
--
-- This adds an 8-argument overload of fail_market_research_pipeline that
-- settles the run row atomically with the request and pipeline. When
-- p_market_research_run_id is not null the run row moves to failed with the
-- worker's safe code and measured costs; an already-failed run with the same
-- code and costs replays true; a terminal run with different values
-- conflicts (23505). Cost/latency bounds mirror the TS boundary
-- (0..50000000 micros USD, 0..600000 ms). Every existing check, the
-- service_role-only grant, and the request/pipeline/audit behavior are
-- otherwise identical. The 6-argument overload is left untouched.

create or replace function public.fail_market_research_pipeline(
  p_organization_id uuid,
  p_pipeline_id uuid,
  p_request_id uuid,
  p_claim_token uuid,
  p_market_research_run_id uuid,
  p_safe_failure_code text,
  p_adapter_cost_micros_usd bigint,
  p_adapter_latency_ms integer
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
  frmp_run_replayed boolean := false;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    raise exception 'market_research_pipeline_worker_forbidden' using errcode = '42501';
  end if;
  if p_pipeline_id is null
    or p_request_id is null
    or p_claim_token is null
    or p_safe_failure_code is null
    or p_safe_failure_code !~ '^[A-Z][A-Z0-9_]{2,80}$'
    or p_adapter_cost_micros_usd is null
    or p_adapter_cost_micros_usd < 0
    or p_adapter_cost_micros_usd > 50000000
    or p_adapter_latency_ms is null
    or p_adapter_latency_ms < 0
    or p_adapter_latency_ms > 600000 then
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

  -- Bound-run settlement: the legacy run-level RPC refuses pipeline-bound
  -- requests, so the pipeline handoff owns the run row here. The request is
  -- already fenced above, so a lease loss aborts before any run mutation
  -- and the whole transaction stays atomic.
  if p_market_research_run_id is not null then
    select run.* into frmp_run
    from public.market_research_runs run
    where run.organization_id = p_organization_id
      and run.id = p_market_research_run_id
      and run.growth_intelligence_request_id = p_request_id
    for update;
    if not found then
      raise exception 'market_research_run_not_found' using errcode = '42501';
    end if;
    if frmp_run.status <> 'running' then
      if frmp_run.status = 'failed'
        and frmp_run.safe_failure_code = p_safe_failure_code
        and frmp_run.adapter_cost_micros_usd = p_adapter_cost_micros_usd
        and frmp_run.adapter_latency_ms = p_adapter_latency_ms then
        frmp_run_replayed := true;
      else
        raise exception 'market_research_run_terminal' using errcode = '23505';
      end if;
    else
      update public.market_research_runs run
      set status = 'failed',
          safe_failure_code = p_safe_failure_code,
          adapter_cost_micros_usd = p_adapter_cost_micros_usd,
          adapter_latency_ms = p_adapter_latency_ms,
          failed_at = pg_catalog.now()
      where run.organization_id = p_organization_id and run.id = frmp_run.id
      returning run.* into frmp_run;
    end if;
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
    'replayed', frmp_run_replayed
  );
end;
$$;

revoke all on function public.fail_market_research_pipeline(
  uuid, uuid, uuid, uuid, uuid, text, bigint, integer
) from public, anon, authenticated, service_role;
grant execute on function public.fail_market_research_pipeline(
  uuid, uuid, uuid, uuid, uuid, text, bigint, integer
) to service_role;
