-- Growth Intelligence Task 17: synchronized triage.
--
-- Channel Recommendations gain `snoozed` with a required future horizon,
-- keeping append-only history: the allowlist check is replaced, the tie
-- between a snooze and its horizon is a new check, and the member RPC takes
-- the horizon as a sixth argument with the same grants as before (members
-- execute; anon, strangers, and the service worker do not).
alter table public.channel_recommendation_decisions
  add column snoozed_until timestamptz;

alter table public.channel_recommendation_decisions
  drop constraint channel_recommendation_decisions_decision_check;

alter table public.channel_recommendation_decisions
  add constraint channel_recommendation_decisions_decision_check
  check (decision in ('acknowledged', 'dismissed', 'planned', 'snoozed'));

alter table public.channel_recommendation_decisions
  add constraint channel_recommendation_decisions_snooze_tie
  check ((decision = 'snoozed') = (snoozed_until is not null));

drop function public.triage_channel_recommendation(uuid, uuid, text, text, uuid);

create function public.triage_channel_recommendation(
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
  );
end;
$$;

comment on function public.triage_channel_recommendation(uuid, uuid, text, text, uuid, timestamptz) is
  'Appends one human triage answer (acknowledged/dismissed/planned/snoozed with a future horizon) to a recommendation in the caller''s organization; owner/admin/operator only.';

revoke all on function public.triage_channel_recommendation(uuid, uuid, text, text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.triage_channel_recommendation(uuid, uuid, text, text, uuid, timestamptz) to authenticated;
revoke all on function public.triage_channel_recommendation(uuid, uuid, text, text, uuid, timestamptz) from service_role;

-- Same signature, so existing grants carry over. Only the kind-to-decision
-- gating below is new.
create or replace function public.decide_growth_intelligence_item(
  p_organization_id uuid,
  p_actor_id uuid,
  p_item_id uuid,
  p_decision text,
  p_reason text,
  p_snoozed_until timestamptz,
  p_item_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item_row public.growth_intelligence_items;
  decision_row public.growth_intelligence_item_decisions;
begin
  if p_organization_id is null or p_actor_id is null or p_item_id is null then
    raise exception 'growth_intelligence_item_decision_invalid' using errcode = '22023';
  end if;
  if p_decision not in ('acknowledged', 'pinned', 'unpinned', 'planned', 'snoozed', 'dismissed', 'resolved') then
    raise exception 'growth_intelligence_item_decision_invalid' using errcode = '22023';
  end if;
  if p_reason is not null and pg_catalog.char_length(p_reason) not between 1 and 500 then
    raise exception 'growth_intelligence_item_decision_invalid' using errcode = '22023';
  end if;
  if (p_decision = 'snoozed') <> (p_snoozed_until is not null) then
    raise exception 'growth_intelligence_item_decision_invalid' using errcode = '22023';
  end if;
  if p_snoozed_until is not null and p_snoozed_until <= pg_catalog.now() then
    raise exception 'growth_intelligence_item_snooze_not_future' using errcode = '22023';
  end if;
  if p_item_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception 'growth_intelligence_item_decision_invalid' using errcode = '22023';
  end if;
  if (select auth.uid()) is distinct from p_actor_id
    or not private.has_organization_permission(p_organization_id, 'growth_intelligence.manage') then
    raise exception 'growth_intelligence_item_decision_forbidden' using errcode = '42501';
  end if;
  select item.* into item_row
  from public.growth_intelligence_items item
  where item.organization_id = p_organization_id
    and item.id = p_item_id
  for update;
  if not found then
    raise exception 'growth_intelligence_item_not_found' using errcode = '22023';
  end if;
  if item_row.item_fingerprint is distinct from p_item_fingerprint then
    raise exception 'growth_intelligence_item_stale' using errcode = '23505';
  end if;
  -- Spec 022 section 9.6: a Data Gap stays open until its named input
  -- becomes current and compatible; an operator cannot mark missing evidence
  -- fixed by assertion. 'resolved' therefore fails closed on every kind until
  -- a deterministic compatible-input path exists.
  if p_decision = 'resolved' then
    raise exception 'growth_intelligence_data_gap_resolution_forbidden' using errcode = '22023';
  end if;
  -- Spec 022 sections 9.6 and 10: each kind answers only its own
  -- questions. An Insight may be acknowledged or pinned; only a
  -- Recommendation may be planned, snoozed, or dismissed; a Data Gap takes
  -- acknowledgement or pins while it waits on evidence. The check sits after
  -- the fingerprint match and the resolution bar, so a stale reading still
  -- reports stale and a resolution attempt still reports forbidden, never
  -- merely invalid.
  if (item_row.kind = 'insight' and p_decision not in ('acknowledged', 'pinned', 'unpinned'))
    or (item_row.kind = 'recommendation' and p_decision not in (
      'acknowledged', 'pinned', 'unpinned', 'planned', 'snoozed', 'dismissed'))
    or (item_row.kind = 'data_gap' and p_decision not in ('acknowledged', 'pinned', 'unpinned'))
  then
    raise exception 'growth_intelligence_item_decision_invalid' using errcode = '22023';
  end if;
  insert into public.growth_intelligence_item_decisions (
    organization_id, growth_intelligence_item_id, actor_id,
    decision, reason, snoozed_until, item_fingerprint
  ) values (
    p_organization_id, p_item_id, p_actor_id,
    p_decision, nullif(p_reason, ''), p_snoozed_until, p_item_fingerprint
  )
  returning * into decision_row;
  return pg_catalog.jsonb_build_object(
    'decisionId', decision_row.id, 'decision', decision_row.decision
  );
end;
$$;
