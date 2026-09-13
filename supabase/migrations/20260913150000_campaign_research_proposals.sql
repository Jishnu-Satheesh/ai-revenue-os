-- Task 6 — campaign research runs, policy, and durable events (C03, D06).
--
-- Research costs real money through qualified external providers, so every run
-- is admitted against explicit organization configuration before any billable
-- work happens. Missing settings produce "needs setup", never a default that
-- spends. Research allowance is distinct from media spend and from the
-- creative preparation allowance.
--
-- Enforcement lives in two places on purpose, mirroring the proposal gates:
-- the domain judges content and produces precise refusal reasons, while these
-- functions own everything about concurrency (idempotent admission under race,
-- claim/lease, exactly-once completion). A refusal reason from the
-- application is advisory; a refusal from these functions is final.
--
-- Additive and forward-only. No existing object is altered. The new permission
-- seed uses the bare `on conflict do nothing` form the drift parser requires.

-- 1. The research capability ----------------------------------------------------
--
-- Requesting research authorizes spending the research allowance, so it is an
-- owner/admin capability like proposal approval — deliberately not the broader
-- `campaign.edit`, because the person who drafts proposals must not be able
-- to commission paid research on their own authority.

insert into public.permissions (key, description, scope) values
  ('campaign.research_request', 'Request campaign research against the research allowance.', 'organization')
on conflict do nothing;

insert into public.organization_role_permissions (organization_role, permission_key) values
  ('owner', 'campaign.research_request'),
  ('admin', 'campaign.research_request')
on conflict do nothing;

-- 2. Policy ---------------------------------------------------------------------

create table public.campaign_research_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Immutable version. Every run records the version that admitted it, so a
  -- later policy change can never retroactively authorize earlier spending.
  version integer not null check (version > 0),
  -- New policies start switched off: nothing spends until someone explicitly
  -- enables research for the organization.
  enabled boolean not null default false,
  schedule_timezone text not null default 'UTC' check (char_length(schedule_timezone) between 1 and 80),
  evidence_qualification_rule_version text not null check (
    char_length(evidence_qualification_rule_version) between 1 and 80
  ),
  cooldown_seconds integer not null default 0 check (cooldown_seconds between 0 and 31536000),
  max_pending_proposals integer not null check (max_pending_proposals between 1 and 100),
  per_run_allowance_minor bigint not null check (per_run_allowance_minor >= 0),
  window_allowance_minor bigint not null check (window_allowance_minor >= 0),
  allowance_currency char(3) not null check (allowance_currency ~ '^[A-Z]{3}$'),
  window_days integer not null check (window_days between 1 and 365),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (window_allowance_minor >= per_run_allowance_minor),
  unique (organization_id, version)
);

-- The one policy that binds the organization. History is preserved in the
-- policies table; this pointer only ever moves forward.
create table public.campaign_research_policy_current (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  policy_id uuid not null references public.campaign_research_policies(id) on delete restrict,
  set_by uuid not null references auth.users(id) on delete restrict,
  set_at timestamptz not null default now()
);

-- 3. Runs ------------------------------------------------------------------------

