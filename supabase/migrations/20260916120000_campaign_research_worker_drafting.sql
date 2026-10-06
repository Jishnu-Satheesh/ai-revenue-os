-- Let the research worker draft a proposal, without letting it approve one.
--
-- Spec 025 built the research machine to write campaign proposals and then made
-- that impossible. `20260913120000` ends with:
--
--   revoke all on function public.request_campaign_proposal(uuid, jsonb),
--     public.complete_campaign_proposal_version(uuid, jsonb),
--     public.decide_campaign_proposal(uuid, jsonb)
--     from public, anon, authenticated, service_role;
--
-- and grants execute back to `authenticated` only. The research worker runs as
-- `service_role`, so its very first proposal write returns 42501 and the run
-- fails. Confirmed against staging before this migration was written.
--
-- That revoke justifies itself by saying a background worker must never
-- APPROVE a proposal: "approval is a person agreeing to spend their own money,
-- and nothing that runs unattended may stand in for that." That reasoning is
-- exactly right, and `decide_campaign_proposal` is untouched here — it stays
-- revoked from `service_role` for good. But the reasoning does not describe
-- DRAFTING. Writing the argument is the worker's whole job; agreeing to it is
-- the person's. The revoke was broader than the rule it was protecting.
--
-- The fix is not "trust the worker". A worker gets no authority from being
-- `service_role`. It gets authority from THE ADMITTED RUN IT HOLDS A LIVE CLAIM
-- ON — a run a person authorized by setting a research policy, admitted against
-- that policy's allowance, cooldown and pending cap, and claimed with a token
-- and a lease. Present that claim and you may draft the proposal that run was
-- admitted to produce. Present nothing and you are refused exactly as before.
--
-- Additive and forward-only. The member path through both functions is
-- unchanged: same `auth.uid()`, same permission, same refusals.

-- 1. Who asked for the research ----------------------------------------------
--
-- A proposal row records `created_by`, and it is `not null`. On the worker path
-- there is no session actor to record, and inventing one — a nil uuid, the
-- first owner, a service account — would put a name against a decision that
-- person did not make.
--
-- The true answer already exists upstream: somebody asked for this research.
-- The run did not record who, so it does so now, and a worker-drafted proposal
-- is attributed to the person whose request produced it. That is accurate, and
-- it is what an audit needs to follow the chain from policy to proposal.
--
-- Nullable rather than `not null`: every run admitted before this migration has
-- no recorded requester (there are none today, but a backfill guess would be a
-- fabricated attribution). The worker path below refuses such a run by name
-- instead of drafting an unattributable proposal.

alter table public.campaign_research_runs
  add column requested_by uuid references auth.users(id) on delete restrict;

comment on column public.campaign_research_runs.requested_by is
  'The person whose request admitted this run. Carried onto any proposal the worker drafts from it, because a proposal records who it came from and a worker is not a who.';

