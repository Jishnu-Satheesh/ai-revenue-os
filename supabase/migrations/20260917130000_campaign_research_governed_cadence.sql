-- Task 16 (Slice 4): governed cadence for campaign research (C03, D06).
--
-- Research knows how to admit one run and how to recover a dead claim, but
-- nothing ever starts a scheduled evaluation: the allowance either sat unused
-- or was spent only by button presses. This is the cadence that asks on its
-- own — and the receipts that prove each asking happened exactly once.
--
-- Additive and forward-only. The policy table is NOT recreated and NOT
-- altered: money, cooldown and the pending cap stay exactly where Task 6 put
-- them, and `request_campaign_research_run` is untouched, so the manual Ask
-- path keeps the behaviour its suites already prove. The new writer below
-- mirrors that function's admission checks check-for-check (pending cap,
-- per-run ceiling, window allowance, cooldown) against the same policy row,
-- so a scheduled run and a manual request obey identical rules; only the
-- transport differs (see §5), because the scheduler needs its verdict and
-- its receipt written in the same transaction.
--
-- Memory writes alone never trigger research. There is no trigger on any
-- memory table in this migration; the only caller is the hourly scheduler,
-- which polls. A memory capture changes the digest the next tick compares
-- against — that is all it can do.

-- 1. The schedule -------------------------------------------------------------
--
-- One row per organization. No row is "not scheduled", never an implied
-- cadence. `enabled` starts false: saving a schedule must not switch
-- research on by itself, and enabling the cadence must not enable spending —
-- the policy's own `enabled` still binds every admission below.
--
-- `interval_days` is a cadence, not a spending limit: how often a scheduled
-- evaluation may admit a run. `qualifying_change_kinds` names what counts as
-- a reason: a moved Business Memory digest (`memory_revision`), the window
-- itself (`scheduled_cadence`), or both. An enabled schedule with an empty
-- set would admit runs nobody asked for, so the check refuses it.
--
-- `enabled_by` is who switched it on. A scheduled run is drafted by a worker
-- with no session actor, and `campaign_research_runs.requested_by` is how a
-- worker-drafted proposal is attributed — so the run inherits the enabler,
-- the same person whose policy admitted it. Accurate, and what an audit needs
-- to follow the chain from cadence to proposal.
--
-- `last_evaluated_at` advances on every completed evaluation whatever its
-- outcome. It is the scheduler's watermark, not a spend record: an evaluation
-- that warranted nothing still happened, and must not be re-done every tick.

create table public.campaign_research_schedules (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  enabled boolean not null default false,
  interval_days integer not null default 7 check (interval_days between 1 and 30),
  qualifying_change_kinds text[] not null default '{}'::text[],
  last_evaluated_at timestamptz,
  enabled_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  check (qualifying_change_kinds <@ array['memory_revision', 'scheduled_cadence']),
  check (not enabled or qualifying_change_kinds <> '{}'::text[])
);

comment on column public.campaign_research_schedules.enabled_by is
  'Who switched the cadence on. Carried onto scheduled runs as requested_by, because a worker-drafted proposal records who it came from and a worker is not a who.';
comment on column public.campaign_research_schedules.last_evaluated_at is
  'The scheduler watermark. Advances on every completed evaluation — admitted or not — so a tick that warranted nothing is still recorded as done.';

-- 2. Due receipts ---------------------------------------------------------------
--
-- One row per organization per schedule window. The unique key is what makes
-- a repeated delivery, a retried tick and two racing schedulers safe: the
-- second claim finds the first one's row instead of evaluating twice. A
-- missed sweep claims only the current window — missed windows stay missed
-- rather than admitting a run each in catch-up.
--
-- `outcome` names what the evaluation decided: admitted, replayed (the same
-- evidence already holds a run), already_evaluated (the same evidence was
-- seen and warranted nothing before), no_qualifying_change (due, but nothing
-- moved), refused (due and warranted, but the purse said no), with the
-- refusal named in `refusal_reason` using the admission vocabulary
-- (allowance_exceeded, pending_limit, cooldown). `warranted` records whether
-- the change qualified even when the purse refused, so an operator reading
-- the history can tell "nothing to research" from "no money to research it".
-- `run_id` is set only when a run was admitted (or replayed) for this window.