create table public.campaign_research_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Set once the run produces (or attaches to) a proposal. Null before that:
  -- research precedes the proposal, not the other way round.
  proposal_id uuid,
  foreign key (organization_id, proposal_id)
    references public.campaign_proposals (organization_id, id) on delete set null,
  -- What triggered this run. Not a campaign source kind: why research began is
  -- independent of where any resulting proposal ends up.
  trigger_kind text not null check (
    trigger_kind in ('business_signal', 'scheduled', 'manual_request', 'next_test')
  ),
  -- The exact policy version that admitted this run. Compared again before any
  -- further billable work, so a revised policy stops work it never authorized.
  policy_version integer not null check (policy_version > 0),
  status text not null default 'queued' check (
    status in ('queued', 'claimed', 'succeeded', 'failed', 'cancelled')
  ),
  attempt integer not null default 0 check (attempt >= 0),
  claim_token uuid,
  lease_expires_at timestamptz,
  -- A repeated signal finds its existing run instead of opening a second one.
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  request_digest text not null check (request_digest ~ '^[0-9a-f]{64}$'),
  -- Only the manifest identity and digest travel in the run row. Entry bytes
  -- stay in Business Memory behind its own access rules.
  context_manifest_id uuid,
  context_digest text check (context_digest ~ '^[0-9a-f]{64}$'),
  check ((context_manifest_id is null) = (context_digest is null)),
  qualified_research_request_ids uuid[] not null default '{}',
  budget_minor bigint not null check (budget_minor >= 0),
  -- Measured spend, including failed calls. Unknown stays zero only until the
  -- first measurement lands; a run never reports zero cost because an attempt
  -- failed.
  actual_cost_minor bigint not null default 0 check (actual_cost_minor >= 0),
  allowance_currency char(3) not null check (allowance_currency ~ '^[A-Z]{3}$'),
  source_fingerprint text,
  started_at timestamptz,
  ended_at timestamptz,
  -- Safe outcome only: identifiers and codes, never provider payloads, model
  -- output, or customer text.
  outcome text check (outcome is null or char_length(outcome) between 1 and 120),
  failure_code text check (failure_code is null or char_length(failure_code) between 1 and 120),
  check ((status = 'claimed') = (claim_token is not null)),
  check ((claim_token is null) = (lease_expires_at is null)),
  check (status <> 'succeeded' or outcome is not null),
  check (status <> 'failed' or failure_code is not null),
  check (status not in ('succeeded', 'failed', 'cancelled') or ended_at is not null),
  unique (organization_id, idempotency_key)
);

create index campaign_research_runs_org_status_idx
  on public.campaign_research_runs (organization_id, status);
create index campaign_research_runs_org_proposal_idx
  on public.campaign_research_runs (organization_id, proposal_id)
  where proposal_id is not null;

-- 4. Evaluated source fingerprints ----------------------------------------------
--
-- Persisted even when no research is warranted, so a repeated signal is
-- recognized as seen rather than re-evaluated at full cost.

create table public.campaign_research_source_fingerprints (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  fingerprint text not null check (char_length(fingerprint) between 8 and 200),
  candidate_revision text check (
    candidate_revision is null or char_length(candidate_revision) between 1 and 120
  ),
  warranted boolean not null,
  evaluated_at timestamptz not null default now(),
  run_id uuid references public.campaign_research_runs(id) on delete set null,
  unique (organization_id, fingerprint)
);

-- 5. Durable events ---------------------------------------------------------------
--
-- Identifier-only past-tense events, written in the same transaction as the
-- run transition they describe. This table IS the durable capture: a
-- logger-only publisher would leave no record a later reader can trust.

create table public.campaign_research_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  run_id uuid not null references public.campaign_research_runs(id) on delete cascade,
  event text not null check (
    event in (
      'campaign.proposal_requested',
      'campaign.proposal_prepared',
      'campaign.research_claimed',
      'campaign.research_failed',
      'campaign.research_cancelled'
    )
  ),
  -- Identifiers only: run, proposal, version, policy version, cost in minor
  -- units. Never prompts, provider responses, or customer text.
  payload jsonb not null default '{}'::jsonb,
  emitted_at timestamptz not null default now()
);

create index campaign_research_events_run_idx
  on public.campaign_research_events (run_id, emitted_at);

-- 6. Access ------------------------------------------------------------------------

revoke all on table public.campaign_research_policies,
  public.campaign_research_policy_current,
  public.campaign_research_runs,
  public.campaign_research_source_fingerprints,
  public.campaign_research_events
  from public, anon, authenticated;

-- 7. Functions ----------------------------------------------------------------------