-- 2. Admission records the requester ------------------------------------------
--
-- Unchanged except for the new column: same permission, same policy binding,
-- same allowance, pending, cooldown and idempotency behaviour.

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
  v_known_version := nullif(input_run ->> 'known_policy_version', '')::integer;

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
    allowance_currency, source_fingerprint, request_digest, idempotency_key, started_at,
    -- The only change to this function: who asked. Everything above is the
    -- admission logic exactly as `20260913150000` wrote it.
    requested_by
  ) values (
    target_organization_id, v_trigger, v_policy.version, v_budget,
    v_currency, v_fingerprint, v_digest, v_key, now(), v_actor
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

-- 3. Opening a proposal --------------------------------------------------------
--
-- Two arms, and only two. A session actor takes the member arm exactly as
-- before. No session actor means the caller can only be `service_role`, since
-- no other role holds EXECUTE — and that arm proves a live claim or is refused.
--
-- The branch is safe because the worker arm is not a weaker check, it is a
-- different one: a claim token for a run in `claimed` state with an unexpired
-- lease. Only the worker that claimed the run holds that token. Reaching this
-- arm without one gets nothing.

create or replace function public.request_campaign_proposal(
  target_organization_id uuid,
  input_proposal jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.campaign_proposals;
  existing public.campaign_proposals;
  fingerprint text;
  v_actor uuid;
  v_run_id uuid;
  v_claim_token uuid;
  v_run public.campaign_research_runs;
  -- Whose name goes on what gets written. Never invented.
  v_author uuid;
begin
  v_actor := (select auth.uid());
  v_run_id := nullif(input_proposal ->> 'research_run_id', '')::uuid;
  v_claim_token := nullif(input_proposal ->> 'research_claim_token', '')::uuid;

  if v_actor is not null then
    -- The member arm, unchanged.
    if not private.has_organization_permission(target_organization_id, 'campaign.create') then
      raise exception 'campaign_proposal_forbidden' using errcode = '42501';
    end if;
    v_author := v_actor;
  else
    -- The worker arm. Only `service_role` can reach it, because no other role
    -- holds EXECUTE -- but the role is not what admits it. A live claim is.
    if v_run_id is null or v_claim_token is null then
      raise exception 'campaign_proposal_forbidden' using errcode = '42501';
    end if;

    select * into v_run
    from public.campaign_research_runs run
    where run.organization_id = target_organization_id
      and run.id = v_run_id
      and run.status = 'claimed'
      and run.claim_token = v_claim_token
      and run.lease_expires_at > now()
    for update;

    if not found then
      -- Cancelled, taken over, or the lease lapsed. Named as the claim being
      -- gone rather than as a permission problem: the worker's job now is to
      -- stand down, not to retry with different credentials.
      raise exception 'campaign_research_claim_lost' using errcode = 'P0002';
    end if;

    -- A run admitted before requesters were recorded cannot attribute what it
    -- drafts. Refused by name rather than attributed to nobody.
    if v_run.requested_by is null then
      raise exception 'campaign_research_requester_unknown' using errcode = '22023';
    end if;
    v_author := v_run.requested_by;
  end if;

  fingerprint := nullif(pg_catalog.btrim(input_proposal ->> 'dedupe_fingerprint'), '');

  -- A repeated signal joins the proposal already open for it rather than
  -- opening a second one that a person would have to reconcile by hand. Only
  -- live states coalesce; a dismissed proposal does not silently reopen.
  if fingerprint is not null then
    select * into existing
    from public.campaign_proposals proposal
    where proposal.organization_id = target_organization_id
      and proposal.dedupe_fingerprint = fingerprint
      and proposal.state in ('researching', 'needs_input', 'ready_for_review', 'changes_requested')
    order by proposal.created_at asc
    limit 1;

    if found then
      -- A run that joined an existing proposal is still bound to it, so the
      -- version writer below can recognise what this claim may write into.
      if v_run.id is not null then
        update public.campaign_research_runs run
        set proposal_id = existing.id
        where run.organization_id = target_organization_id
          and run.id = v_run.id
          and run.proposal_id is null;
      end if;
      return pg_catalog.jsonb_build_object(
        'proposal_id', existing.id,
        'outcome', 'replayed'
      );
    end if;
  end if;

  insert into public.campaign_proposals
    (organization_id, source_kind, source_id, dedupe_fingerprint, state, created_by)
  values (
    target_organization_id,
    input_proposal ->> 'source_kind',
    nullif(input_proposal ->> 'source_id', '')::uuid,
    fingerprint,
    coalesce(nullif(input_proposal ->> 'state', ''), 'researching'),
    v_author
  )
  returning * into saved;

  -- Bound to the run now, not at completion. This link is exactly what the
  -- version writer checks, so a worker holding a claim on one run can never
  -- write into a proposal that run did not open.
  if v_run.id is not null then
    update public.campaign_research_runs run
    set proposal_id = saved.id
    where run.organization_id = target_organization_id
      and run.id = v_run.id;
  end if;

  return pg_catalog.jsonb_build_object('proposal_id', saved.id, 'outcome', 'saved');
end;
$$;

-- 4. Writing a version ---------------------------------------------------------
--
-- Same two arms, plus one check the opener does not need: the run must already
-- own this exact proposal. A live claim says "you are the worker for run A"; it
-- must not also say "you may write into anyone's proposal".

create or replace function public.complete_campaign_proposal_version(
  target_organization_id uuid,
  input_version jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_proposal public.campaign_proposals;
  saved public.campaign_proposal_versions;
  next_version integer;
  v_actor uuid;
  v_run_id uuid;
  v_claim_token uuid;
  v_run public.campaign_research_runs;
  -- Whose name goes on what gets written. Never invented.
  v_author uuid;
begin
  v_actor := (select auth.uid());
  v_run_id := nullif(input_version ->> 'research_run_id', '')::uuid;
  v_claim_token := nullif(input_version ->> 'research_claim_token', '')::uuid;

  if v_actor is not null then
    -- The member arm, unchanged.
    if not private.has_organization_permission(target_organization_id, 'campaign.edit') then
      raise exception 'campaign_proposal_forbidden' using errcode = '42501';
    end if;
    v_author := v_actor;
  else
    if v_run_id is null or v_claim_token is null then
      raise exception 'campaign_proposal_forbidden' using errcode = '42501';
    end if;

    select * into v_run
    from public.campaign_research_runs run
    where run.organization_id = target_organization_id
      and run.id = v_run_id
      and run.status = 'claimed'
      and run.claim_token = v_claim_token
      and run.lease_expires_at > now();

    if not found then
      raise exception 'campaign_research_claim_lost' using errcode = 'P0002';
    end if;

    -- The check that keeps a claim narrow. Without it a live claim on any run
    -- would be a key to every proposal in the organization.
    if v_run.proposal_id is distinct from (input_version ->> 'proposal_id')::uuid then
      raise exception 'campaign_proposal_forbidden' using errcode = '42501';
    end if;

    if v_run.requested_by is null then
      raise exception 'campaign_research_requester_unknown' using errcode = '22023';
    end if;
    v_author := v_run.requested_by;
  end if;

  select * into target_proposal
  from public.campaign_proposals proposal
  where proposal.organization_id = target_organization_id
    and proposal.id = (input_version ->> 'proposal_id')::uuid
  for update;

  if not found then
    raise exception 'campaign_proposal_not_found' using errcode = 'P0002';
  end if;

  -- A decided proposal does not quietly gain a new revision underneath its
  -- decision. Asking for changes is what reopens it.
  if target_proposal.state in ('approved_for_preparation', 'dismissed', 'superseded', 'cancelled') then
    raise exception 'campaign_proposal_not_revisable' using errcode = '22023';
  end if;

  select coalesce(pg_catalog.max(version), 0) + 1 into next_version
  from public.campaign_proposal_versions version_row
  where version_row.organization_id = target_organization_id
    and version_row.proposal_id = target_proposal.id;

  insert into public.campaign_proposal_versions
    (organization_id, proposal_id, version, document, digest, source_revision_manifest, created_by)
  values (
    target_organization_id,
    target_proposal.id,
    next_version,
    input_version -> 'document',
    input_version ->> 'digest',
    coalesce(input_version -> 'source_revision_manifest', '{}'::jsonb),
    v_author
  )
  returning * into saved;

  update public.campaign_proposals
  set current_version_id = saved.id,
      state = coalesce(nullif(input_version ->> 'state', ''), 'ready_for_review'),
      snoozed_until = null,
      updated_at = pg_catalog.now()
  where organization_id = target_organization_id
    and id = target_proposal.id;

  return pg_catalog.jsonb_build_object(
    'proposal_version_id', saved.id,
    'version', saved.version,
    'digest', saved.digest
  );
end;
$$;

-- 5. Grants ---------------------------------------------------------------------
--
-- Drafting only. `decide_campaign_proposal` is deliberately absent from this
-- list and stays revoked from `service_role`: approving a proposal is a person
-- agreeing to spend their own money, and nothing unattended stands in for that.

grant execute on function public.request_campaign_proposal(uuid, jsonb) to service_role;
grant execute on function public.complete_campaign_proposal_version(uuid, jsonb) to service_role;
