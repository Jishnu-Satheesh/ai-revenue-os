-- Spec 023 Task A repair: PL/pgSQL treats an unqualified name matching both a
-- declared variable and a queried column as ambiguous (42702). The completion's
-- `source_id` variable collided with memory_source_revisions.source_id on the
-- revision-ordering read, so every registered-kind delivery died there. Renamed
-- to v_source_id; behavior unchanged.
--
-- (20260911120400 was filed empty by a script assert that matched its own
-- replacement text; it applies as a no-op and this migration carries the fix.)

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
  v_source_id uuid;
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

  v_source_id := coalesce(
    capture.channel_finding_id, capture.channel_recommendation_id, capture.channel_decision_id,
    capture.market_claim_id, capture.growth_item_id, capture.growth_decision_id,
    capture.campaign_id, capture.campaign_outcome_id, capture.campaign_learning_proposal_id
  );

  select * into source_row
  from public.memory_source_revisions current_revision
  where current_revision.organization_id = p_organization_id
    and current_revision.source_kind = capture.source_kind
    and current_revision.source_id = v_source_id;

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
