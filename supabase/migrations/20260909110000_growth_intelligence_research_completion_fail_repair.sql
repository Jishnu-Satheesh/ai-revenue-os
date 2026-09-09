-- Task 8 repair 2: the inner synthesis fail already fails the request.
--
-- fail_growth_intelligence_synthesis marks its run failed AND fails the
-- request in the same call. This RPC called fail_growth_intelligence_request
-- a second time, which answered already_finished and tripped the outcome
-- check. The redundant call is removed: the RPC now verifies the request
-- reached failed after the inner call instead of transitioning it twice.
-- No other behavior changes.

create or replace function public.fail_market_synthesis_pipeline(
  p_organization_id uuid,
  p_request_id uuid,
  p_claim_token uuid,
  p_synthesis_run_id uuid,
  p_safe_failure_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  fmsp_pipeline public.growth_intelligence_research_pipelines;
  fmsp_request public.growth_intelligence_requests;
  fmsp_run public.growth_intelligence_synthesis_runs;
  fmsp_inner jsonb;
  fmsp_request_status text;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    raise exception 'growth_intelligence_synthesis_worker_forbidden' using errcode = '42501';
  end if;
  if p_request_id is null
    or p_claim_token is null
    or p_synthesis_run_id is null
    or p_safe_failure_code !~ '^[A-Z][A-Z0-9_]{2,80}$' then
    raise exception 'growth_intelligence_synthesis_failure_invalid' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.concat_ws(
      '|', 'growth_intelligence', 'synthesis_pipeline_fail',
      p_organization_id, p_request_id, p_claim_token
    ),
    0
  ));

  select request.* into fmsp_request
  from public.growth_intelligence_requests request
  where request.organization_id = p_organization_id
    and request.id = p_request_id
  for update;
  if not found
    or fmsp_request.pipeline_id is null
    or fmsp_request.phase is distinct from 'synthesis' then
    raise exception 'market_synthesis_pipeline_child_invalid' using errcode = '42501';
  end if;

  select pipeline.* into fmsp_pipeline
  from public.growth_intelligence_research_pipelines pipeline
  where pipeline.organization_id = p_organization_id
    and pipeline.id = fmsp_request.pipeline_id
  for update;
  if not found then
    raise exception 'market_research_pipeline_not_found' using errcode = '42501';
  end if;
  if fmsp_pipeline.stage <> 'preparing_insights'
    and not (
      fmsp_pipeline.stage = 'synthesis_failed'
      and fmsp_request.status = 'failed'
    ) then
    raise exception 'market_research_pipeline_terminal' using errcode = '23505';
  end if;

  -- Replay precedes the lease gate: a recorded failure answers duplicates
  -- identically after its request already failed.
  select run.* into fmsp_run
  from public.growth_intelligence_synthesis_runs run
  where run.organization_id = p_organization_id
    and run.id = p_synthesis_run_id
    and run.growth_intelligence_request_id = p_request_id;
  if found and fmsp_run.status <> 'running' then
    if fmsp_run.status = 'failed'
      and fmsp_run.safe_failure_code = p_safe_failure_code then
      return pg_catalog.jsonb_build_object(
        'runId', fmsp_run.id,
        'pipelineStage', fmsp_pipeline.stage,
        'replayed', true
      );
    end if;
    raise exception 'growth_intelligence_synthesis_run_terminal' using errcode = '23505';
  end if;
  if not found then
    raise exception 'growth_intelligence_synthesis_run_not_running' using errcode = '22023';
  end if;

  perform private.assert_growth_intelligence_synthesis_claim(
    p_organization_id, p_request_id, p_claim_token
  );

  select run.* into fmsp_run
  from public.growth_intelligence_synthesis_runs run
  where run.organization_id = p_organization_id
    and run.id = p_synthesis_run_id
    and run.growth_intelligence_request_id = p_request_id
    and run.claim_token = p_claim_token
  for update;
  if not found then
    raise exception 'growth_intelligence_synthesis_run_not_running' using errcode = '22023';
  end if;
  if fmsp_run.status <> 'running' then
    raise exception 'growth_intelligence_synthesis_run_terminal' using errcode = '23505';
  end if;

  -- The inner call fails the run and the request together; this RPC only
  -- verifies the request landed failed instead of transitioning it twice.
  fmsp_inner := public.fail_growth_intelligence_synthesis(
    p_organization_id, p_request_id, p_claim_token, p_synthesis_run_id, p_safe_failure_code
  );
  select request.status into fmsp_request_status
  from public.growth_intelligence_requests request
  where request.organization_id = p_organization_id
    and request.id = p_request_id;
  if fmsp_request_status is distinct from 'failed' then
    raise exception 'market_synthesis_request_failure_failed' using errcode = '42501';
  end if;

  -- Findings stay retained: only the pipeline envelope records the failure,
  -- so an operator retry reuses the same immutable evidence.
  update public.growth_intelligence_research_pipelines pipeline
  set stage = 'synthesis_failed',
      safe_failure_code = p_safe_failure_code,
      stage_changed_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  where pipeline.organization_id = p_organization_id
    and pipeline.id = fmsp_pipeline.id
  returning * into fmsp_pipeline;

  return pg_catalog.jsonb_build_object(
    'runId', fmsp_run.id,
    'pipelineStage', 'synthesis_failed',
    'replayed', false
  );
end;
$$;

revoke all on function public.fail_market_synthesis_pipeline(uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.fail_market_synthesis_pipeline(uuid, uuid, uuid, uuid, text)
  to service_role;
