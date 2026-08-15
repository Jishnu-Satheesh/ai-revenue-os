-- The Tool Gateway's execution ledger.
--
-- Everything here is additive: four new public tables, one private ledger, and
-- new functions. No existing table, column, policy, or row is altered, so
-- staging data is untouched.
--
-- The rule this enforces: nothing reaches a provider except through a claim
-- granted inside a transaction that locked the rows the decision was made from.
-- Checking approval and budget outside a lock, then calling a provider, is how
-- two workers each see budget available and both spend it.
--
-- Where each check lives. The database owns everything it can prove from its
-- own rows: approval binding, expiry, revocation, attestation, action
-- inclusion, cancellation, schedule window, capability grant version, and the
-- spend ceiling. Facts that live outside the campaign schema — credential
-- health, tracking readiness, consent — are evaluated by the worker and passed
-- in, and are recorded on the claim so an audit can see what was asserted.
-- `src/domain/tools/policy.ts` mirrors these rules for preview in the UI; the
-- refusal codes are deliberately the same strings in both places.

create table public.campaign_action_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null,
  bundle_version_id uuid not null,
  action_key uuid not null,
  status text not null default 'queued' check (
    status in (
      'queued', 'claimed', 'requested', 'provider_pending', 'confirmed',
      'reconciled', 'failed', 'blocked', 'cancelled', 'provider_outcome_unknown'
    )
  ),
  claim_token uuid,
  lease_expires_at timestamptz,
  attempt integer not null default 0 check (attempt >= 0),
  approval_id uuid,
  scheduled_for timestamptz not null,
  -- The facts the worker asserted at claim time, kept so a later audit can see
  -- what the platform believed rather than only what it decided.
  asserted_facts jsonb not null default '{}'::jsonb,
  last_refusal_codes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  -- One run per action per version. A second row would make "did this publish?"
  -- ambiguous at exactly the moment it matters.
  unique (organization_id, bundle_version_id, action_key),
  foreign key (organization_id, campaign_id)
    references public.campaigns (organization_id, id) on delete cascade,
  foreign key (organization_id, bundle_version_id)
    references public.campaign_bundle_versions (organization_id, id) on delete cascade,
  foreign key (organization_id, approval_id)
    references public.campaign_approvals (organization_id, id) on delete restrict,
  check ((status = 'claimed') = (claim_token is not null)),
  check ((claim_token is null) = (lease_expires_at is null))
);

-- Append-only: one row per attempt to call a provider.
create table public.tool_invocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  action_run_id uuid not null,
  tool_key text not null check (tool_key ~ '^[a-z][a-z0-9_.]+$'),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  request_digest text not null check (request_digest ~ '^[0-9a-f]{64}$'),
  claim_token uuid not null,
  status text not null default 'requested' check (
    status in ('requested', 'succeeded', 'failed', 'unknown')
  ),
  failure_code text check (char_length(failure_code) between 1 and 120),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (organization_id, id),
  -- The replay key. One provider call, one row, however many times a worker
  -- retries.
  unique (organization_id, action_run_id, idempotency_key),
  foreign key (organization_id, action_run_id)
    references public.campaign_action_runs (organization_id, id) on delete cascade,
  check (status <> 'failed' or failure_code is not null)
);

-- Normalized provider evidence. Never the raw payload: a provider response can
-- carry customer data the platform has no reason to keep.
create table public.provider_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invocation_id uuid not null,
  external_reference text not null check (char_length(external_reference) between 1 and 400),
  provider_status text not null check (char_length(provider_status) between 1 and 80),
  permalink text check (char_length(permalink) between 1 and 2000),
  occurred_at timestamptz not null,
  payload_digest text not null check (payload_digest ~ '^[0-9a-f]{64}$'),
  normalized jsonb not null default '{}'::jsonb check (
    jsonb_typeof(normalized) = 'object' and pg_catalog.length(normalized::text) <= 8000
  ),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, invocation_id),
  foreign key (organization_id, invocation_id)
    references public.tool_invocations (organization_id, id) on delete restrict
);

