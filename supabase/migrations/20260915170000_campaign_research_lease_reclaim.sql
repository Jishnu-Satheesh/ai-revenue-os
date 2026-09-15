-- Task 6 follow-up: a dead research claim can be recovered (C03, D06).
--
-- The lifecycle shipped with five operations — request, claim, complete, fail,
-- cancel — and no way back from a claim whose worker died. `claim` only takes
-- a `queued` row; `complete` and `fail` both require a live lease. So a run
-- left in `claimed` with an expired lease could never be picked up, never
-- finish, and never be given up on.
--
-- That is not merely an orphan row. Such a run counts against
-- `max_pending_proposals` forever, and because `ended_at` stays null its
-- reserved budget counts against the rolling window allowance forever too.
-- Enough dead workers and an organization can never request research again,
-- with no recovery short of hand-written SQL.
--
-- This adds the missing transition. An expired claim either goes back to the
-- queue for another worker, or — once it has used the attempts its own
-- admitting policy allows — is failed with a named cause, which frees both the
-- pending slot and the reserved allowance.

-- How many times a run may be attempted before it is given up on is a numeric
-- operating limit, so it is organization configuration like every other
-- threshold in this table, never a constant in code (D06). No default is
-- offered: a policy that does not say must not be guessed at. Both the
-- policies table and the runs table are empty, so requiring the column breaks
-- no existing row, and nothing in the application writes policies yet — the
-- settings surface that will (Task 16) has to collect this alongside the
-- allowances.
alter table public.campaign_research_policies
  add column max_attempts integer not null check (max_attempts between 1 and 10);

-- Two more transitions to record. Reclaimed and abandoned are kept distinct:
-- one says another worker may try, the other says nobody will, and an
-- operator reading the history must not have to infer which happened.
alter table public.campaign_research_events
  drop constraint campaign_research_events_event_check,
  add constraint campaign_research_events_event_check check (
    event in (
      'campaign.proposal_requested',
      'campaign.proposal_prepared',
      'campaign.research_claimed',
      'campaign.research_failed',
      'campaign.research_cancelled',
      'campaign.research_lease_reclaimed',
      'campaign.research_lease_abandoned'
    )
  );

