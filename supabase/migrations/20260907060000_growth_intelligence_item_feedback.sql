-- Growth Intelligence synthesized-item helpfulness votes.
--
-- Channel Recommendations already separate the triage answer ("we acted on
-- this") from the helpfulness vote ("this was useful") through
-- `channel_recommendation_feedback` and `record_channel_recommendation_feedback`
-- (20260824100000, 20260824120000). Synthesized Growth Intelligence items had
-- decisions and pins but no equivalent vote, so the redesigned workspace could
-- show thumbs up/down controls with nowhere to save them. This migration adds
-- the narrow missing piece and nothing else: one vote row per actor per item,
-- upserted in place, through one fenced member RPC.
--
-- The rules mirror the channel precedent exactly:
-- - voting takes less authority than answering, so any organization member
--   with `growth_intelligence.read` (viewer and above) may vote; triage keeps
--   its `growth_intelligence.manage` gate inside `decide_growth_intelligence_item`;
-- - a vote outside the caller's tenant is refused exactly like a vote on an
--   item that does not exist, so nothing about a neighbour's intelligence leaks;
-- - changing your mind moves the same row rather than stacking votes;
-- - sessions read through RLS and never write directly; the worker never calls
--   the member RPC.

create table public.growth_intelligence_item_feedback (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  growth_intelligence_item_id uuid not null,
  actor_id uuid not null,
  helpful boolean not null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  primary key (growth_intelligence_item_id, actor_id),
  foreign key (organization_id, growth_intelligence_item_id)
    references public.growth_intelligence_items(organization_id, id) on delete restrict
);

comment on table public.growth_intelligence_item_feedback is
  'One helpfulness vote per actor per synthesized intelligence item.';

create index growth_intelligence_item_feedback_item_idx
  on public.growth_intelligence_item_feedback (organization_id, growth_intelligence_item_id);

revoke all on table public.growth_intelligence_item_feedback
  from public, anon, authenticated, service_role;

alter table public.growth_intelligence_item_feedback enable row level security;
alter table public.growth_intelligence_item_feedback force row level security;

-- Readable, never writable, from a session. The only write path is the member
-- RPC below, mirroring how channel_recommendation_feedback grants readability.
create policy "members with growth intelligence read can view item feedback"
on public.growth_intelligence_item_feedback for select to authenticated
using ((organization_id in (select private.organizations_with_permission('growth_intelligence.read'::text))));

grant select on table public.growth_intelligence_item_feedback to authenticated;

create function public.record_growth_intelligence_item_feedback(
  p_organization_id uuid,
  p_item_id uuid,
  p_helpful boolean,
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is distinct from p_actor_id then
    raise exception 'growth intelligence item feedback is not authorized' using errcode = '42501';
  end if;

  -- Any member may vote; a null grant means no membership at all. Viewers grade
  -- the narration while operators answer it, exactly as channel feedback allows
  -- any role to vote while triage keeps its higher gate.
  if not private.has_organization_permission(p_organization_id, 'growth_intelligence.read') then
    raise exception 'growth intelligence item feedback is not authorized' using errcode = '42501';
  end if;

  -- An abstention is not a vote.
  if p_helpful is null then
    raise exception 'growth intelligence item feedback is invalid' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.growth_intelligence_items item
    where item.organization_id = p_organization_id
      and item.id = p_item_id
  ) then
    raise exception 'growth intelligence item was not found' using errcode = 'P0002';
  end if;

  -- Changing your mind moves the same row rather than stacking votes.
  insert into public.growth_intelligence_item_feedback (
    organization_id, growth_intelligence_item_id, actor_id, helpful
  ) values (
    p_organization_id, p_item_id, p_actor_id, p_helpful
  )
  on conflict (growth_intelligence_item_id, actor_id) do update
    set helpful = excluded.helpful, updated_at = pg_catalog.now();
end;
$$;

comment on function public.record_growth_intelligence_item_feedback(uuid, uuid, boolean, uuid) is
  'Upserts the calling member''s helpful/not-helpful vote on a synthesized intelligence item in their organization.';

-- User-facing by design: members hold execute, workers and strangers do not,
-- mirroring the channel feedback grants and the service-role denial there.
revoke all on function public.record_growth_intelligence_item_feedback(uuid, uuid, boolean, uuid) from public, anon, authenticated;
grant execute on function public.record_growth_intelligence_item_feedback(uuid, uuid, boolean, uuid) to authenticated;
revoke all on function public.record_growth_intelligence_item_feedback(uuid, uuid, boolean, uuid) from service_role;