-- Admits one research request, atomically.
--
-- The application pre-checks the same limits to produce precise refusal
-- reasons; this function rechecks them under a lock on the current-policy
-- row, so two concurrent requests cannot both spend the last of the window.
-- A repeated idempotency key replays the existing run instead of opening a
-- second one, and a repeated signal for the same candidate coalesces onto it.
create function public.request_campaign_research_run(
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
    allowance_currency, source_fingerprint, request_digest, idempotency_key, started_at
  ) values (
    target_organization_id, v_trigger, v_policy.version, v_budget,
    v_currency, v_fingerprint, v_digest, v_key, now()
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

-- Claims one queued run for a worker. Service role only: the EXECUTE grant is
-- the gate, so there is deliberately no in-function role check.
create function public.claim_campaign_research_run(
  target_organization_id uuid,
  input_claim jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.campaign_research_runs;
  v_token uuid := gen_random_uuid();
begin
  update public.campaign_research_runs run
  set status = 'claimed',
      claim_token = v_token,
      lease_expires_at = now() + ((input_claim ->> 'lease_seconds')::integer || ' seconds')::interval,
      attempt = run.attempt + 1
  where run.organization_id = target_organization_id
    and run.id = ((input_claim ->> 'run_id'))::uuid
    and run.status = 'queued'
  returning * into v_run;

  if v_run.id is null then
    return jsonb_build_object('outcome', 'already_claimed');
  end if;

  insert into public.campaign_research_events (organization_id, run_id, event, payload)
  values (
    target_organization_id, v_run.id, 'campaign.research_claimed',
    jsonb_build_object('run_id', v_run.id, 'attempt', v_run.attempt)
  );

  return jsonb_build_object(
    'outcome', 'claimed',
    'run_id', v_run.id,
    'claim_token', v_token,
    'policy_version', v_run.policy_version,
    'budget_minor', v_run.budget_minor
  );
end;
$$;

-- Records success, binding the prepared proposal version and the measured
-- cost. The claim token and a live lease are required: a worker that lost its
-- lease must never be able to complete over the run's rightful successor.
create function public.complete_campaign_research_run(
  target_organization_id uuid,
  input_complete jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.campaign_research_runs;
begin
  update public.campaign_research_runs run
  set status = 'succeeded',
      proposal_id = ((input_complete ->> 'proposal_id'))::uuid,
      context_manifest_id = nullif(input_complete ->> 'context_manifest_id', '')::uuid,
      context_digest = nullif(input_complete ->> 'context_digest', ''),
      qualified_research_request_ids = coalesce(
        (select array_agg(value::uuid) from jsonb_array_elements_text(
          coalesce(input_complete -> 'qualified_research_request_ids', '[]'::jsonb)
        ) as value),
        '{}'::uuid[]
      ),
      actual_cost_minor = (input_complete ->> 'actual_cost_minor')::bigint,
      outcome = input_complete ->> 'outcome',
      ended_at = now(),
      claim_token = null,
      lease_expires_at = null
  where run.organization_id = target_organization_id
    and run.id = ((input_complete ->> 'run_id'))::uuid
    and run.status = 'claimed'
    and run.claim_token = ((input_complete ->> 'claim_token'))::uuid
    and run.lease_expires_at > now()
  returning * into v_run;

  if v_run.id is null then
    raise exception 'campaign_research_claim_lost' using errcode = 'P0002';
  end if;

  insert into public.campaign_research_events (organization_id, run_id, event, payload)
  values (
    target_organization_id, v_run.id, 'campaign.proposal_prepared',
    jsonb_build_object(
      'run_id', v_run.id,
      'proposal_id', v_run.proposal_id,
      'actual_cost_minor', v_run.actual_cost_minor,
      'allowance_currency', v_run.allowance_currency
    )
  );

  return jsonb_build_object('outcome', 'completed', 'run_id', v_run.id);
end;
$$;

-- Records failure with its measured cost and safe reason. Failed spend stays
-- visible: the actual cost is preserved, never zeroed because the attempt
-- failed.
create function public.fail_campaign_research_run(
  target_organization_id uuid,
  input_failure jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.campaign_research_runs;
begin
  update public.campaign_research_runs run
  set status = 'failed',
      actual_cost_minor = coalesce((input_failure ->> 'actual_cost_minor')::bigint, run.actual_cost_minor),
      failure_code = input_failure ->> 'failure_code',
      ended_at = now(),
      claim_token = null,
      lease_expires_at = null
  where run.organization_id = target_organization_id
    and run.id = ((input_failure ->> 'run_id'))::uuid
    and run.status = 'claimed'
    and run.claim_token = ((input_failure ->> 'claim_token'))::uuid
  returning * into v_run;

  if v_run.id is null then
    raise exception 'campaign_research_claim_lost' using errcode = 'P0002';
  end if;
  if v_run.failure_code is null then
    raise exception 'campaign_research_invalid' using errcode = '22023';
  end if;

  insert into public.campaign_research_events (organization_id, run_id, event, payload)
  values (
    target_organization_id, v_run.id, 'campaign.research_failed',
    jsonb_build_object(
      'run_id', v_run.id,
      'failure_code', v_run.failure_code,
      'actual_cost_minor', v_run.actual_cost_minor
    )
  );

  return jsonb_build_object('outcome', 'failed', 'run_id', v_run.id);
end;
$$;

-- Cancels a run that has not finished. Cancellation keeps history: the
-- measured cost and the run row stay, so pausing research never rewrites what
-- was spent.
create function public.cancel_campaign_research_run(
  target_organization_id uuid,
  input_cancel jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.campaign_research_runs;
begin
  update public.campaign_research_runs run
  set status = 'cancelled',
      actual_cost_minor = coalesce((input_cancel ->> 'actual_cost_minor')::bigint, run.actual_cost_minor),
      failure_code = coalesce(input_cancel ->> 'failure_code', 'cancelled'),
      ended_at = now(),
      claim_token = null,
      lease_expires_at = null
  where run.organization_id = target_organization_id
    and run.id = ((input_cancel ->> 'run_id'))::uuid
    and run.status in ('queued', 'claimed')
  returning * into v_run;

  if v_run.id is null then
    raise exception 'campaign_research_claim_lost' using errcode = 'P0002';
  end if;

  insert into public.campaign_research_events (organization_id, run_id, event, payload)
  values (
    target_organization_id, v_run.id, 'campaign.research_cancelled',
    jsonb_build_object(
      'run_id', v_run.id,
      'actual_cost_minor', v_run.actual_cost_minor
    )
  );

  return jsonb_build_object('outcome', 'cancelled', 'run_id', v_run.id);
end;
$$;

-- Moves the current-policy pointer. Owner/admin only, forward only by version:
-- a policy change is an auditable decision, not an edit.
create function public.set_campaign_research_policy_current(
  target_organization_id uuid,
  input_pointer jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_policy public.campaign_research_policies;
begin
  v_actor := (select auth.uid());
  if v_actor is null then
    raise exception 'campaign_research_forbidden' using errcode = '42501';
  end if;
  if not private.has_organization_permission(target_organization_id, 'campaign.research_request') then
    raise exception 'campaign_research_forbidden' using errcode = '42501';
  end if;

  select * into v_policy
  from public.campaign_research_policies policy
  where policy.organization_id = target_organization_id
    and policy.id = ((input_pointer ->> 'policy_id'))::uuid;
  if v_policy.id is null then
    raise exception 'campaign_research_not_found' using errcode = 'P0002';
  end if;

  insert into public.campaign_research_policy_current (
    organization_id, policy_id, set_by
  ) values (
    target_organization_id, v_policy.id, v_actor
  )
  on conflict (organization_id) do update
    set policy_id = excluded.policy_id,
        set_by = excluded.set_by,
        set_at = now()
  where public.campaign_research_policy_current.policy_id <> excluded.policy_id;

  return jsonb_build_object('policy_id', v_policy.id, 'version', v_policy.version);
end;
$$;

revoke all on function public.request_campaign_research_run(uuid, jsonb) from public, anon;
grant execute on function public.request_campaign_research_run(uuid, jsonb) to authenticated;
revoke all on function public.set_campaign_research_policy_current(uuid, jsonb) from public, anon;
grant execute on function public.set_campaign_research_policy_current(uuid, jsonb) to authenticated;

-- Worker functions are locked to service_role. No in-function role check: a
-- worker connecting as service_role sets no JWT claim, so `auth.role()` would
-- refuse the only legitimate caller. The grant is the gate.
revoke all on function public.claim_campaign_research_run(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.complete_campaign_research_run(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.fail_campaign_research_run(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.cancel_campaign_research_run(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.claim_campaign_research_run(uuid, jsonb) to service_role;
grant execute on function public.complete_campaign_research_run(uuid, jsonb) to service_role;
grant execute on function public.fail_campaign_research_run(uuid, jsonb) to service_role;
grant execute on function public.cancel_campaign_research_run(uuid, jsonb) to service_role;
