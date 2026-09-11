-- Spec 023 Task A3: channel_decision capture adapter.
--
-- Registry row, projector (private.project_memory_channel_decision), enqueue
-- helper, and the forward replacement of triage_channel_recommendation below.
--
-- Digest canonicalization (fixed order, unit-separator joined, nulls collapse
-- to empty): decision | recommendation_id | actor_id | dismissal_reason |
-- snoozed_until. Each triage append is a new source row, so each decision
-- starts at revision 1; a later decision on the same target is a new event
-- and a new projection, never an edit of the earlier one. History keeps both.
--
-- Personal helpfulness votes and pins live in the feedback tables, which this
-- adapter never reads: they enqueue nothing. Note the stored decision
-- vocabulary is acknowledged/planned/snoozed/dismissed (the table check);
-- the projector records whatever value the row carries.

insert into public.memory_capture_adapters (source_kind, registered, note) values
  ('channel_decision', true, 'Operator triage answers project to operator_decision records; votes and pins are never captured.')
on conflict (source_kind) do update set
  registered = excluded.registered,
  note = excluded.note;

-- Enqueue helper: one event for one accepted decision append. Settings-gated
-- (absent or disabled settings enqueue nothing) and transaction-local (a
-- rolled-back triage removes its event with it). Returns the event id, or
-- null when capture is bypassed.