-- The ledger carries the new threshold so admission and the settings surface
-- read one policy shape. Unchanged apart from `maxAttempts`.
create or replace function public.read_campaign_research_ledger(
  target_organization_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy public.campaign_research_policies;
  v_pending integer;
  v_spent bigint;
  v_last_admitted timestamptz;
begin
  if (select auth.uid()) is null then
    raise exception 'campaign_research_forbidden' using errcode = '42501';
  end if;
  if not private.has_organization_permission(target_organization_id, 'campaign.research_request') then
    raise exception 'campaign_research_forbidden' using errcode = '42501';
  end if;

  select policy.* into v_policy
  from public.campaign_research_policy_current current_pointer
  join public.campaign_research_policies policy on policy.id = current_pointer.policy_id
  where current_pointer.organization_id = target_organization_id;

  if v_policy.id is null then
    return jsonb_build_object(
      'policy', null,
      'pending_count', 0,
      'window_spent_minor', 0,
      'last_admitted_at', null
    );
  end if;

  select count(*) into v_pending
  from public.campaign_research_runs run
  where run.organization_id = target_organization_id
    and run.status in ('queued', 'claimed');

  select coalesce(sum(run.budget_minor), 0) into v_spent
  from public.campaign_research_runs run
  where run.organization_id = target_organization_id
    and run.status in ('queued', 'claimed', 'succeeded')
    and run.allowance_currency = v_policy.allowance_currency
    and (run.ended_at is null or run.ended_at > now() - (v_policy.window_days || ' days')::interval);

  select max(run.started_at) into v_last_admitted
  from public.campaign_research_runs run
  where run.organization_id = target_organization_id;

  return jsonb_build_object(
    'policy', jsonb_build_object(
      'schemaVersion', 1,
      'organizationId', v_policy.organization_id,
      'version', v_policy.version,
      'enabled', v_policy.enabled,
      'timezone', v_policy.schedule_timezone,
      'evidenceQualificationRuleVersion', v_policy.evidence_qualification_rule_version,
      'evidenceMaxAgeDays', v_policy.evidence_max_age_days,
      'cooldownSeconds', v_policy.cooldown_seconds,
      'maxPendingProposals', v_policy.max_pending_proposals,
      'maxAttempts', v_policy.max_attempts,
      'perRunAllowance', jsonb_build_object(
        'amountMinor', v_policy.per_run_allowance_minor,
        'currency', v_policy.allowance_currency
      ),
      'windowAllowance', jsonb_build_object(
        'amountMinor', v_policy.window_allowance_minor,
        'currency', v_policy.allowance_currency
      ),
      'windowDays', v_policy.window_days
    ),
    'pending_count', v_pending,
    'window_spent_minor', v_spent,
    'last_admitted_at', v_last_admitted
  );
end;
$$;

-- Names the organizations holding at least one expired claim, so the sweep
-- can act tenant by tenant instead of running one cross-tenant statement.
-- Service role only: the EXECUTE grant is the gate, matching the other worker
-- functions, which take no in-function role check because a worker connecting
-- as service_role sets no JWT claim.
create function public.list_campaign_research_lease_expiries()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return coalesce(
    (
      select jsonb_agg(distinct run.organization_id)
      from public.campaign_research_runs run
      where run.status = 'claimed'
        and run.lease_expires_at <= now()
    ),
    '[]'::jsonb
  );
end;
$$;

-- Returns one organization's expired claims to the queue, or gives up on the
-- ones that have had their attempts.
create function public.reclaim_campaign_research_runs(
  target_organization_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.campaign_research_runs;
  v_max_attempts integer;
  v_reclaimed integer := 0;
  v_abandoned integer := 0;
begin
  for v_run in
    select run.*
    from public.campaign_research_runs run
    where run.organization_id = target_organization_id
      and run.status = 'claimed'
      and run.lease_expires_at <= now()
    -- A row another sweep already holds is that sweep's to finish. Skipping
    -- it keeps two schedulers from both reclaiming the same run.
    for update skip locked
  loop
    -- The policy that admitted this run, not whichever is current. A later
    -- policy must not retroactively grant a run more attempts than the one it
    -- was admitted under allowed, which is the same rule the spend checks
    -- follow.
    select policy.max_attempts into v_max_attempts
    from public.campaign_research_policies policy
    where policy.organization_id = target_organization_id
      and policy.version = v_run.policy_version;

    -- No readable admitting policy means the cap cannot be known. Guessing one
    -- would be inventing an operating limit, and leaving the run claimed would
    -- restore the very trap this function exists to remove, so it is given up
    -- on under its own name. A failed run holds neither a pending slot nor
    -- reserved allowance.
    if v_max_attempts is null or v_run.attempt >= v_max_attempts then
      update public.campaign_research_runs run
      set status = 'failed',
          claim_token = null,
          lease_expires_at = null,
          ended_at = now(),
          failure_code = case
            when v_max_attempts is null then 'lease_expired_policy_unreadable'
            else 'lease_expired'
          end
      where run.id = v_run.id;

      insert into public.campaign_research_events (organization_id, run_id, event, payload)
      values (
        target_organization_id, v_run.id, 'campaign.research_lease_abandoned',
        jsonb_build_object(
          'run_id', v_run.id,
          'attempt', v_run.attempt,
          'max_attempts', v_max_attempts,
          'budget_minor', v_run.budget_minor,
          'allowance_currency', v_run.allowance_currency
        )
      );
      v_abandoned := v_abandoned + 1;
    else
      -- `attempt` is not incremented here: claiming does that, so counting it
      -- again would charge the run twice for one failure.
      update public.campaign_research_runs run
      set status = 'queued',
          claim_token = null,
          lease_expires_at = null
      where run.id = v_run.id;

      insert into public.campaign_research_events (organization_id, run_id, event, payload)
      values (
        target_organization_id, v_run.id, 'campaign.research_lease_reclaimed',
        jsonb_build_object(
          'run_id', v_run.id,
          'attempt', v_run.attempt,
          'max_attempts', v_max_attempts
        )
      );
      v_reclaimed := v_reclaimed + 1;
    end if;
  end loop;

  return jsonb_build_object('reclaimed', v_reclaimed, 'abandoned', v_abandoned);
end;
$$;

-- Proves a run still holds its claim, without returning the run.
--
-- The worker reads its business context, pinned memory and qualified Growth
-- evidence on the service client, which bypasses RLS — tenancy holds there
-- because every query repeats the organization id. This is the second fence:
-- the worker must show a live claim immediately before that read, so a worker
-- that lost its claim cannot keep reading an organization's evidence on the
-- strength of a connection it still happens to hold.
--
-- Deliberately returns nothing but liveness. A checker that returned the run
-- would become a second loader, and the claim-bound loader is already the one
-- place a run's contents are served.
create function public.assert_campaign_research_claim(
  target_organization_id uuid,
  input_claim jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.campaign_research_runs run
    where run.organization_id = target_organization_id
      and run.id = ((input_claim ->> 'run_id'))::uuid
      and run.status = 'claimed'
      and run.claim_token = ((input_claim ->> 'claim_token'))::uuid
      and run.lease_expires_at > now()
  ) then
    raise exception 'campaign_research_claim_lost' using errcode = 'P0002';
  end if;

  return jsonb_build_object('live', true);
end;
$$;

revoke all on function public.list_campaign_research_lease_expiries() from public, anon, authenticated;
revoke all on function public.reclaim_campaign_research_runs(uuid) from public, anon, authenticated;
grant execute on function public.list_campaign_research_lease_expiries() to service_role;
grant execute on function public.reclaim_campaign_research_runs(uuid) to service_role;
revoke all on function public.assert_campaign_research_claim(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.assert_campaign_research_claim(uuid, jsonb) to service_role;
