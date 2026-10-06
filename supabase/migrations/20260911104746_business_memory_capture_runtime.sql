-- Spec 023 Task 03: leased capture runtime. Workers transport identifiers;
-- Postgres owns every state change. Member paths (retry) and worker paths
-- (claim/load/fail/complete) are disjoint by grant, so a browser session can
-- never drive a projection and a worker can never retry on anyone's behalf.
--
-- complete_ projects through per-kind private helpers owned by adapter
-- slices. No kind is registered yet, so every delivery quarantines with
-- QUARANTINE_UNREGISTERED_ADAPTER until an adapter registers its kind,
-- helper, and success-path tests. Lease, replay, obsolescence, and failure
-- paths below are complete and tested now.

-- Due organizations: oldest due work first ---------------------------------------
--
-- The dispatcher rotates fairly instead of letting one large tenant take
-- every batch. Payloads are identifiers; bounds stay global per pass.

create or replace function public.list_memory_capture_due_orgs(p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  orgs jsonb;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'memory capture due-organization input is invalid' using errcode = '23514';
  end if;

  select pg_catalog.jsonb_agg(organization_id) into orgs
  from (
    select due.organization_id
    from public.memory_capture_events due
    where due.status = 'pending' and due.next_attempt_at <= now()
       or due.status = 'claimed' and due.lease_expires_at <= now()
    group by due.organization_id
    order by min(due.next_attempt_at) asc
    limit p_limit
  ) ordered;

  return pg_catalog.jsonb_build_object('organizationIds', coalesce(orgs, '[]'::jsonb));
end;
$$;

revoke all on function public.list_memory_capture_due_orgs(integer) from public, anon, authenticated;
grant execute on function public.list_memory_capture_due_orgs(integer) to service_role;

-- Claim: bounded batch under SKIP LOCKED -------------------------------------------

create or replace function public.claim_memory_capture_events(
  p_organization_id uuid,
  p_claim_token uuid,
  p_limit integer,
  p_lease_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed jsonb;
begin
  if p_organization_id is null
    or p_claim_token is null
    or p_limit is null or p_limit < 1 or p_limit > 25
    or p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 600 then
    raise exception 'memory capture claim input is invalid' using errcode = '23514';
  end if;

  with due as (
    select due_event.id
    from public.memory_capture_events due_event
    where due_event.organization_id = p_organization_id
      and (
        due_event.status = 'pending' and due_event.next_attempt_at <= now()
        or due_event.status = 'claimed' and due_event.lease_expires_at <= now()
      )
    order by due_event.next_attempt_at asc
    limit p_limit
    for update skip locked
  )
  update public.memory_capture_events claimed_event
  set status = 'claimed',
    claim_token = p_claim_token,
    lease_expires_at = now() + (p_lease_seconds || ' seconds')::interval,
    attempt_count = claimed_event.attempt_count + 1,
    next_attempt_at = now() + (p_lease_seconds || ' seconds')::interval,
    safe_failure_code = null
  from due
  where claimed_event.id = due.id;

  select pg_catalog.jsonb_agg(id) into claimed from (
    select claimed_event.id from public.memory_capture_events claimed_event
    where claimed_event.organization_id = p_organization_id
      and claimed_event.claim_token = p_claim_token
      and claimed_event.status = 'claimed'
      and claimed_event.lease_expires_at > now()
  ) claimed_ids;

  return pg_catalog.jsonb_build_object('captureIds', coalesce(claimed, '[]'::jsonb));
end;
$$;

revoke all on function public.claim_memory_capture_events(uuid, uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_memory_capture_events(uuid, uuid, integer, integer)
  to service_role;

-- Load: the lease holder reads its typed projection document -------------------------

create or replace function public.load_memory_capture_event(
  p_organization_id uuid,
  p_capture_id uuid,
  p_claim_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  capture public.memory_capture_events;
begin
  if p_organization_id is null or p_capture_id is null or p_claim_token is null then
    raise exception 'memory capture load input is invalid' using errcode = '23514';
  end if;

  select * into capture
  from public.memory_capture_events stored
  where stored.organization_id = p_organization_id
    and stored.id = p_capture_id;

  if not found then
    raise exception 'memory capture event was not found' using errcode = 'P0002';
  end if;
  if capture.status <> 'claimed'
    or capture.claim_token is distinct from p_claim_token
    or capture.lease_expires_at is null
    or capture.lease_expires_at <= now() then
    raise exception 'memory capture lease is not held' using errcode = '42501';
  end if;

  return pg_catalog.jsonb_build_object(
    'captureId', capture.id,
    'sourceKind', capture.source_kind,
    'sourceRevision', capture.source_revision,
    'sourceDigest', capture.source_digest,
    'eventKind', capture.event_kind,
    'attemptCount', capture.attempt_count,
    'channelFindingId', capture.channel_finding_id,
    'channelRecommendationId', capture.channel_recommendation_id,
    'channelDecisionId', capture.channel_decision_id,
    'marketClaimId', capture.market_claim_id,
    'growthItemId', capture.growth_item_id,
    'growthDecisionId', capture.growth_decision_id,
    'campaignId', capture.campaign_id,
    'campaignOutcomeId', capture.campaign_outcome_id,
    'campaignLearningProposalId', capture.campaign_learning_proposal_id,
    'branchId', capture.branch_id,
    'channelId', capture.channel_id,
    'sensitivity', capture.sensitivity,
    'reuseClass', capture.reuse_class,
    'projectionDocument', capture.projection_document
  );
end;
$$;

revoke all on function public.load_memory_capture_event(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.load_memory_capture_event(uuid, uuid, uuid)
  to service_role;

-- Fail: fixed classifier, bounded retries ----------------------------------------------
--
-- The code vocabulary is closed: transient codes retry with backoff,
-- quarantine codes park for an operator, obsolete codes end the event without
-- projecting. Anything else is refused outright, never retried blindly.

create or replace function public.fail_memory_capture_event(
  p_organization_id uuid,
  p_capture_id uuid,
  p_claim_token uuid,
  p_safe_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  capture public.memory_capture_events;
  delay interval;
begin
  if p_organization_id is null
    or p_capture_id is null
    or p_claim_token is null
    or p_safe_code is null
    or p_safe_code not in (
      'TRANSIENT_DB', 'TRANSIENT_THROTTLED',
      'QUARANTINE_UNREGISTERED_ADAPTER', 'QUARANTINE_INVALID_SHAPE',
      'QUARANTINE_TENANT_MISMATCH', 'QUARANTINE_RIGHTS_DENIED',
      'QUARANTINE_MISSING_PROVENANCE',
      'OBSOLETE_WITHDRAWN', 'OBSOLETE_SUPERSEDED', 'OBSOLETE_DISABLED'
    ) then
    raise exception 'memory capture failure input is invalid' using errcode = '23514';
  end if;

  select * into capture
  from public.memory_capture_events stored
  where stored.organization_id = p_organization_id
    and stored.id = p_capture_id
  for update;

  if not found then
    raise exception 'memory capture event was not found' using errcode = 'P0002';
  end if;
  if capture.status <> 'claimed'
    or capture.claim_token is distinct from p_claim_token
    or capture.lease_expires_at is null
    or capture.lease_expires_at <= now() then
    raise exception 'memory capture lease is not held' using errcode = '42501';
  end if;

  if p_safe_code in ('OBSOLETE_WITHDRAWN', 'OBSOLETE_SUPERSEDED', 'OBSOLETE_DISABLED') then
    update public.memory_capture_events
    set status = 'obsolete',
      claim_token = null,
      lease_expires_at = null,
      safe_failure_code = p_safe_code
    where memory_capture_events.id = p_capture_id
      and memory_capture_events.organization_id = p_organization_id;
    return pg_catalog.jsonb_build_object('captureId', p_capture_id, 'status', 'obsolete');
  end if;

  if p_safe_code like 'QUARANTINE\_%' then
    update public.memory_capture_events
    set status = 'quarantined',
      claim_token = null,
      lease_expires_at = null,
      safe_failure_code = p_safe_code
    where memory_capture_events.id = p_capture_id
      and memory_capture_events.organization_id = p_organization_id;
    return pg_catalog.jsonb_build_object('captureId', p_capture_id, 'status', 'quarantined');
  end if;

  -- Transient: five attempts total, then terminal. Delays of 30 seconds,
  -- 2 minutes, 10 minutes, 30 minutes.
  if capture.attempt_count >= 5 then
    update public.memory_capture_events
    set status = 'failed',
      claim_token = null,
      lease_expires_at = null,
      safe_failure_code = 'ATTEMPTS_EXHAUSTED'
    where memory_capture_events.id = p_capture_id
      and memory_capture_events.organization_id = p_organization_id;
    return pg_catalog.jsonb_build_object('captureId', p_capture_id, 'status', 'failed');
  end if;

  delay := case capture.attempt_count
    when 1 then interval '30 seconds'
    when 2 then interval '2 minutes'
    when 3 then interval '10 minutes'
    else interval '30 minutes'
  end;

  update public.memory_capture_events
  set status = 'pending',
    claim_token = null,
    lease_expires_at = null,
    next_attempt_at = now() + delay,
    safe_failure_code = p_safe_code
  where memory_capture_events.id = p_capture_id
    and memory_capture_events.organization_id = p_organization_id;
  return pg_catalog.jsonb_build_object('captureId', p_capture_id, 'status', 'pending');
end;
$$;

revoke all on function public.fail_memory_capture_event(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.fail_memory_capture_event(uuid, uuid, uuid, text)
  to service_role;

-- Complete: atomic project-or-quarantine -------------------------------------------------
--
-- One transaction reloads the event, revalidates the lease, source state,
-- and capture flags, then either projects (registered kinds, via the
-- adapter-owned private projector) or records exactly why it did not.
-- Repeated delivery of a completed event returns the same item: a receipt
-- lost after commit replays without a duplicate.

create or replace function public.complete_memory_capture_event(
  p_organization_id uuid,
  p_capture_id uuid,
  p_claim_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  capture public.memory_capture_events;
  settings public.memory_integration_settings;
  adapter public.memory_capture_adapters;
  source_row public.memory_source_revisions;
  source_id uuid;
  projected uuid;
begin
  if p_organization_id is null or p_capture_id is null or p_claim_token is null then
    raise exception 'memory capture completion input is invalid' using errcode = '23514';
  end if;

  select * into capture
  from public.memory_capture_events stored
  where stored.organization_id = p_organization_id
    and stored.id = p_capture_id
  for update;

  if not found then
    raise exception 'memory capture event was not found' using errcode = 'P0002';
  end if;

  -- A completed event replays to the same projection identity, never a second item.
  if capture.status = 'completed' then
    return pg_catalog.jsonb_build_object(
      'captureId', capture.id, 'status', 'replayed', 'projectedItemId', capture.projected_item_id
    );
  end if;

  if capture.status <> 'claimed'
    or capture.claim_token is distinct from p_claim_token
    or capture.lease_expires_at is null
    or capture.lease_expires_at <= now() then
    raise exception 'memory capture lease is not held' using errcode = '42501';
  end if;

  select * into settings
  from public.memory_integration_settings configured
  where configured.organization_id = p_organization_id;

  if settings.organization_id is null or not settings.capture_enabled then
    update public.memory_capture_events
    set status = 'obsolete',
      claim_token = null, lease_expires_at = null, safe_failure_code = 'OBSOLETE_DISABLED'
    where memory_capture_events.id = p_capture_id
      and memory_capture_events.organization_id = p_organization_id;
    return pg_catalog.jsonb_build_object('captureId', p_capture_id, 'status', 'obsolete');
  end if;

  select * into adapter
  from public.memory_capture_adapters registered
  where registered.source_kind = capture.source_kind
    and registered.registered;

  if not found then
    update public.memory_capture_events
    set status = 'quarantined',
      claim_token = null, lease_expires_at = null,
      safe_failure_code = 'QUARANTINE_UNREGISTERED_ADAPTER'
    where memory_capture_events.id = p_capture_id
      and memory_capture_events.organization_id = p_organization_id;
    return pg_catalog.jsonb_build_object('captureId', p_capture_id, 'status', 'quarantined');
  end if;

  source_id := coalesce(
    capture.channel_finding_id, capture.channel_recommendation_id, capture.channel_decision_id,
    capture.market_claim_id, capture.growth_item_id, capture.growth_decision_id,
    capture.campaign_id, capture.campaign_outcome_id, capture.campaign_learning_proposal_id
  );

  select * into source_row
  from public.memory_source_revisions current_revision
  where current_revision.organization_id = p_organization_id
    and current_revision.source_kind = capture.source_kind
    and current_revision.source_id = source_id;

  -- An older delivery arriving after a newer revision took the source can
  -- never become the current projection.
  if found
    and (source_row.revision > capture.source_revision
      or source_row.state_digest is distinct from capture.source_digest) then
    update public.memory_capture_events
    set status = 'obsolete',
      claim_token = null, lease_expires_at = null, safe_failure_code = 'OBSOLETE_SUPERSEDED'
    where memory_capture_events.id = p_capture_id
      and memory_capture_events.organization_id = p_organization_id;
    return pg_catalog.jsonb_build_object('captureId', p_capture_id, 'status', 'obsolete');
  end if;

  -- Registered-kind projection lives in the adapter-owned private projector.
  -- Adapter slices create private.project_memory_<kind> plus the registry row
  -- and the success-path tests together; this call site stays untouched.
  case capture.source_kind
    when 'channel_finding' then
      select private.project_memory_channel_finding(p_organization_id, p_capture_id) into projected;
    when 'channel_recommendation' then
      select private.project_memory_channel_recommendation(p_organization_id, p_capture_id) into projected;
    when 'channel_decision' then
      select private.project_memory_channel_decision(p_organization_id, p_capture_id) into projected;
    when 'market_claim' then
      select private.project_memory_market_claim(p_organization_id, p_capture_id) into projected;
    when 'growth_item' then
      select private.project_memory_growth_item(p_organization_id, p_capture_id) into projected;
    when 'growth_decision' then
      select private.project_memory_growth_decision(p_organization_id, p_capture_id) into projected;
    when 'campaign_state' then
      select private.project_memory_campaign_state(p_organization_id, p_capture_id) into projected;
    when 'campaign_outcome' then
      select private.project_memory_campaign_outcome(p_organization_id, p_capture_id) into projected;
    when 'campaign_lesson' then
      select private.project_memory_campaign_lesson(p_organization_id, p_capture_id) into projected;
    else
      raise exception 'memory capture kind is not projectable' using errcode = '23514';
  end case;

  update public.memory_capture_events
  set status = 'completed',
    claim_token = null, lease_expires_at = null,
    completed_at = now(), safe_failure_code = null, projected_item_id = projected
  where memory_capture_events.id = p_capture_id
    and memory_capture_events.organization_id = p_organization_id;

  return pg_catalog.jsonb_build_object(
    'captureId', p_capture_id, 'status', 'completed', 'projectedItemId', projected
  );
end;
$$;

revoke all on function public.complete_memory_capture_event(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.complete_memory_capture_event(uuid, uuid, uuid)
  to service_role;

-- Retry: owner/admin requeues a failed or quarantined event -------------------------------

create or replace function public.retry_memory_capture(
  p_organization_id uuid,
  p_actor_id uuid,
  p_capture_id uuid,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  capture public.memory_capture_events;
begin
  if p_organization_id is null
    or p_actor_id is null
    or p_capture_id is null
    or p_correlation_id is null then
    raise exception 'memory capture retry input is invalid' using errcode = '23514';
  end if;

  if (select auth.uid()) <> p_actor_id
    or not private.has_organization_permission(p_organization_id, 'memory.retry_capture') then
    raise exception 'memory capture retry is not authorized' using errcode = '42501';
  end if;

  perform pg_catalog.set_config('app.correlation_id', p_correlation_id::text, true);

  select * into capture
  from public.memory_capture_events stored
  where stored.organization_id = p_organization_id
    and stored.id = p_capture_id
  for update;

  if not found then
    raise exception 'memory capture event was not found' using errcode = 'P0002';
  end if;
  if capture.status not in ('failed', 'quarantined') then
    raise exception 'memory capture event is not retryable' using errcode = '23505';
  end if;

  update public.memory_capture_events
  set status = 'pending',
    attempt_count = 0,
    next_attempt_at = now(),
    claim_token = null,
    lease_expires_at = null,
    safe_failure_code = null
  where memory_capture_events.id = p_capture_id
    and memory_capture_events.organization_id = p_organization_id;

  insert into public.audit_events (
    organization_id, event_name, actor_type, actor_id, entity_type, entity_id, payload
  ) values (
    p_organization_id, 'memory.capture_retried', 'user', p_actor_id,
    'memory_capture_events', p_capture_id,
    pg_catalog.jsonb_build_object('priorStatus', capture.status)
  );

  return pg_catalog.jsonb_build_object('captureId', p_capture_id, 'status', 'pending');
end;
$$;

revoke all on function public.retry_memory_capture(uuid, uuid, uuid, uuid)
  from public, anon;
grant execute on function public.retry_memory_capture(uuid, uuid, uuid, uuid)
  to authenticated;
revoke all on function public.retry_memory_capture(uuid, uuid, uuid, uuid)
  from service_role;
