-- Creative History is the reviewed visual-memory model corrected by ADR 0049.
-- It is intentionally additive: legacy brand assets and avoid receipts remain
-- readable and are never rewritten by this migration.

-- Uploads owned by Creative History never share the historical `campaign-assets`
-- bucket. Every object path begins with its organization UUID, so the storage
-- policy and the database writer enforce the same tenant boundary.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'creative-assets', 'creative-assets', false, 15728640,
  array['image/png', 'image/jpeg', 'image/webp']::text[]
)
on conflict (id) do update set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "members read creative history objects"
on storage.objects for select to authenticated
using (
  bucket_id = 'creative-assets'
  and cardinality(storage.foldername(name)) >= 2
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and private.is_organization_member(((storage.foldername(name))[1])::uuid)
);

create policy "operators upload creative history objects"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'creative-assets'
  and cardinality(storage.foldername(name)) >= 2
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and private.has_organization_role(
    ((storage.foldername(name))[1])::uuid,
    array['owner', 'admin', 'operator']::public.organization_role[]
  )
);

create table public.creative_folders (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  parent_folder_id uuid,
  name text not null check (pg_catalog.char_length(pg_catalog.btrim(name)) between 1 and 160),
  default_metadata jsonb not null default '{}'::jsonb
    check (pg_catalog.jsonb_typeof(default_metadata) = 'object'),
  archived_at timestamptz,
  created_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (organization_id, id),
  constraint creative_folders_parent_fkey foreign key (organization_id, parent_folder_id)
    references public.creative_folders (organization_id, id) on delete restrict
);

create index creative_folders_organization_parent_idx
  on public.creative_folders (organization_id, parent_folder_id, archived_at, name, id);

create function private.assert_creative_folder_depth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
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

create trigger creative_folders_one_nested_level
  before insert or update of parent_folder_id on public.creative_folders
  for each row execute function private.assert_creative_folder_depth();

create trigger creative_folders_set_updated_at
  before update on public.creative_folders
  for each row execute function public.set_updated_at();

create table public.creative_items (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  folder_id uuid,
  label text not null check (pg_catalog.char_length(pg_catalog.btrim(label)) between 1 and 160),
  creative_type text not null check (creative_type in (
    'poster', 'flyer', 'social_post', 'story', 'carousel', 'banner'
  )),
  source_kind text not null check (source_kind in (
    'historical_upload', 'studio_render', 'qualified_legacy_delivered_creative'
  )),
  rights jsonb not null check (pg_catalog.jsonb_typeof(rights) = 'object'),
  confirmed_metadata jsonb,
  proposed_metadata jsonb,
  archived_at timestamptz,
  created_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (organization_id, id),
  constraint creative_items_folder_fkey foreign key (organization_id, folder_id)
    references public.creative_folders (organization_id, id) on delete restrict,
  check (confirmed_metadata is null or pg_catalog.jsonb_typeof(confirmed_metadata) = 'object'),
  check (proposed_metadata is null or pg_catalog.jsonb_typeof(proposed_metadata) = 'object'),
  check (
    rights ? 'status'
    and rights ->> 'status' in ('owned', 'licensed', 'permission_confirmed')
  )
);

create index creative_items_active_folder_idx
  on public.creative_items (organization_id, folder_id, id)
  where archived_at is null;
create index creative_items_created_by_idx on public.creative_items (organization_id, created_by);

create trigger creative_items_set_updated_at
  before update on public.creative_items
  for each row execute function public.set_updated_at();

