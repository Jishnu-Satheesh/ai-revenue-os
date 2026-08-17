-- Campaign Bundle manifest V2: the generation policy.
--
-- Approval stops binding a single creative point and starts binding a bounded
-- creative family: how many variants may be produced, until when, within which
-- offer and which claims. The policy lives inside the manifest, so it is inside
-- the digest and inside the approval binding, and widening it is material
-- exactly like changing the copy. See adrs/0020-bounded-creative-family-approval.md.
--
-- There is deliberately no schemaVersion 1 reader. The platform is
-- pre-production and the single V1 version chain is repaired forward by
-- regenerating it, which exercises the new path instead of merely asserting it.

-- Refuse to run if anything has ever executed -------------------------------
--
-- Deleting the V1 chain is only legal while no campaign has reached a provider.
-- Once an action run or a receipt exists, that history is evidence and the
-- forward repair becomes destruction. This aborts rather than assuming.
do $guard$
begin
  if exists (select 1 from public.campaign_action_runs)
     or exists (select 1 from public.provider_receipts)
  then
    raise exception
      'campaign bundle V2 repair refused: execution history exists, so V1 versions must be migrated rather than regenerated'
      using errcode = 'P0001';
  end if;
end;
$guard$;

-- Remove the pre-production V1 chain ---------------------------------------
--
-- A bundle version is deliberately undeletable: it is the evidence an approval
-- points at, and nine triggers say so. Removing the V1 chain therefore means
-- stepping over those guards on purpose, in the open, for exactly one
-- statement — which is why the abort above runs first. The guards are correct;
-- this is the one moment the platform is allowed to be younger than them.
--
-- `session_replication_role` is deliberately NOT used: it would also disable
-- foreign-key enforcement, and the cascade is what does the actual cleanup.
alter table public.campaign_source_snapshots disable trigger campaign_source_snapshots_immutable;
alter table public.campaign_bundle_versions disable trigger campaign_bundle_versions_immutable;
alter table public.campaign_creative_directions disable trigger campaign_creative_directions_immutable;
alter table public.campaign_assets disable trigger campaign_assets_immutable;
alter table public.campaign_channel_actions disable trigger campaign_channel_actions_immutable;
alter table public.campaign_measurement_plans disable trigger campaign_measurement_plans_immutable;
alter table public.campaign_briefs disable trigger campaign_briefs_immutable;
alter table public.campaign_approvals disable trigger campaign_approvals_append_only;
alter table public.campaign_visual_attestations disable trigger campaign_visual_attestations_append_only;

-- Cascades through source snapshots, bundle versions, directions, assets,
-- actions, measurement plans, attestations, approvals, and generation runs.
delete from public.campaigns
where id in (
  select distinct version.campaign_id
  from public.campaign_bundle_versions version
  where (version.manifest ->> 'schemaVersion') is distinct from '2'
);

alter table public.campaign_visual_attestations enable trigger campaign_visual_attestations_append_only;
alter table public.campaign_approvals enable trigger campaign_approvals_append_only;
alter table public.campaign_briefs enable trigger campaign_briefs_immutable;
alter table public.campaign_measurement_plans enable trigger campaign_measurement_plans_immutable;
alter table public.campaign_channel_actions enable trigger campaign_channel_actions_immutable;
alter table public.campaign_assets enable trigger campaign_assets_immutable;
alter table public.campaign_creative_directions enable trigger campaign_creative_directions_immutable;
alter table public.campaign_bundle_versions enable trigger campaign_bundle_versions_immutable;
alter table public.campaign_source_snapshots enable trigger campaign_source_snapshots_immutable;

-- Every guard is back on. A later statement in this migration that tried to
-- edit a version would now fail exactly as it should.
do $verify$
declare
  disabled integer;
begin
  select pg_catalog.count(*) into disabled
  from pg_catalog.pg_trigger trigger_row
  join pg_catalog.pg_class table_row on table_row.oid = trigger_row.tgrelid
  where table_row.relname like 'campaign%'
    and not trigger_row.tgisinternal
    and trigger_row.tgenabled = 'D';

  if disabled > 0 then
    raise exception 'campaign immutability guards left disabled: % trigger(s)', disabled
      using errcode = 'P0001';
  end if;
end;
$verify$;

-- Policy columns ------------------------------------------------------------
--
-- Generated rather than written, so a stored manifest and its indexed columns
-- cannot disagree. The expiry stays text: casting to timestamptz is not
-- immutable and therefore not allowed in a generated column, and an ISO 8601
-- UTC string already compares correctly as text.
-- `not null` is load-bearing, not decoration. A manifest carrying no policy
-- generates NULL into all three columns, and a CHECK that evaluates to NULL
-- passes. Without this, a bundle with no bound at all would satisfy every
-- constraint below.
alter table public.campaign_bundle_versions
  add column max_variants_per_direction integer
    generated always as ((manifest -> 'generationPolicy' ->> 'maxVariantsPerDirection')::integer) stored
    not null,
  add column max_variants_total integer
    generated always as ((manifest -> 'generationPolicy' ->> 'maxVariantsTotal')::integer) stored
    not null,
  add column policy_expires_at_utc text
    generated always as (manifest -> 'generationPolicy' ->> 'policyExpiresAt') stored
    not null;

alter table public.campaign_bundle_versions
  add constraint campaign_bundle_versions_schema_version_2
    check ((manifest ->> 'schemaVersion') = '2'),
  add constraint campaign_bundle_versions_variant_caps_bounded
    check (
      max_variants_per_direction between 1 and 50
      and max_variants_total between 1 and 300
    ),
  -- The total may never be able to starve a direction. With five per direction
  -- across three directions, a total of twelve is not a budget but a race, and
  -- the loser is usually the experimental direction whose data matters most.
  add constraint campaign_bundle_versions_variant_total_covers_directions
    check (
      max_variants_total
        >= max_variants_per_direction * jsonb_array_length(manifest -> 'directions')
    ),
  add constraint campaign_bundle_versions_policy_expiry_utc
    check (policy_expires_at_utc ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$');

comment on column public.campaign_bundle_versions.policy_expires_at_utc is
  'ISO 8601 UTC instant the licence to generate variants ends. Text because a timestamptz cast is not immutable; ISO 8601 Z strings sort correctly as text.';

-- Approval must cover the window it authorizes ------------------------------

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

-- Approval is a human act performed in a session, so the authenticated role
-- holds it. Every check inside is re-evaluated against `auth.uid()`.
revoke all on function public.approve_campaign_bundle(uuid, jsonb) from public, anon;
grant execute on function public.approve_campaign_bundle(uuid, jsonb) to authenticated;
