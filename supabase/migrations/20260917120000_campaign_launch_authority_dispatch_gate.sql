-- Launch authority gates dispatch: schedule-time gate plus claim-time verifier.
--
-- Two places, one cutover, no halt to work already scheduled:
--
-- 1. Schedule time is the gate. `schedule_campaign_actions` refuses to create
--    new runs unless a live (`authorized`) launch approval covers this exact
--    campaign and bundle version, and stamps every run it creates with that
--    authority's id and digest. A later re-render supersedes covering
--    authorities automatically (trigger below), so the gate also refuses
--    schedules drawn up after the bytes moved. New schedules without authority
--    fail closed with `campaign_schedule_requires_launch_authority`.
--
-- 2. Claim time is the verifier. `claim_campaign_action` re-reads the stamped
--    authority: a superseded or revoked authority, or a digest that no longer
--    matches, refuses the claim (`launch_authority_superseded` /
--    `launch_authority_digest_mismatch`). Runs scheduled before enforcement
--    carry no reference and proceed under the proposal approval exactly as
--    today; each such claim writes one `grandfathered` marker row so the
--    ledger shows how much dispatch still flows without authority. Pause runs
--    are safety actions, not publications: they skip both the check and the
--    marker, explicitly.
--
-- The stamp itself is immutable: runs may change status, lease and attempt,
-- but never which authority they were scheduled under. Rewriting the stamp
-- would let a run borrow authority granted for different bytes.
--
-- Coverage is per action, not per campaign. A launch authority names the exact
-- outputs it covers (its selections); a scheduled channel action is covered by
-- an authority only when the authority names a selection for an output
-- prepared under the same direction, for the same channel, in the same bundle
-- version. Direction and channel are matched exactly — never normalised —
-- because the two tables use different placement vocabularies and guessing
-- across them would schedule work nobody authorized. Residual: two outputs
-- under one direction and channel that differ only in placement, language,
-- format or ordinal share coverage; the authority's own review checks still
-- apply per output at authorize time, and narrowing this further needs a real
-- action-to-output key that the schema does not have.
--
-- Additive and forward-only. No existing table is altered beyond two nullable
-- columns; no existing function signature changes.

alter table public.campaign_action_runs
  add column launch_approval_id uuid,
  add column launch_digest text
    check (launch_digest is null or launch_digest ~ '^[0-9a-f]{64}$');

alter table public.campaign_action_runs
  add constraint campaign_action_runs_launch_authority_fkey
  foreign key (organization_id, launch_approval_id)
  references public.campaign_launch_approvals (organization_id, id)
  on delete restrict;

create index campaign_action_runs_launch_authority_idx
  on public.campaign_action_runs (organization_id, launch_approval_id);

-- The stamp is a record of the schedule decision, not a field to revise.
create function private.reject_campaign_action_run_authority_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.launch_approval_id is distinct from old.launch_approval_id
    or new.launch_digest is distinct from old.launch_digest then
    raise exception 'campaign_action_run_authority_immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger campaign_action_runs_authority_immutable
  before update on public.campaign_action_runs
  for each row execute function private.reject_campaign_action_run_authority_mutation();

-- A later variant invalidates: recording a new current version ends the power
-- of every live authority covering that output, without erasing what was
-- authorized. The replacement needs its own review and its own authority.
-- This is the existing invalidates-approval flow extended to the authority
-- record itself: refusal of new approvals already existed; this retires live
-- ones, which is what closes schedule-then-rerender-then-claim.
create function private.supersede_campaign_launch_authority()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.current_version_id is distinct from old.current_version_id then
    update public.campaign_launch_approvals authority
    set state = 'superseded'
    where authority.organization_id = new.organization_id
      and authority.campaign_id = new.campaign_id
      and authority.state = 'authorized'
      and exists (
        select 1 from public.campaign_launch_selections selection
        where selection.organization_id = new.organization_id
          and selection.launch_approval_id = authority.id
          and selection.deliverable_id = new.id
      );
  end if;
  return new;
end;
$$;