create table public.creative_item_versions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  creative_item_id uuid not null,
  version integer not null check (version > 0),
  storage_path text,
  source_poster_render_id uuid,
  content_hash text check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$'),
  mime_type text check (mime_type is null or mime_type in ('image/png', 'image/jpeg', 'image/webp')),
  byte_size bigint check (byte_size is null or byte_size > 0),
  width_px integer check (width_px is null or width_px > 0),
  height_px integer check (height_px is null or height_px > 0),
  is_usable boolean not null default false,
  finalized_at timestamptz,
  created_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  unique (organization_id, id),
  unique (organization_id, creative_item_id, version),
  constraint creative_item_versions_item_fkey foreign key (organization_id, creative_item_id)
    references public.creative_items (organization_id, id) on delete cascade,
  constraint creative_item_versions_poster_render_fkey foreign key (
    organization_id, source_poster_render_id
  ) references public.campaign_poster_renders (organization_id, id) on delete cascade,
  check (
    (storage_path is not null) <> (source_poster_render_id is not null)
  ),
  check (
    storage_path is null or storage_path like organization_id::text || '/%'
  ),
  check (
    (is_usable and content_hash is not null and mime_type is not null and byte_size is not null
      and width_px is not null and height_px is not null and finalized_at is not null)
    or (not is_usable and content_hash is null and mime_type is null and byte_size is null
      and width_px is null and height_px is null and finalized_at is null)
  )
);

create index creative_item_versions_item_idx
  on public.creative_item_versions (organization_id, creative_item_id, version desc, id desc);
create index creative_item_versions_active_storage_idx
  on public.creative_item_versions (organization_id, storage_path)
  where is_usable and storage_path is not null;
create unique index creative_item_versions_poster_render_idx
  on public.creative_item_versions (organization_id, source_poster_render_id)
  where source_poster_render_id is not null;

alter table public.creative_items
  add column current_version_id uuid,
  add constraint creative_items_current_version_fkey foreign key (organization_id, current_version_id)
    references public.creative_item_versions (organization_id, id) on delete set null;

create index creative_items_current_version_idx
  on public.creative_items (organization_id, current_version_id);

create function private.assert_creative_item_version_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.creative_items item
    where item.organization_id = new.organization_id
      and item.id = new.creative_item_id
      and (
        (item.source_kind = 'studio_render' and new.source_poster_render_id is null)
        or (item.source_kind <> 'studio_render' and new.storage_path is null)
      )
  ) then
    raise exception 'creative_item_version_source_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

create function private.assert_creative_item_current_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.current_version_id is not null and not exists (
    select 1
    from public.creative_item_versions version
    where version.organization_id = new.organization_id
      and version.id = new.current_version_id
      and version.creative_item_id = new.id
  ) then
    raise exception 'creative_item_current_version_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger creative_item_versions_require_matching_source
  before insert or update of storage_path, source_poster_render_id on public.creative_item_versions
  for each row execute function private.assert_creative_item_version_source();
create trigger creative_items_current_version_belongs_to_item
  before update of current_version_id on public.creative_items
  for each row execute function private.assert_creative_item_current_version();

create table public.creative_item_reviews (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  creative_item_version_id uuid not null,
  verdict text not null check (verdict in ('approved', 'rejected')),
  reason_codes text[] not null default '{}'::text[],
  note text check (note is null or pg_catalog.char_length(note) between 1 and 500),
  reviewed_by uuid not null references auth.users(id) on delete restrict,
  reviewed_at timestamptz not null default pg_catalog.now(),
  created_at timestamptz not null default pg_catalog.now(),
  unique (organization_id, id),
  constraint creative_item_reviews_version_fkey foreign key (organization_id, creative_item_version_id)
    references public.creative_item_versions (organization_id, id) on delete restrict,
  check (
    (verdict = 'approved' and pg_catalog.cardinality(reason_codes) = 0)
    or (verdict = 'rejected' and pg_catalog.cardinality(reason_codes) between 1 and 15)
  ),
  check (private.asset_library_text_array_valid(reason_codes, 15, 80))
);

create index creative_item_reviews_current_idx
  on public.creative_item_reviews (
    organization_id, creative_item_version_id, reviewed_at desc, id desc
  );

create table public.creative_item_performance_evidence (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  creative_item_version_id uuid not null,
  source_kind text not null check (source_kind in ('campaign_outcome', 'manual_verified')), 
  measured_at timestamptz not null,
  score numeric(12, 6) not null check (score >= 0),
  evidence jsonb not null check (pg_catalog.jsonb_typeof(evidence) = 'object'),
  recorded_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  unique (organization_id, id),
  constraint creative_item_performance_version_fkey foreign key (organization_id, creative_item_version_id)
    references public.creative_item_versions (organization_id, id) on delete restrict
);

