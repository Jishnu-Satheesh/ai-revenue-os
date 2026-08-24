-- Snapshot the hand that answered: who triaged a recommendation, by name.
--
-- The read side (Task 10) originally resolved decision actors' display names
-- at page time through the caller's own session -- and profiles carry only a
-- "read your own row" policy (20260807000000), so every teammate's name read
-- as "Unknown". A service-role lookup would have fixed the name by breaking
-- the rule that user-facing reads go through RLS. The honest fix is to write
-- the name down when it is known: `triage_channel_recommendation` already runs
-- definer-side for authorization, so it resolves the actor's display name from
-- public.profiles there and stores it beside the answer.
--
-- The snapshot is taken once, at answer time -- it does not track later
-- profile renames, which is the point: the log records who answered as they
-- were known then, append-only history like everything else in this table.

alter table public.channel_recommendation_decisions
  add column actor_display_name text not null default 'Unknown';

comment on column public.channel_recommendation_decisions.actor_display_name is
  'The actor''s display name as resolved inside the triage function''s definer context at answer time; ''Unknown'' when no readable profile row existed. Not updated by later profile changes.';

-- History already on the table gets the same resolution once, here, where the
-- migration's own privileges may read profiles; rows whose actor has no
-- profile row keep the default.
update public.channel_recommendation_decisions d
set actor_display_name = coalesce(nullif(btrim(p.display_name), ''), 'Unknown')
from public.profiles p
where p.id = d.actor_id;

create or replace function public.triage_channel_recommendation(
  p_organization_id uuid,
  p_recommendation_id uuid,
  p_decision text,
  p_dismissal_reason text,
  p_actor_id uuid
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
    actor_display_name
  ) values (
    p_organization_id, p_recommendation_id, p_decision, p_dismissal_reason, p_actor_id,
    coalesce(v_actor_display_name, 'Unknown')
  );
end;
$$;