/**
 * One reservation per action run.
 *
 * `reserved_minor` is written once and never changed: it is what the platform
 * committed before it called anyone. Settlement writes `settled_minor`
 * alongside it rather than overwriting, so the difference between what was
 * committed and what was actually spent stays visible.
 */
create table public.campaign_budget_reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null,
  action_run_id uuid not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  reserved_minor bigint not null check (reserved_minor >= 0),
  settled_minor bigint check (settled_minor >= 0),
  state text not null default 'reserved' check (state in ('reserved', 'settled', 'released')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, action_run_id),
  foreign key (organization_id, campaign_id)
    references public.campaigns (organization_id, id) on delete cascade,
  foreign key (organization_id, action_run_id)
    references public.campaign_action_runs (organization_id, id) on delete cascade,
  check ((state = 'reserved') = (settled_minor is null))
);

create table private.tool_gateway_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  action_run_id uuid not null,
  operation text not null,
  claim_token uuid,
  outcome text not null,
  refusal_codes text[] not null default '{}',
  created_at timestamptz not null default now(),
  retention_until timestamptz not null default (now() + interval '400 days')
);

create index campaign_action_runs_campaign_idx
  on public.campaign_action_runs (organization_id, campaign_id, scheduled_for);
create index campaign_action_runs_due_idx
  on public.campaign_action_runs (status, scheduled_for)
  where status in ('queued', 'claimed');
create index campaign_action_runs_approval_idx
  on public.campaign_action_runs (organization_id, approval_id);
create index campaign_action_runs_version_idx
  on public.campaign_action_runs (organization_id, bundle_version_id);
create index tool_invocations_run_idx
  on public.tool_invocations (organization_id, action_run_id, started_at desc);
create index provider_receipts_invocation_idx
  on public.provider_receipts (organization_id, invocation_id);
create index campaign_budget_reservations_campaign_idx
  on public.campaign_budget_reservations (organization_id, campaign_id);
create index campaign_budget_reservations_run_idx
  on public.campaign_budget_reservations (organization_id, action_run_id);
create index tool_gateway_operations_run_idx
  on private.tool_gateway_operations (organization_id, action_run_id, created_at desc);

-- Invocations and receipts are evidence of what happened. Editing either would
-- rewrite history a reconciliation depends on.
create function private.reject_tool_ledger_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'tool_ledger_is_append_only' using errcode = '23514';
end;
$$;

create trigger provider_receipts_append_only
  before update or delete on public.provider_receipts
  for each row execute function private.reject_tool_ledger_mutation();

/** An invocation may only move forward from `requested`, and only once. */
create function private.guard_tool_invocation_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'tool_ledger_is_append_only' using errcode = '23514';
  end if;
  if old.status <> 'requested' then
    raise exception 'tool_invocation_already_final' using errcode = '23514';
  end if;
  if (
    new.organization_id, new.action_run_id, new.tool_key, new.idempotency_key,
    new.request_digest, new.claim_token, new.started_at
  ) is distinct from (
    old.organization_id, old.action_run_id, old.tool_key, old.idempotency_key,
    old.request_digest, old.claim_token, old.started_at
  ) then
    raise exception 'tool_ledger_is_append_only' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger tool_invocations_forward_only
  before update or delete on public.tool_invocations
  for each row execute function private.guard_tool_invocation_mutation();

/** A reservation's committed amount is written once. */
create function private.guard_budget_reservation_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'tool_ledger_is_append_only' using errcode = '23514';
  end if;
  if (new.reserved_minor, new.currency, new.action_run_id)
    is distinct from (old.reserved_minor, old.currency, old.action_run_id)
  then
    raise exception 'budget_reservation_is_immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger campaign_budget_reservations_immutable
  before update or delete on public.campaign_budget_reservations
  for each row execute function private.guard_budget_reservation_mutation();

