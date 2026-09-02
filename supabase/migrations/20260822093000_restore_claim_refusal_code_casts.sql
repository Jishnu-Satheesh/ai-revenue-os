-- Restore the explicit text cast on every gateway refusal code.
--
-- `codes` is `text[]`. In `codes := codes || 'capability_not_granted'` the
-- literal has no declared type, and Postgres resolves the ambiguity toward
-- `text[] || text[]` rather than `text[] || text`. It then tries to read the
-- word as an array literal and raises "malformed array literal", so a claim
-- that should have been refused politely with a named reason crashes instead.
--
-- 20260815203000_repair_claim_refusal_codes.sql fixed exactly this. Task 20
-- re-created `claim_campaign_action` for the pause branch in
-- 20260819120000_campaign_allocation_events.sql and carried the uncast literals
-- back in with it, reopening the regression on every refusal path.
--
-- This definition is the Task 20 body with `::text` on each appended code and
-- no other change. Forward-only; no table, grant, or signature is touched.

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

  if campaign.state = 'cancelled' then codes := codes || 'campaign_cancelled'::text; end if;

  if not found or approval.id is null then
    codes := codes || 'no_active_approval'::text;
  else
    if approval.bundle_version_id is distinct from run.bundle_version_id
      or run.bundle_version_id is distinct from latest_version_id
    then
      codes := codes || 'approval_version_superseded'::text;
    end if;
    if approval.bundle_digest is distinct from version.digest then
      codes := codes || 'approval_digest_mismatch'::text;
    end if;
    if approval.expires_at <= pg_catalog.now() then codes := codes || 'approval_expired'::text; end if;
    if approval.attestation_id is null then codes := codes || 'attestation_missing'::text; end if;
    if not is_pause and not (run.action_key = any (approval.action_keys)) then
      codes := codes || 'action_not_approved'::text;
    end if;
  end if;

  if not is_pause then
    if action.id is null then
      codes := codes || 'action_not_approved'::text;
    elsif pg_catalog.now() + interval '5 minutes' < action.scheduled_for then
      codes := codes || 'outside_schedule_window'::text;
    end if;
  end if;

  select scoped.* into grant_row from public.integration_capability_grants scoped
  where scoped.organization_id = target_organization_id
    and scoped.capability_key = input_claim ->> 'capability_key';

  if not found then
    codes := codes || 'capability_not_granted'::text;
  else
    if pg_catalog.cardinality(grant_row.restriction_codes) > 0 then
      codes := codes || 'capability_restricted'::text;
    end if;
    if approval.capability_grant_versions ? (input_claim ->> 'capability_key')
      and (approval.capability_grant_versions ->> (input_claim ->> 'capability_key'))
        is distinct from grant_row.grant_version::text
    then
      codes := codes || 'capability_grant_changed'::text;
    end if;
  end if;

  if coalesce((asserted ->> 'credential_healthy')::boolean, false) is not true then
    codes := codes || 'credential_unhealthy'::text;
  end if;
  if coalesce((asserted ->> 'tracking_ready')::boolean, false) is not true then
    codes := codes || 'tracking_not_ready'::text;
  end if;
  if coalesce((asserted ->> 'consent_withdrawn')::boolean, false) is true then
    codes := codes || 'consent_withdrawn'::text;
  end if;

  -- A pause never reserves: stopping an object moves no money.
  reservation := null;
  if not is_pause and action.spend_ceiling_minor is not null then
    if action.spend_currency is distinct from approval.spend_currency then
      codes := codes || 'spend_currency_mismatch'::text;
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
        codes := codes || 'spend_ceiling_exhausted'::text;
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

-- `create or replace` keeps the existing ACL, so these re-assert rather than
-- change it. Stated explicitly because a gateway claim reachable by a logged-in
-- user would bypass the worker boundary entirely, and that is worth failing
-- loudly on rather than inheriting quietly.
revoke all on function public.claim_campaign_action(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.claim_campaign_action(uuid, jsonb) to service_role;
