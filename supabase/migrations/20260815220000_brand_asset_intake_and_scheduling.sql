-- Brand-asset intake and campaign scheduling. Additive only.
--
-- Two flows that share one idea: a row exists before the thing it describes is
-- trustworthy, and something server-side has to promote it.
--
-- A brand asset version is created unusable. The browser uploads bytes to its
-- reserved path, and the server then fetches them back, identifies them from
-- their own leading bytes, re-encodes them, and only then marks the version
-- usable. Until that happens, generation cannot see it. A version that trusted
-- the browser's declared type would let anything through under an image label.
--
-- Scheduling materialises one action run per approved action. It refuses unless
-- a live approval covers the exact version, so scheduling cannot become a way
-- around approval.

create function public.create_brand_asset_version(
  target_organization_id uuid,
  input_asset jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  asset_id uuid := (input_asset ->> 'brand_asset_id')::uuid;
  version_id uuid := gen_random_uuid();
  next_version integer;
  storage_path text;
begin
  if target_organization_id is null
    or input_asset ->> 'organization_id' is distinct from target_organization_id::text
  then
    raise exception 'brand_asset_organization_mismatch' using errcode = '42501';
  end if;

  if auth.uid() is null or not private.has_organization_role(
    target_organization_id,
    array['owner', 'admin', 'operator']::public.organization_role[]
  ) then
    raise exception 'brand_asset_forbidden' using errcode = '42501';
  end if;

  -- A new asset identity, or another version of one that already exists.
  if asset_id is null then
    insert into public.organization_brand_assets (
      organization_id, label, asset_role, created_by
    ) values (
      target_organization_id,
      input_asset ->> 'label',
      input_asset ->> 'asset_role',
      auth.uid()
    )
    returning id into asset_id;
  elsif not exists (
    select 1 from public.organization_brand_assets existing
    where existing.organization_id = target_organization_id and existing.id = asset_id
  ) then
    raise exception 'brand_asset_not_found' using errcode = '42501';
  end if;

  select coalesce(pg_catalog.max(version.version), 0) + 1
  into next_version
  from public.organization_brand_asset_versions version
  where version.organization_id = target_organization_id and version.brand_asset_id = asset_id;

  -- The path is decided here, not by the caller. A browser that chose its own
  -- path could write into another organization's folder.
  storage_path := target_organization_id::text || '/' || asset_id::text || '/'
    || version_id::text || '/source';

  insert into public.organization_brand_asset_versions (
    id, organization_id, brand_asset_id, version, storage_path, content_hash,
    mime_type, byte_size, width_px, height_px, is_usable
  ) values (
    version_id, target_organization_id, asset_id, next_version, storage_path,
    -- Placeholders until the server has seen the bytes. `is_usable` false is
    -- what actually keeps this out of generation.
    repeat('0', 64), 'image/png', 1, 1, 1, false
  );

  return pg_catalog.jsonb_build_object(
    'brand_asset_id', asset_id,
    'version_id', version_id,
    'storage_path', storage_path
  );
end;
$$;

revoke all on function public.create_brand_asset_version(uuid, jsonb) from public, anon;
grant execute on function public.create_brand_asset_version(uuid, jsonb) to authenticated;

/**
 * Promotes a version to usable, from facts the server read out of the bytes.
 *
 * Every value here comes from decoding the stored object. None of it is taken
 * from the request that uploaded it.
 */
create function public.finalize_brand_asset_version(
  target_organization_id uuid,
  input_version jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  version_row public.organization_brand_asset_versions;
begin
  if auth.uid() is null or not private.has_organization_role(
    target_organization_id,
    array['owner', 'admin', 'operator']::public.organization_role[]
  ) then
    raise exception 'brand_asset_forbidden' using errcode = '42501';
  end if;

  select version.* into version_row
  from public.organization_brand_asset_versions version
  where version.organization_id = target_organization_id
    and version.id = (input_version ->> 'version_id')::uuid
  for update;

  if not found then
    raise exception 'brand_asset_version_not_found' using errcode = '42501';
  end if;

  -- Finalizing twice would let a second upload replace bytes a campaign has
  -- already been generated from.
  if version_row.is_usable then
    raise exception 'brand_asset_version_already_final' using errcode = '23514';
  end if;

  update public.organization_brand_asset_versions
  set content_hash = input_version ->> 'content_hash',
      mime_type = input_version ->> 'mime_type',
      byte_size = (input_version ->> 'byte_size')::bigint,
      width_px = (input_version ->> 'width_px')::integer,
      height_px = (input_version ->> 'height_px')::integer,
      is_usable = true
  where organization_id = target_organization_id and id = version_row.id;
end;
$$;

revoke all on function public.finalize_brand_asset_version(uuid, jsonb) from public, anon;
grant execute on function public.finalize_brand_asset_version(uuid, jsonb) to authenticated;

/**
 * Materialises one action run per approved action.
 *
 * Refuses unless a live, unexpired approval covers this exact version and
 * digest, so scheduling cannot become a path around approval. Idempotent: a
 * second call returns the runs the first one created rather than duplicating
 * them, because two runs for one action would make "did this publish?"
 * ambiguous.
 */
create function public.schedule_campaign_actions(
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

  -- Only the actions the approval actually named. An action present on the
  -- version but absent from the approval was not agreed to.
  insert into public.campaign_action_runs (
    organization_id, campaign_id, bundle_version_id, action_key, scheduled_for, approval_id
  )
  select
    target_organization_id, version_row.campaign_id, version_row.id,
    action.action_key, action.scheduled_for, approval.id
  from public.campaign_channel_actions action
  where action.organization_id = target_organization_id
    and action.bundle_version_id = version_row.id
    and action.action_key = any (approval.action_keys)
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

revoke all on function public.schedule_campaign_actions(uuid, jsonb) from public, anon;
grant execute on function public.schedule_campaign_actions(uuid, jsonb) to authenticated;