create trigger campaign_action_runs_audit
  after insert or update on public.campaign_action_runs
  for each row execute function private.audit_organization_change();

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------

alter table public.campaign_action_runs enable row level security;
alter table public.campaign_action_runs force row level security;
alter table public.tool_invocations enable row level security;
alter table public.tool_invocations force row level security;
alter table public.provider_receipts enable row level security;
alter table public.provider_receipts force row level security;
alter table public.campaign_budget_reservations enable row level security;
alter table public.campaign_budget_reservations force row level security;
alter table private.tool_gateway_operations enable row level security;
alter table private.tool_gateway_operations force row level security;

create policy "members read action runs" on public.campaign_action_runs
  for select to authenticated using (private.is_organization_member(organization_id));
create policy "members read tool invocations" on public.tool_invocations
  for select to authenticated using (private.is_organization_member(organization_id));
create policy "members read provider receipts" on public.provider_receipts
  for select to authenticated using (private.is_organization_member(organization_id));
create policy "members read budget reservations" on public.campaign_budget_reservations
  for select to authenticated using (private.is_organization_member(organization_id));

revoke all on table public.campaign_action_runs, public.tool_invocations,
  public.provider_receipts, public.campaign_budget_reservations from anon;
revoke all on table public.campaign_action_runs, public.tool_invocations,
  public.provider_receipts, public.campaign_budget_reservations from authenticated;
grant select on table public.campaign_action_runs, public.tool_invocations,
  public.provider_receipts, public.campaign_budget_reservations to authenticated;

revoke all on table private.tool_gateway_operations from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The atomic claim
-- ---------------------------------------------------------------------------

