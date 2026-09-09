-- Task 8 repair 4: cancelled work fences instead of conflicting.
--
-- A cancelled pipeline or child refused finalization with the terminal
-- conflict (23505), which reads as "retry" to callers. Cancelled work can
-- never become finalizable, so both synthesis RPCs now check for
-- cancellation first and refuse with the lease fence (42501): stop, never
-- redeliver. Replay and live paths are unchanged.

create or replace function public.complete_market_synthesis_pipeline(
  p_organization_id uuid,
  p_request_id uuid,
  p_claim_token uuid,
  p_synthesis_run_id uuid,
  p_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cmsp_pipeline public.growth_intelligence_research_pipelines;
  cmsp_request public.growth_intelligence_requests;
  cmsp_run public.growth_intelligence_synthesis_runs;
  cmsp_inner jsonb;
  cmsp_completion jsonb;
  cmsp_stage text;
  cmsp_fresh integer;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    raise exception 'growth_intelligence_synthesis_worker_forbidden' using errcode = '42501';
  end if;
  if p_request_id is null
    or p_claim_token is null
    or p_synthesis_run_id is null
    or pg_catalog.jsonb_typeof(p_result) <> 'object'
    or (p_result ->> 'outcome') <> 'completed'
    or (p_result ->> 'resultDigest') !~ '^[a-f0-9]{64}$'
    or pg_catalog.jsonb_typeof(p_result -> 'items') <> 'array'
    or pg_catalog.jsonb_array_length(p_result -> 'items') > 200 then
    raise exception 'growth_intelligence_synthesis_result_invalid' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.concat_ws(
      '|', 'growth_intelligence', 'synthesis_pipeline_complete',
      p_organization_id, p_request_id, p_claim_token
    ),
    0
  ));

  select request.* into cmsp_request
  from public.growth_intelligence_requests request
  where request.organization_id = p_organization_id
    and request.id = p_request_id
  for update;
  if not found
    or cmsp_request.pipeline_id is null
    or cmsp_request.phase is distinct from 'synthesis' then
    raise exception 'market_synthesis_pipeline_child_invalid' using errcode = '42501';
  end if;

  select pipeline.* into cmsp_pipeline
  from public.growth_intelligence_research_pipelines pipeline
  where pipeline.organization_id = p_organization_id
    and pipeline.id = cmsp_request.pipeline_id
  for update;
  if not found then
    raise exception 'market_research_pipeline_not_found' using errcode = '42501';
  end if;

  -- Cancelled work fences, never conflicts: a replaced pipeline cannot
  -- become finalizable, so late deliveries stop instead of retrying.
  if cmsp_request.status = 'cancelled'
    or cmsp_pipeline.stage = 'cancelled' then
    raise exception 'growth_intelligence_synthesis_claim_lost' using errcode = '42501';
  end if;

  -- Replay precedes the lease gate, mirroring the research handoff: a
  -- committed finalization answers every duplicate child execution
  -- identically, even though its request already succeeded. Lock order
  -- stays request, pipeline, run in both synthesis RPCs; the research
  -- handoff cannot interleave because the child only exists after it
  -- commits.
  select run.* into cmsp_run
  from public.growth_intelligence_synthesis_runs run
  where run.organization_id = p_organization_id
    and run.id = p_synthesis_run_id
    and run.growth_intelligence_request_id = p_request_id;
  if found and cmsp_run.status <> 'running' then
    if cmsp_run.status = 'completed'
      and cmsp_run.result_digest = p_result ->> 'resultDigest'
      and cmsp_request.status = 'succeeded'
      and cmsp_pipeline.stage in ('ready', 'partial') then
      return pg_catalog.jsonb_build_object(
        'runId', cmsp_run.id,
        'itemCount', cmsp_run.item_count,
        'supersededItemIds', pg_catalog.jsonb_build_array(),
        'pipelineStage', cmsp_pipeline.stage,
        'replayed', true
      );
    end if;
    raise exception 'growth_intelligence_synthesis_run_terminal' using errcode = '23505';
  end if;
  if not found then
    raise exception 'growth_intelligence_synthesis_run_not_running' using errcode = '22023';
  end if;

  -- The claim gate doubles as the cancellation fence: a replaced or
  -- cancelled child is no longer claimed, so late deliveries refuse here
  -- with no writes, while spend receipts still reconcile through settle.
  perform private.assert_growth_intelligence_synthesis_claim(
    p_organization_id, p_request_id, p_claim_token
  );

  select run.* into cmsp_run
  from public.growth_intelligence_synthesis_runs run
  where run.organization_id = p_organization_id
    and run.id = p_synthesis_run_id
    and run.growth_intelligence_request_id = p_request_id
    and run.claim_token = p_claim_token
  for update;
  if not found then
    raise exception 'growth_intelligence_synthesis_run_not_running' using errcode = '22023';
  end if;
  if cmsp_run.status <> 'running' then
    raise exception 'growth_intelligence_synthesis_run_terminal' using errcode = '23505';
  end if;

  if cmsp_pipeline.stage <> 'preparing_insights' then
    raise exception 'market_research_pipeline_terminal' using errcode = '23505';
  end if;

  -- Scope and freshness are re-checked at finalization: a moved profile or
  -- fully stale evidence refuses persisted output, never silently ages it.
  if cmsp_request.market_profile_version_id is distinct from
    cmsp_pipeline.market_profile_version_id then
    raise exception 'market_research_pipeline_scope_mismatch' using errcode = '42501';
  end if;
  perform private.assert_research_pipeline_scope(p_organization_id, cmsp_pipeline);
  select pg_catalog.count(*)::integer into cmsp_fresh
  from public.market_evidence_claims claim
  where claim.organization_id = p_organization_id
    and claim.market_profile_version_id = cmsp_pipeline.market_profile_version_id
    and public.market_evidence_claim_current_state(
      p_organization_id, claim.id
    ) = 'current';
  if cmsp_fresh < 1 then
    raise exception 'market_synthesis_evidence_stale' using errcode = '42501';
  end if;

  -- No budget gate here: the synthesis call was already admitted through
  -- the pipeline reservation before it ran, and finalizing adds no spend.
  -- Recorded overruns never strand ready output; they block new calls at
  -- reserve time instead.
  cmsp_inner := public.complete_growth_intelligence_synthesis(
    p_organization_id, p_request_id, p_claim_token, p_synthesis_run_id, p_result
  );

  cmsp_completion := public.complete_growth_intelligence_request(
    p_organization_id, p_request_id, p_claim_token
  );
  if cmsp_completion ->> 'outcome' <> 'completed' then
    raise exception 'market_synthesis_request_completion_failed' using errcode = '42501';
  end if;

  -- A partial research run carries its limitations into synthesis: any
  -- non-supported coverage entry ends the pipeline partial, never ready.
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(cmsp_pipeline.coverage) as entry(value)
    where entry.value ->> 'outcome' <> 'supported'
  ) then
    cmsp_stage := 'partial';
  else
    cmsp_stage := 'ready';
  end if;

  update public.growth_intelligence_research_pipelines pipeline
  set stage = cmsp_stage,
      stage_changed_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  where pipeline.organization_id = p_organization_id
    and pipeline.id = cmsp_pipeline.id
  returning * into cmsp_pipeline;

  insert into public.audit_events (
    organization_id, event_name, actor_type, actor_id, entity_type, entity_id,
    correlation_id, payload
  ) values (
    p_organization_id,
    'growth_intelligence.research_finished',
    'system'::public.audit_actor_type,
    null,
    'growth_intelligence_research_pipeline',
    cmsp_pipeline.id,
    cmsp_request.correlation_id,
    pg_catalog.jsonb_build_object(
      'pipelineId', cmsp_pipeline.id,
      'stage', cmsp_stage,
      'synthesisRequestId', p_request_id,
      'itemCount', (cmsp_inner ->> 'itemCount')::integer
    )
  );

  return pg_catalog.jsonb_build_object(
    'runId', cmsp_run.id,
    'itemCount', (cmsp_inner ->> 'itemCount')::integer,
    'supersededItemIds', cmsp_inner -> 'supersededItemIds',
    'pipelineStage', cmsp_stage,
    'replayed', false
  );
end;
$$;

revoke all on function public.complete_market_synthesis_pipeline(uuid, uuid, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_market_synthesis_pipeline(uuid, uuid, uuid, uuid, jsonb)
  to service_role;

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

  -- Cancelled work fences, never conflicts (see the finalize RPC above).
  if fmsp_request.status = 'cancelled'
    or fmsp_pipeline.stage = 'cancelled' then
    raise exception 'growth_intelligence_synthesis_claim_lost' using errcode = '42501';
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
