-- Creative History intake completion.
--
-- `20260909124757_creative_history_core.sql` created the tables, the storage
-- bucket and the first write paths. Three doors were still missing, and without
-- them the upload story cannot be finished:
--
--   1. A second file for an existing design. `create_creative_item` reserves
--      version 1 only, so a corrected re-upload had nowhere to go.
--   2. Human metadata confirmation. `creativeEligibility` treats an item with
--      no confirmed metadata as ineligible, and confirmed metadata could only
--      be supplied at creation — which is the wrong moment, because ADR 0049
--      puts confirmation *after* the bytes are validated and after a model may
--      have proposed a description.
--   3. A folder that is its own parent. The depth trigger refused a grandchild
--      but read the *committed* parent row, so a row pointing at itself slipped
--      past it. No caller can reach that today (`create_creative_folder` does
--      not accept an id and `authenticated` holds no UPDATE grant), but the
--      guard should not depend on that staying true.
--
-- Additive and forward-only. Nothing here rewrites an existing row, and no
-- existing function is replaced except the depth trigger, which only gains a
-- refusal.

-- 1. A folder can never be its own parent -------------------------------------

create or replace function private.assert_creative_folder_depth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Checked before the depth rule: a self-parent is invisible to the lookup
  -- below, because the row being written is not yet the row being read.
  if new.parent_folder_id is not null and new.parent_folder_id = new.id then
    raise exception 'creative_folder_cycle' using errcode = '23514';
  end if;
  if new.parent_folder_id is not null and exists (
    select 1
    from public.creative_folders parent
    where parent.organization_id = new.organization_id
      and parent.id = new.parent_folder_id
      and parent.parent_folder_id is not null
  ) then
    raise exception 'creative_folder_depth_exceeded' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- 2. Reserving the next version of an existing design --------------------------
--
-- The reservation deliberately does NOT move `creative_items.current_version_id`.
-- That pointer would then name bytes nobody has validated, and a reader asking
-- "what is the current design?" would get an empty frame. The read model derives
-- the latest *usable* version from the version rows instead, and reports a
-- pending reservation separately.

create function public.reserve_creative_item_version(
  target_organization_id uuid,
  input_version jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_item public.creative_items;
  saved public.creative_item_versions;
  next_version integer;
begin
  if (select auth.uid()) is null
    or not private.has_organization_permission(target_organization_id, 'asset.manage')
    or input_version ->> 'organization_id' is distinct from target_organization_id::text then
    raise exception 'creative_item_version_reserve_forbidden' using errcode = '42501';
  end if;

  if nullif(input_version ->> 'storage_path', '') is null
    or input_version ->> 'storage_path' not like target_organization_id::text || '/%'
    or nullif(input_version ->> 'item_id', '') is null then
    raise exception 'creative_item_version_reserve_invalid' using errcode = '22023';
  end if;

  -- Locking the item serializes version numbering. Two browser tabs reserving
  -- at the same moment would otherwise both read the same maximum and collide
  -- on the (organization_id, creative_item_id, version) unique index.
  select * into target_item
  from public.creative_items item
  where item.organization_id = target_organization_id
    and item.id = (input_version ->> 'item_id')::uuid
    and item.archived_at is null
  for update;

  if not found then
    raise exception 'creative_item_not_found_or_archived' using errcode = '42501';
  end if;

  -- A Studio-linked design carries a render reference, never uploaded bytes.
  -- Task 8's controlled completion path owns that linkage.
  if target_item.source_kind = 'studio_render' then
    raise exception 'creative_item_version_reserve_invalid' using errcode = '22023';
  end if;

  -- The alias is not `version`: that is also a column name here, and
  -- `max(version)` would then read as the whole row rather than the number.
  select coalesce(pg_catalog.max(item_version.version), 0) + 1 into next_version
  from public.creative_item_versions item_version
  where item_version.organization_id = target_organization_id
    and item_version.creative_item_id = target_item.id;

  insert into public.creative_item_versions (
    organization_id, creative_item_id, version, storage_path, created_by
  ) values (
    target_organization_id, target_item.id, next_version,
    input_version ->> 'storage_path', (select auth.uid())
  ) returning * into saved;

  return pg_catalog.jsonb_build_object(
    'item_id', target_item.id,
    'version_id', saved.id,
    'version', saved.version,
    'storage_path', saved.storage_path
  );
end;
$$;

-- 3. Human-confirmed metadata, kept apart from a model's proposal --------------
--
-- Both columns are written here, but they are never written from the same
-- caller intent: the application exposes confirmation and proposal as two
-- separate methods, and only a person's request reaches the confirmed column.
-- Writing them through one function keeps the permission check in one place.

create function public.confirm_creative_item_metadata(
  target_organization_id uuid,
  input_metadata jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.creative_items;
  has_confirmed boolean := input_metadata ? 'confirmed_metadata';
  has_proposed boolean := input_metadata ? 'proposed_metadata';
begin
  if (select auth.uid()) is null
    or not private.has_organization_permission(target_organization_id, 'asset.manage')
    or input_metadata ->> 'organization_id' is distinct from target_organization_id::text then
    raise exception 'creative_item_metadata_forbidden' using errcode = '42501';
  end if;

  if nullif(input_metadata ->> 'item_id', '') is null
    or not (has_confirmed or has_proposed)
    or (has_confirmed
      and pg_catalog.jsonb_typeof(input_metadata -> 'confirmed_metadata') not in ('object', 'null'))
    or (has_proposed
      and pg_catalog.jsonb_typeof(input_metadata -> 'proposed_metadata') not in ('object', 'null')) then
    raise exception 'creative_item_metadata_invalid' using errcode = '22023';
  end if;

  update public.creative_items
  set
    confirmed_metadata = case
      when has_confirmed then nullif(input_metadata -> 'confirmed_metadata', 'null'::jsonb)
      else confirmed_metadata
    end,
    proposed_metadata = case
      when has_proposed then nullif(input_metadata -> 'proposed_metadata', 'null'::jsonb)
      else proposed_metadata
    end
  where organization_id = target_organization_id
    and id = (input_metadata ->> 'item_id')::uuid
    and archived_at is null
  returning * into saved;

  if not found then
    raise exception 'creative_item_not_found_or_archived' using errcode = '42501';
  end if;

  return pg_catalog.jsonb_build_object(
    'item_id', saved.id,
    'metadata_confirmed', saved.confirmed_metadata is not null,
    'updated_at', saved.updated_at
  );
end;
$$;

revoke all on function public.reserve_creative_item_version(uuid, jsonb),
  public.confirm_creative_item_metadata(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.reserve_creative_item_version(uuid, jsonb),
  public.confirm_creative_item_metadata(uuid, jsonb) to authenticated;

comment on function public.reserve_creative_item_version(uuid, jsonb) is
  'Appends an unfinalized version to an existing non-archived, non-Studio Creative History item. Requires asset.manage. Does not move current_version_id: unvalidated bytes are never the current design.';
comment on function public.confirm_creative_item_metadata(uuid, jsonb) is
  'Writes human-confirmed and/or model-proposed descriptive metadata for a Creative History item. Requires asset.manage. Confirmed metadata is what makes an item selector-eligible, so only a person''s request reaches that column.';
