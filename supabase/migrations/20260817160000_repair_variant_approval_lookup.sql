-- Repair: the variant append function ordered approvals by a column that does
-- not exist.
--
-- `campaign_approvals` records `approved_at`, not `created_at`. plpgsql resolves
-- record fields at execution time, so the original function applied cleanly and
-- failed on its first real call — which is precisely why AGENTS.md requires a
-- new function reading a table it did not create to be called once against
-- staging before it is considered done. This is that call's result.
--
-- Nothing else about the function changes.

create or replace function public.append_campaign_creative_variant(
  target_organization_id uuid,
  input_variant jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_version_id uuid := (input_variant ->> 'bundle_version_id')::uuid;
  version_row public.campaign_bundle_versions;
  approval_row public.campaign_approvals;
  next_direction_ordinal integer;
  next_total_ordinal integer;
  saved_id uuid;
begin
  if target_organization_id is null
    or input_variant ->> 'organization_id' is distinct from target_organization_id::text
  then
    raise exception 'campaign_variant_organization_mismatch' using errcode = '42501';
  end if;

  select version.* into version_row
  from public.campaign_bundle_versions version
  where version.organization_id = target_organization_id
    and version.id = target_version_id
  for update;

  if not found then
    raise exception 'campaign_bundle_version_not_found' using errcode = '42501';
  end if;

  -- A variant is creative nobody reviewed individually, so the licence to make
  -- one has to be live at the moment it is made. An approval that has lapsed,
  -- been revoked, or been superseded by a later version authorizes nothing.
  select approval.* into approval_row
  from public.campaign_approvals approval
  where approval.organization_id = target_organization_id
    and approval.bundle_version_id = target_version_id
    and approval.revoked_at is null
    and approval.expires_at > pg_catalog.now()
  order by approval.approved_at desc
  limit 1;

  if not found then
    raise exception 'campaign_variant_requires_live_approval' using errcode = '42501';
  end if;

  if approval_row.bundle_digest is distinct from version_row.digest then
    raise exception 'campaign_variant_approval_digest_mismatch' using errcode = '22023';
  end if;

  -- The window the approval licensed. Past it, the policy authorizes nothing,
  -- whatever the approval's own expiry still says.
  if (version_row.manifest -> 'generationPolicy' ->> 'policyExpiresAt')::timestamptz
     <= pg_catalog.now()
  then
    raise exception 'campaign_variant_policy_expired' using errcode = '22023';
  end if;

  select coalesce(pg_catalog.max(variant.direction_ordinal), 0) + 1
    into next_direction_ordinal
  from public.campaign_creative_variants variant
  where variant.organization_id = target_organization_id
    and variant.bundle_version_id = target_version_id
    and variant.direction_key = (input_variant ->> 'direction_key')::uuid;

  select coalesce(pg_catalog.max(variant.total_ordinal), 0) + 1
    into next_total_ordinal
  from public.campaign_creative_variants variant
  where variant.organization_id = target_organization_id
    and variant.bundle_version_id = target_version_id;

  -- Named refusals rather than a constraint violation, so the caller can tell
  -- "this direction is full" from "the whole version is full" and say so.
  if next_direction_ordinal > version_row.max_variants_per_direction then
    raise exception 'campaign_variant_direction_cap_reached' using errcode = '22023';
  end if;
  if next_total_ordinal > version_row.max_variants_total then
    raise exception 'campaign_variant_total_cap_reached' using errcode = '22023';
  end if;

  insert into public.campaign_creative_variants (
    organization_id, campaign_id, bundle_version_id, direction_key,
    direction_ordinal, total_ordinal,
    max_variants_per_direction, max_variants_total,
    asset_id, channel, placement,
    hook, caption, call_to_action, hashtags,
    content_hash, provenance, created_by
  ) values (
    target_organization_id,
    version_row.campaign_id,
    target_version_id,
    (input_variant ->> 'direction_key')::uuid,
    next_direction_ordinal,
    next_total_ordinal,
    version_row.max_variants_per_direction,
    version_row.max_variants_total,
    (input_variant ->> 'asset_id')::uuid,
    input_variant ->> 'channel',
    input_variant ->> 'placement',
    input_variant ->> 'hook',
    input_variant ->> 'caption',
    input_variant ->> 'call_to_action',
    coalesce(
      (select pg_catalog.array_agg(value #>> '{}')
       from pg_catalog.jsonb_array_elements(input_variant -> 'hashtags')),
      '{}'::text[]
    ),
    input_variant ->> 'content_hash',
    coalesce(input_variant -> 'provenance', '{}'::jsonb),
    auth.uid()
  )
  returning id into saved_id;

  return saved_id;
end;
$$;

revoke all on function public.append_campaign_creative_variant(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.append_campaign_creative_variant(uuid, jsonb) to service_role;