create trigger campaign_deliverables_new_version_supersedes_launch_authority
  after update of current_version_id on public.campaign_deliverables
  for each row execute function private.supersede_campaign_launch_authority();

-- Whether one scheduled action falls inside one authority's covered set.
--
-- Read against the selections rows, not the manifest JSON: the rows are the
-- enforced binding (one per reviewed output, written in the same transaction
-- that granted authority), while the manifest is stored opaquely.
create function private.launch_authority_covers_action(
  cover_organization_id uuid,
  cover_approval_id uuid,
  cover_bundle_version_id uuid,
  cover_direction_key uuid,
  cover_channel text
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.campaign_launch_selections selection
    join public.campaign_deliverable_versions version_row
      on version_row.organization_id = selection.organization_id
     and version_row.id = selection.deliverable_version_id
    join public.campaign_deliverables deliverable
      on deliverable.organization_id = selection.organization_id
     and deliverable.id = selection.deliverable_id
    where selection.organization_id = cover_organization_id
      and selection.launch_approval_id = cover_approval_id
      and version_row.bundle_version_id = cover_bundle_version_id
      and version_row.direction_key = cover_direction_key
      and deliverable.channel = cover_channel
  );
$$;

-- ---------------------------------------------------------------------------
-- schedule_campaign_actions, taught to require publication authority.
-- ---------------------------------------------------------------------------
--
-- The body is the scheduling flow as shipped; the only changes are the
-- authority lookup after the proposal-approval checks, the coverage join that
-- restricts the insert to the approved actions the authority actually covers,
-- and the stamp on the inserted runs. Check order is unchanged, so every
-- existing refusal still fires first for its own cause.

