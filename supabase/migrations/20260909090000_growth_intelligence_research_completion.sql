-- Task 8: atomic research-to-synthesis handoff and recoverable synthesis.
--
-- The research worker saves evidence outside any transaction. These fenced
-- operations own the crash window between saved research, analysis
-- scheduling and terminal output:
--
-- 1. complete_market_research_pipeline locks run, request and pipeline,
--    re-checks lease, branch/profile scope and eligible PERSISTED claims,
--    then in one transaction completes the run and request, inserts the
--    unique market_evidence_changed child and moves the pipeline to
--    preparing_insights (or no_findings when zero eligible claims remain).
--    Replay returns the same child; stale leases, superseded scopes and
--    terminal conflicts cannot mutate success.
-- 2. retry_market_research_synthesis requeues the same failed synthesis
--    child after scope, freshness and prequoted-budget checks. Never
--    refetches research; no paid search rides a synthesis retry.
-- 3. complete_market_synthesis_pipeline finalizes synthesis items, the
--    child request and the terminal pipeline stage in one transaction.
-- 4. fail_market_synthesis_pipeline fails run, request and pipeline
--    together, so a failed analysis always lands the pipeline in
--    synthesis_failed with its findings retained.
--
-- The legacy run completion RPCs refuse pipeline-bound runs so a stale
-- worker cannot bypass the handoff, and the due scheduler skips poison
-- scopes (unique/poison-object conflicts) instead of aborting the sweep.

-- The handoff child is a new request kind -----------------------------------

alter table public.growth_intelligence_requests
  drop constraint growth_intelligence_requests_kind_check;
alter table public.growth_intelligence_requests
  add constraint growth_intelligence_requests_kind_check
  check (kind in (
    'profile_discovery', 'market_research', 'market_evidence_changed',
    'weekly_synthesis', 'business_evidence_changed', 'evidence_reassessment'
  ));

alter table public.growth_intelligence_requests
  drop constraint growth_intelligence_requests_trigger_reason_check;
alter table public.growth_intelligence_requests
  add constraint growth_intelligence_requests_trigger_reason_check
  check (trigger_reason in (
    'profile_confirmed', 'profile_revised', 'daily_due', 'weekly_due',
    'business_evidence_current', 'market_research_completed',
    'source_policy_changed', 'evidence_expired', 'source_changed',
    'manual_retry'
  ));

-- enqueue_growth_intelligence_request keeps its narrower kind/reason lists
-- on purpose: only this handoff mints market_evidence_changed children, so
-- any other path attempting one fails closed at the enqueue boundary.

-- Shared scope fence ----------------------------------------------------------

