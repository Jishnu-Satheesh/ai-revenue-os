-- Re-approval retire needs a reason.
--
-- The 160000 retire set revoked_at without revoked_reason, violating the
-- paired-null check: every revocation names its reason. An approval retired
-- to make room for its own re-approval is operator_revoked — the approving
-- operator's new decision ends the dead row, not a new version and not a
-- lost capability. Single-line change; whole body repeated.

create or replace function public.approve_campaign_bundle(
  target_organization_id uuid,
  input_approval jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_version_id uuid := (input_approval ->> 'bundle_version_id')::uuid;
  supplied_digest text := input_approval ->> 'bundle_digest';
  version_row public.campaign_bundle_versions;
  attestation public.campaign_visual_attestations;
  saved_id uuid;
  supplied_actions uuid[] := coalesce(
    (select pg_catalog.array_agg((value #>> '{}')::uuid)
     from pg_catalog.jsonb_array_elements(input_approval -> 'action_keys')),
    '{}'::uuid[]
  );
begin
  if target_organization_id is null
    or input_approval ->> 'organization_id' is distinct from target_organization_id::text
  then
    raise exception 'campaign_approval_organization_mismatch' using errcode = '42501';
  end if;

  -- Role is re-checked here, not trusted from the caller. This function is a
  -- privileged path, so it must not assume the route in front of it ran.
  if auth.uid() is null or not private.has_organization_role(
    target_organization_id,
    array['owner', 'admin', 'operator']::public.organization_role[]
  ) then
    raise exception 'campaign_approval_forbidden' using errcode = '42501';
  end if;

  select version.* into version_row
  from public.campaign_bundle_versions version
  where version.organization_id = target_organization_id
    and version.id = target_version_id
  for update;

  if not found then
    raise exception 'campaign_bundle_version_not_found' using errcode = '42501';
  end if;

  -- The digest the operator saw must be the digest stored. A mismatch means
  -- they approved a different document from the one on file.
  if version_row.digest is distinct from supplied_digest then
    raise exception 'campaign_approval_digest_mismatch' using errcode = '22023';
  end if;

  -- Approval may only ever cover the newest version. An older one has already
  -- been superseded, and authorizing it would authorize a proposal nobody is
  -- looking at any more.
  if exists (
    select 1 from public.campaign_bundle_versions newer
    where newer.organization_id = target_organization_id
      and newer.campaign_id = version_row.campaign_id
      and newer.version > version_row.version
  ) then
    raise exception 'campaign_approval_version_superseded' using errcode = '22023';
  end if;

  select attest.* into attestation
  from public.campaign_visual_attestations attest
  where attest.organization_id = target_organization_id
    and attest.id = (input_approval ->> 'attestation_id')::uuid;

  if not found
    or attestation.bundle_version_id is distinct from target_version_id
    or attestation.bundle_digest is distinct from supplied_digest
  then
    raise exception 'campaign_attestation_missing_for_version' using errcode = '22023';
  end if;

  if cardinality(supplied_actions) = 0 then
    raise exception 'campaign_approval_actions_missing' using errcode = '22023';
  end if;

  -- Every approved action must belong to this version, and every action of
  -- this version must be approved. A partial list would silently authorize
  -- some of a proposal an operator read as a whole.
  if exists (
    select 1
    from pg_catalog.unnest(supplied_actions) as supplied(action_key)
    where not exists (
      select 1 from public.campaign_channel_actions channel_action
      where channel_action.organization_id = target_organization_id
        and channel_action.bundle_version_id = target_version_id
        and channel_action.action_key = supplied.action_key
    )
  ) or (
    select pg_catalog.count(*) from public.campaign_channel_actions channel_action
    where channel_action.organization_id = target_organization_id
      and channel_action.bundle_version_id = target_version_id
  ) <> cardinality(supplied_actions) then
    raise exception 'campaign_approval_actions_mismatch' using errcode = '22023';
  end if;

  -- An approval must cover the whole window it authorizes. The policy licences
  -- variant generation until `policyExpiresAt`; an approval lapsing before then
  -- would leave a live licence with no live authority behind it, which reads to
  -- an operator as permission the database would in fact refuse.
  if (input_approval ->> 'expires_at')::timestamptz
     < (version_row.manifest -> 'generationPolicy' ->> 'policyExpiresAt')::timestamptz
  then
    raise exception 'campaign_approval_expires_before_policy' using errcode = '22023';
  end if;

  -- The approved ceiling must match the version's own, or the approval would
  -- authorize a different amount of money from the one under review.
  if (input_approval -> 'total_spend_ceiling' ->> 'amountMinor')::bigint
      is distinct from version_row.total_spend_ceiling_minor
    or input_approval -> 'total_spend_ceiling' ->> 'currency'
      is distinct from version_row.spend_currency
  then
    raise exception 'campaign_approval_spend_mismatch' using errcode = '22023';
  end if;

  -- An expired approval that was never revoked still occupies the version's
  -- single live slot, which made re-approval after expiry impossible: the
  -- unique index refused the new row while the UI invited it. Retire only the
  -- dead rows — a still-live approval keeps blocking, so a second approval
  -- can never replace authority that has not lapsed.
  update public.campaign_approvals
  set revoked_at = pg_catalog.now(),
      revoked_reason = 'operator_revoked'
  where organization_id = target_organization_id
    and bundle_version_id = target_version_id
    and revoked_at is null
    and expires_at <= pg_catalog.now();

  if exists (
    select 1 from public.campaign_approvals live
    where live.organization_id = target_organization_id
      and live.bundle_version_id = target_version_id
      and live.revoked_at is null
  ) then
    raise exception 'campaign_approval_already_live' using errcode = '22023';
  end if;

  insert into public.campaign_approvals (
    organization_id, campaign_id, bundle_version_id, bundle_digest, attestation_id,
    approved_by, expires_at, capability_grant_versions, policy_version_ids,
    action_keys, total_spend_ceiling_minor, spend_currency
  ) values (
    target_organization_id, version_row.campaign_id, target_version_id, supplied_digest,
    attestation.id, auth.uid(), (input_approval ->> 'expires_at')::timestamptz,
    coalesce(input_approval -> 'capability_grant_versions', '{}'::jsonb),
    coalesce(
      (select pg_catalog.array_agg((value #>> '{}')::uuid)
       from pg_catalog.jsonb_array_elements(input_approval -> 'policy_version_ids')),
      '{}'::uuid[]
    ),
    supplied_actions,
    version_row.total_spend_ceiling_minor,
    version_row.spend_currency
  )
  returning id into saved_id;

  update public.campaigns
  set state = 'approved', updated_at = pg_catalog.now()
  where organization_id = target_organization_id and id = version_row.campaign_id;

  return saved_id;
end;
$$;