create index creative_item_performance_version_idx
  on public.creative_item_performance_evidence (
    organization_id, creative_item_version_id, measured_at desc, id desc
  );

create function private.assert_creative_item_review_reason_codes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from pg_catalog.unnest(new.reason_codes) as supplied(code)
    left join public.creative_review_reasons reason on reason.key = supplied.code
    where reason.key is null
  ) then
    raise exception 'creative_item_review_reason_not_found' using errcode = '23503';
  end if;
  return new;
end;
$$;

create function private.reject_creative_item_review_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'creative_item_review_is_append_only' using errcode = '23514';
end;
$$;

create function private.reject_finalized_creative_item_version_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or old.is_usable then
    raise exception 'creative_item_version_is_immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger creative_item_reviews_reason_codes_guard
  before insert on public.creative_item_reviews
  for each row execute function private.assert_creative_item_review_reason_codes();
create trigger creative_item_reviews_append_only
  before update on public.creative_item_reviews
  for each row execute function private.reject_creative_item_review_mutation();
create trigger creative_item_versions_immutable_after_finalize
  before update on public.creative_item_versions
  for each row execute function private.reject_finalized_creative_item_version_mutation();

alter table public.creative_folders enable row level security;
alter table public.creative_folders force row level security;
alter table public.creative_items enable row level security;
alter table public.creative_items force row level security;
alter table public.creative_item_versions enable row level security;
alter table public.creative_item_versions force row level security;
alter table public.creative_item_reviews enable row level security;
alter table public.creative_item_reviews force row level security;
alter table public.creative_item_performance_evidence enable row level security;
alter table public.creative_item_performance_evidence force row level security;

create policy "members read creative folders" on public.creative_folders for select to authenticated
  using ((select private.has_organization_permission(organization_id, 'asset.read')));
create policy "members read creative items" on public.creative_items for select to authenticated
  using ((select private.has_organization_permission(organization_id, 'asset.read')));
create policy "members read creative versions" on public.creative_item_versions for select to authenticated
  using ((select private.has_organization_permission(organization_id, 'asset.read')));
create policy "members read creative reviews" on public.creative_item_reviews for select to authenticated
  using ((select private.has_organization_permission(organization_id, 'asset.read')));
create policy "members read creative performance evidence" on public.creative_item_performance_evidence for select to authenticated
  using ((select private.has_organization_permission(organization_id, 'asset.read')));

revoke all on table public.creative_folders, public.creative_items, public.creative_item_versions,
  public.creative_item_reviews, public.creative_item_performance_evidence from public, anon, authenticated;
grant select on table public.creative_folders, public.creative_items, public.creative_item_versions,
  public.creative_item_reviews, public.creative_item_performance_evidence to authenticated;