create table public.campaign_research_schedule_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  window_start timestamptz not null,
  evaluated_at timestamptz not null default now(),
  run_id uuid references public.campaign_research_runs(id) on delete set null,
  warranted boolean not null,
  outcome text not null check (
    outcome in (
      'admitted',
      'replayed',
      'already_evaluated',
      'no_qualifying_change',
      'refused'
    )
  ),
  refusal_reason text check (
    refusal_reason is null
    or refusal_reason in ('allowance_exceeded', 'pending_limit', 'cooldown')
  ),
  check ((outcome = 'refused') = (refusal_reason is not null)),
  check ((outcome in ('admitted', 'replayed')) = (run_id is not null)),
  unique (organization_id, window_start)
);

create index campaign_research_schedule_receipts_org_idx
  on public.campaign_research_schedule_receipts (organization_id, evaluated_at desc);

-- 3. Access -----------------------------------------------------------------------
--
-- Closed like every other research table: no role holds a grant, and every
-- read and write goes through a security-definer function below.

revoke all on table public.campaign_research_schedules,
  public.campaign_research_schedule_receipts
  from public, anon, authenticated;

-- 4. Settings surface ---------------------------------------------------------------
--
-- Read and write take the same permission that spends the allowance
-- (`campaign.research_request`): whoever may spend it is whoever may set the
-- rhythm it is spent on. The database checks the permission again inside both
-- functions, so the route is a courtesy rather than the fence.