create or replace function private.enqueue_memory_channel_decision(
  p_organization_id uuid,
  p_decision_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capture_on boolean;
  v_decision public.channel_recommendation_decisions;
  v_rec public.channel_recommendations;
  v_canonical text;
  v_digest text;
  v_revision bigint;
  v_event_id uuid;
begin
  select settings_row.capture_enabled into v_capture_on
  from public.memory_integration_settings settings_row
  where settings_row.organization_id = p_organization_id;
  if not found or not v_capture_on then
    return null;
  end if;

  select decision_row.* into v_decision
  from public.channel_recommendation_decisions decision_row
  where decision_row.organization_id = p_organization_id
    and decision_row.id = p_decision_id;
  if not found then
    return null;
  end if;

  select rec_row.* into v_rec
  from public.channel_recommendations rec_row
  where rec_row.organization_id = p_organization_id
    and rec_row.id = v_decision.recommendation_id;
  if not found then
    return null;
  end if;

  v_canonical := pg_catalog.concat_ws(pg_catalog.chr(31),
    v_decision.decision,
    v_decision.recommendation_id::text,
    v_decision.actor_id::text,
    coalesce(v_decision.dismissal_reason, ''),
    coalesce(v_decision.snoozed_until::text, ''));
  v_digest := pg_catalog.encode(extensions.digest(v_canonical, 'sha256'), 'hex');
  v_revision := private.allocate_memory_source_revision(
    p_organization_id, 'channel_decision', v_decision.id, v_digest);

  insert into public.memory_capture_events (
    organization_id, source_kind, channel_decision_id, source_revision,
    source_digest, event_kind, occurred_at, correlation_id,
    branch_id, channel_id, projection_document
  ) values (
    p_organization_id, 'channel_decision', v_decision.id, v_revision,
    v_digest, 'recorded', v_decision.created_at, pg_catalog.gen_random_uuid(),
    v_rec.branch_id, v_rec.channel_id,
    pg_catalog.jsonb_build_object(
      'decisionId', v_decision.id,
      'recommendationId', v_decision.recommendation_id,
      'decision', v_decision.decision,
      'actorId', v_decision.actor_id,
      'decidedAt', v_decision.created_at,
      'snoozedUntil', v_decision.snoozed_until,
      'sourceRevision', v_revision)
  ) returning id into v_event_id;

  return v_event_id;
end;
$$;

revoke all on function private.enqueue_memory_channel_decision(uuid, uuid) from public;

-- Projector: deterministic decision row to operator_decision record. Body
-- holds the actor action, the target recommendation, the decision value and
-- the time; votes and pins are never consulted. Withdrawn deliveries project
-- no new item.

create or replace function private.project_memory_channel_decision(
  p_organization_id uuid,
  p_capture_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.memory_capture_events;
  v_decision public.channel_recommendation_decisions;
  v_rec public.channel_recommendations;
  v_title text;
  v_body text;
  v_item_id uuid;
begin
  select event_row.* into v_event
  from public.memory_capture_events event_row
  where event_row.organization_id = p_organization_id
    and event_row.id = p_capture_id;
  if not found then
    raise exception 'memory capture event was not found' using errcode = 'P0002';
  end if;

  select decision_row.* into v_decision
  from public.channel_recommendation_decisions decision_row
  where decision_row.organization_id = v_event.organization_id
    and decision_row.id = v_event.channel_decision_id;
  if not found then
    raise exception 'memory capture source is withdrawn' using errcode = 'P0002';
  end if;
  if v_decision.organization_id is distinct from p_organization_id then
    raise exception 'memory capture source scope is not authorized' using errcode = '42501';
  end if;

  if v_event.event_kind = 'withdrawn' then
    return null;
  end if;

  select rec_row.* into v_rec
  from public.channel_recommendations rec_row
  where rec_row.organization_id = v_decision.organization_id
    and rec_row.id = v_decision.recommendation_id;
  if not found then
    raise exception 'memory capture source is withdrawn' using errcode = 'P0002';
  end if;

  v_title := pg_catalog.substring(
    'Channel decision: ' || v_decision.decision, 1, 300);
  v_body := pg_catalog.substring(pg_catalog.concat_ws(E'\n',
    'Actor ' || v_decision.actor_id::text
      || ' recorded ' || v_decision.decision
      || ' on recommendation ' || v_decision.recommendation_id::text
      || ' at ' || v_decision.created_at::text || '.',
    case when v_decision.dismissal_reason is null then null
      else 'Reason: ' || v_decision.dismissal_reason end,
    case when v_decision.snoozed_until is null then null
      else 'Snoozed until ' || v_decision.snoozed_until::text || '.' end
  ), 1, 2000);

  insert into public.memory_items (
    organization_id, branch_id, memory_type, title, body, origin,
    verification_state, sensitivity, knowledge_kind, capture_event_id,
    source_reference, observed_at
  ) values (
    p_organization_id, v_rec.branch_id, 'decision', v_title, v_body,
    'system_generated', 'unverified', v_event.sensitivity, 'operator_decision',
    v_event.id,
    'channel_decision:' || v_decision.id::text,
    v_event.occurred_at
  ) returning id into v_item_id;

  return v_item_id;
end;
$$;

revoke all on function private.project_memory_channel_decision(uuid, uuid) from public;

-- Forward replacement of triage_channel_recommendation: byte-for-byte the
-- 20260904093804 six-argument definition (snooze horizon discipline,
-- actor-name snapshot, append-only history), plus capturing the appended
-- decision id and the single capture enqueue. Grants re-issued unchanged:
-- members triage, the worker never does.

create or replace function public.triage_channel_recommendation(
  p_organization_id uuid,
  p_recommendation_id uuid,
  p_decision text,
  p_dismissal_reason text,
  p_actor_id uuid,
  p_snoozed_until timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.organization_role;
  v_actor_display_name text;
  v_decision_id uuid;
begin
  if (select auth.uid()) is distinct from p_actor_id then
    raise exception 'channel recommendation triage is not authorized' using errcode = '42501';
  end if;

  -- Answering takes the triage tier. A viewer reads the narration; someone
  -- with no role here was never a member, and gets the same refusal either
  -- way.
  v_role := public.current_organization_role(p_organization_id);
  if v_role is null or v_role not in ('owner', 'admin', 'operator') then
    raise exception 'channel recommendation triage is not authorized' using errcode = '42501';
  end if;

  -- A recommendation that does not resolve in this tenant does not resolve at
  -- all; saying which would describe the neighbours' narration.
  if not exists (
    select 1 from public.channel_recommendations r
    where r.organization_id = p_organization_id and r.id = p_recommendation_id
  ) then
    raise exception 'channel recommendation was not found' using errcode = 'P0002';
  end if;

  -- A snooze hides the row until its horizon, so the horizon must travel with
  -- the answer and lie in the future; every other answer carries no horizon.
  -- The table tie check repeats this, so a direct write cannot slip one past.
  if (p_decision = 'snoozed') <> (p_snoozed_until is not null) then
    raise exception 'channel recommendation snooze horizon is not valid' using errcode = '22023';
  end if;
  if p_snoozed_until is not null and p_snoozed_until <= pg_catalog.now() then
    raise exception 'channel recommendation snooze is not future' using errcode = '22023';
  end if;

  -- The name travels with the answer. This function already runs definer-side,
  -- so it may read profiles regardless of the caller's own row-level policy --
  -- the one place a name can be written down without borrowing authority the
  -- session does not have.
  select nullif(btrim(p.display_name), '')
    into v_actor_display_name
    from public.profiles p
    where p.id = p_actor_id;

  -- Append-only by construction: the log holds every answer, and the storage
  -- migration's own trigger audits each one as it lands.
  insert into public.channel_recommendation_decisions (
    organization_id, recommendation_id, decision, dismissal_reason, actor_id,
    actor_display_name, snoozed_until
  ) values (
    p_organization_id, p_recommendation_id, p_decision, p_dismissal_reason, p_actor_id,
    coalesce(v_actor_display_name, 'Unknown'), p_snoozed_until
  ) returning id into v_decision_id;

  -- Business Memory capture (Spec 023 Task A3): one event for this accepted
  -- append. The helper no-ops when capture is disabled, so triage behaves
  -- exactly as before. A later decision on the same target enqueues its own
  -- new event; nothing here edits history.
  perform private.enqueue_memory_channel_decision(p_organization_id, v_decision_id);
end;
$$;

comment on function public.triage_channel_recommendation(uuid, uuid, text, text, uuid, timestamptz) is
  'Appends one human triage answer (acknowledged/dismissed/planned/snoozed with a future horizon) to a recommendation in the caller''s organization; owner/admin/operator only.';

revoke all on function public.triage_channel_recommendation(uuid, uuid, text, text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.triage_channel_recommendation(uuid, uuid, text, text, uuid, timestamptz) to authenticated;
revoke all on function public.triage_channel_recommendation(uuid, uuid, text, text, uuid, timestamptz) from service_role;
