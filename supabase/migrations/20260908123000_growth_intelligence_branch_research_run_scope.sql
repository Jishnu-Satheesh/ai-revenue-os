-- Task 4 follow-up: deliberate reruns mint their own request row.
--
-- The atomic start enqueues its research root through the canonical request
-- fingerprint, which is shared work identity: schedulers and retries must keep
-- deduplicating on it. But a deliberate rerun of unchanged scope after a
-- terminal outcome replays that same fingerprint while the design requires new
-- pipeline/request IDs per run — and the replayed row is already bound to the
-- old pipeline, so linking it again violates the one-request-per-pipeline
-- lineage. The start now detects that case: an unbound replay is adopted into
-- the new run, otherwise the run inserts its own request whose fingerprint is
-- the canonical work identity bound to the new pipeline id. Canonical
-- fingerprints never collide with run-scoped values, so scheduler dedupe is
-- unaffected and the frozen fingerprint function is untouched.

create or replace function public.start_branch_market_research(
  p_organization_id uuid,
  p_actor_id uuid,
  p_branch_id uuid,
  p_profile_document jsonb,
  p_profile_digest text,
  p_expected_current_version_id uuid,
  p_idempotency_key text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  start_branch_is_active boolean;
  start_profile public.organization_market_profiles;
  start_version public.organization_market_profile_versions;
  start_operation private.growth_intelligence_write_operations;
  start_pipeline public.growth_intelligence_research_pipelines;
  start_pipeline_version public.organization_market_profile_versions;
  start_request public.growth_intelligence_requests;
  start_decision public.organization_market_profile_decisions;
  start_operation_fingerprint text;
  start_next_version integer;
  start_request_reason text;
  start_request_fingerprint text;
  start_request_result jsonb;
  start_replayed_request public.growth_intelligence_requests;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role'
    and (
      (select auth.uid()) is distinct from p_actor_id
      or not private.has_organization_permission(p_organization_id, 'growth_intelligence.manage')
    ) then
    raise exception 'market_profile_start_forbidden' using errcode = '42501';
  end if;
  if p_organization_id is null
    or p_branch_id is null
    or p_profile_digest !~ '^[a-f0-9]{64}$'
    or pg_catalog.char_length(p_idempotency_key) not between 16 and 200
    or p_correlation_id is null then
    raise exception 'market_profile_start_invalid' using errcode = '22023';
  end if;

  -- The branch must be active and belong to this organization. Inactive and
  -- foreign branches share one safe refusal: there is no branch to scope to.
  select branch.is_active into start_branch_is_active
  from public.branches branch
  where branch.organization_id = p_organization_id
    and branch.id = p_branch_id;
  if not found or not start_branch_is_active then
    raise exception 'market_profile_branch_not_found' using errcode = '42501';
  end if;

  perform private.assert_market_profile_document_v2(
    p_organization_id, p_branch_id, p_profile_document
  );
  if private.create_market_profile_digest(p_profile_document) is distinct from p_profile_digest then
    raise exception 'market_profile_digest_mismatch' using errcode = '22023';
  end if;

  -- One serialized start per organization, branch and retry key. Different
  -- browser keys still converge below under the branch-profile lock.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.concat_ws(
      '|', 'growth_intelligence', 'start_branch_research',
      p_organization_id, p_branch_id, p_idempotency_key
    ),
    0
  ));

  start_operation_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.concat_ws(
        '|', p_branch_id::text, p_profile_digest,
        coalesce(p_expected_current_version_id::text, '')
      ),
      'sha256'
    ),
    'hex'
  );
  select stored.* into start_operation
  from private.growth_intelligence_write_operations stored
  where stored.organization_id = p_organization_id
    and stored.operation_kind = 'start_branch_research'
    and stored.idempotency_key = p_idempotency_key
  for update;
  if found then
    if start_operation.operation_fingerprint is distinct from start_operation_fingerprint then
      raise exception 'market_profile_start_idempotency_conflict' using errcode = '23505';
    end if;
    select request.* into start_replayed_request
    from public.growth_intelligence_requests request
    where request.organization_id = p_organization_id
      and request.id = start_operation.request_id;
    if not found or start_replayed_request.pipeline_id is null then
      raise exception 'market_profile_start_replay_invalid' using errcode = '55000';
    end if;
    select pipeline.* into start_pipeline
    from public.growth_intelligence_research_pipelines pipeline
    where pipeline.organization_id = p_organization_id
      and pipeline.id = start_replayed_request.pipeline_id;
    if not found then
      raise exception 'market_profile_start_replay_invalid' using errcode = '55000';
    end if;
    return pg_catalog.jsonb_build_object(
      'outcome', 'replayed',
      'profileVersionId', start_operation.market_profile_version_id,
      'pipelineId', start_pipeline.id,
      'researchRequestId', start_replayed_request.id
    );
  end if;

  -- The branch profile row is the scope lock. Creating it here keeps the
  -- first start for a branch atomic; later starts lock the same row.
  insert into public.organization_market_profiles (
    organization_id, branch_id, created_by
  ) values (
    p_organization_id, p_branch_id, p_actor_id
  ) on conflict (organization_id, branch_id) where branch_id is not null do nothing;

  select stored.* into start_profile
  from public.organization_market_profiles stored
  where stored.organization_id = p_organization_id
    and stored.branch_id = p_branch_id
  for update;
  if not found then
    raise exception 'market_profile_branch_not_found' using errcode = '42501';
  end if;

  -- Identical active scope returns its pipeline before any version check: the
  -- operator reviewed exactly what is already running.
  select pipeline.* into start_pipeline
  from public.growth_intelligence_research_pipelines pipeline
  where pipeline.organization_id = p_organization_id
    and pipeline.branch_id = p_branch_id
    and pipeline.stage in ('queued', 'researching', 'preparing_insights')
  order by pipeline.created_at desc, pipeline.id desc
  limit 1
  for update;
  if found then
    select version.* into start_pipeline_version
    from public.organization_market_profile_versions version
    where version.organization_id = p_organization_id
      and version.id = start_pipeline.market_profile_version_id;
    if found and start_pipeline_version.profile_digest = p_profile_digest then
      select request.* into start_request
      from public.growth_intelligence_requests request
      where request.organization_id = p_organization_id
        and request.pipeline_id = start_pipeline.id
        and request.phase = 'research'
      order by request.created_at, request.id
      limit 1
      for update;
      if not found and start_pipeline.research_request_id is not null then
        select request.* into start_request
        from public.growth_intelligence_requests request
        where request.organization_id = p_organization_id
          and request.id = start_pipeline.research_request_id
        for update;
      end if;
      if not found then
        raise exception 'market_profile_start_replay_invalid' using errcode = '55000';
      end if;
      insert into private.growth_intelligence_write_operations (
        organization_id, operation_kind, idempotency_key, operation_fingerprint,
        market_profile_version_id, request_id
      ) values (
        p_organization_id, 'start_branch_research', p_idempotency_key,
        start_operation_fingerprint, start_pipeline_version.id, start_request.id
      );
      return pg_catalog.jsonb_build_object(
        'outcome', 'existing_active',
        'profileVersionId', start_pipeline_version.id,
        'pipelineId', start_pipeline.id,
        'researchRequestId', start_request.id
      );
    end if;

    -- Changed scope replaces unfinished work for this branch only. Sibling
    -- branches keep their pipelines: the update is pinned to this branch row.
    update public.growth_intelligence_research_pipelines pipeline
    set stage = 'cancelled',
        safe_failure_code = 'SUPERSEDED_BY_NEW_SCOPE',
        stage_changed_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    where pipeline.organization_id = p_organization_id
      and pipeline.id = start_pipeline.id;
    update public.growth_intelligence_requests request
    set status = 'cancelled', claim_token = null, lease_expires_at = null,
        cancelled_at = pg_catalog.now(),
        cancel_reason = 'Replaced by a new branch research scope.',
        last_transition_actor_type = 'user', last_transition_actor_id = p_actor_id,
        correlation_id = p_correlation_id
    where request.organization_id = p_organization_id
      and request.pipeline_id = start_pipeline.id
      and request.status in ('pending', 'claimed');
  end if;

  -- A stale review conflicts once identical scope is ruled out above, and the
  -- caller retains its edits because this transaction changes nothing.
  if p_expected_current_version_id is not null
    and start_profile.current_version_id is distinct from p_expected_current_version_id then
    raise exception 'market_profile_version_conflict' using errcode = '23505';
  end if;

  -- Save or reuse the reviewed version inside this exact branch profile, so a
  -- pipeline can never point at another branch's version lineage.
  select stored.* into start_version
  from public.organization_market_profile_versions stored
  where stored.organization_id = p_organization_id
    and stored.market_profile_id = start_profile.id
    and stored.profile_digest = p_profile_digest;
  if not found then
    select coalesce(pg_catalog.max(stored.version), 0) + 1
    into start_next_version
    from public.organization_market_profile_versions stored
    where stored.organization_id = p_organization_id
      and stored.market_profile_id = start_profile.id;

    insert into public.organization_market_profile_versions (
      organization_id, market_profile_id, version, schema_version,
      profile_document, profile_digest, source_policy_digest, proposal_source,
      created_by, correlation_id
    ) values (
      p_organization_id,
      start_profile.id,
      start_next_version,
      2,
      p_profile_document,
      p_profile_digest,
      private.create_market_profile_digest(p_profile_document -> 'sourcePolicy'),
      'operator',
      p_actor_id,
      p_correlation_id
    ) returning * into start_version;
  end if;

  -- Explicit confirmation audit: the reviewed version becomes current, is
  -- enabled, and carries its own confirmed decision row.
  update public.organization_market_profiles
  set current_version_id = start_version.id, enabled = true
  where organization_id = p_organization_id and id = start_profile.id;

  insert into public.organization_market_profile_decisions (
    organization_id, market_profile_id, market_profile_version_id, decision,
    profile_digest, reason, decided_by, correlation_id
  ) values (
    p_organization_id, start_profile.id, start_version.id, 'confirmed',
    start_version.profile_digest, 'Branch research started.', p_actor_id, p_correlation_id
  ) returning * into start_decision;

  insert into public.growth_intelligence_research_pipelines (
    organization_id, branch_id, market_profile_id, market_profile_version_id,
    scope_digest, coverage
  ) values (
    p_organization_id, p_branch_id, start_profile.id, start_version.id,
    p_profile_digest, '[]'::jsonb
  ) returning * into start_pipeline;

  start_request_reason := case when start_profile.current_version_id is null
    then 'profile_confirmed' else 'profile_revised' end;
  start_request_fingerprint := private.create_growth_intelligence_request_fingerprint(
    p_organization_id, p_branch_id, null, 'market_research', start_request_reason, null,
    start_version.id, start_version.source_policy_digest, 'market-research@1',
    'immediate', null, null
  );
  start_request_result := public.enqueue_growth_intelligence_request(
    p_organization_id,
    pg_catalog.jsonb_build_object(
      'organizationId', p_organization_id,
      'branchId', p_branch_id,
      'channelId', null,
      'kind', 'market_research',
      'triggerReason', start_request_reason,
      'businessEvidenceDigest', null,
      'marketProfileVersionId', start_version.id,
      'sourcePolicyDigest', start_version.source_policy_digest,
      'researchRuleVersion', 'market-research@1',
      'localTimeBucket', 'immediate',
      'synthesisVersionTuple', null,
      'playbookVersionTuple', null,
      'requestFingerprint', start_request_fingerprint,
      'dueAt', pg_catalog.now(),
      'correlationId', p_correlation_id,
      'requestedBy', p_actor_id
    )
  );
  select request.* into start_request
  from public.growth_intelligence_requests request
  where request.organization_id = p_organization_id
    and request.id = (start_request_result ->> 'requestId')::uuid
  for update;

  -- A replayed request already bound to another pipeline cannot move: runs
  -- own their request rows. An unbound replay (for example a due-scheduled
  -- row for the same scope) is adopted into this run. Otherwise this run
  -- mints its own request with a run-scoped fingerprint, so deliberate
  -- reruns receive new request IDs while canonical scheduler dedupe is
  -- unaffected.
  if (start_request_result ->> 'replayed')::boolean
    and start_request.pipeline_id is not null then
    start_request_fingerprint := pg_catalog.encode(
      extensions.digest(
        start_request_fingerprint || '|' || start_pipeline.id::text,
        'sha256'
      ),
      'hex'
    );
    insert into public.growth_intelligence_requests (
      organization_id, branch_id, channel_id, kind, trigger_reason,
      request_fingerprint, business_evidence_digest, market_profile_version_id,
      source_policy_digest, research_rule_version, local_time_bucket,
      synthesis_version_tuple, playbook_version_tuple, due_at, requested_by,
      last_transition_actor_type, last_transition_actor_id, correlation_id
    ) values (
      p_organization_id,
      p_branch_id,
      null,
      'market_research',
      start_request_reason,
      start_request_fingerprint,
      null,
      start_version.id,
      start_version.source_policy_digest,
      'market-research@1',
      'immediate',
      null,
      null,
      pg_catalog.now(),
      p_actor_id,
      'user'::public.audit_actor_type,
      p_actor_id,
      p_correlation_id
    ) returning * into start_request;
  end if;

  update public.growth_intelligence_research_pipelines pipeline
  set research_request_id = start_request.id, updated_at = pg_catalog.now()
  where pipeline.organization_id = p_organization_id
    and pipeline.id = start_pipeline.id;

  update public.growth_intelligence_requests request
  set pipeline_id = start_pipeline.id, phase = 'research'
  where request.organization_id = p_organization_id
    and request.id = start_request.id;

  insert into private.growth_intelligence_write_operations (
    organization_id, operation_kind, idempotency_key, operation_fingerprint,
    market_profile_version_id, market_profile_decision_id, request_id
  ) values (
    p_organization_id, 'start_branch_research', p_idempotency_key,
    start_operation_fingerprint, start_version.id, start_decision.id, start_request.id
  );

  return pg_catalog.jsonb_build_object(
    'outcome', 'started',
    'profileVersionId', start_version.id,
    'pipelineId', start_pipeline.id,
    'researchRequestId', start_request.id
  );
end;
$$;

revoke all on function public.start_branch_market_research(uuid, uuid, uuid, jsonb, text, uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.start_branch_market_research(uuid, uuid, uuid, jsonb, text, uuid, text, uuid)
  to authenticated, service_role;
