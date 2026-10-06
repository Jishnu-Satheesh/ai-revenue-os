-- Task 16: an organization can actually set its research policy (C03, D06).
--
-- Task 6 built the whole research machine — admission, allowances, cooldown,
-- the claim lifecycle, the worker — against a policy table that nothing could
-- write. `set_campaign_research_policy_current` moves a pointer at a policy
-- that must already exist, and no function ever created one. No grant, no
-- insert path, no caller. So research could never be switched on by anybody,
-- and every part of it above was unreachable.
--
-- This is the missing writer. It creates a new immutable version and moves the
-- current pointer to it in one statement, because those two facts must not be
-- separable: a version nothing points at authorizes no spending, and a pointer
-- at a half-written version authorizes spending nobody described.
--
-- Versions are never edited. Every run records the version that admitted it, so
-- changing a policy in place would retroactively rewrite what earlier spending
-- was allowed to be.

create function public.save_campaign_research_policy(
  target_organization_id uuid,
  input_policy jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_next_version integer;
  v_policy public.campaign_research_policies;
begin
  v_actor := (select auth.uid());
  if v_actor is null then
    raise exception 'campaign_research_forbidden' using errcode = '42501';
  end if;
  -- The same permission that admits a run. Whoever may spend the allowance is
  -- whoever may set it; splitting those would let someone raise a ceiling they
  -- are not trusted to spend against.
  if not private.has_organization_permission(target_organization_id, 'campaign.research_request') then
    raise exception 'campaign_research_forbidden' using errcode = '42501';
  end if;

  -- Serialized per organization for the rest of the transaction, so two people
  -- saving at once cannot mint the same version number or leave the pointer at
  -- the loser of a race. An advisory lock rather than `for update`, because the
  -- row to lock is the one about to be created and there is nothing to hold on
  -- the very first save. The unique (organization_id, version) index is still
  -- the backstop if this is ever bypassed.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('campaign_research_policy:' || target_organization_id::text)
  );

  select coalesce(pg_catalog.max(policy.version), 0) + 1 into v_next_version
  from public.campaign_research_policies policy
  where policy.organization_id = target_organization_id;

  insert into public.campaign_research_policies (
    organization_id, version, enabled, schedule_timezone,
    evidence_qualification_rule_version, evidence_max_age_days,
    cooldown_seconds, max_pending_proposals, max_attempts,
    per_run_allowance_minor, window_allowance_minor, allowance_currency,
    window_days, created_by
  ) values (
    target_organization_id,
    v_next_version,
    coalesce((input_policy ->> 'enabled')::boolean, false),
    input_policy ->> 'schedule_timezone',
    input_policy ->> 'evidence_qualification_rule_version',
    (input_policy ->> 'evidence_max_age_days')::integer,
    (input_policy ->> 'cooldown_seconds')::integer,
    (input_policy ->> 'max_pending_proposals')::integer,
    (input_policy ->> 'max_attempts')::integer,
    (input_policy ->> 'per_run_allowance_minor')::bigint,
    (input_policy ->> 'window_allowance_minor')::bigint,
    input_policy ->> 'allowance_currency',
    (input_policy ->> 'window_days')::integer,
    v_actor
  )
  returning * into v_policy;

  -- Atomic with the insert on purpose. Every table check above has already
  -- fired by this point, so the pointer can only ever name a complete version.
  insert into public.campaign_research_policy_current (
    organization_id, policy_id, set_by
  ) values (
    target_organization_id, v_policy.id, v_actor
  )
  on conflict (organization_id) do update
    set policy_id = excluded.policy_id,
        set_by = excluded.set_by,
        set_at = now();

  return jsonb_build_object(
    'policy_id', v_policy.id,
    'version', v_policy.version,
    'enabled', v_policy.enabled
  );
end;
$$;

revoke all on function public.save_campaign_research_policy(uuid, jsonb) from public, anon;
grant execute on function public.save_campaign_research_policy(uuid, jsonb) to authenticated;