create function public.claim_campaign_action(
  target_organization_id uuid,
  input_claim jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.campaign_action_runs;
  campaign public.campaigns;
  approval public.campaign_approvals;
  version public.campaign_bundle_versions;
  action public.campaign_channel_actions;
  latest_version_id uuid;
  grant_row public.integration_capability_grants;
  committed bigint;
  reservation bigint;
  token uuid := gen_random_uuid();
  codes text[] := '{}';
  asserted jsonb := coalesce(input_claim -> 'asserted_facts', '{}'::jsonb);
  completed_receipt uuid;
  unknown_invocation uuid;
begin
  if target_organization_id is null
    or input_claim ->> 'organization_id' is distinct from target_organization_id::text
  then
    raise exception 'tool_gateway_organization_mismatch' using errcode = '42501';
  end if;

  -- Lock the run first, then everything the decision reads. Every other claim
  -- for this action queues behind this line, which is what makes the budget
  -- check below safe.
  select existing.* into run
  from public.campaign_action_runs existing
  where existing.organization_id = target_organization_id
    and existing.id = (input_claim ->> 'action_run_id')::uuid
  for update;

  if not found then
    raise exception 'tool_gateway_action_run_not_found' using errcode = '42501';
  end if;

  -- A finished provider call replays. Re-checking policy on work the provider
  -- already did could refuse something that has already happened.
  select receipt.id into completed_receipt
  from public.provider_receipts receipt
  join public.tool_invocations invocation
    on invocation.organization_id = receipt.organization_id
   and invocation.id = receipt.invocation_id
  where invocation.organization_id = target_organization_id
    and invocation.action_run_id = run.id
    and invocation.status = 'succeeded'
  limit 1;

  if completed_receipt is not null then
    return pg_catalog.jsonb_build_object('outcome', 'already_completed', 'receipt_id', completed_receipt);
  end if;

  -- An ambiguous send blocks everything until reconciliation clears it.
  select invocation.id into unknown_invocation
  from public.tool_invocations invocation
  where invocation.organization_id = target_organization_id
    and invocation.action_run_id = run.id
    and invocation.status = 'unknown'
  limit 1;

  if unknown_invocation is not null then
    return pg_catalog.jsonb_build_object(
      'outcome', 'provider_outcome_unknown', 'invocation_id', unknown_invocation
    );
  end if;

  if run.status = 'claimed' and run.lease_expires_at > pg_catalog.now() then
    return pg_catalog.jsonb_build_object('outcome', 'already_claimed');
  end if;

  select scoped.* into campaign from public.campaigns scoped
  where scoped.organization_id = target_organization_id and scoped.id = run.campaign_id
  for update;

  select scoped.* into version from public.campaign_bundle_versions scoped
  where scoped.organization_id = target_organization_id and scoped.id = run.bundle_version_id;

  select scoped.* into action from public.campaign_channel_actions scoped
  where scoped.organization_id = target_organization_id
    and scoped.bundle_version_id = run.bundle_version_id
    and scoped.action_key = run.action_key;

  select scoped.id into latest_version_id from public.campaign_bundle_versions scoped
  where scoped.organization_id = target_organization_id and scoped.campaign_id = run.campaign_id
  order by scoped.version desc limit 1;

  select scoped.* into approval from public.campaign_approvals scoped
  where scoped.organization_id = target_organization_id
    and scoped.campaign_id = run.campaign_id
    and scoped.revoked_at is null
  for update;

  if campaign.state = 'cancelled' then codes := codes || 'campaign_cancelled'; end if;

  if not found or approval.id is null then
    codes := codes || 'no_active_approval';
  else
    if approval.bundle_version_id is distinct from run.bundle_version_id
      or run.bundle_version_id is distinct from latest_version_id
    then
      codes := codes || 'approval_version_superseded';
    end if;
    if approval.bundle_digest is distinct from version.digest then
      codes := codes || 'approval_digest_mismatch';
    end if;
    if approval.expires_at <= pg_catalog.now() then codes := codes || 'approval_expired'; end if;
    if approval.attestation_id is null then codes := codes || 'attestation_missing'; end if;
    if not (run.action_key = any (approval.action_keys)) then
      codes := codes || 'action_not_approved';
    end if;
  end if;

  if action.id is null then
    codes := codes || 'action_not_approved';
  elsif pg_catalog.now() + interval '5 minutes' < action.scheduled_for then
    codes := codes || 'outside_schedule_window';
  end if;

  -- The capability grant is checked against the version approval recorded, so a
  -- reconnection with different scopes does not silently inherit permission.
  select scoped.* into grant_row from public.integration_capability_grants scoped
  where scoped.organization_id = target_organization_id
    and scoped.capability_key = input_claim ->> 'capability_key';

  if not found then
    codes := codes || 'capability_not_granted';
  else
    if pg_catalog.cardinality(grant_row.restriction_codes) > 0 then
      codes := codes || 'capability_restricted';
    end if;
    if approval.capability_grant_versions ? (input_claim ->> 'capability_key')
      and (approval.capability_grant_versions ->> (input_claim ->> 'capability_key'))
        is distinct from grant_row.grant_version::text
    then
      codes := codes || 'capability_grant_changed';
    end if;
  end if;

  -- Facts the campaign schema cannot prove. The worker evaluated them and they
  -- are recorded on the run, so a refusal is explicable afterwards.
  if coalesce((asserted ->> 'credential_healthy')::boolean, false) is not true then
    codes := codes || 'credential_unhealthy';
  end if;
  if coalesce((asserted ->> 'tracking_ready')::boolean, false) is not true then
    codes := codes || 'tracking_not_ready';
  end if;
  if coalesce((asserted ->> 'consent_withdrawn')::boolean, false) is true then
    codes := codes || 'consent_withdrawn';
  end if;

  -- Spend, decided under the lock taken above.
  reservation := null;
  if action.spend_ceiling_minor is not null then
    if action.spend_currency is distinct from approval.spend_currency then
      codes := codes || 'spend_currency_mismatch';
    else
      select coalesce(pg_catalog.sum(
        case when ledger.state = 'released' then 0
             else pg_catalog.greatest(ledger.reserved_minor, coalesce(ledger.settled_minor, 0))
        end
      ), 0)
      into committed
      from public.campaign_budget_reservations ledger
      where ledger.organization_id = target_organization_id
        and ledger.campaign_id = run.campaign_id
        and ledger.action_run_id <> run.id;

      if approval.total_spend_ceiling_minor is null
        or committed + action.spend_ceiling_minor > approval.total_spend_ceiling_minor
      then
        codes := codes || 'spend_ceiling_exhausted';
      else
        reservation := action.spend_ceiling_minor;
      end if;
    end if;
  end if;

  if pg_catalog.cardinality(codes) > 0 then
    update public.campaign_action_runs
    set status = 'blocked',
        claim_token = null,
        lease_expires_at = null,
        last_refusal_codes = codes,
        asserted_facts = asserted,
        updated_at = pg_catalog.now()
    where organization_id = target_organization_id and id = run.id;

    insert into private.tool_gateway_operations (
      organization_id, action_run_id, operation, outcome, refusal_codes
    ) values (target_organization_id, run.id, 'claim', 'refused', codes);

    return pg_catalog.jsonb_build_object('outcome', 'refused', 'reason_codes', pg_catalog.to_jsonb(codes));
  end if;

  -- Reserve before returning. A claim that returned first and reserved after
  -- would let the next claim see budget that is already spoken for.
  if reservation is not null then
    insert into public.campaign_budget_reservations (
      organization_id, campaign_id, action_run_id, currency, reserved_minor
    ) values (
      target_organization_id, run.campaign_id, run.id, action.spend_currency, reservation
    )
    on conflict (organization_id, action_run_id) do nothing;
  end if;

  update public.campaign_action_runs
  set status = 'claimed',
      claim_token = token,
      lease_expires_at = pg_catalog.now()
        + pg_catalog.make_interval(secs => coalesce((input_claim ->> 'lease_seconds')::integer, 300)),
      attempt = attempt + 1,
      approval_id = approval.id,
      asserted_facts = asserted,
      last_refusal_codes = '{}',
      updated_at = pg_catalog.now()
  where organization_id = target_organization_id and id = run.id;

  insert into private.tool_gateway_operations (
    organization_id, action_run_id, operation, claim_token, outcome
  ) values (target_organization_id, run.id, 'claim', token, 'claimed');

  return pg_catalog.jsonb_build_object(
    'outcome', 'claimed',
    'claim_token', token,
    'attempt', run.attempt + 1,
    'reservation_minor', reservation,
    'currency', action.spend_currency
  );
end;
$$;

/** Fences a worker whose lease lapsed and was replaced. */
create function private.assert_campaign_action_claim(
  target_organization_id uuid,
  target_run_id uuid,
  supplied_token uuid
)
returns public.campaign_action_runs
language plpgsql security definer set search_path = '' as $$
declare
  run public.campaign_action_runs;
begin
  select existing.* into run from public.campaign_action_runs existing
  where existing.organization_id = target_organization_id and existing.id = target_run_id
  for update;

  if not found then
    raise exception 'tool_gateway_action_run_not_found' using errcode = '42501';
  end if;
  if run.claim_token is distinct from supplied_token then
    raise exception 'tool_gateway_claim_lost' using errcode = '42501';
  end if;
  return run;
end;
$$;

create function public.record_tool_invocation(
  target_organization_id uuid,
  input_invocation jsonb
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  run public.campaign_action_runs;
  saved_id uuid;
begin
  run := private.assert_campaign_action_claim(
    target_organization_id,
    (input_invocation ->> 'action_run_id')::uuid,
    (input_invocation ->> 'claim_token')::uuid
  );

  insert into public.tool_invocations (
    organization_id, action_run_id, tool_key, idempotency_key, request_digest, claim_token
  ) values (
    target_organization_id, run.id, input_invocation ->> 'tool_key',
    input_invocation ->> 'idempotency_key', input_invocation ->> 'request_digest',
    (input_invocation ->> 'claim_token')::uuid
  )
  on conflict (organization_id, action_run_id, idempotency_key) do update
    set request_digest = public.tool_invocations.request_digest
  returning id into saved_id;

  update public.campaign_action_runs
  set status = 'requested', updated_at = pg_catalog.now()
  where organization_id = target_organization_id and id = run.id;

  return saved_id;
end;
$$;

create function public.complete_tool_invocation(
  target_organization_id uuid,
  input_completion jsonb
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  run public.campaign_action_runs;
  receipt_id uuid;
  settled bigint := (input_completion ->> 'settled_minor')::bigint;
begin
  run := private.assert_campaign_action_claim(
    target_organization_id,
    (input_completion ->> 'action_run_id')::uuid,
    (input_completion ->> 'claim_token')::uuid
  );

  update public.tool_invocations
  set status = 'succeeded', finished_at = pg_catalog.now()
  where organization_id = target_organization_id
    and id = (input_completion ->> 'invocation_id')::uuid;

  insert into public.provider_receipts (
    organization_id, invocation_id, external_reference, provider_status,
    permalink, occurred_at, payload_digest, normalized
  ) values (
    target_organization_id,
    (input_completion ->> 'invocation_id')::uuid,
    input_completion ->> 'external_reference',
    input_completion ->> 'provider_status',
    input_completion ->> 'permalink',
    coalesce((input_completion ->> 'occurred_at')::timestamptz, pg_catalog.now()),
    input_completion ->> 'payload_digest',
    coalesce(input_completion -> 'normalized', '{}'::jsonb)
  )
  returning id into receipt_id;

  -- Settlement records what was actually spent beside what was committed. The
  -- reserved figure is never overwritten: the difference is the evidence.
  if settled is not null then
    update public.campaign_budget_reservations
    set settled_minor = settled, state = 'settled', updated_at = pg_catalog.now()
    where organization_id = target_organization_id and action_run_id = run.id;
  end if;

  update public.campaign_action_runs
  set status = 'confirmed', claim_token = null, lease_expires_at = null,
      updated_at = pg_catalog.now()
  where organization_id = target_organization_id and id = run.id;

  insert into private.tool_gateway_operations (
    organization_id, action_run_id, operation, claim_token, outcome
  ) values (
    target_organization_id, run.id, 'complete',
    (input_completion ->> 'claim_token')::uuid, 'confirmed'
  );

  return receipt_id;
end;
$$;

create function public.fail_tool_invocation(
  target_organization_id uuid,
  input_failure jsonb
)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  run public.campaign_action_runs;
  ambiguous boolean := coalesce((input_failure ->> 'outcome_unknown')::boolean, false);
begin
  run := private.assert_campaign_action_claim(
    target_organization_id,
    (input_failure ->> 'action_run_id')::uuid,
    (input_failure ->> 'claim_token')::uuid
  );

  update public.tool_invocations
  set status = case when ambiguous then 'unknown' else 'failed' end,
      failure_code = input_failure ->> 'failure_code',
      finished_at = pg_catalog.now()
  where organization_id = target_organization_id
    and id = (input_failure ->> 'invocation_id')::uuid;

  -- An unknown outcome keeps its reservation. Releasing money for a call that
  -- may have succeeded would let the campaign overspend once it is reconciled.
  if not ambiguous then
    update public.campaign_budget_reservations
    set state = 'released', settled_minor = 0, updated_at = pg_catalog.now()
    where organization_id = target_organization_id and action_run_id = run.id;
  end if;

  update public.campaign_action_runs
  set status = case when ambiguous then 'provider_outcome_unknown' else 'failed' end,
      claim_token = null, lease_expires_at = null, updated_at = pg_catalog.now()
  where organization_id = target_organization_id and id = run.id;

  insert into private.tool_gateway_operations (
    organization_id, action_run_id, operation, claim_token, outcome
  ) values (
    target_organization_id, run.id, 'fail', (input_failure ->> 'claim_token')::uuid,
    case when ambiguous then 'provider_outcome_unknown' else 'failed' end
  );
end;
$$;

/**
 * Reconciliation resolves an ambiguous send.
 *
 * It is the only path out of `provider_outcome_unknown`, and it never guesses:
 * the caller has looked the action up at the provider and reports what it
 * found. `confirmed` records the receipt that was missing; `absent` proves
 * nothing happened and releases the reservation for a retry.
 */
create function public.reconcile_tool_invocation(
  target_organization_id uuid,
  input_reconciliation jsonb
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  run public.campaign_action_runs;
  finding text := input_reconciliation ->> 'finding';
  receipt_id uuid;
begin
  select existing.* into run from public.campaign_action_runs existing
  where existing.organization_id = target_organization_id
    and existing.id = (input_reconciliation ->> 'action_run_id')::uuid
  for update;

  if not found then
    raise exception 'tool_gateway_action_run_not_found' using errcode = '42501';
  end if;
  if run.status <> 'provider_outcome_unknown' then
    raise exception 'tool_gateway_nothing_to_reconcile' using errcode = '22023';
  end if;

  if finding = 'confirmed' then
    update public.tool_invocations set status = 'succeeded', finished_at = pg_catalog.now()
    where organization_id = target_organization_id
      and id = (input_reconciliation ->> 'invocation_id')::uuid;

    insert into public.provider_receipts (
      organization_id, invocation_id, external_reference, provider_status,
      occurred_at, payload_digest, normalized
    ) values (
      target_organization_id,
      (input_reconciliation ->> 'invocation_id')::uuid,
      input_reconciliation ->> 'external_reference',
      input_reconciliation ->> 'provider_status',
      coalesce((input_reconciliation ->> 'occurred_at')::timestamptz, pg_catalog.now()),
      input_reconciliation ->> 'payload_digest',
      coalesce(input_reconciliation -> 'normalized', '{}'::jsonb)
    )
    on conflict (organization_id, invocation_id) do nothing
    returning id into receipt_id;

    update public.campaign_action_runs
    set status = 'reconciled', updated_at = pg_catalog.now()
    where organization_id = target_organization_id and id = run.id;

  elsif finding = 'absent' then
    update public.tool_invocations set status = 'failed',
      failure_code = 'provider_has_no_record', finished_at = pg_catalog.now()
    where organization_id = target_organization_id
      and id = (input_reconciliation ->> 'invocation_id')::uuid;

    update public.campaign_budget_reservations
    set state = 'released', settled_minor = 0, updated_at = pg_catalog.now()
    where organization_id = target_organization_id and action_run_id = run.id;

    update public.campaign_action_runs
    set status = 'queued', updated_at = pg_catalog.now()
    where organization_id = target_organization_id and id = run.id;

  else
    raise exception 'tool_gateway_reconciliation_finding_invalid' using errcode = '22023';
  end if;

  insert into private.tool_gateway_operations (
    organization_id, action_run_id, operation, outcome
  ) values (target_organization_id, run.id, 'reconcile', finding);

  return pg_catalog.jsonb_build_object('outcome', finding, 'receipt_id', receipt_id);
end;
$$;

revoke all on function public.claim_campaign_action(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.record_tool_invocation(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.complete_tool_invocation(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.fail_tool_invocation(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.reconcile_tool_invocation(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.assert_campaign_action_claim(uuid, uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.claim_campaign_action(uuid, jsonb) to service_role;
grant execute on function public.record_tool_invocation(uuid, jsonb) to service_role;
grant execute on function public.complete_tool_invocation(uuid, jsonb) to service_role;
grant execute on function public.fail_tool_invocation(uuid, jsonb) to service_role;
grant execute on function public.reconcile_tool_invocation(uuid, jsonb) to service_role;
