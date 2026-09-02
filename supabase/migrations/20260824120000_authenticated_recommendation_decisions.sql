-- The human fence: how a member answers what the narrator said.
--
-- Storage (20260824100000) left every recommendation table writable by no
-- session at all, and the worker fence (20260824110000) gave the narrator its
-- gated write path. What was missing is the point of the whole slice: a person
-- reading a recommendation and answering it. These two RPCs are the only
-- authenticated write paths into those tables.
--
-- Triage appends an answer -- acknowledged, dismissed, or planned -- from an
-- owner, admin, or operator, matching the `recommendation.triage` tier of the
-- permission catalogue (spec 018 section 5). The decision log is append-only,
-- so a changed mind is history rather than an overwrite. Feedback records the
-- helpful/not-helpful vote, one per actor per recommendation, upserted in
-- place, and any member with a role may vote: grading the narrator takes less
-- authority than answering it.
--
-- Both functions verify that the session is the actor it claims to be, resolve
-- membership through `public.current_organization_role`, and refuse a
-- recommendation that does not resolve inside the caller's tenant --
-- indistinguishably from one that does not exist. The decision kind and the
-- dismissal reason meet the storage table's own CHECK constraints by plain
-- insertion: one authority decides what a valid answer is, and it is not this
-- function. The audit trail was wired alongside the table it watches -- every
-- inserted decision is audited as `channel_recommendation.triaged` with ids
-- and state only (20260824100000).

create function public.triage_channel_recommendation(
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

  -- Append-only by construction: the log holds every answer, and the storage
  -- migration's own trigger audits each one as it lands.
  insert into public.channel_recommendation_decisions (
    organization_id, recommendation_id, decision, dismissal_reason, actor_id
  ) values (
    p_organization_id, p_recommendation_id, p_decision, p_dismissal_reason, p_actor_id
  );
end;
$$;

create function public.record_channel_recommendation_feedback(
  p_organization_id uuid,
  p_recommendation_id uuid,
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
    raise exception 'channel recommendation feedback is not authorized' using errcode = '42501';
  end if;

  -- Any member may vote; a null role means no membership at all.
  if public.current_organization_role(p_organization_id) is null then
    raise exception 'channel recommendation feedback is not authorized' using errcode = '42501';
  end if;

  -- An abstention is not a vote.
  if p_helpful is null then
    raise exception 'channel recommendation feedback is invalid' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.channel_recommendations r
    where r.organization_id = p_organization_id and r.id = p_recommendation_id
  ) then
    raise exception 'channel recommendation was not found' using errcode = 'P0002';
  end if;

  -- Changing your mind moves the same row rather than stacking votes.
  insert into public.channel_recommendation_feedback (
    organization_id, recommendation_id, actor_id, helpful
  ) values (
    p_organization_id, p_recommendation_id, p_actor_id, p_helpful
  )
  on conflict (recommendation_id, actor_id) do update
    set helpful = excluded.helpful, updated_at = now();
end;
$$;

comment on function public.triage_channel_recommendation(uuid, uuid, text, text, uuid) is
  'Appends one human triage answer (acknowledged/dismissed/planned) to a recommendation in the caller''s organization; owner/admin/operator only.';

comment on function public.record_channel_recommendation_feedback(uuid, uuid, boolean, uuid) is
  'Upserts the calling member''s helpful/not-helpful vote on a recommendation in their organization.';

-- User-facing by design: members hold execute, workers and strangers do not.
revoke all on function public.triage_channel_recommendation(uuid, uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.record_channel_recommendation_feedback(uuid, uuid, boolean, uuid) from public, anon, authenticated;
grant execute on function public.triage_channel_recommendation(uuid, uuid, text, text, uuid) to authenticated;
grant execute on function public.record_channel_recommendation_feedback(uuid, uuid, boolean, uuid) to authenticated;
