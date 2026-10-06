-- Restore the staged question and manifest pin on admission (C03).
--
-- `20260913153000` taught `request_campaign_research_run` to store the
-- requester's `research_question` (1..2000 chars) and the pinned
-- `context_manifest_id` / `context_digest` pair on the admitted run, so the
-- worker loads them back claim-bound through `load_campaign_research_context`.
-- `20260916120000` retyped this function to record `requested_by` and in doing
-- so silently dropped all three columns: every run admitted since stores a
-- NULL question + NULL pin whatever the app sends.
--
-- This is a programmatic merge, not a rewrite. The body below is `16120000`
-- line-for-line — same permission, same policy binding, same allowance,
-- pending, cooldown and idempotency behaviour, same `requested_by = v_actor` —
-- with only the question extraction + length check, the manifest pair
-- validation + pin lookup, and the three insert columns restored from
-- `13153000`. No schema change: all four columns already exist.

create or replace function public.request_campaign_research_run(
  target_organization_id uuid,
  input_run jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_policy public.campaign_research_policies;
  v_known_version integer;
  v_budget bigint;
  v_currency char(3);
  v_trigger text;
  v_fingerprint text;
  v_digest text;
  v_key text;
  v_question text;
  v_manifest_id uuid;
  v_manifest_digest text;
  v_manifest public.memory_context_manifests;
  v_existing public.campaign_research_runs;
  v_pending integer;
  v_spent bigint;
  v_last_admitted timestamptz;
  v_run public.campaign_research_runs;
begin
  v_actor := (select auth.uid());
  if v_actor is null then
    raise exception 'campaign_research_forbidden' using errcode = '42501';
  end if;
  if not private.has_organization_permission(target_organization_id, 'campaign.research_request') then
    raise exception 'campaign_research_forbidden' using errcode = '42501';
  end if;

  v_trigger := input_run ->> 'trigger_kind';
  if v_trigger not in ('business_signal', 'scheduled', 'manual_request', 'next_test') then
    raise exception 'campaign_research_invalid' using errcode = '22023';
  end if;
  v_budget := (input_run ->> 'budget_minor')::bigint;
  v_currency := input_run ->> 'allowance_currency';
  v_fingerprint := nullif(input_run ->> 'source_fingerprint', '');
  v_digest := input_run ->> 'request_digest';
  v_key := input_run ->> 'idempotency_key';
  v_question := nullif(input_run ->> 'research_question', '');
  if v_budget is null or v_budget < 0 then
    raise exception 'campaign_research_invalid' using errcode = '22023';
  end if;
  if v_currency is null or v_currency !~ '^[A-Z]{3}$' then
    raise exception 'campaign_research_invalid' using errcode = '22023';
  end if;
  if v_key is null or char_length(v_key) not between 8 and 200 then
    raise exception 'campaign_research_invalid' using errcode = '22023';
  end if;
  if v_digest is null or v_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'campaign_research_invalid' using errcode = '22023';
  end if;
  if v_question is not null and char_length(v_question) > 2000 then
    raise exception 'campaign_research_invalid' using errcode = '22023';
  end if;
  v_known_version := nullif(input_run ->> 'known_policy_version', '')::integer;

  v_manifest_id := nullif(input_run ->> 'context_manifest_id', '')::uuid;
  v_manifest_digest := nullif(input_run ->> 'context_digest', '');
  if (v_manifest_id is null) <> (v_manifest_digest is null) then
    raise exception 'campaign_research_invalid' using errcode = '22023';
  end if;
  if v_manifest_digest is not null and v_manifest_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'campaign_research_invalid' using errcode = '22023';
  end if;
  if v_manifest_id is not null then
    select * into v_manifest
    from public.memory_context_manifests manifest
    where manifest.organization_id = target_organization_id
      and manifest.id = v_manifest_id;
    if v_manifest.id is null or v_manifest.context_digest <> v_manifest_digest then
      raise exception 'campaign_research_invalid' using errcode = '22023';
    end if;
  end if;

  -- The lock that makes admission single-file per organization.
  select policy.* into v_policy
  from public.campaign_research_policy_current current_pointer
  join public.campaign_research_policies policy on policy.id = current_pointer.policy_id
  where current_pointer.organization_id = target_organization_id
  for update of current_pointer;

  if v_policy.id is null or not v_policy.enabled then
    raise exception 'campaign_research_needs_setup';
  end if;
  if v_known_version is not null and v_known_version <> v_policy.version then
    raise exception 'campaign_research_stale_policy';
  end if;
  if v_currency <> v_policy.allowance_currency then
    raise exception 'campaign_research_currency_mismatch';
  end if;

  select * into v_existing
  from public.campaign_research_runs run
  where run.organization_id = target_organization_id
    and run.idempotency_key = v_key;
  if v_existing.id is not null then
    return jsonb_build_object('run_id', v_existing.id, 'outcome', 'replayed');
  end if;

  select count(*) into v_pending
  from public.campaign_research_runs run
  where run.organization_id = target_organization_id
    and run.status in ('queued', 'claimed');
  if v_pending >= v_policy.max_pending_proposals then
    raise exception 'campaign_research_pending_limit';
  end if;

  if v_budget > v_policy.per_run_allowance_minor then
    raise exception 'campaign_research_allowance_exceeded';
  end if;

  select coalesce(sum(run.budget_minor), 0) into v_spent
  from public.campaign_research_runs run
  where run.organization_id = target_organization_id
    and run.status in ('queued', 'claimed', 'succeeded')
    and run.allowance_currency = v_policy.allowance_currency
    -- Open runs have no end yet; their reservation counts in full. A finished
    -- run counts while its completion sits inside the policy window.
    and (run.ended_at is null or run.ended_at > now() - (v_policy.window_days || ' days')::interval);
  if v_spent + v_budget > v_policy.window_allowance_minor then
    raise exception 'campaign_research_allowance_exceeded';
  end if;

  select max(run.started_at) into v_last_admitted
  from public.campaign_research_runs run
  where run.organization_id = target_organization_id;
  if v_last_admitted is not null
    and v_policy.cooldown_seconds > 0
    and v_last_admitted > now() - (v_policy.cooldown_seconds || ' seconds')::interval then
    raise exception 'campaign_research_cooldown';
  end if;

  insert into public.campaign_research_runs (
    organization_id, trigger_kind, policy_version, budget_minor,
    allowance_currency, source_fingerprint, request_digest, idempotency_key,
    research_question, context_manifest_id, context_digest, started_at,
    -- Who asked, in their own words, and the context they pinned: carried
    -- from the staged request onto the admitted run.
    requested_by
  ) values (
    target_organization_id, v_trigger, v_policy.version, v_budget,
    v_currency, v_fingerprint, v_digest, v_key,
    v_question, v_manifest_id, v_manifest_digest, now(), v_actor
  )
  returning * into v_run;

  insert into public.campaign_research_events (organization_id, run_id, event, payload)
  values (
    target_organization_id, v_run.id, 'campaign.proposal_requested',
    jsonb_build_object(
      'run_id', v_run.id,
      'trigger_kind', v_trigger,
      'policy_version', v_policy.version,
      'budget_minor', v_budget,
      'allowance_currency', v_currency
    )
  );

  return jsonb_build_object('run_id', v_run.id, 'outcome', 'saved');
end;
$$;
