-- Repair: the Task 17 kind gate shadowed the resolution bar, so a
-- 'resolved' attempt reported invalid instead of forbidden. Same function,
-- same signature and grants; only the check order changes: stale, then
-- forbidden, then kind-invalid.
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