create function private.assert_research_pipeline_scope(
  p_organization_id uuid,
  p_pipeline public.growth_intelligence_research_pipelines
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  scope_profile public.organization_market_profiles;
begin
  select profile.* into scope_profile
  from public.organization_market_profiles profile
  where profile.organization_id = p_organization_id
    and profile.id = p_pipeline.market_profile_id;
  if not found
    or not scope_profile.enabled
    or scope_profile.current_version_id is distinct from p_pipeline.market_profile_version_id then
    raise exception 'market_research_pipeline_superseded' using errcode = '42501';
  end if;
end;
$$;

revoke all on function private.assert_research_pipeline_scope(
  uuid, public.growth_intelligence_research_pipelines
) from public, anon, authenticated, service_role;

-- Atomic research completion + synthesis scheduling ----------------------------

create function public.complete_market_research_pipeline(
  p_organization_id uuid,
  p_pipeline_id uuid,
  p_market_research_run_id uuid,
  p_request_id uuid,
  p_claim_token uuid,
  p_result jsonb,
  p_coverage jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cmrp_pipeline public.growth_intelligence_research_pipelines;
  cmrp_request public.growth_intelligence_requests;
  cmrp_run public.market_research_runs;
  cmrp_child public.growth_intelligence_requests;
  cmrp_canonical_fingerprint text;
  cmrp_child_fingerprint text;
  cmrp_eligible integer;
  cmrp_recorded_source_count integer;
  cmrp_recorded_success_count integer;
  cmrp_completion jsonb;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    raise exception 'market_research_pipeline_worker_forbidden' using errcode = '42501';
  end if;
  if p_pipeline_id is null
    or p_market_research_run_id is null
    or p_request_id is null
    or p_claim_token is null then
    raise exception 'market_research_pipeline_completion_invalid' using errcode = '22023';
  end if;
  perform private.assert_market_research_result(p_result);
  perform private.assert_research_pipeline_coverage(p_coverage);

  -- Duplicate deliveries serialize on the pipeline, not on each row.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.concat_ws(
      '|', 'growth_intelligence', 'research_pipeline_complete',
      p_organization_id, p_pipeline_id
    ),
    0
  ));

  select pipeline.* into cmrp_pipeline
  from public.growth_intelligence_research_pipelines pipeline
  where pipeline.organization_id = p_organization_id
    and pipeline.id = p_pipeline_id
  for update;
  if not found then
    raise exception 'market_research_pipeline_not_found' using errcode = '42501';
  end if;

  select request.* into cmrp_request
  from public.growth_intelligence_requests request
  where request.organization_id = p_organization_id
    and request.id = p_request_id
  for update;
  if not found
    or cmrp_request.pipeline_id is distinct from p_pipeline_id
    or cmrp_request.phase is distinct from 'research' then
    raise exception 'market_research_pipeline_request_mismatch' using errcode = '42501';
  end if;

  -- Replay precedes the lease gate, mirroring the legacy completion path:
  -- a committed handoff answers every duplicate delivery identically.
  select run.* into cmrp_run
  from public.market_research_runs run
  where run.organization_id = p_organization_id
    and run.id = p_market_research_run_id
    and run.growth_intelligence_request_id = p_request_id;
  if found and cmrp_run.status <> 'running' then
    if cmrp_run.status = p_result ->> 'outcome'
      and cmrp_run.result_digest = p_result ->> 'resultDigest'
      and cmrp_run.adapter_cost_micros_usd = (p_result ->> 'adapterCostMicrosUsd')::bigint
      and cmrp_run.adapter_latency_ms = (p_result ->> 'adapterLatencyMs')::integer then
      select child.* into cmrp_child
      from public.growth_intelligence_requests child
      where child.organization_id = p_organization_id
        and child.pipeline_id = p_pipeline_id
        and child.phase = 'synthesis';
      select pg_catalog.count(*)::integer into cmrp_eligible
      from public.market_evidence_claims claim
      where claim.organization_id = p_organization_id
        and claim.market_research_run_id = cmrp_run.id
        and public.market_evidence_claim_current_state(
          p_organization_id, claim.id
        ) in ('current', 'stale');
      return pg_catalog.jsonb_build_object(
        'runId', cmrp_run.id,
        'pipelineStage', cmrp_pipeline.stage,
        'synthesisRequestId', case when found then cmrp_child.id else null end,
        'eligibleClaimCount', cmrp_eligible,
        'replayed', true
      );
    end if;
    raise exception 'market_research_run_terminal' using errcode = '23505';
  end if;

  -- Stale leases (expiry or same-branch replacement, which cancels the
  -- claimed request) end here with no mutation.
  if cmrp_request.status <> 'claimed'
    or cmrp_request.claim_token is distinct from p_claim_token
    or cmrp_request.lease_expires_at <= pg_catalog.now() then
    raise exception 'market_research_claim_lost' using errcode = '42501';
  end if;
  if cmrp_pipeline.stage not in ('queued', 'researching') then
    raise exception 'market_research_pipeline_terminal' using errcode = '23505';
  end if;

  -- The pipeline's profile version must still be current and enabled, and
  -- the request must belong to that same version. A confirmed replacement
  -- scope refuses the old run's output instead of scheduling stale analysis.
  if cmrp_request.market_profile_version_id is distinct from
    cmrp_pipeline.market_profile_version_id then
    raise exception 'market_research_pipeline_scope_mismatch' using errcode = '42501';
  end if;
  perform private.assert_research_pipeline_scope(p_organization_id, cmrp_pipeline);

  select run.* into cmrp_run
  from public.market_research_runs run
  where run.organization_id = p_organization_id
    and run.id = p_market_research_run_id
    and run.growth_intelligence_request_id = p_request_id
    and run.claim_token = p_claim_token
  for update;
  if not found then
    raise exception 'market_research_run_not_found' using errcode = '42501';
  end if;
  if cmrp_run.status <> 'running' then
    raise exception 'market_research_run_terminal' using errcode = '23505';
  end if;

  select pg_catalog.count(*)::integer,
    pg_catalog.count(*) filter (where source.availability = 'available')::integer
  into cmrp_recorded_source_count, cmrp_recorded_success_count
  from public.market_evidence_sources source
  where source.organization_id = p_organization_id
    and source.market_research_run_id = cmrp_run.id;
  if cmrp_recorded_source_count <> (p_result ->> 'sourceAttemptCount')::integer
    or cmrp_recorded_success_count <> (p_result ->> 'sourceSuccessCount')::integer then
    raise exception 'market_research_result_source_count_mismatch' using errcode = '22023';
  end if;

  -- Eligibility comes from persisted claims in a citable state, never from
  -- a worker-supplied count. Freshly persisted supported claims are
  -- current; stale-but-supported keeps its verdict for coverage honesty.
  select pg_catalog.count(*)::integer into cmrp_eligible
  from public.market_evidence_claims claim
  where claim.organization_id = p_organization_id
    and claim.market_research_run_id = cmrp_run.id
    and public.market_evidence_claim_current_state(
      p_organization_id, claim.id
    ) in ('current', 'stale');

  update public.market_research_runs
  set status = p_result ->> 'outcome',
      result_digest = p_result ->> 'resultDigest',
      source_attempt_count = (p_result ->> 'sourceAttemptCount')::integer,
      source_success_count = (p_result ->> 'sourceSuccessCount')::integer,
      adapter_cost_micros_usd = (p_result ->> 'adapterCostMicrosUsd')::bigint,
      adapter_latency_ms = (p_result ->> 'adapterLatencyMs')::integer,
      completed_at = pg_catalog.now()
  where organization_id = p_organization_id and id = cmrp_run.id
  returning * into cmrp_run;

  cmrp_completion := public.complete_growth_intelligence_request(
    p_organization_id, p_request_id, p_claim_token
  );
  if cmrp_completion ->> 'outcome' <> 'completed' then
    raise exception 'market_research_request_completion_failed' using errcode = '42501';
  end if;

  if cmrp_eligible > 0 then
    -- One unique child per pipeline. The canonical work identity binds the
    -- pipeline id the way deliberate reruns scope their own requests, so a
    -- later pipeline on identical scope never collides on the fingerprint.
    cmrp_canonical_fingerprint :=
      private.create_growth_intelligence_request_fingerprint(
        p_organization_id,
        cmrp_request.branch_id,
        cmrp_request.channel_id,
        'market_evidence_changed',
        'market_research_completed',
        null,
        cmrp_request.market_profile_version_id,
        cmrp_request.source_policy_digest,
        cmrp_request.research_rule_version,
        'immediate',
        null,
        null
      );
    cmrp_child_fingerprint := pg_catalog.encode(
      extensions.digest(
        cmrp_canonical_fingerprint || '|' || p_pipeline_id::text,
        'sha256'
      ),
      'hex'
    );
    insert into public.growth_intelligence_requests (
      organization_id, branch_id, channel_id, kind, trigger_reason,
      request_fingerprint, business_evidence_digest, market_profile_version_id,
      source_policy_digest, research_rule_version, local_time_bucket,
      synthesis_version_tuple, playbook_version_tuple, due_at, requested_by,
      last_transition_actor_type, last_transition_actor_id, correlation_id,
      pipeline_id, phase
    ) values (
      p_organization_id,
      cmrp_request.branch_id,
      cmrp_request.channel_id,
      'market_evidence_changed',
      'market_research_completed',
      cmrp_child_fingerprint,
      null,
      cmrp_request.market_profile_version_id,
      cmrp_request.source_policy_digest,
      cmrp_request.research_rule_version,
      'immediate',
      null,
      null,
      pg_catalog.now(),
      null,
      'system'::public.audit_actor_type,
      null,
      cmrp_request.correlation_id,
      p_pipeline_id,
      'synthesis'
    ) returning * into cmrp_child;

    update public.growth_intelligence_research_pipelines pipeline
    set stage = 'preparing_insights',
        synthesis_request_id = cmrp_child.id,
        coverage = p_coverage,
        stage_changed_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    where pipeline.organization_id = p_organization_id
      and pipeline.id = p_pipeline_id
    returning * into cmrp_pipeline;

    insert into public.audit_events (
      organization_id, event_name, actor_type, actor_id, entity_type, entity_id,
      correlation_id, payload
    ) values (
      p_organization_id,
      'growth_intelligence.research_prepared',
      'system'::public.audit_actor_type,
      null,
      'growth_intelligence_research_pipeline',
      p_pipeline_id,
      cmrp_request.correlation_id,
      pg_catalog.jsonb_build_object(
        'pipelineId', p_pipeline_id,
        'stage', 'preparing_insights',
        'researchRequestId', p_request_id,
        'synthesisRequestId', cmrp_child.id,
        'eligibleClaimCount', cmrp_eligible
      )
    );

    return pg_catalog.jsonb_build_object(
      'runId', cmrp_run.id,
      'pipelineStage', 'preparing_insights',
      'synthesisRequestId', cmrp_child.id,
      'eligibleClaimCount', cmrp_eligible,
      'replayed', false
    );
  end if;

  update public.growth_intelligence_research_pipelines pipeline
  set stage = 'no_findings',
      safe_failure_code = 'NO_ELIGIBLE_FINDINGS',
      coverage = p_coverage,
      stage_changed_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  where pipeline.organization_id = p_organization_id
    and pipeline.id = p_pipeline_id
  returning * into cmrp_pipeline;

  insert into public.audit_events (
    organization_id, event_name, actor_type, actor_id, entity_type, entity_id,
    correlation_id, payload
  ) values (
    p_organization_id,
    'growth_intelligence.research_prepared',
    'system'::public.audit_actor_type,
    null,
    'growth_intelligence_research_pipeline',
    p_pipeline_id,
    cmrp_request.correlation_id,
    pg_catalog.jsonb_build_object(
      'pipelineId', p_pipeline_id,
      'stage', 'no_findings',
      'researchRequestId', p_request_id,
      'reason', 'NO_ELIGIBLE_FINDINGS',
      'eligibleClaimCount', 0
    )
  );

  return pg_catalog.jsonb_build_object(
    'runId', cmrp_run.id,
    'pipelineStage', 'no_findings',
    'synthesisRequestId', null,
    'eligibleClaimCount', 0,
    'replayed', false
  );
