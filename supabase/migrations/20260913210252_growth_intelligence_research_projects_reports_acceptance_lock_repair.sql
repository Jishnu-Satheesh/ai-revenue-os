-- Repair: rename accept_draft_item PL/pgSQL variables that collide with
-- growth_intelligence_acceptances columns (late-binding ambiguity).
-- Base migration 20260913202720 (and replay repair 20260913205527, which does
-- not touch this function) already applied to shared staging, so this ships as
-- a forward migration. acceptance_key -> v_acceptance_key and
-- destination -> v_destination at declaration and all variable use sites;
-- column references, conflict target, and composite field accesses unchanged.
-- Semantics byte-identical otherwise.

create or replace function public.accept_draft_item(
  p_organization_id uuid,
  p_actor_id uuid,
  p_report_version_id uuid,
  p_item_key text,
  p_kind text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft_row public.growth_intelligence_draft_items;
  kept public.growth_intelligence_acceptances;
  inserted public.growth_intelligence_acceptances;
  v_acceptance_key text;
  v_destination text;
  remaining integer;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role'
    and (
      (select auth.uid()) is distinct from p_actor_id
      or not private.has_organization_permission(p_organization_id, 'growth_intelligence.manage')
    ) then
    raise exception 'draft_acceptance_forbidden' using errcode = '42501';
  end if;
  if p_organization_id is null
    or p_report_version_id is null
    or p_item_key is null
    or pg_catalog.char_length(p_item_key) not between 1 and 160
    or p_kind not in ('action', 'finding') then
    raise exception 'draft_acceptance_invalid' using errcode = '22023';
  end if;

  select item.* into draft_row
  from public.growth_intelligence_draft_items item
  where item.organization_id = p_organization_id
    and item.report_version_id = p_report_version_id
    and item.item_key = p_item_key;
  if not found then
    raise exception 'draft_item_not_found' using errcode = '42501';
  end if;
  -- The acceptance kind must match the draft item it accepts: a key presented
  -- for another type is a conflict, never a silent overwrite.
  if draft_row.kind is distinct from p_kind then
    raise exception 'draft_acceptance_kind_conflict' using errcode = '23505';
  end if;

  v_acceptance_key := p_report_version_id::text || ':' || p_item_key;
  v_destination := case when p_kind = 'action' then 'Recommendations' else 'Insights' end;

  -- One serialized acceptance per report, taken before the per-key lock so
  -- concurrent transactions always acquire the two locks in the same order.
  -- The flip counts remaining items across keys, so without this lock two
  -- concurrent accepts of the last two items could each see remaining = 1
  -- under READ COMMITTED and neither would flip the report to accepted.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.concat_ws(
      '|', 'growth_intelligence', 'accept_draft_item',
      p_organization_id, p_report_version_id
    ),
    0
  ));

  -- One serialized acceptance per key: concurrent accepts converge on the
  -- single kept row instead of duplicating feed items.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.concat_ws(
      '|', 'growth_intelligence', 'accept_draft_item',
      p_organization_id, v_acceptance_key
    ),
    0
  ));

  insert into public.growth_intelligence_acceptances (
    organization_id, acceptance_key, report_version_id, item_key,
    kind, destination, accepted_by
  ) values (
    p_organization_id, v_acceptance_key, p_report_version_id, p_item_key,
    p_kind, v_destination, p_actor_id
  )
  on conflict (organization_id, acceptance_key) do nothing
  returning * into inserted;

  if found then
    -- The report leaves pending review once every draft item it carries has
    -- been accepted; the content itself never changes.
    select pg_catalog.count(*) into remaining
    from public.growth_intelligence_draft_items item
    where item.organization_id = p_organization_id
      and item.report_version_id = p_report_version_id
      and not exists (
        select 1 from public.growth_intelligence_acceptances acceptance
        where acceptance.organization_id = p_organization_id
          and acceptance.report_version_id = p_report_version_id
          and acceptance.item_key = item.item_key
      );
    if remaining = 0 then
      update public.growth_intelligence_reports report
      set review_state = 'accepted'
      where report.organization_id = p_organization_id
        and report.report_version_id = p_report_version_id
        and report.review_state = 'pending_review';
    end if;
    return pg_catalog.jsonb_build_object(
      'acceptanceKey', inserted.acceptance_key,
      'destination', inserted.destination,
      'grantsExecutionApproval', inserted.grants_execution_approval,
      'outcome', 'accepted'
    );
  end if;

  select acceptance.* into kept
  from public.growth_intelligence_acceptances acceptance
  where acceptance.organization_id = p_organization_id
    and acceptance.acceptance_key = v_acceptance_key;
  if kept.kind is distinct from p_kind then
    raise exception 'draft_acceptance_kind_conflict' using errcode = '23505';
  end if;
  -- A replayed acceptance retries the flip too: if an earlier concurrent
  -- accept lost the race and left the report pending with every item
  -- accepted, the next replay converges it to accepted. The update stays
  -- conditional on pending_review, so replays never move a decided report.
  select pg_catalog.count(*) into remaining
  from public.growth_intelligence_draft_items item
  where item.organization_id = p_organization_id
    and item.report_version_id = p_report_version_id
    and not exists (
      select 1 from public.growth_intelligence_acceptances acceptance
      where acceptance.organization_id = p_organization_id
        and acceptance.report_version_id = p_report_version_id
        and acceptance.item_key = item.item_key
    );
  if remaining = 0 then
    update public.growth_intelligence_reports report
    set review_state = 'accepted'
    where report.organization_id = p_organization_id
      and report.report_version_id = p_report_version_id
      and report.review_state = 'pending_review';
  end if;
  return pg_catalog.jsonb_build_object(
    'acceptanceKey', kept.acceptance_key,
    'destination', kept.destination,
    'grantsExecutionApproval', kept.grants_execution_approval,
    'outcome', 'already_accepted'
  );
end;
$$;
