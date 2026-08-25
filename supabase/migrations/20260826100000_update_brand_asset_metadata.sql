-- Complete the organization Asset Library write boundary.
--
-- Brand assets were deliberately left select-only for authenticated users, but
-- the first Asset Library migration did not provide the RPC Task 9 needs to
-- classify, tag, or archive them. Keep the tables select-only and put the
-- mutable identity fields behind one tenant- and permission-checked function.

create or replace function public.create_brand_asset_version(
  target_organization_id uuid,
  input_asset jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  asset_id uuid;
  version_id uuid := pg_catalog.gen_random_uuid();
  next_version integer;
  storage_path text;
  supplied_classification boolean := input_asset ? 'conditioning_roles'
    or input_asset ? 'tags'
    or input_asset ? 'scripts'
    or input_asset ? 'ownership';
  asset_conditioning_roles text[];
  asset_tags text[];
  asset_scripts text[];
  asset_ownership text := coalesce(nullif(input_asset ->> 'ownership', ''), 'third_party');
begin
  if target_organization_id is null
    or input_asset ->> 'organization_id' is distinct from target_organization_id::text
  then
    raise exception 'brand_asset_organization_mismatch' using errcode = '42501';
  end if;

  if (select auth.uid()) is null
    or not private.has_organization_permission(target_organization_id, 'asset.manage')
  then
    raise exception 'brand_asset_forbidden' using errcode = '42501';
  end if;

  asset_id := nullif(input_asset ->> 'brand_asset_id', '')::uuid;

  if (
    input_asset ? 'conditioning_roles'
    and pg_catalog.jsonb_typeof(input_asset -> 'conditioning_roles') <> 'array'
  ) or (
    input_asset ? 'tags'
    and pg_catalog.jsonb_typeof(input_asset -> 'tags') <> 'array'
  ) or (
    input_asset ? 'scripts'
    and pg_catalog.jsonb_typeof(input_asset -> 'scripts') <> 'array'
  ) or (
    input_asset ? 'ownership'
    and pg_catalog.jsonb_typeof(input_asset -> 'ownership') <> 'string'
  ) then
    raise exception 'brand_asset_invalid' using errcode = '23514';
  end if;

  select coalesce(
    pg_catalog.array_agg(pg_catalog.btrim(item.value) order by item.ordinality),
    '{}'::text[]
  )
  into asset_conditioning_roles
  from pg_catalog.jsonb_array_elements_text(
    coalesce(input_asset -> 'conditioning_roles', '[]'::jsonb)
  ) with ordinality as item(value, ordinality);

  select coalesce(
    pg_catalog.array_agg(
      pg_catalog.normalize(pg_catalog.btrim(item.value), 'NFC') order by item.ordinality
    ),
    '{}'::text[]
  )
  into asset_tags
  from pg_catalog.jsonb_array_elements_text(
    coalesce(input_asset -> 'tags', '[]'::jsonb)
  ) with ordinality as item(value, ordinality);

  select coalesce(
    pg_catalog.array_agg(pg_catalog.btrim(item.value) order by item.ordinality),
    '{}'::text[]
  )
  into asset_scripts
  from pg_catalog.jsonb_array_elements_text(
    coalesce(input_asset -> 'scripts', '[]'::jsonb)
  ) with ordinality as item(value, ordinality);

  if supplied_classification and pg_catalog.cardinality(asset_conditioning_roles) = 0 then
    raise exception 'brand_asset_classification_required' using errcode = '23514';
  end if;

  if pg_catalog.cardinality(asset_tags) <> (
    select pg_catalog.count(distinct pg_catalog.lower(tag.value))::integer
    from pg_catalog.unnest(asset_tags) as tag(value)
  ) then
    raise exception 'brand_asset_tags_duplicate' using errcode = '23514';
  end if;

  -- A new asset may carry its complete classification in the reservation
  -- transaction. A new version never rewrites the existing asset identity.
  if asset_id is null then
    insert into public.organization_brand_assets (
      organization_id,
      label,
      asset_role,
      conditioning_roles,
      tags,
      scripts,
      ownership,
      created_by
    ) values (
      target_organization_id,
      input_asset ->> 'label',
      input_asset ->> 'asset_role',
      asset_conditioning_roles,
      asset_tags,
      asset_scripts,
      asset_ownership,
      (select auth.uid())
    )
    returning id into asset_id;
  else
    if supplied_classification then
      raise exception 'brand_asset_existing_classification_forbidden' using errcode = '23514';
    end if;

    if not exists (
      select 1
      from public.organization_brand_assets existing
      where existing.organization_id = target_organization_id
        and existing.id = asset_id
    ) then
      raise exception 'brand_asset_not_found' using errcode = '42501';
    end if;
  end if;

  select coalesce(pg_catalog.max(version.version), 0) + 1
  into next_version
  from public.organization_brand_asset_versions version
  where version.organization_id = target_organization_id
    and version.brand_asset_id = asset_id;

  storage_path := target_organization_id::text || '/' || asset_id::text || '/'
    || version_id::text || '/source';

  insert into public.organization_brand_asset_versions (
    id,
    organization_id,
    brand_asset_id,
    version,
    storage_path,
    content_hash,
    mime_type,
    byte_size,
    width_px,
    height_px,
    is_usable
  ) values (
    version_id,
    target_organization_id,
    asset_id,
    next_version,
    storage_path,
    pg_catalog.repeat('0', 64),
    'image/png',
    1,
    1,
    1,
    false
  );

  return pg_catalog.jsonb_build_object(
    'brand_asset_id', asset_id,
    'version_id', version_id,
    'storage_path', storage_path
  );
end;
$$;

revoke all on function public.create_brand_asset_version(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.create_brand_asset_version(uuid, jsonb) to authenticated;

create function public.update_brand_asset_metadata(
  target_organization_id uuid,
  input_metadata jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  target_asset_id uuid;
  existing_asset public.organization_brand_assets;
  saved_asset public.organization_brand_assets;
  next_conditioning_roles text[];
  next_tags text[];
  next_scripts text[];
  requested_archived boolean;
  supplied_classification boolean := input_metadata ? 'conditioning_roles'
    or input_metadata ? 'tags'
    or input_metadata ? 'scripts';
begin
  if target_organization_id is null
    or input_metadata ->> 'organization_id' is distinct from target_organization_id::text
  then
    raise exception 'brand_asset_metadata_organization_mismatch' using errcode = '42501';
  end if;

  if (select auth.uid()) is null
    or not private.has_organization_permission(target_organization_id, 'asset.manage')
  then
    raise exception 'brand_asset_metadata_forbidden' using errcode = '42501';
  end if;

  target_asset_id := nullif(input_metadata ->> 'brand_asset_id', '')::uuid;

  if target_asset_id is null
    or (not supplied_classification and not (input_metadata ? 'archived'))
    or (
      input_metadata ? 'conditioning_roles'
      and pg_catalog.jsonb_typeof(input_metadata -> 'conditioning_roles') <> 'array'
    )
    or (
      input_metadata ? 'tags'
      and pg_catalog.jsonb_typeof(input_metadata -> 'tags') <> 'array'
    )
    or (
      input_metadata ? 'scripts'
      and pg_catalog.jsonb_typeof(input_metadata -> 'scripts') <> 'array'
    )
    or (
      input_metadata ? 'archived'
      and pg_catalog.jsonb_typeof(input_metadata -> 'archived') <> 'boolean'
    )
  then
    raise exception 'brand_asset_metadata_invalid' using errcode = '23514';
  end if;

  requested_archived := case
    when input_metadata ? 'archived' then (input_metadata ->> 'archived')::boolean
    else null
  end;

  select asset.* into existing_asset
  from public.organization_brand_assets asset
  where asset.organization_id = target_organization_id
    and asset.id = target_asset_id
  for update;

  if not found then
    raise exception 'brand_asset_metadata_not_found' using errcode = '42501';
  end if;

  select coalesce(
    pg_catalog.array_agg(pg_catalog.btrim(item.value) order by item.ordinality),
    '{}'::text[]
  )
  into next_conditioning_roles
  from pg_catalog.jsonb_array_elements_text(
    coalesce(
      input_metadata -> 'conditioning_roles',
      pg_catalog.to_jsonb(existing_asset.conditioning_roles)
    )
  ) with ordinality as item(value, ordinality);

  select coalesce(
    pg_catalog.array_agg(
      pg_catalog.normalize(pg_catalog.btrim(item.value), 'NFC') order by item.ordinality
    ),
    '{}'::text[]
  )
  into next_tags
  from pg_catalog.jsonb_array_elements_text(
    coalesce(input_metadata -> 'tags', pg_catalog.to_jsonb(existing_asset.tags))
  ) with ordinality as item(value, ordinality);

  select coalesce(
    pg_catalog.array_agg(pg_catalog.btrim(item.value) order by item.ordinality),
    '{}'::text[]
  )
  into next_scripts
  from pg_catalog.jsonb_array_elements_text(
    coalesce(input_metadata -> 'scripts', pg_catalog.to_jsonb(existing_asset.scripts))
  ) with ordinality as item(value, ordinality);

  if supplied_classification and pg_catalog.cardinality(next_conditioning_roles) = 0 then
    raise exception 'brand_asset_classification_required' using errcode = '23514';
  end if;

  if pg_catalog.cardinality(next_tags) <> (
    select pg_catalog.count(distinct pg_catalog.lower(tag.value))::integer
    from pg_catalog.unnest(next_tags) as tag(value)
  ) then
    raise exception 'brand_asset_tags_duplicate' using errcode = '23514';
  end if;

  update public.organization_brand_assets
  set conditioning_roles = next_conditioning_roles,
      tags = next_tags,
      scripts = next_scripts,
      archived_at = case
        when requested_archived is null then existing_asset.archived_at
        when requested_archived then coalesce(existing_asset.archived_at, pg_catalog.now())
        else null
      end
  where organization_id = target_organization_id
    and id = target_asset_id
  returning * into saved_asset;

  return pg_catalog.jsonb_build_object(
    'brand_asset_id', saved_asset.id,
    'archived_at', saved_asset.archived_at
  );
end;
$$;

revoke all on function public.update_brand_asset_metadata(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.update_brand_asset_metadata(uuid, jsonb) to authenticated;

-- Audit the three events the specification promises without placing labels,
-- tags, notes, or any other customer-authored text in the audit payload.
create function private.audit_brand_asset_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_event_name text;
  target_entity_type text;
  target_entity_id uuid;
  target_payload jsonb;
  target_actor_id uuid := (select auth.uid());
begin
  if tg_table_name = 'organization_brand_asset_versions' then
    if not new.is_usable or old.is_usable then
      return new;
    end if;
    target_event_name := 'asset.version_added';
    target_entity_type := 'organization_brand_asset_version';
    target_entity_id := new.id;
    target_payload := pg_catalog.jsonb_build_object(
      'brandAssetId', new.brand_asset_id,
      'version', new.version
    );
  else
    if (
      new.conditioning_roles,
      new.tags,
      new.scripts,
      new.archived_at
    ) is not distinct from (
      old.conditioning_roles,
      old.tags,
      old.scripts,
      old.archived_at
    ) then
      return new;
    end if;

    target_event_name := case
      when new.archived_at is not null and old.archived_at is null then 'asset.archived'
      else 'asset.updated'
    end;
    target_entity_type := 'organization_brand_asset';
    target_entity_id := new.id;
    target_payload := pg_catalog.jsonb_build_object('operation', tg_op);
  end if;

  insert into public.audit_events (
    organization_id,
    event_name,
    actor_type,
    actor_id,
    entity_type,
    entity_id,
    correlation_id,
    payload
  ) values (
    new.organization_id,
    target_event_name,
    (case when target_actor_id is null then 'system' else 'user' end)::public.audit_actor_type,
    target_actor_id,
    target_entity_type,
    target_entity_id,
    coalesce(
      nullif(pg_catalog.current_setting('app.correlation_id', true), '')::uuid,
      pg_catalog.gen_random_uuid()
    ),
    target_payload
  );

  return new;
end;
$$;

create trigger organization_brand_assets_audit
  after update on public.organization_brand_assets
  for each row execute function private.audit_brand_asset_change();

create trigger organization_brand_asset_versions_audit
  after update on public.organization_brand_asset_versions
  for each row
  when (new.is_usable and not old.is_usable)
  execute function private.audit_brand_asset_change();

revoke all on function private.audit_brand_asset_change() from public;