create function public.create_creative_folder(target_organization_id uuid, input_folder jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved public.creative_folders;
begin
  if (select auth.uid()) is null or not private.has_organization_permission(target_organization_id, 'asset.manage')
    or input_folder ->> 'organization_id' is distinct from target_organization_id::text then
    raise exception 'creative_folder_forbidden' using errcode = '42501';
  end if;
  insert into public.creative_folders (organization_id, parent_folder_id, name, default_metadata, created_by)
  values (target_organization_id, nullif(input_folder ->> 'parent_folder_id', '')::uuid,
    pg_catalog.btrim(input_folder ->> 'name'), coalesce(input_folder -> 'default_metadata', '{}'::jsonb), (select auth.uid()))
  returning * into saved;
  return pg_catalog.jsonb_build_object('folder_id', saved.id);
end;
$$;

create function public.create_creative_item(target_organization_id uuid, input_item jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved_item public.creative_items; saved_version public.creative_item_versions; next_version integer;
begin
  if (select auth.uid()) is null or not private.has_organization_permission(target_organization_id, 'asset.manage')
    or input_item ->> 'organization_id' is distinct from target_organization_id::text then
    raise exception 'creative_item_forbidden' using errcode = '42501';
  end if;
  if input_item ->> 'source_kind' not in ('historical_upload', 'qualified_legacy_delivered_creative')
    or pg_catalog.jsonb_typeof(coalesce(input_item -> 'rights', '{}'::jsonb)) <> 'object'
    or nullif(input_item ->> 'storage_path', '') is null
    or input_item ->> 'storage_path' not like target_organization_id::text || '/%'
    or nullif(input_item ->> 'source_poster_render_id', '') is not null then
    raise exception 'creative_item_invalid' using errcode = '22023';
  end if;
  insert into public.creative_items (organization_id, folder_id, label, creative_type, source_kind, rights,
    confirmed_metadata, proposed_metadata, created_by)
  values (target_organization_id, nullif(input_item ->> 'folder_id', '')::uuid,
    pg_catalog.btrim(input_item ->> 'label'), input_item ->> 'creative_type', input_item ->> 'source_kind',
    input_item -> 'rights', input_item -> 'confirmed_metadata', input_item -> 'proposed_metadata', (select auth.uid()))
  returning * into saved_item;
  next_version := 1;
  insert into public.creative_item_versions (organization_id, creative_item_id, version, storage_path,
    source_poster_render_id, created_by)
  values (target_organization_id, saved_item.id, next_version,
    nullif(input_item ->> 'storage_path', ''), nullif(input_item ->> 'source_poster_render_id', '')::uuid,
    (select auth.uid())) returning * into saved_version;
  update public.creative_items set current_version_id = saved_version.id
    where organization_id = target_organization_id and id = saved_item.id;
  return pg_catalog.jsonb_build_object('item_id', saved_item.id, 'version_id', saved_version.id);
end;
$$;

create function public.finalize_creative_item_version(target_organization_id uuid, input_version jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved public.creative_item_versions;
begin
  if (select auth.uid()) is null or not private.has_organization_permission(target_organization_id, 'asset.manage')
    or input_version ->> 'organization_id' is distinct from target_organization_id::text then
    raise exception 'creative_item_version_forbidden' using errcode = '42501';
  end if;
  update public.creative_item_versions set content_hash = input_version ->> 'content_hash',
    mime_type = input_version ->> 'mime_type', byte_size = (input_version ->> 'byte_size')::bigint,
    width_px = (input_version ->> 'width_px')::integer, height_px = (input_version ->> 'height_px')::integer,
    is_usable = true, finalized_at = pg_catalog.now()
  where organization_id = target_organization_id
    and id = (input_version ->> 'version_id')::uuid
    and not is_usable
    and exists (
      select 1 from storage.objects object
      where object.bucket_id = 'creative-assets'
        and object.name = public.creative_item_versions.storage_path
        and coalesce(object.metadata ->> 'size', '') = input_version ->> 'byte_size'
        and coalesce(object.metadata ->> 'mimetype', '') = input_version ->> 'mime_type'
    )
  returning * into saved;
  if not found then raise exception 'creative_item_version_not_found_or_finalized' using errcode = '42501'; end if;
  return pg_catalog.jsonb_build_object('version_id', saved.id, 'finalized_at', saved.finalized_at);
end;
$$;

create function public.record_creative_item_review(target_organization_id uuid, input_review jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved public.creative_item_reviews; codes text[];
begin
  if (select auth.uid()) is null or not private.has_organization_permission(target_organization_id, 'asset.review')
    or input_review ->> 'organization_id' is distinct from target_organization_id::text then
    raise exception 'creative_item_review_forbidden' using errcode = '42501';
  end if;
  select coalesce(pg_catalog.array_agg(value order by ordinality), '{}'::text[]) into codes
  from pg_catalog.jsonb_array_elements_text(coalesce(input_review -> 'reason_codes', '[]'::jsonb)) with ordinality;
  if not exists (
    select 1 from public.creative_item_versions version
    where version.organization_id = target_organization_id
      and version.id = (input_review ->> 'creative_item_version_id')::uuid
      and version.is_usable
  ) then
    raise exception 'creative_item_review_version_not_finalized' using errcode = '42501';
  end if;
  insert into public.creative_item_reviews (organization_id, creative_item_version_id, verdict, reason_codes, note, reviewed_by)
  values (target_organization_id, (input_review ->> 'creative_item_version_id')::uuid, input_review ->> 'verdict',
    codes, nullif(pg_catalog.btrim(input_review ->> 'note'), ''), (select auth.uid())) returning * into saved;
  return pg_catalog.jsonb_build_object('review_id', saved.id, 'verdict', saved.verdict, 'reviewed_at', saved.reviewed_at);
end;
$$;

create function public.archive_creative_item(target_organization_id uuid, input_item jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved public.creative_items;
begin
  if (select auth.uid()) is null or not private.has_organization_permission(target_organization_id, 'asset.manage')
    or input_item ->> 'organization_id' is distinct from target_organization_id::text then
    raise exception 'creative_item_archive_forbidden' using errcode = '42501';
  end if;
  update public.creative_items set archived_at = pg_catalog.now()
  where organization_id = target_organization_id and id = (input_item ->> 'item_id')::uuid and archived_at is null
  returning * into saved;
  if not found then raise exception 'creative_item_not_found_or_archived' using errcode = '42501'; end if;
  return pg_catalog.jsonb_build_object('item_id', saved.id, 'archived_at', saved.archived_at);
end;
$$;

create function public.backfill_studio_renders_to_creative_history(target_organization_id uuid, dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  inserted_count integer := 0;
  render_row public.campaign_poster_renders;
  storage_object storage.objects;
  saved_item public.creative_items;
  saved_version public.creative_item_versions;
begin
  if target_organization_id is null
    or pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    raise exception 'creative_history_backfill_forbidden' using errcode = '42501';
  end if;
  if dry_run then
    return pg_catalog.jsonb_build_object('dry_run', true, 'candidate_count', (
      select count(*) from public.campaign_poster_renders render
      join storage.objects object on object.bucket_id = 'campaign-assets'
        and object.name = render.output_storage_path
      where render.organization_id = target_organization_id and render.state = 'rendered'
        and coalesce(object.metadata ->> 'size', '') ~ '^[1-9][0-9]*$'
        and not exists (select 1 from public.creative_item_versions version
          where version.organization_id = render.organization_id and version.source_poster_render_id = render.id)
    ));
  end if;
  for render_row in
    select render.*
    from public.campaign_poster_renders render
    join storage.objects object on object.bucket_id = 'campaign-assets'
      and object.name = render.output_storage_path
    where render.organization_id = target_organization_id
      and render.state = 'rendered'
      and coalesce(object.metadata ->> 'size', '') ~ '^[1-9][0-9]*$'
      and not exists (
        select 1 from public.creative_item_versions version
        where version.organization_id = render.organization_id
          and version.source_poster_render_id = render.id
      )
    order by render.rendered_at, render.id
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(render_row.id::text, 0)
    );
    if exists (
      select 1 from public.creative_item_versions version
      where version.organization_id = render_row.organization_id
        and version.source_poster_render_id = render_row.id
    ) then
      continue;
    end if;

    select object.* into storage_object
    from storage.objects object
    where object.bucket_id = 'campaign-assets'
      and object.name = render_row.output_storage_path;

    -- The link is intentionally Unreviewed: a completed poster is a candidate
    -- for visual history, not automatic approval or selector evidence.
    insert into public.creative_items (
      organization_id, label, creative_type, source_kind, rights
    ) values (
      target_organization_id,
      pg_catalog.left('Studio poster ' || render_row.id::text, 160),
      'poster', 'studio_render',
      pg_catalog.jsonb_build_object('status', 'owned', 'source', 'studio_render')
    ) returning * into saved_item;

    insert into public.creative_item_versions (
      organization_id, creative_item_id, version, source_poster_render_id,
      content_hash, mime_type, byte_size, width_px, height_px, is_usable, finalized_at
    ) values (
      target_organization_id, saved_item.id, 1, render_row.id,
      render_row.output_content_hash, render_row.output_mime_type,
      (storage_object.metadata ->> 'size')::bigint,
      render_row.output_width_px, render_row.output_height_px, true, render_row.rendered_at
    ) returning * into saved_version;

    update public.creative_items
    set current_version_id = saved_version.id
    where organization_id = target_organization_id and id = saved_item.id;
    inserted_count := inserted_count + 1;
  end loop;
  return pg_catalog.jsonb_build_object('dry_run', false, 'inserted_count', inserted_count);
end;
$$;

create function private.audit_creative_history_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_event_name text;
  target_entity_type text := tg_table_name;
  target_entity_id uuid := new.id;
  target_actor_id uuid;
  target_payload jsonb;
begin
  if tg_table_name = 'creative_item_reviews' then
    target_event_name := 'asset.reviewed';
    target_entity_id := new.creative_item_version_id;
    target_actor_id := new.reviewed_by;
    target_payload := pg_catalog.jsonb_build_object(
      'reviewId', new.id,
      'verdict', new.verdict,
      'reasonCodes', pg_catalog.to_jsonb(new.reason_codes)
    );
  elsif tg_table_name = 'creative_item_versions' then
    target_event_name := 'asset.version_added';
    target_actor_id := coalesce((select auth.uid()), new.created_by);
    target_payload := pg_catalog.jsonb_build_object(
      'creativeItemId', new.creative_item_id,
      'version', new.version,
      'sourceKind', case when new.source_poster_render_id is null then 'uploaded' else 'studio_render' end
    );
  else
    target_event_name := case
      when tg_op = 'INSERT' then 'asset.updated'
      when new.archived_at is not null and old.archived_at is null then 'asset.archived'
      else 'asset.updated'
    end;
    target_actor_id := coalesce((select auth.uid()), new.created_by);
    target_payload := pg_catalog.jsonb_build_object('operation', tg_op);
  end if;

  insert into public.audit_events (
    organization_id, event_name, actor_type, actor_id, entity_type, entity_id, correlation_id, payload
  ) values (
    new.organization_id,
    target_event_name,
    (case when target_actor_id is null then 'system' else 'user' end)::public.audit_actor_type,
    target_actor_id,
    target_entity_type,
    target_entity_id,
    coalesce(nullif(pg_catalog.current_setting('app.correlation_id', true), '')::uuid, pg_catalog.gen_random_uuid()),
    target_payload
  );
  return new;
end;
$$;

create trigger creative_items_audit
  after insert or update of label, creative_type, rights, confirmed_metadata, proposed_metadata, archived_at
  on public.creative_items
  for each row execute function private.audit_creative_history_change();
create trigger creative_item_versions_insert_audit
  after insert on public.creative_item_versions
  for each row when (new.is_usable)
  execute function private.audit_creative_history_change();
create trigger creative_item_versions_finalize_audit
  after update of is_usable on public.creative_item_versions
  for each row when (new.is_usable and not old.is_usable)
  execute function private.audit_creative_history_change();
create trigger creative_item_reviews_audit
  after insert on public.creative_item_reviews
  for each row execute function private.audit_creative_history_change();

revoke all on function private.assert_creative_folder_depth() from public;
revoke all on function private.assert_creative_item_review_reason_codes() from public;
revoke all on function private.reject_creative_item_review_mutation() from public;
revoke all on function private.reject_finalized_creative_item_version_mutation() from public;
revoke all on function private.assert_creative_item_version_source() from public;
revoke all on function private.assert_creative_item_current_version() from public;
revoke all on function private.audit_creative_history_change() from public;
revoke all on function public.create_creative_folder(uuid, jsonb), public.create_creative_item(uuid, jsonb),
  public.finalize_creative_item_version(uuid, jsonb), public.record_creative_item_review(uuid, jsonb),
  public.archive_creative_item(uuid, jsonb), public.backfill_studio_renders_to_creative_history(uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.create_creative_folder(uuid, jsonb), public.create_creative_item(uuid, jsonb),
  public.finalize_creative_item_version(uuid, jsonb), public.record_creative_item_review(uuid, jsonb),
  public.archive_creative_item(uuid, jsonb) to authenticated;
grant execute on function public.backfill_studio_renders_to_creative_history(uuid, boolean) to service_role;