create or replace function public.schedule_campaign_actions(
  target_organization_id uuid,
  input_schedule jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  version_row public.campaign_bundle_versions;
  approval public.campaign_approvals;
  launch_authority public.campaign_launch_approvals;
  created integer := 0;
  existing integer := 0;
begin
  if target_organization_id is null
    or input_schedule ->> 'organization_id' is distinct from target_organization_id::text
  then
    raise exception 'campaign_schedule_organization_mismatch' using errcode = '42501';
  end if;

  if auth.uid() is null or not private.has_organization_role(
    target_organization_id,
    array['owner', 'admin', 'operator']::public.organization_role[]
  ) then
    raise exception 'campaign_schedule_forbidden' using errcode = '42501';
  end if;

  select version.* into version_row
  from public.campaign_bundle_versions version
  where version.organization_id = target_organization_id
    and version.id = (input_schedule ->> 'bundle_version_id')::uuid
  for update;

  if not found then
    raise exception 'campaign_bundle_version_not_found' using errcode = '42501';
  end if;

  select scoped.* into approval
  from public.campaign_approvals scoped
  where scoped.organization_id = target_organization_id
    and scoped.bundle_version_id = version_row.id
    and scoped.revoked_at is null;

  if not found then
    raise exception 'campaign_schedule_requires_approval' using errcode = '42501';
  end if;

  if approval.bundle_digest is distinct from version_row.digest then
    raise exception 'campaign_schedule_digest_mismatch' using errcode = '22023';
  end if;

  if approval.expires_at <= pg_catalog.now() then
    raise exception 'campaign_schedule_approval_expired' using errcode = '22023';
  end if;

  -- Publication authority: the newest live launch approval for this exact
  -- campaign and bundle version. Without one, scheduling fails closed — a
  -- visible refusal the operator retries after authorizing, never a silent
  -- queue of work nobody approved. Authority granted after a run was
  -- scheduled cannot cover that run retroactively: the stamp below is what
  -- the claim re-verifies.
  select authority.* into launch_authority
  from public.campaign_launch_approvals authority
  where authority.organization_id = target_organization_id
    and authority.campaign_id = version_row.campaign_id
    and authority.bundle_version_id = version_row.id
    and authority.state = 'authorized'
  order by authority.authorized_at desc
  limit 1;

  if not found then
    raise exception 'campaign_schedule_requires_launch_authority' using errcode = '22023';
  end if;

  -- A partial authority schedules its covered subset, never the whole approved
  -- set: stamping an uncovered action would let it dispatch outputs nobody
  -- authorized. An authority that covers none of the approved actions is a
  -- caller error worth surfacing, not a silent zero-create that reads as done.
  if not exists (
    select 1
    from public.campaign_channel_actions action
    where action.organization_id = target_organization_id
      and action.bundle_version_id = version_row.id
      and action.action_key = any (approval.action_keys)
      and private.launch_authority_covers_action(
        target_organization_id, launch_authority.id, version_row.id,
        action.direction_key, action.channel
      )
  ) then
    raise exception 'campaign_schedule_launch_authority_covers_nothing' using errcode = '22023';
  end if;

  -- Only the actions the approval actually named. An action present on the
  -- version but absent from the approval was not agreed to. And only the named
  -- actions the authority actually covers: stamping the rest would convert
  -- reviewed-one-output into permission to publish them all. Uncovered actions
  -- get no run at all — an unstamped run would flow through the grandfathered
  -- path below, which exists only for rows scheduled before enforcement.
  insert into public.campaign_action_runs (
    organization_id, campaign_id, bundle_version_id, action_key, scheduled_for, approval_id,
    launch_approval_id, launch_digest
  )
  select
    target_organization_id, version_row.campaign_id, version_row.id,
    action.action_key, action.scheduled_for, approval.id,
    launch_authority.id, launch_authority.launch_digest
  from public.campaign_channel_actions action
  where action.organization_id = target_organization_id
    and action.bundle_version_id = version_row.id
    and action.action_key = any (approval.action_keys)
    and private.launch_authority_covers_action(
      target_organization_id, launch_authority.id, version_row.id,
      action.direction_key, action.channel
    )
  on conflict (organization_id, bundle_version_id, action_key) do nothing;

  get diagnostics created = row_count;

  select pg_catalog.count(*)::integer into existing
  from public.campaign_action_runs run
  where run.organization_id = target_organization_id
    and run.bundle_version_id = version_row.id;

  update public.campaigns
  set state = 'scheduled', updated_at = pg_catalog.now()
  where organization_id = target_organization_id and id = version_row.campaign_id;

  return pg_catalog.jsonb_build_object(
    'campaign_id', version_row.campaign_id,
    'created_count', created,
    'total_count', existing
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- claim_campaign_action, taught to verify publication authority.
-- ---------------------------------------------------------------------------
--
-- The body is the claim path Task 17 plus the pause branch; the only changes
-- are the authority verification after the schedule-window checks and the
-- grandfather marker on the claim path. Pause runs skip both explicitly: a
-- pause stops spend rather than publishing, so publication authority has
-- nothing to say about it, and marking pauses grandfathered would pollute the
-- signal the marker exists to give.

create or replace function public.claim_campaign_action(
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
  launch_authority public.campaign_launch_approvals;
  committed bigint;
  reservation bigint;
  token uuid := gen_random_uuid();
  codes text[] := '{}';
  asserted jsonb := coalesce(input_claim -> 'asserted_facts', '{}'::jsonb);
  completed_receipt uuid;
  unknown_invocation uuid;
  is_pause boolean := false;
begin
  if target_organization_id is null
    or input_claim ->> 'organization_id' is distinct from target_organization_id::text
  then
    raise exception 'tool_gateway_organization_mismatch' using errcode = '42501';
  end if;

  select existing.* into run
  from public.campaign_action_runs existing
  where existing.organization_id = target_organization_id
    and existing.id = (input_claim ->> 'action_run_id')::uuid
  for update;

  if not found then
    raise exception 'tool_gateway_action_run_not_found' using errcode = '42501';
  end if;

  -- A pause run is named by the campaign_pause_runs row that created it. It is
  -- the one kind of action run that spends nothing and matches no channel action.
  select exists (
    select 1 from public.campaign_pause_runs pr
    where pr.organization_id = target_organization_id
      and pr.pause_action_run_id = run.id
  ) into is_pause;

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

  -- A pause has no channel action; leave `action` null and skip its checks.
  if not is_pause then
    select scoped.* into action from public.campaign_channel_actions scoped
    where scoped.organization_id = target_organization_id
      and scoped.bundle_version_id = run.bundle_version_id
      and scoped.action_key = run.action_key;
  end if;

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
    if not is_pause and not (run.action_key = any (approval.action_keys)) then
      codes := codes || 'action_not_approved';
    end if;
  end if;

  if not is_pause then
    if action.id is null then
      codes := codes || 'action_not_approved';
    elsif pg_catalog.now() + interval '5 minutes' < action.scheduled_for then
      codes := codes || 'outside_schedule_window';
    end if;
  end if;

  -- Publication authority, verified when the run carries it. The stamped
  -- digest must still match a live authority: a superseded or revoked
  -- authority, or terms that moved under it, refuses the claim rather than
  -- dispatching bytes nobody currently authorizes. Membership is re-checked
  -- too: a stamp only proves the run was scheduled under an authority, not
  -- that the authority covers this action — a forged or over-broad stamp for
  -- an uncovered action refuses rather than dispatching it. Runs scheduled
  -- before enforcement carry no reference and are evaluated under the proposal
  -- approval above, exactly as today.
  if not is_pause and run.launch_approval_id is not null then
    select authority.* into launch_authority
    from public.campaign_launch_approvals authority
    where authority.organization_id = target_organization_id
      and authority.id = run.launch_approval_id;

    if not found or launch_authority.state is distinct from 'authorized' then
      codes := codes || 'launch_authority_superseded';
    elsif launch_authority.launch_digest is distinct from run.launch_digest then
      codes := codes || 'launch_authority_digest_mismatch';
    elsif action.id is not null and not private.launch_authority_covers_action(
      target_organization_id, launch_authority.id, run.bundle_version_id,
      action.direction_key, action.channel
    ) then
      codes := codes || 'launch_authority_action_not_covered';
    end if;
  end if;

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

  if coalesce((asserted ->> 'credential_healthy')::boolean, false) is not true then
    codes := codes || 'credential_unhealthy';
  end if;
  if coalesce((asserted ->> 'tracking_ready')::boolean, false) is not true then
    codes := codes || 'tracking_not_ready';
  end if;
  if coalesce((asserted ->> 'consent_withdrawn')::boolean, false) is true then
    codes := codes || 'consent_withdrawn';
  end if;

  -- A pause never reserves: stopping an object moves no money.
  reservation := null;
  if not is_pause and action.spend_ceiling_minor is not null then
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

  if reservation is not null then
    insert into public.campaign_budget_reservations (
      organization_id, campaign_id, action_run_id, currency, reserved_minor
    ) values (
      target_organization_id, run.campaign_id, run.id, action.spend_currency, reservation
    )
    on conflict (organization_id, action_run_id) do nothing;
  end if;

  -- Pre-enforcement runs proceed, audibly. One marker row per claim keeps the
  -- ledger queryable for how much dispatch still flows without authority, so
  -- the cutover can be watched rather than assumed. This population only
  -- drains: the schedule gate above creates no new ref-less runs, so each
  -- marker is an old row working its way out, never a new one arriving.
  if not is_pause and run.launch_approval_id is null then
    insert into private.tool_gateway_operations (
      organization_id, action_run_id, operation, outcome, refusal_codes
    ) values (target_organization_id, run.id, 'claim', 'grandfathered', '{}');
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
    'currency', case when is_pause then null else action.spend_currency end
  );
end;
$$;

comment on function public.schedule_campaign_actions(uuid, jsonb) is
  'Materialises one action run per approved action the live launch authority covers. Requires a live launch approval for the exact campaign and bundle version, refuses when it covers none of the approved actions, and stamps its id and digest on every run it creates; uncovered actions get no run. The claim re-verifies the stamp.';

comment on function public.claim_campaign_action(uuid, jsonb) is
  'Atomically claims a due action. Re-verifies the stamped launch authority when the run carries one and refuses on supersession, digest mismatch, or an action outside the authority''s covered set; pre-enforcement runs without a reference proceed under the proposal approval and are logged as grandfathered.';