create function public.read_campaign_research_schedule(
  target_organization_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_schedule public.campaign_research_schedules;
begin
  if (select auth.uid()) is null then
    raise exception 'campaign_research_forbidden' using errcode = '42501';
  end if;
  if not private.has_organization_permission(target_organization_id, 'campaign.research_request') then
    raise exception 'campaign_research_forbidden' using errcode = '42501';
  end if;

  select * into v_schedule
  from public.campaign_research_schedules schedule
  where schedule.organization_id = target_organization_id;

  if v_schedule.organization_id is null then
    return jsonb_build_object('schedule', null);
  end if;

  return jsonb_build_object(
    'schedule', jsonb_build_object(
      'organizationId', v_schedule.organization_id,
      'enabled', v_schedule.enabled,
      'intervalDays', v_schedule.interval_days,
      'qualifyingChangeKinds', v_schedule.qualifying_change_kinds,
      'lastEvaluatedAt', v_schedule.last_evaluated_at
    )
  );
end;
$$;

create function public.save_campaign_research_schedule(
  target_organization_id uuid,
  input_schedule jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_enabled boolean;
  v_interval integer;
  v_kinds text[];
  v_row public.campaign_research_schedules;
begin
  v_actor := (select auth.uid());
  if v_actor is null then
    raise exception 'campaign_research_forbidden' using errcode = '42501';
  end if;
  if not private.has_organization_permission(target_organization_id, 'campaign.research_request') then
    raise exception 'campaign_research_forbidden' using errcode = '42501';
  end if;

  v_enabled := coalesce((input_schedule ->> 'enabled')::boolean, false);
  v_interval := (input_schedule ->> 'interval_days')::integer;
  if jsonb_typeof(coalesce(input_schedule -> 'qualifying_change_kinds', '[]'::jsonb)) <> 'array' then
    raise exception 'campaign_research_invalid' using errcode = '22023';
  end if;
  select coalesce(array_agg(value order by value), '{}'::text[]) into v_kinds
  from jsonb_array_elements_text(coalesce(input_schedule -> 'qualifying_change_kinds', '[]'::jsonb)) as value;

  -- Refused with a name rather than completed with a guess. The table checks
  -- below are the backstop; these say why, earlier, in the admission
  -- vocabulary the application already maps.
  if v_interval is null or v_interval not between 1 and 30 then
    raise exception 'campaign_research_invalid' using errcode = '22023';
  end if;
  if v_kinds is null or not (v_kinds <@ array['memory_revision', 'scheduled_cadence']) then
    raise exception 'campaign_research_invalid' using errcode = '22023';
  end if;
  if v_enabled and v_kinds = '{}'::text[] then
    raise exception 'campaign_research_invalid' using errcode = '22023';
  end if;

  insert into public.campaign_research_schedules (
    organization_id, enabled, interval_days, qualifying_change_kinds, enabled_by, updated_at
  ) values (
    target_organization_id, v_enabled, v_interval, v_kinds, v_actor, now()
  )
  on conflict (organization_id) do update
    set enabled = excluded.enabled,
        interval_days = excluded.interval_days,
        qualifying_change_kinds = excluded.qualifying_change_kinds,
        enabled_by = excluded.enabled_by,
        updated_at = now()
  returning * into v_row;

  return jsonb_build_object(
    'organization_id', v_row.organization_id,
    'enabled', v_row.enabled,
    'interval_days', v_row.interval_days,
    'qualifying_change_kinds', v_row.qualifying_change_kinds
  );
end;
$$;

revoke all on function public.read_campaign_research_schedule(uuid) from public, anon;
grant execute on function public.read_campaign_research_schedule(uuid) to authenticated;
revoke all on function public.save_campaign_research_schedule(uuid, jsonb) from public, anon;
grant execute on function public.save_campaign_research_schedule(uuid, jsonb) to authenticated;

-- 5. The due evaluation -------------------------------------------------------------
--
-- One function does the whole tick for one organization, atomically: claim
-- the window, recognize a repeated signal, judge the change, admit against
-- the binding policy, and record what it decided. A scheduled evaluation that
-- warrants nothing still writes its receipt and its fingerprint — "seen",
-- not silence — so the next tick with the same evidence stands down too.
--
-- Transport differs from the manual writer on purpose. The manual writer
-- raises its refusals because it writes nothing else in the transaction; this
-- writer must record the refusal alongside the decision, so it returns every
-- business outcome (admitted, replayed, already_evaluated,
-- no_qualifying_change, refused with a named reason) and raises only for
-- faults: forbidden (unreachable — service_role only), invalid input, and
-- anything unrecognized. `not_due` is returned before any write when the
-- schedule or the policy is off: there is no evaluation to record, only a
-- tick that found no work.
--
-- The allowance checks are the manual writer's checks against the same
-- policy row under the same lock: pending cap, per-run ceiling, window
-- allowance, cooldown. A scheduled run reserves the per-run ceiling like any
-- other run; its actuals settle and its unused reservation releases through
-- the existing complete/fail/cancel lifecycle, which this migration does not
-- touch. Containment for live spend lives in the execution loop and is never
-- consulted here — the scheduler cannot disable what it never touches.

-- Names the organizations holding a due schedule, oldest evaluation first so
-- a bounded tick is fair rather than alphabetical. Service role only: the
-- EXECUTE grant is the gate, matching the other worker functions, which take
-- no in-function role check because a worker connecting as service_role sets
-- no JWT claim.
create function public.list_campaign_research_due_organizations()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return coalesce(
    (
      select jsonb_agg(due.organization_id order by due.last_evaluated_at nulls first)
      from (
        select schedule.organization_id, schedule.last_evaluated_at
        from public.campaign_research_schedules schedule
        join public.campaign_research_policy_current current_pointer
          on current_pointer.organization_id = schedule.organization_id
        join public.campaign_research_policies policy
          on policy.id = current_pointer.policy_id
        where schedule.enabled
          and policy.enabled
          and (
            schedule.last_evaluated_at is null
            or schedule.last_evaluated_at <= now() - (schedule.interval_days || ' days')::interval
          )
        order by schedule.last_evaluated_at nulls first
        limit 200
      ) due
    ),
    '[]'::jsonb
  );
end;
$$;

create function public.evaluate_campaign_research_schedule_due(
  target_organization_id uuid,
  input_evaluation jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_schedule public.campaign_research_schedules;
  v_policy public.campaign_research_policies;
  v_fingerprint text;
  v_revision text;
  v_key text;
  v_digest text;
  v_tz text;
  v_local_date date;
  v_day_number integer;
  v_window_index integer;
  v_window timestamptz;
  v_receipt public.campaign_research_schedule_receipts;
  v_existing_run public.campaign_research_runs;
  v_seen public.campaign_research_source_fingerprints;
  v_warranted boolean;
  v_pending integer;
  v_spent bigint;
  v_last_admitted timestamptz;
  v_run public.campaign_research_runs;
begin
  v_fingerprint := nullif(input_evaluation ->> 'evidence_fingerprint', '');
  v_revision := nullif(input_evaluation ->> 'candidate_revision', '');
  v_key := input_evaluation ->> 'idempotency_key';
  v_digest := input_evaluation ->> 'request_digest';
  if v_fingerprint is null or char_length(v_fingerprint) not between 1 and 200 then
    raise exception 'campaign_research_invalid' using errcode = '22023';
  end if;
  if v_revision is not null and char_length(v_revision) not between 1 and 120 then
    raise exception 'campaign_research_invalid' using errcode = '22023';
  end if;
  if v_key is null or char_length(v_key) not between 8 and 200 then
    raise exception 'campaign_research_invalid' using errcode = '22023';
  end if;
  if v_digest is null or v_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'campaign_research_invalid' using errcode = '22023';
  end if;

  -- The lock that makes evaluation single-file per organization. Taken before
  -- any decision, so two racing ticks serialize here rather than both
  -- admitting against the same allowance.
  select * into v_schedule
  from public.campaign_research_schedules schedule
  where schedule.organization_id = target_organization_id
  for update;

  -- The same lock the manual writer takes, in the one order both writers use
  -- (schedule first, pointer second; the manual path takes only the pointer,
  -- so no cycle can form). Allowance admission stays single-file across
  -- manual and scheduled requests: a concurrent button press cannot spend
  -- the last of the window out from under this evaluation, or vice versa.
  select policy.* into v_policy
  from public.campaign_research_policy_current current_pointer
  join public.campaign_research_policies policy on policy.id = current_pointer.policy_id
  where current_pointer.organization_id = target_organization_id
  for update of current_pointer;

  if v_schedule.organization_id is null or not v_schedule.enabled
    or v_policy.id is null or not v_policy.enabled then
    -- Paused mid-run, or never set up: no evaluation, no write. The next tick
    -- re-checks; nothing is lost because nothing was decided.
    return jsonb_build_object('outcome', 'not_due');
  end if;

  -- The window is the organization's calendar day bucketed by its interval,
  -- in the timezone of the binding policy — the same bucket the application
  -- computes in `scheduleWindowStart`. An unreadable timezone is config
  -- corruption, not a business outcome: it raises rather than being guessed.
  -- Computed before the replay check below so a retry names its own window.
  v_tz := v_policy.schedule_timezone;
  begin
    v_local_date := (now() at time zone v_tz)::date;
  exception when others then
    raise exception 'campaign_research_invalid' using errcode = '22023';
  end;
  v_day_number := (v_local_date - date '1970-01-01')::integer;
  v_window_index := v_day_number / v_schedule.interval_days;
  v_window := (date '1970-01-01' + (v_window_index * v_schedule.interval_days))::timestamp at time zone 'UTC';

  -- A run already admitted for this evidence is replayed, never duplicated.
  -- Checked before the watermark below so a retry that crashed between the
  -- run insert and the response still finds its run: idempotency wins over
  -- due-ness, because the run exists and only needs its dispatch.
  select * into v_existing_run
  from public.campaign_research_runs run
  where run.organization_id = target_organization_id
    and run.idempotency_key = v_key;
  if v_existing_run.id is not null then
    insert into public.campaign_research_schedule_receipts (
      organization_id, window_start, run_id, warranted, outcome
    ) values (
      target_organization_id, v_window, v_existing_run.id, true, 'replayed'
    )
    on conflict (organization_id, window_start) do update
      set run_id = excluded.run_id,
          warranted = true,
          outcome = 'replayed',
          evaluated_at = now();
    update public.campaign_research_schedules schedule
    set last_evaluated_at = now()
    where schedule.organization_id = target_organization_id;
    return jsonb_build_object(
      'outcome', 'replayed',
      'run_id', v_existing_run.id,
      'policy_version', v_existing_run.policy_version,
      'evidence_max_age_days', v_policy.evidence_max_age_days,
      'budget_minor', v_existing_run.budget_minor,
      'allowance_currency', v_existing_run.allowance_currency
    );
  end if;

  if v_schedule.last_evaluated_at is not null
    and v_schedule.interval_days > 0
    and v_schedule.last_evaluated_at > now() - (v_schedule.interval_days || ' days')::interval then
    return jsonb_build_object('outcome', 'not_due');
  end if;

  -- Claim the window. A repeated delivery, a retried tick or a racing second
  -- scheduler finds the first claim's row instead of evaluating twice: one
  -- evaluation per window per organization, whatever the evidence. Evidence
  -- that arrives after the window was claimed waits for the next window
  -- rather than admitting a second run into this one.
  insert into public.campaign_research_schedule_receipts (
    organization_id, window_start, warranted, outcome
  ) values (
    target_organization_id, v_window, false, 'no_qualifying_change'
  )
  on conflict (organization_id, window_start) do nothing
  returning * into v_receipt;
  if v_receipt.organization_id is null then
    update public.campaign_research_schedules schedule
    set last_evaluated_at = now()
    where schedule.organization_id = target_organization_id;
    return jsonb_build_object(
      'outcome', 'already_evaluated',
      'policy_version', v_policy.version,
      'evidence_max_age_days', v_policy.evidence_max_age_days
    );
  end if;

  -- A repeated signal is recognized as seen, not re-evaluated at full cost.
  -- The fingerprints table persists even no-warrant outcomes, so a repeated
  -- capture of the same root revision (same fingerprint, same revision)
  -- stands down here whatever warranted it last time — including never.
  select * into v_seen
  from public.campaign_research_source_fingerprints seen
  where seen.organization_id = target_organization_id
    and seen.fingerprint = v_fingerprint
    and coalesce(seen.candidate_revision, '') = coalesce(v_revision, '');
  if v_seen.id is not null then
    update public.campaign_research_source_fingerprints seen
    set evaluated_at = now()
    where seen.id = v_seen.id;
    update public.campaign_research_schedule_receipts receipt
    set warranted = false,
        outcome = 'already_evaluated',
        evaluated_at = now()
    where receipt.id = v_receipt.id;
    update public.campaign_research_schedules schedule
    set last_evaluated_at = now()
    where schedule.organization_id = target_organization_id;
    return jsonb_build_object(
      'outcome', 'already_evaluated',
      'policy_version', v_policy.version,
      'evidence_max_age_days', v_policy.evidence_max_age_days
    );
  end if;

  -- The change judgement, under the lock: the window qualifies on its own
  -- when named; otherwise only a memory digest the tick has never seen does.
  -- A repeated capture of the same root revision carries the same digest, so
  -- it stands down here; a new digest is a material change and may admit
  -- exactly one run. The fingerprints table is the memory — every evaluated
  -- fingerprint is recorded, warranted or not — so there is no separate
  -- state to drift.
  v_warranted :=
    ('scheduled_cadence' = any (v_schedule.qualifying_change_kinds))
    or (
      'memory_revision' = any (v_schedule.qualifying_change_kinds)
      and v_fingerprint <> 'no-memory'
      and not exists (
        select 1
        from public.campaign_research_source_fingerprints seen
        where seen.organization_id = target_organization_id
          and seen.fingerprint = v_fingerprint
      )
    );
  insert into public.campaign_research_source_fingerprints (
    organization_id, fingerprint, candidate_revision, warranted, evaluated_at, run_id
  ) values (
    target_organization_id, v_fingerprint, v_revision, v_warranted, now(), null
  )
  on conflict (organization_id, fingerprint) do update
    set candidate_revision = excluded.candidate_revision,
        warranted = excluded.warranted,
        run_id = excluded.run_id,
        evaluated_at = now();

  if not v_warranted then
    -- Due, evaluated, and proposing nothing. The receipt and the fingerprint
    -- above are the stored outcome: the next tick with the same evidence
    -- stands down at the seen-check instead of spending a full evaluation.
    update public.campaign_research_schedule_receipts receipt
    set warranted = false,
        outcome = 'no_qualifying_change',
        evaluated_at = now()
    where receipt.id = v_receipt.id;
    update public.campaign_research_schedules schedule
    set last_evaluated_at = now()
    where schedule.organization_id = target_organization_id;
    return jsonb_build_object(
      'outcome', 'no_qualifying_change',
      'policy_version', v_policy.version,
      'evidence_max_age_days', v_policy.evidence_max_age_days
    );
  end if;

  -- Admitted against the binding policy, check-for-check with the manual
  -- writer: pending cap, per-run ceiling, window allowance, cooldown. The
  -- scheduled run reserves the per-run ceiling — the organization's own
  -- figure — so there is no per-run comparison to make: the budget IS the
  -- ceiling, read from the policy itself rather than supplied by a caller.
  -- A future caller-supplied budget must add the comparison back.
  select count(*) into v_pending
  from public.campaign_research_runs run
  where run.organization_id = target_organization_id
    and run.status in ('queued', 'claimed');
  if v_pending >= v_policy.max_pending_proposals then
    update public.campaign_research_schedule_receipts receipt
    set warranted = true,
        outcome = 'refused',
        refusal_reason = 'pending_limit',
        evaluated_at = now()
    where receipt.id = v_receipt.id;
    update public.campaign_research_schedules schedule
    set last_evaluated_at = now()
    where schedule.organization_id = target_organization_id;
    return jsonb_build_object('outcome', 'refused', 'reason', 'pending_limit');
  end if;

  select coalesce(sum(run.budget_minor), 0) into v_spent
  from public.campaign_research_runs run
  where run.organization_id = target_organization_id
    and run.status in ('queued', 'claimed', 'succeeded')
    and run.allowance_currency = v_policy.allowance_currency
    and (run.ended_at is null or run.ended_at > now() - (v_policy.window_days || ' days')::interval);
  if v_spent + v_policy.per_run_allowance_minor > v_policy.window_allowance_minor then
    update public.campaign_research_schedule_receipts receipt
    set warranted = true,
        outcome = 'refused',
        refusal_reason = 'allowance_exceeded',
        evaluated_at = now()
    where receipt.id = v_receipt.id;
    update public.campaign_research_schedules schedule
    set last_evaluated_at = now()
    where schedule.organization_id = target_organization_id;
    return jsonb_build_object('outcome', 'refused', 'reason', 'allowance_exceeded');
  end if;

  select max(run.started_at) into v_last_admitted
  from public.campaign_research_runs run
  where run.organization_id = target_organization_id;
  if v_last_admitted is not null
    and v_policy.cooldown_seconds > 0
    and v_last_admitted > now() - (v_policy.cooldown_seconds || ' seconds')::interval then
    update public.campaign_research_schedule_receipts receipt
    set warranted = true,
        outcome = 'refused',
        refusal_reason = 'cooldown',
        evaluated_at = now()
    where receipt.id = v_receipt.id;
    update public.campaign_research_schedules schedule
    set last_evaluated_at = now()
    where schedule.organization_id = target_organization_id;
    return jsonb_build_object('outcome', 'refused', 'reason', 'cooldown');
  end if;

  insert into public.campaign_research_runs (
    organization_id, trigger_kind, policy_version, budget_minor,
    allowance_currency, source_fingerprint, request_digest, idempotency_key, started_at,
    requested_by
  ) values (
    target_organization_id, 'scheduled', v_policy.version, v_policy.per_run_allowance_minor,
    v_policy.allowance_currency, v_fingerprint, v_digest, v_key, now(),
    v_schedule.enabled_by
  )
  returning * into v_run;

  insert into public.campaign_research_events (organization_id, run_id, event, payload)
  values (
    target_organization_id, v_run.id, 'campaign.proposal_requested',
    jsonb_build_object(
      'run_id', v_run.id,
      'trigger_kind', 'scheduled',
      'policy_version', v_policy.version,
      'budget_minor', v_run.budget_minor,
      'allowance_currency', v_run.allowance_currency
    )
  );

  update public.campaign_research_schedule_receipts receipt
  set run_id = v_run.id,
      warranted = true,
      outcome = 'admitted',
      evaluated_at = now()
  where receipt.id = v_receipt.id;

  update public.campaign_research_source_fingerprints seen
  set warranted = true,
      run_id = v_run.id,
      evaluated_at = now()
  where seen.organization_id = target_organization_id
    and seen.fingerprint = v_fingerprint;

  update public.campaign_research_schedules schedule
  set last_evaluated_at = now()
  where schedule.organization_id = target_organization_id;

  return jsonb_build_object(
    'outcome', 'admitted',
    'run_id', v_run.id,
    'policy_version', v_policy.version,
    'evidence_max_age_days', v_policy.evidence_max_age_days,
    'budget_minor', v_run.budget_minor,
    'allowance_currency', v_run.allowance_currency
  );
end;
$$;

revoke all on function public.list_campaign_research_due_organizations() from public, anon, authenticated;
revoke all on function public.evaluate_campaign_research_schedule_due(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.list_campaign_research_due_organizations() to service_role;
grant execute on function public.evaluate_campaign_research_schedule_due(uuid, jsonb) to service_role;