end;
$$;

revoke all on function public.complete_market_research_pipeline(
  uuid, uuid, uuid, uuid, uuid, jsonb, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.complete_market_research_pipeline(
  uuid, uuid, uuid, uuid, uuid, jsonb, jsonb
) to service_role;

-- Governed analysis-only retry --------------------------------------------------

create function public.retry_market_research_synthesis(
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
  select pg_catalog.coalesce(pg_catalog.sum(
    case
      when attempt.status = 'reserved'
        or attempt.settlement_kind = 'unknown' then attempt.maximum_micros_usd
      else pg_catalog.coalesce(attempt.actual_micros_usd, attempt.maximum_micros_usd)
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

-- Atomic synthesis finalization --------------------------------------------------

create function public.complete_market_synthesis_pipeline(
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

  -- The claim gate doubles as the cancellation fence: a replaced or
  -- cancelled child is no longer claimed, so late deliveries refuse here
  -- with no writes, while spend receipts still reconcile through settle.
  perform private.assert_growth_intelligence_synthesis_claim(
    p_organization_id, p_request_id, p_claim_token
  );

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

  select run.* into cmsp_run
  from public.growth_intelligence_synthesis_runs run
  where run.organization_id = p_organization_id
    and run.id = p_synthesis_run_id
    and run.growth_intelligence_request_id = p_request_id
    and run.claim_token = p_claim_token;
  -- Duplicate child execution replays the committed outcome: the run digest
  -- identifies the delivery, so a second commit with different items
  -- conflicts instead of duplicating persisted intelligence.
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

-- Atomic synthesis failure -------------------------------------------------------

create function public.fail_market_synthesis_pipeline(
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
  fmsp_failure jsonb;
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

  perform private.assert_growth_intelligence_synthesis_claim(
    p_organization_id, p_request_id, p_claim_token
  );

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
  if fmsp_pipeline.stage <> 'preparing_insights' then
    raise exception 'market_research_pipeline_terminal' using errcode = '23505';
  end if;

  select run.* into fmsp_run
  from public.growth_intelligence_synthesis_runs run
  where run.organization_id = p_organization_id
    and run.id = p_synthesis_run_id
    and run.growth_intelligence_request_id = p_request_id
    and run.claim_token = p_claim_token;
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

  fmsp_inner := public.fail_growth_intelligence_synthesis(
    p_organization_id, p_request_id, p_claim_token, p_synthesis_run_id, p_safe_failure_code
  );

  fmsp_failure := public.fail_growth_intelligence_request(
    p_organization_id, p_request_id, p_claim_token, p_safe_failure_code
  );
  if fmsp_failure ->> 'outcome' <> 'failed' then
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

-- Legacy completion can no longer bypass the handoff -----------------------------
--
-- Bodies are byte-identical to the live replacements except the pipeline
-- guard at the top: pipeline-bound runs complete and fail only through the
-- atomic RPCs above.

create or replace function public.complete_market_research_run(
  p_organization_id uuid,
  p_request_id uuid,
  p_claim_token uuid,
  p_market_research_run_id uuid,
  p_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.growth_intelligence_requests;
  run_row public.market_research_runs;
  completion jsonb;
  recorded_source_count integer;
  recorded_success_count integer;
begin
  -- Pipeline-bound runs complete through complete_market_research_pipeline.
  -- This legacy path refuses them before the replay shortcut below, so a
  -- stale worker cannot bypass the atomic handoff with old outputs.
  perform 1
  from public.growth_intelligence_requests request
  where request.organization_id = p_organization_id
    and request.id = p_request_id
    and request.pipeline_id is not null;
  if found then
    raise exception 'market_research_pipeline_bypass_forbidden' using errcode = '42501';
  end if;
  if p_market_research_run_id is null then
    raise exception 'market_research_completion_invalid' using errcode = '22023';
  end if;
  perform private.assert_market_research_result(p_result);
  select run.* into run_row
  from public.market_research_runs run
  where run.organization_id = p_organization_id
    and run.id = p_market_research_run_id
    and run.growth_intelligence_request_id = p_request_id
    and run.claim_token = p_claim_token;
  if found and run_row.status <> 'running' then
    if run_row.status = p_result ->> 'outcome'
      and run_row.result_digest = p_result ->> 'resultDigest'
      and run_row.adapter_cost_micros_usd = (p_result ->> 'adapterCostMicrosUsd')::bigint
      and run_row.adapter_latency_ms = (p_result ->> 'adapterLatencyMs')::integer then
      return pg_catalog.jsonb_build_object(
        'runId', run_row.id, 'status', run_row.status, 'replayed', true
      );
    end if;
    raise exception 'market_research_run_terminal' using errcode = '23505';
  end if;
  request_row := private.assert_market_research_claim(p_organization_id, p_request_id, p_claim_token);

  select run.* into run_row
  from public.market_research_runs run
  where run.organization_id = p_organization_id
    and run.id = p_market_research_run_id
    and run.growth_intelligence_request_id = p_request_id
    and run.claim_token = p_claim_token
  for update;
  if not found then
    raise exception 'market_research_run_not_found' using errcode = '42501';
  end if;
  if run_row.status <> 'running' then
    if run_row.status = p_result ->> 'outcome'
      and run_row.result_digest = p_result ->> 'resultDigest'
      and run_row.adapter_cost_micros_usd = (p_result ->> 'adapterCostMicrosUsd')::bigint
      and run_row.adapter_latency_ms = (p_result ->> 'adapterLatencyMs')::integer then
      return pg_catalog.jsonb_build_object(
        'runId', run_row.id, 'status', run_row.status, 'replayed', true
      );
    end if;
    raise exception 'market_research_run_terminal' using errcode = '23505';
  end if;

  select pg_catalog.count(*)::integer,
    pg_catalog.count(*) filter (where source.availability = 'available')::integer
  into recorded_source_count, recorded_success_count
  from public.market_evidence_sources source
  where source.organization_id = p_organization_id
    and source.market_research_run_id = run_row.id;
  if recorded_source_count <> (p_result ->> 'sourceAttemptCount')::integer
    or recorded_success_count <> (p_result ->> 'sourceSuccessCount')::integer then
    raise exception 'market_research_result_source_count_mismatch' using errcode = '22023';
  end if;

  update public.market_research_runs
  set status = p_result ->> 'outcome',
      result_digest = p_result ->> 'resultDigest',
      source_attempt_count = (p_result ->> 'sourceAttemptCount')::integer,
      source_success_count = (p_result ->> 'sourceSuccessCount')::integer,
      adapter_cost_micros_usd = (p_result ->> 'adapterCostMicrosUsd')::bigint,
      adapter_latency_ms = (p_result ->> 'adapterLatencyMs')::integer,
      completed_at = pg_catalog.now()
  where organization_id = p_organization_id and id = run_row.id
  returning * into run_row;

  completion := public.complete_growth_intelligence_request(
    p_organization_id, p_request_id, p_claim_token
  );
  if completion ->> 'outcome' <> 'completed' then
    raise exception 'market_research_request_completion_failed' using errcode = '42501';
  end if;
  return pg_catalog.jsonb_build_object(
    'runId', run_row.id, 'status', run_row.status, 'replayed', false
  );
end;
$$;

revoke all on function public.complete_market_research_run(uuid, uuid, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_market_research_run(uuid, uuid, uuid, uuid, jsonb)
  to service_role;

create or replace function public.fail_market_research_run(
  p_organization_id uuid,
  p_request_id uuid,
  p_claim_token uuid,
  p_market_research_run_id uuid,
  p_failure jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.growth_intelligence_requests;
  run_row public.market_research_runs;
  failure jsonb;
  failure_code text;
  measured_adapter_cost_micros_usd bigint;
  measured_adapter_latency_ms integer;
begin
  -- Pipeline-bound runs fail through the atomic handoff path. Same bypass
  -- refusal as the legacy completion above.
  perform 1
  from public.growth_intelligence_requests request
  where request.organization_id = p_organization_id
    and request.id = p_request_id
    and request.pipeline_id is not null;
  if found then
    raise exception 'market_research_pipeline_bypass_forbidden' using errcode = '42501';
  end if;
  if p_market_research_run_id is null
    or not private.jsonb_object_has_exact_keys(
      p_failure,
      array['safeFailureCode', 'adapterCostMicrosUsd', 'adapterLatencyMs']::text[]
    )
    or coalesce(p_failure ->> 'safeFailureCode', '') !~ '^[A-Z][A-Z0-9_]{2,80}$'
    or coalesce(p_failure ->> 'adapterCostMicrosUsd', '') !~ '^(0|[1-9][0-9]{0,7})$'
    or coalesce(p_failure ->> 'adapterLatencyMs', '') !~ '^(0|[1-9][0-9]{0,5})$'
    or (p_failure ->> 'adapterCostMicrosUsd')::bigint > 50000000
    or (p_failure ->> 'adapterLatencyMs')::integer > 600000 then
    raise exception 'market_research_failure_invalid' using errcode = '22023';
  end if;
  failure_code := p_failure ->> 'safeFailureCode';
  measured_adapter_cost_micros_usd := (p_failure ->> 'adapterCostMicrosUsd')::bigint;
  measured_adapter_latency_ms := (p_failure ->> 'adapterLatencyMs')::integer;

  select run.* into run_row
  from public.market_research_runs run
  where run.organization_id = p_organization_id
    and run.id = p_market_research_run_id
    and run.growth_intelligence_request_id = p_request_id
    and run.claim_token = p_claim_token;
  if found and run_row.status <> 'running' then
    if run_row.status = 'failed'
      and run_row.safe_failure_code = failure_code
      and run_row.adapter_cost_micros_usd = measured_adapter_cost_micros_usd
      and run_row.adapter_latency_ms = measured_adapter_latency_ms then
      return pg_catalog.jsonb_build_object(
        'runId', run_row.id, 'status', run_row.status, 'replayed', true
      );
    end if;
    raise exception 'market_research_run_terminal' using errcode = '23505';
  end if;
  request_row := private.assert_market_research_claim(p_organization_id, p_request_id, p_claim_token);

  select run.* into run_row
  from public.market_research_runs run
  where run.organization_id = p_organization_id
    and run.id = p_market_research_run_id
    and run.growth_intelligence_request_id = p_request_id
    and run.claim_token = p_claim_token
  for update;
  if not found then
    raise exception 'market_research_run_not_found' using errcode = '42501';
  end if;
  if run_row.status <> 'running' then
    if run_row.status = 'failed'
      and run_row.safe_failure_code = failure_code
      and run_row.adapter_cost_micros_usd = measured_adapter_cost_micros_usd
      and run_row.adapter_latency_ms = measured_adapter_latency_ms then
      return pg_catalog.jsonb_build_object(
        'runId', run_row.id, 'status', run_row.status, 'replayed', true
      );
    end if;
    raise exception 'market_research_run_terminal' using errcode = '23505';
  end if;

  update public.market_research_runs run
  set status = 'failed',
      safe_failure_code = failure_code,
      adapter_cost_micros_usd = measured_adapter_cost_micros_usd,
      adapter_latency_ms = measured_adapter_latency_ms,
      failed_at = pg_catalog.now()
  where run.organization_id = p_organization_id and run.id = run_row.id
  returning run.* into run_row;

  failure := public.fail_growth_intelligence_request(
    p_organization_id, p_request_id, p_claim_token, failure_code
  );
  if failure ->> 'outcome' <> 'failed' then
    raise exception 'market_research_request_failure_failed' using errcode = '42501';
  end if;
  return pg_catalog.jsonb_build_object(
    'runId', run_row.id, 'status', run_row.status, 'replayed', false
  );
end;
$$;

revoke all on function public.fail_market_research_run(uuid, uuid, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.fail_market_research_run(uuid, uuid, uuid, uuid, jsonb)
  to service_role;

-- Poison scopes must not abort the sweep -----------------------------------------
--
-- Body is byte-identical to the live scheduler except the exception handler:
-- a scope that raises a unique conflict (23505, for example a fingerprint
-- race a sibling just won) or a poison-object failure (55000) is recorded
-- as skipped for this sweep instead of aborting every sibling behind it.
-- Unexpected failures still propagate.

create or replace function public.enqueue_due_scoped_market_research(
  p_limit integer default 25
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  due_profile record;
  due_tz text;
  due_daily_time interval;
  due_weekly_day text;
  due_weekly_time interval;
  due_target_dow integer;
  due_local_day date;
  due_candidate timestamptz;
  due_bucket text;
  due_fingerprint text;
  due_request jsonb;
  due_result jsonb;
  due_collected jsonb := '[]'::jsonb;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'growth_intelligence_due_claim_invalid' using errcode = '22023';
  end if;

  for due_profile in
    select profile.organization_id as organization_id,
           profile.branch_id as branch_id,
           profile.id as profile_id,
           version.id as version_id,
           version.source_policy_digest as source_policy_digest,
           version.profile_document -> 'cadence' as cadence,
           profile.next_daily_research_due_at as next_daily_due_at,
           profile.next_weekly_synthesis_due_at as next_weekly_due_at
    from public.organization_market_profiles profile
    join public.organization_market_profile_versions version
      on version.organization_id = profile.organization_id
      and version.id = profile.current_version_id
    where profile.enabled
    order by profile.organization_id, profile.branch_id nulls first
    limit p_limit
  loop
    begin
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        pg_catalog.concat_ws(
          '|', 'growth_intelligence', 'due_scoped',
          due_profile.organization_id, due_profile.profile_id
        ),
        0
      ));

      due_tz := due_profile.cadence ->> 'timeZone';
      if due_tz is null
        or not exists (
          select 1 from pg_catalog.pg_timezone_names zone where zone.name = due_tz
        )
        or coalesce(due_profile.cadence ->> 'dailyLocalTime', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        or due_profile.cadence ->> 'weeklyDay' not in (
          'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'
        )
        or coalesce(due_profile.cadence ->> 'weeklyLocalTime', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
        raise exception 'market_profile_cadence_invalid' using errcode = '22023';
      end if;
      due_daily_time := (due_profile.cadence ->> 'dailyLocalTime')::interval;
      due_weekly_day := due_profile.cadence ->> 'weeklyDay';
      due_weekly_time := (due_profile.cadence ->> 'weeklyLocalTime')::interval;
      due_target_dow := case due_weekly_day
        when 'monday' then 1 when 'tuesday' then 2 when 'wednesday' then 3
        when 'thursday' then 4 when 'friday' then 5 when 'saturday' then 6
        else 7 end;
      due_local_day := (pg_catalog.now() at time zone due_tz)::date;

      -- Daily research ------------------------------------------------------
      if due_profile.next_daily_due_at is null
        or due_profile.next_daily_due_at <= pg_catalog.now() then
        due_bucket := 'daily:' || due_local_day::text;
        due_fingerprint := private.create_growth_intelligence_request_fingerprint(
          due_profile.organization_id, due_profile.branch_id, null,
          'market_research', 'daily_due', null,
          due_profile.version_id, due_profile.source_policy_digest, 'market-research@1',
          due_bucket, null, null
        );
        due_request := pg_catalog.jsonb_build_object(
          'organizationId', due_profile.organization_id::text,
          'branchId', due_profile.branch_id::text,
          'channelId', null,
          'kind', 'market_research',
          'triggerReason', 'daily_due',
          'businessEvidenceDigest', null,
          'marketProfileVersionId', due_profile.version_id::text,
          'sourcePolicyDigest', due_profile.source_policy_digest,
          'researchRuleVersion', 'market-research@1',
          'localTimeBucket', due_bucket,
          'synthesisVersionTuple', null,
          'playbookVersionTuple', null,
          'requestFingerprint', due_fingerprint,
          'dueAt', pg_catalog.now()::text,
          'correlationId', pg_catalog.gen_random_uuid()::text,
          'requestedBy', null
        );
        due_result := public.enqueue_growth_intelligence_request(
          due_profile.organization_id, due_request
        );
        due_candidate :=
          (due_local_day::timestamp + due_daily_time) at time zone due_tz;
        if due_candidate <= pg_catalog.now() then
          due_candidate := due_candidate + interval '1 day';
        end if;
        update public.organization_market_profiles profile
        set next_daily_research_due_at = due_candidate
        where profile.organization_id = due_profile.organization_id
          and profile.id = due_profile.profile_id;
        due_collected := due_collected || pg_catalog.jsonb_build_object(
          'organizationId', due_profile.organization_id,
          'branchId', due_profile.branch_id,
          'kind', 'market_research',
          'localTimeBucket', due_bucket,
          'requestId', due_result ->> 'requestId',
          'replayed', (due_result ->> 'replayed')::boolean
        );
      end if;

      -- Weekly synthesis ----------------------------------------------------
      if due_profile.next_weekly_due_at is null
        or due_profile.next_weekly_due_at <= pg_catalog.now() then
        due_bucket := 'weekly:' || (
          due_local_day - (((extract(isodow from due_local_day))::integer - 1))
        )::text;
        due_fingerprint := private.create_growth_intelligence_request_fingerprint(
          due_profile.organization_id, due_profile.branch_id, null,
          'weekly_synthesis', 'weekly_due', null,
          due_profile.version_id, due_profile.source_policy_digest, 'market-research@1',
          due_bucket, null, null
        );
        due_request := pg_catalog.jsonb_build_object(
          'organizationId', due_profile.organization_id::text,
          'branchId', due_profile.branch_id::text,
          'channelId', null,
          'kind', 'weekly_synthesis',
          'triggerReason', 'weekly_due',
          'businessEvidenceDigest', null,
          'marketProfileVersionId', due_profile.version_id::text,
          'sourcePolicyDigest', due_profile.source_policy_digest,
          'researchRuleVersion', 'market-research@1',
          'localTimeBucket', due_bucket,
          'synthesisVersionTuple', null,
          'playbookVersionTuple', null,
          'requestFingerprint', due_fingerprint,
          'dueAt', pg_catalog.now()::text,
          'correlationId', pg_catalog.gen_random_uuid()::text,
          'requestedBy', null
        );
        due_result := public.enqueue_growth_intelligence_request(
          due_profile.organization_id, due_request
        );
        due_candidate := (
          (due_local_day
            + (((due_target_dow - (extract(isodow from due_local_day))::integer + 7) % 7))
          )::timestamp + due_weekly_time
        ) at time zone due_tz;
        if due_candidate <= pg_catalog.now() then
          due_candidate := due_candidate + interval '7 days';
        end if;
        update public.organization_market_profiles profile
        set next_weekly_synthesis_due_at = due_candidate
        where profile.organization_id = due_profile.organization_id
          and profile.id = due_profile.profile_id;
        due_collected := due_collected || pg_catalog.jsonb_build_object(
          'organizationId', due_profile.organization_id,
          'branchId', due_profile.branch_id,
          'kind', 'weekly_synthesis',
          'localTimeBucket', due_bucket,
          'requestId', due_result ->> 'requestId',
          'replayed', (due_result ->> 'replayed')::boolean
        );
      end if;
    exception when sqlstate '22023'
      or sqlstate '42501'
      or sqlstate '23505'
      or sqlstate '55000' then
      due_collected := due_collected || pg_catalog.jsonb_build_object(
        'organizationId', due_profile.organization_id,
        'branchId', due_profile.branch_id,
        'skipped', true
      );
    end;
  end loop;

  return due_collected;
end;
$$;

revoke all on function public.enqueue_due_scoped_market_research(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.enqueue_due_scoped_market_research(integer)
  to service_role;
