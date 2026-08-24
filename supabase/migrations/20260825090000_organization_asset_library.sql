-- Organization Asset Library foundation.
--
-- Every generation must be anchored to a declared subject: a usable client
-- reference where one exists, a confirmed subject description where it does
-- not, and a refusal when neither exists. This migration adds the governed
-- storage and write boundaries for that rule. It is additive only.

-- ---------------------------------------------------------------------------
-- Reusable, immutable constraint helpers
-- ---------------------------------------------------------------------------

create function private.asset_library_text_array_valid(
  input_values text[],
  maximum_items integer,
  maximum_item_length integer,
  allowed_values text[] default null
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select input_values is not null
    and pg_catalog.cardinality(input_values) <= maximum_items
    and not exists (
      select 1
      from pg_catalog.unnest(input_values) as item(value)
      where value is null
        or pg_catalog.char_length(pg_catalog.btrim(value)) not between 1 and maximum_item_length
    )
    and pg_catalog.cardinality(input_values) = (
      select pg_catalog.count(distinct item.value)::integer
      from pg_catalog.unnest(input_values) as item(value)
    )
    and (allowed_values is null or input_values <@ allowed_values);
$$;

create function private.asset_library_scripts_valid(input_scripts text[])
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select private.asset_library_text_array_valid(input_scripts, 16, 4)
    and not exists (
      select 1
      from pg_catalog.unnest(input_scripts) as script(value)
      where script.value !~ '^[A-Z][a-z]{3}$'
    );
$$;

create function private.asset_library_names_by_script_valid(input_names jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select input_names is not null
    and pg_catalog.jsonb_typeof(input_names) = 'object'
    and pg_catalog.jsonb_object_length(input_names) <= 16
    and not exists (
      select 1
      from pg_catalog.jsonb_each_text(input_names) as script(key, value)
      where script.key !~ '^[A-Z][a-z]{3}$'
        or pg_catalog.char_length(pg_catalog.btrim(script.value)) not between 1 and 160
    );
$$;

revoke all on function private.asset_library_text_array_valid(text[], integer, integer, text[])
  from public;
revoke all on function private.asset_library_scripts_valid(text[]) from public;
revoke all on function private.asset_library_names_by_script_valid(jsonb) from public;

-- ---------------------------------------------------------------------------
-- Existing reference and source-snapshot tables
-- ---------------------------------------------------------------------------

alter table public.organization_brand_assets
  add column conditioning_roles text[] not null default '{}'::text[],
  add column tags text[] not null default '{}'::text[],
  add column scripts text[] not null default '{}'::text[],
  add column archived_at timestamptz;

alter table public.organization_brand_assets
  add constraint organization_brand_assets_conditioning_roles_check check (
    private.asset_library_text_array_valid(
      conditioning_roles,
      6,
      32,
      array['subject', 'brand_mark', 'setting', 'style_exemplar', 'palette', 'typography']
    )
  ),
  add constraint organization_brand_assets_tags_check check (
    private.asset_library_text_array_valid(tags, 24, 60)
  ),
  add constraint organization_brand_assets_scripts_check check (
    private.asset_library_scripts_valid(scripts)
  ),
  add constraint organization_brand_assets_typography_scripts_check check (
    (conditioning_roles @> array['typography']::text[] and pg_catalog.cardinality(scripts) > 0)
    or (
      not (conditioning_roles @> array['typography']::text[])
      and pg_catalog.cardinality(scripts) = 0
    )
  );

-- `conditioning_roles` is deliberately allowed to be empty at this schema
-- step. The already-deployed create_brand_asset_version RPC creates the asset
-- identity before Task 9 supplies classification. Rejecting its default here
-- would turn an additive migration into an outage for the current upload path.
create index organization_brand_assets_resolvable_idx
  on public.organization_brand_assets (organization_id, id)
  where archived_at is null;

-- ---------------------------------------------------------------------------
-- Review-reason registry and append-only verdicts
-- ---------------------------------------------------------------------------

create table public.creative_review_reasons (
  key text primary key check (key ~ '^[a-z][a-z0-9_]*$'),
  description text not null check (pg_catalog.char_length(description) between 3 and 300),
  owner_scope text not null check (owner_scope in ('core', 'pack')),
  pack_slug text check (
    pack_slug is null
    or (
      pg_catalog.char_length(pack_slug) between 1 and 80
      and pack_slug ~ '^[a-z][a-z0-9-]*$'
    )
  ),
  created_at timestamptz not null default pg_catalog.now(),
  check ((owner_scope = 'core') = (pack_slug is null))
);

insert into public.creative_review_reasons (key, description, owner_scope, pack_slug)
values
  ('wrong_subject', 'Keep the declared subject accurate; do not replace it with another subject.', 'core', null),
  ('wrong_style', 'Avoid the rejected visual style and follow the approved style references.', 'core', null),
  ('text_unreadable', 'Do not render unreadable or garbled text inside the image.', 'core', null),
  ('text_incorrect', 'Do not render incorrect words, prices, offers, or claims inside the image.', 'core', null),
  ('brand_mark_distorted', 'Do not redraw, distort, recolour, or re-space the brand mark.', 'core', null),
  ('people_shown', 'Do not show people, faces, or hands unless the declared subject requires them.', 'core', null),
  ('prohibited_content', 'Do not include content prohibited by the organization constraints.', 'core', null),
  ('low_quality', 'Avoid visible generation defects, blur, artifacts, and unfinished details.', 'core', null),
  ('off_palette', 'Keep the image within the approved colour palette.', 'core', null),
  ('not_localised', 'Keep the scene and visual context appropriate to the declared locality.', 'core', null),
  ('other', 'Avoid the platform-authored negative constraints selected for this generation.', 'core', null),
  ('wrong_cuisine', 'Keep the food faithful to the declared cuisine and dish.', 'pack', 'restaurant'),
  ('alcohol_visible', 'Do not show alcohol or alcohol-coded drinks unless the subject declares them.', 'pack', 'restaurant'),
  ('unappetising', 'Present the food as fresh, appetising, and ready to serve.', 'pack', 'restaurant'),
  ('not_our_plating', 'Keep the serving vessel, garnish, and plating faithful to the declared subject.', 'pack', 'restaurant');

create table public.creative_asset_reviews (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subject_kind text not null check (subject_kind in ('brand_asset_version', 'campaign_asset')),
  subject_id uuid not null,
  verdict text not null check (verdict in ('approved', 'rejected')),
  reason_codes text[] not null default '{}'::text[],
  note text check (note is null or pg_catalog.char_length(note) between 1 and 500),
  reviewed_by uuid not null references auth.users(id) on delete restrict,
  reviewed_at timestamptz not null default pg_catalog.now(),
  created_at timestamptz not null default pg_catalog.now(),
  unique (organization_id, id),
  check (
    (verdict = 'approved' and pg_catalog.cardinality(reason_codes) = 0)
    or (
      verdict = 'rejected'
      and pg_catalog.cardinality(reason_codes) between 1 and 15
    )
  ),
  check (private.asset_library_text_array_valid(reason_codes, 15, 80))
);

create index creative_asset_reviews_current_verdict_idx
  on public.creative_asset_reviews (
    organization_id, subject_kind, subject_id, reviewed_at desc, id desc
  );
create index creative_asset_reviews_reviewed_by_idx
  on public.creative_asset_reviews (reviewed_by);

-- PostgreSQL cannot attach a foreign key to each element of a text array.
-- This insert-time referential guard provides the required behavior while
-- keeping the approved reason_codes text[] contract and the three-table scope.
create function private.assert_creative_review_reason_codes()
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
    raise exception 'creative_review_reason_not_found' using errcode = '23503';
  end if;

  return new;
end;
$$;

create trigger creative_asset_reviews_reason_codes_guard
  before insert on public.creative_asset_reviews
  for each row execute function private.assert_creative_review_reason_codes();

create function private.reject_creative_asset_review_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'creative_asset_review_is_append_only' using errcode = '23514';
end;
$$;

create trigger creative_asset_reviews_append_only
  before update or delete on public.creative_asset_reviews
  for each row execute function private.reject_creative_asset_review_mutation();

revoke all on function private.assert_creative_review_reason_codes() from public;
revoke all on function private.reject_creative_asset_review_mutation() from public;

-- ---------------------------------------------------------------------------
-- Confirmed, organization-owned subject descriptions
-- ---------------------------------------------------------------------------

create table public.organization_subject_profiles (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (pg_catalog.char_length(pg_catalog.btrim(name)) between 1 and 160),
  slug text not null check (pg_catalog.char_length(pg_catalog.btrim(slug)) between 1 and 160),
  description text check (
    description is null
    or pg_catalog.char_length(pg_catalog.btrim(description)) between 1 and 2000
  ),
  tags text[] not null default '{}'::text[],
  names_by_script jsonb not null default '{}'::jsonb,
  must_not_appear text[] not null default '{}'::text[],
  illustrated_style boolean not null default false,
  state text not null default 'draft' check (state in ('draft', 'confirmed')),
  confirmed_by uuid references auth.users(id) on delete restrict,
  confirmed_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  archived_at timestamptz,
  unique (organization_id, id),
  unique (organization_id, slug),
  check (private.asset_library_text_array_valid(tags, 24, 60)),
  check (private.asset_library_names_by_script_valid(names_by_script)),
  check (private.asset_library_text_array_valid(must_not_appear, 24, 240)),
  check (
    (state = 'confirmed' and confirmed_by is not null and confirmed_at is not null)
    or (state = 'draft' and confirmed_by is null and confirmed_at is null)
  ),
  check (state <> 'confirmed' or description is not null)
);

create index organization_subject_profiles_state_idx
  on public.organization_subject_profiles (organization_id, state, archived_at, id);
create index organization_subject_profiles_created_by_idx
  on public.organization_subject_profiles (created_by);
create index organization_subject_profiles_confirmed_by_idx
  on public.organization_subject_profiles (confirmed_by)
  where confirmed_by is not null;

create trigger organization_subject_profiles_set_updated_at
  before update on public.organization_subject_profiles
  for each row execute function public.set_updated_at();

-- The copied description is what preserves history: editing a profile next
-- month cannot rewrite what an earlier campaign was actually drawn from.
alter table public.campaign_source_snapshots
  add column reference_slots jsonb not null default '[]'::jsonb,
  add column negative_rules jsonb not null default '[]'::jsonb,
  add column resolver_version integer,
  add column resolution_outcome text,
  add column subject_profile_id uuid,
  add column subject_description text;

alter table public.campaign_source_snapshots
  add constraint campaign_source_snapshots_reference_slots_check check (
    pg_catalog.jsonb_typeof(reference_slots) = 'array'
  ),
  add constraint campaign_source_snapshots_negative_rules_check check (
    pg_catalog.jsonb_typeof(negative_rules) = 'array'
  ),
  add constraint campaign_source_snapshots_resolver_version_check check (
    resolver_version is null or resolver_version > 0
  ),
  add constraint campaign_source_snapshots_resolution_outcome_check check (
    resolution_outcome is null
    or resolution_outcome in ('resolved', 'synthesis_permitted')
  ),
  add constraint campaign_source_snapshots_resolution_pair_check check (
    (resolver_version is null) = (resolution_outcome is null)
  ),
  add constraint campaign_source_snapshots_subject_description_check check (
    subject_description is null
    or pg_catalog.char_length(pg_catalog.btrim(subject_description)) between 1 and 2000
  ),
  add constraint campaign_source_snapshots_resolved_subject_check check (
    resolution_outcome is distinct from 'resolved'
    or pg_catalog.jsonb_array_length(reference_slots) > 0
  ),
  add constraint campaign_source_snapshots_synthesis_subject_check check (
    resolution_outcome is distinct from 'synthesis_permitted'
    or (subject_profile_id is not null and subject_description is not null)
  ),
  add constraint campaign_source_snapshots_subject_profile_fkey foreign key (
    organization_id, subject_profile_id
  ) references public.organization_subject_profiles (organization_id, id) on delete restrict;

create index campaign_source_snapshots_subject_profile_idx
  on public.campaign_source_snapshots (organization_id, subject_profile_id)
  where subject_profile_id is not null;

-- ---------------------------------------------------------------------------
-- Least-privilege RLS and audit events
-- ---------------------------------------------------------------------------

alter table public.creative_review_reasons enable row level security;
alter table public.creative_review_reasons force row level security;
alter table public.creative_asset_reviews enable row level security;
alter table public.creative_asset_reviews force row level security;
alter table public.organization_subject_profiles enable row level security;
alter table public.organization_subject_profiles force row level security;

create policy "signed-in users read creative review reasons"
on public.creative_review_reasons for select to authenticated using (true);

create policy "members read creative asset reviews"
on public.creative_asset_reviews for select to authenticated
using (
  private.has_organization_permission(organization_id, 'asset.read')
);

create policy "members read organization subject profiles"
on public.organization_subject_profiles for select to authenticated
using (
  private.has_organization_permission(organization_id, 'asset.read')
);

revoke all on table public.creative_review_reasons from anon, authenticated;
revoke all on table public.creative_asset_reviews from anon, authenticated;
revoke all on table public.organization_subject_profiles from anon, authenticated;

grant select on table public.creative_review_reasons to authenticated;
grant select on table public.creative_asset_reviews to authenticated;
grant select on table public.organization_subject_profiles to authenticated;

create function private.audit_asset_library_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_event_name text;
  target_entity_type text;
  target_entity_id uuid;
  target_actor_id uuid;
  target_payload jsonb;
begin
  if tg_table_name = 'creative_asset_reviews' then
    target_event_name := 'asset.reviewed';
    target_entity_type := new.subject_kind;
    target_entity_id := new.subject_id;
    target_actor_id := new.reviewed_by;
    target_payload := pg_catalog.jsonb_build_object(
      'reviewId', new.id,
      'verdict', new.verdict,
      'reasonCodes', pg_catalog.to_jsonb(new.reason_codes)
    );
  else
    target_entity_type := 'organization_subject_profile';
    target_entity_id := new.id;
    target_actor_id := coalesce((select auth.uid()), new.confirmed_by, new.created_by);
    target_event_name := case
      when tg_op = 'INSERT' then 'subject.created'
      when new.archived_at is not null and old.archived_at is null then 'subject.archived'
      when new.state = 'confirmed' and old.state is distinct from 'confirmed'
        then 'subject.confirmed'
      else 'subject.updated'
    end;
    target_payload := pg_catalog.jsonb_build_object('state', new.state, 'operation', tg_op);
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

create trigger creative_asset_reviews_audit
  after insert on public.creative_asset_reviews
  for each row execute function private.audit_asset_library_change();
create trigger organization_subject_profiles_audit
  after insert or update on public.organization_subject_profiles
  for each row execute function private.audit_asset_library_change();

revoke all on function private.audit_asset_library_change() from public;

-- ---------------------------------------------------------------------------
-- Permission vocabulary and explicit nested role mappings
-- ---------------------------------------------------------------------------

insert into public.permissions (key, description, scope) values
  ('asset.read', 'Read the organization asset library and subject profiles.', 'organization'),
  ('asset.manage', 'Upload, classify, tag, and archive organization reference assets.', 'organization'),
  ('asset.review', 'Approve or reject reference and generated creative assets.', 'organization'),
  ('subject.manage', 'Create, edit, confirm, and archive organization subject profiles.', 'organization');

insert into public.organization_role_permissions (organization_role, permission_key) values
  ('owner', 'asset.read'),
  ('owner', 'asset.manage'),
  ('owner', 'asset.review'),
  ('owner', 'subject.manage'),
  ('admin', 'asset.read'),
  ('admin', 'asset.manage'),
  ('admin', 'asset.review'),
  ('admin', 'subject.manage'),
  ('operator', 'asset.read'),
  ('operator', 'asset.manage'),
  ('operator', 'asset.review'),
  ('operator', 'subject.manage'),
  ('viewer', 'asset.read');

-- ---------------------------------------------------------------------------
-- Governed review and subject-profile writes
-- ---------------------------------------------------------------------------

create function public.record_creative_asset_review(
  target_organization_id uuid,
  input_review jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  review_subject_kind text := input_review ->> 'subject_kind';
  review_subject_id uuid := nullif(input_review ->> 'subject_id', '')::uuid;
  review_verdict text := input_review ->> 'verdict';
  review_reason_codes text[];
  review_note text := nullif(pg_catalog.btrim(input_review ->> 'note'), '');
  saved_review public.creative_asset_reviews;
begin
  if target_organization_id is null
    or input_review ->> 'organization_id' is distinct from target_organization_id::text
  then
    raise exception 'creative_asset_review_organization_mismatch' using errcode = '42501';
  end if;

  if (select auth.uid()) is null
    or not private.has_organization_permission(target_organization_id, 'asset.review')
  then
    raise exception 'creative_asset_review_forbidden' using errcode = '42501';
  end if;

  if pg_catalog.jsonb_typeof(coalesce(input_review -> 'reason_codes', '[]'::jsonb)) <> 'array'
    or review_subject_kind not in ('brand_asset_version', 'campaign_asset')
    or review_subject_id is null
    or review_verdict not in ('approved', 'rejected')
    or (review_note is not null and pg_catalog.char_length(review_note) > 500)
  then
    raise exception 'creative_asset_review_invalid' using errcode = '23514';
  end if;

  select coalesce(
    pg_catalog.array_agg(item.value order by item.ordinality),
    '{}'::text[]
  )
  into review_reason_codes
  from pg_catalog.jsonb_array_elements_text(
    coalesce(input_review -> 'reason_codes', '[]'::jsonb)
  ) with ordinality as item(value, ordinality);

  if review_subject_kind = 'brand_asset_version' then
    if not exists (
      select 1
      from public.organization_brand_asset_versions version
      where version.organization_id = target_organization_id
        and version.id = review_subject_id
    ) then
      raise exception 'creative_asset_review_subject_not_found' using errcode = '42501';
    end if;
  elsif not exists (
    select 1
    from public.campaign_assets asset
    where asset.organization_id = target_organization_id
      and asset.id = review_subject_id
  ) then
    raise exception 'creative_asset_review_subject_not_found' using errcode = '42501';
  end if;

  insert into public.creative_asset_reviews (
    organization_id,
    subject_kind,
    subject_id,
    verdict,
    reason_codes,
    note,
    reviewed_by
  ) values (
    target_organization_id,
    review_subject_kind,
    review_subject_id,
    review_verdict,
    review_reason_codes,
    review_note,
    (select auth.uid())
  )
  returning * into saved_review;

  return pg_catalog.jsonb_build_object(
    'review_id', saved_review.id,
    'verdict', saved_review.verdict,
    'reviewed_at', saved_review.reviewed_at
  );
end;
$$;

create function public.upsert_subject_profile(
  target_organization_id uuid,
  input_profile jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  target_profile_id uuid := nullif(input_profile ->> 'subject_profile_id', '')::uuid;
  existing_profile public.organization_subject_profiles;
  saved_profile public.organization_subject_profiles;
  profile_name text := pg_catalog.btrim(input_profile ->> 'name');
  profile_slug text := pg_catalog.lower(pg_catalog.btrim(input_profile ->> 'slug'));
  profile_description text := nullif(pg_catalog.btrim(input_profile ->> 'description'), '');
  profile_tags text[];
  profile_names_by_script jsonb;
  profile_must_not_appear text[];
  profile_illustrated_style boolean := coalesce(
    (input_profile ->> 'illustrated_style')::boolean,
    false
  );
  requested_archived boolean := case
    when input_profile ? 'archived' then (input_profile ->> 'archived')::boolean
    else null
  end;
  content_changed boolean;
begin
  if target_organization_id is null
    or input_profile ->> 'organization_id' is distinct from target_organization_id::text
  then
    raise exception 'subject_profile_organization_mismatch' using errcode = '42501';
  end if;

  if (select auth.uid()) is null
    or not private.has_organization_permission(target_organization_id, 'subject.manage')
  then
    raise exception 'subject_profile_forbidden' using errcode = '42501';
  end if;

  if pg_catalog.jsonb_typeof(coalesce(input_profile -> 'tags', '[]'::jsonb)) <> 'array'
    or pg_catalog.jsonb_typeof(
      coalesce(input_profile -> 'names_by_script', '{}'::jsonb)
    ) <> 'object'
    or pg_catalog.jsonb_typeof(
      coalesce(input_profile -> 'must_not_appear', '[]'::jsonb)
    ) <> 'array'
    or (
      input_profile ? 'illustrated_style'
      and pg_catalog.jsonb_typeof(input_profile -> 'illustrated_style') <> 'boolean'
    )
    or (
      input_profile ? 'archived'
      and pg_catalog.jsonb_typeof(input_profile -> 'archived') <> 'boolean'
    )
  then
    raise exception 'subject_profile_invalid' using errcode = '23514';
  end if;

  select coalesce(
    pg_catalog.array_agg(pg_catalog.btrim(item.value) order by item.ordinality),
    '{}'::text[]
  )
  into profile_tags
  from pg_catalog.jsonb_array_elements_text(
    coalesce(input_profile -> 'tags', '[]'::jsonb)
  ) with ordinality as item(value, ordinality);

  select coalesce(
    pg_catalog.jsonb_object_agg(item.key, pg_catalog.btrim(item.value)),
    '{}'::jsonb
  )
  into profile_names_by_script
  from pg_catalog.jsonb_each_text(
    coalesce(input_profile -> 'names_by_script', '{}'::jsonb)
  ) as item(key, value);

  select coalesce(
    pg_catalog.array_agg(pg_catalog.btrim(item.value) order by item.ordinality),
    '{}'::text[]
  )
  into profile_must_not_appear
  from pg_catalog.jsonb_array_elements_text(
    coalesce(input_profile -> 'must_not_appear', '[]'::jsonb)
  ) with ordinality as item(value, ordinality);

  if target_profile_id is null then
    insert into public.organization_subject_profiles (
      organization_id,
      name,
      slug,
      description,
      tags,
      names_by_script,
      must_not_appear,
      illustrated_style,
      created_by,
      archived_at
    ) values (
      target_organization_id,
      profile_name,
      profile_slug,
      profile_description,
      profile_tags,
      profile_names_by_script,
      profile_must_not_appear,
      profile_illustrated_style,
      (select auth.uid()),
      case when requested_archived then pg_catalog.now() else null end
    )
    returning * into saved_profile;

    return pg_catalog.jsonb_build_object(
      'subject_profile_id', saved_profile.id,
      'state', saved_profile.state,
      'created', true
    );
  end if;

  select profile.* into existing_profile
  from public.organization_subject_profiles profile
  where profile.organization_id = target_organization_id
    and profile.id = target_profile_id
  for update;

  if not found then
    raise exception 'subject_profile_not_found' using errcode = '42501';
  end if;

  content_changed := (
    profile_name,
    profile_slug,
    profile_description,
    profile_tags,
    profile_names_by_script,
    profile_must_not_appear,
    profile_illustrated_style
  ) is distinct from (
    existing_profile.name,
    existing_profile.slug,
    existing_profile.description,
    existing_profile.tags,
    existing_profile.names_by_script,
    existing_profile.must_not_appear,
    existing_profile.illustrated_style
  );

  update public.organization_subject_profiles
  set name = profile_name,
      slug = profile_slug,
      description = profile_description,
      tags = profile_tags,
      names_by_script = profile_names_by_script,
      must_not_appear = profile_must_not_appear,
      illustrated_style = profile_illustrated_style,
      state = case when content_changed then 'draft' else existing_profile.state end,
      confirmed_by = case when content_changed then null else existing_profile.confirmed_by end,
      confirmed_at = case when content_changed then null else existing_profile.confirmed_at end,
      archived_at = case
        when requested_archived is null then existing_profile.archived_at
        when requested_archived then coalesce(existing_profile.archived_at, pg_catalog.now())
        else null
      end
  where organization_id = target_organization_id and id = target_profile_id
  returning * into saved_profile;

  return pg_catalog.jsonb_build_object(
    'subject_profile_id', saved_profile.id,
    'state', saved_profile.state,
    'created', false
  );
end;
$$;

create function public.confirm_subject_profile(
  target_organization_id uuid,
  input_confirmation jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  target_profile_id uuid := nullif(input_confirmation ->> 'subject_profile_id', '')::uuid;
  profile_row public.organization_subject_profiles;
begin
  if target_organization_id is null
    or input_confirmation ->> 'organization_id' is distinct from target_organization_id::text
  then
    raise exception 'subject_profile_organization_mismatch' using errcode = '42501';
  end if;

  if (select auth.uid()) is null
    or not private.has_organization_permission(target_organization_id, 'subject.manage')
  then
    raise exception 'subject_profile_forbidden' using errcode = '42501';
  end if;

  select profile.* into profile_row
  from public.organization_subject_profiles profile
  where profile.organization_id = target_organization_id
    and profile.id = target_profile_id
  for update;

  if not found then
    raise exception 'subject_profile_not_found' using errcode = '42501';
  end if;

  if profile_row.archived_at is not null then
    raise exception 'subject_profile_archived' using errcode = '23514';
  end if;

  if profile_row.description is null
    or pg_catalog.char_length(pg_catalog.btrim(profile_row.description)) = 0
  then
    raise exception 'subject_profile_description_required' using errcode = '23514';
  end if;

  if profile_row.state = 'confirmed' then
    return pg_catalog.jsonb_build_object(
      'subject_profile_id', profile_row.id,
      'state', profile_row.state,
      'confirmed_at', profile_row.confirmed_at,
      'replayed', true
    );
  end if;

  update public.organization_subject_profiles
  set state = 'confirmed',
      confirmed_by = (select auth.uid()),
      confirmed_at = pg_catalog.now()
  where organization_id = target_organization_id and id = target_profile_id
  returning * into profile_row;

  return pg_catalog.jsonb_build_object(
    'subject_profile_id', profile_row.id,
    'state', profile_row.state,
    'confirmed_at', profile_row.confirmed_at,
    'replayed', false
  );
end;
$$;

-- One read shape serves both the authenticated preview and the worker. The
-- caller role grant decides who may invoke it; every relation is still scoped
-- explicitly by target_organization_id inside this security-definer function.
create function public.read_reference_candidates(target_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  candidate_rows jsonb;
  rejected_reason_rows jsonb;
  caller_claim_role text := coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
    (select auth.jwt() ->> 'role')
  );
begin
  if target_organization_id is null then
    raise exception 'reference_candidates_organization_required' using errcode = '23514';
  end if;

  if caller_claim_role is distinct from 'service_role'
    and (
      (select auth.uid()) is null
      or not private.has_organization_permission(target_organization_id, 'asset.read')
    ) then
    raise exception 'reference_candidates_forbidden' using errcode = '42501';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'brand_asset_id', asset.id,
        'brand_asset_version_id', version.id,
        'label', asset.label,
        'asset_role', asset.asset_role,
        'conditioning_roles', pg_catalog.to_jsonb(asset.conditioning_roles),
        'tags', pg_catalog.to_jsonb(asset.tags),
        'scripts', pg_catalog.to_jsonb(asset.scripts),
        'version', version.version,
        'storage_path', version.storage_path,
        'content_hash', version.content_hash,
        'mime_type', version.mime_type,
        'byte_size', version.byte_size,
        'width_px', version.width_px,
        'height_px', version.height_px,
        'current_verdict', latest_review.verdict
      ) order by asset.id asc, version.version desc, version.id asc
    ),
    '[]'::jsonb
  )
  into candidate_rows
  from public.organization_brand_assets asset
  join public.organization_brand_asset_versions version
    on version.organization_id = asset.organization_id
   and version.brand_asset_id = asset.id
  left join lateral (
    select review.verdict
    from public.creative_asset_reviews review
    where review.organization_id = target_organization_id
      and review.subject_kind = 'brand_asset_version'
      and review.subject_id = version.id
    order by review.reviewed_at desc, review.id desc
    limit 1
  ) latest_review on true
  where asset.organization_id = target_organization_id
    and asset.archived_at is null
    and version.is_usable
    and latest_review.verdict is distinct from 'rejected';

  with current_reviews as (
    select distinct on (review.subject_kind, review.subject_id)
      review.subject_kind,
      review.subject_id,
      review.verdict,
      review.reason_codes
    from public.creative_asset_reviews review
    where review.organization_id = target_organization_id
    order by
      review.subject_kind,
      review.subject_id,
      review.reviewed_at desc,
      review.id desc
  ), distinct_codes as (
    select distinct supplied.code
    from current_reviews current_review
    cross join lateral pg_catalog.unnest(current_review.reason_codes) as supplied(code)
    where current_review.verdict = 'rejected'
  )
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'code', reason.key,
        'description', reason.description
      ) order by reason.key
    ),
    '[]'::jsonb
  )
  into rejected_reason_rows
  from distinct_codes code
  join public.creative_review_reasons reason on reason.key = code.code;

  return pg_catalog.jsonb_build_object(
    'candidates', candidate_rows,
    'rejected_reasons', rejected_reason_rows
  );
end;
$$;

revoke all on function public.record_creative_asset_review(uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.upsert_subject_profile(uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.confirm_subject_profile(uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.read_reference_candidates(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.record_creative_asset_review(uuid, jsonb) to authenticated;
grant execute on function public.upsert_subject_profile(uuid, jsonb) to authenticated;
grant execute on function public.confirm_subject_profile(uuid, jsonb) to authenticated;
grant execute on function public.read_reference_candidates(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Existing campaign functions, widened at their settled direct table boundary
-- ---------------------------------------------------------------------------

create or replace function public.create_campaign_with_source(
  target_organization_id uuid,
  input_campaign jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  existing public.campaigns;
  brief_id uuid;
  campaign_id uuid;
  snapshot_id uuid;
  snapshot_facts jsonb;
  supplied_key text := input_campaign ->> 'idempotency_key';
  source_kind text := input_campaign ->> 'source_kind';
  opportunity_id uuid := nullif(input_campaign ->> 'opportunity_id', '')::uuid;
  pinned_subject_profile_id uuid := nullif(
    input_campaign ->> 'subject_profile_id',
    ''
  )::uuid;
  pinned_subject_description text := input_campaign ->> 'subject_description';
begin
  if target_organization_id is null
    or input_campaign ->> 'organization_id' is distinct from target_organization_id::text
  then
    raise exception 'campaign_create_organization_mismatch' using errcode = '42501';
  end if;

  if (select auth.uid()) is null or not private.has_organization_role(
    target_organization_id,
    array['owner', 'admin', 'operator']::public.organization_role[]
  ) then
    raise exception 'campaign_create_forbidden' using errcode = '42501';
  end if;

  select campaign.* into existing
  from public.campaigns campaign
  where campaign.organization_id = target_organization_id
    and campaign.idempotency_key = supplied_key;

  if found then
    return pg_catalog.jsonb_build_object(
      'campaign_id', existing.id,
      'source_snapshot_id', (
        select snapshot.id
        from public.campaign_source_snapshots snapshot
        where snapshot.organization_id = target_organization_id
          and snapshot.campaign_id = existing.id
        order by snapshot.captured_at asc
        limit 1
      ),
      'replayed', true
    );
  end if;

  if source_kind = 'decision_opportunity' then
    if not exists (
      select 1
      from public.opportunities opportunity
      where opportunity.organization_id = target_organization_id
        and opportunity.id = opportunity_id
        and opportunity.status in ('proposed', 'awaiting_approval')
        and opportunity.expires_at > pg_catalog.now()
    ) then
      raise exception 'campaign_opportunity_not_available' using errcode = '22023';
    end if;
  end if;

  if pinned_subject_profile_id is not null then
    select profile.description into pinned_subject_description
    from public.organization_subject_profiles profile
    where profile.organization_id = target_organization_id
      and profile.id = pinned_subject_profile_id
      and profile.state = 'confirmed'
      and profile.archived_at is null;

    if not found then
      raise exception 'campaign_subject_profile_not_available' using errcode = '42501';
    end if;

    if input_campaign ->> 'subject_description' is distinct from pinned_subject_description then
      raise exception 'campaign_subject_description_mismatch' using errcode = '22023';
    end if;
  end if;

  if source_kind = 'manual_brief' then
    insert into public.campaign_briefs (
      organization_id, objective, audience, offer, requested_channels, created_by
    ) values (
      target_organization_id,
      input_campaign #>> '{brief,objective}',
      input_campaign #>> '{brief,audience}',
      input_campaign #>> '{brief,offer}',
      coalesce(
        (
          select pg_catalog.array_agg(value #>> '{}')
          from pg_catalog.jsonb_array_elements(
            input_campaign #> '{brief,requested_channels}'
          )
        ),
        '{}'::text[]
      ),
      (select auth.uid())
    )
    returning id into brief_id;
  end if;

  insert into public.campaigns (
    organization_id, title, source_kind, brief_id, opportunity_id, created_by, idempotency_key
  ) values (
    target_organization_id,
    input_campaign ->> 'title',
    source_kind,
    brief_id,
    case when source_kind = 'decision_opportunity' then opportunity_id else null end,
    (select auth.uid()),
    supplied_key
  )
  returning id into campaign_id;

  snapshot_facts := coalesce(input_campaign -> 'facts', '{}'::jsonb);

  if brief_id is not null then
    snapshot_facts := snapshot_facts || (
      select pg_catalog.jsonb_strip_nulls(
        pg_catalog.jsonb_build_object(
          'objective', brief.objective,
          'audience', brief.audience,
          'offer', brief.offer,
          'requestedChannels', pg_catalog.to_jsonb(brief.requested_channels)
        )
      )
      from public.campaign_briefs brief
      where brief.organization_id = target_organization_id and brief.id = brief_id
    );
  end if;

  insert into public.campaign_source_snapshots (
    organization_id,
    campaign_id,
    facts,
    brand_asset_version_ids,
    assertions,
    reference_slots,
    negative_rules,
    resolver_version,
    resolution_outcome,
    subject_profile_id,
    subject_description
  ) values (
    target_organization_id,
    campaign_id,
    snapshot_facts,
    coalesce(
      (
        select pg_catalog.array_agg((value #>> '{}')::uuid)
        from pg_catalog.jsonb_array_elements(input_campaign -> 'brand_asset_version_ids')
      ),
      '{}'::uuid[]
    ),
    coalesce(input_campaign -> 'assertions', '[]'::jsonb),
    coalesce(input_campaign -> 'reference_slots', '[]'::jsonb),
    coalesce(input_campaign -> 'negative_rules', '[]'::jsonb),
    nullif(input_campaign ->> 'resolver_version', '')::integer,
    nullif(input_campaign ->> 'resolution_outcome', ''),
    pinned_subject_profile_id,
    pinned_subject_description
  )
  returning id into snapshot_id;

  return pg_catalog.jsonb_build_object(
    'campaign_id', campaign_id,
    'source_snapshot_id', snapshot_id,
    'replayed', false
  );
end;
$$;

create or replace function public.load_campaign_generation_context(
  target_organization_id uuid,
  input_context jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  run_row public.campaign_generation_runs;
  snapshot_row public.campaign_source_snapshots;
  campaign_row public.campaigns;
  latest_version_id uuid;
  base_version_row public.campaign_bundle_versions;
begin
  run_row := private.assert_campaign_generation_claim(
    target_organization_id,
    (input_context ->> 'run_id')::uuid,
    (input_context ->> 'claim_token')::uuid
  );

  select scoped.* into snapshot_row
  from public.campaign_source_snapshots scoped
  where scoped.organization_id = target_organization_id
    and scoped.id = run_row.source_snapshot_id;

  if not found then
    raise exception 'campaign_source_snapshot_not_found' using errcode = '42501';
  end if;

  select scoped.* into campaign_row
  from public.campaigns scoped
  where scoped.organization_id = target_organization_id
    and scoped.id = run_row.campaign_id;

  select version.id into latest_version_id
  from public.campaign_bundle_versions version
  where version.organization_id = target_organization_id
    and version.campaign_id = run_row.campaign_id
  order by version.version desc
  limit 1;

  if run_row.base_version_id is not null then
    select version.* into base_version_row
    from public.campaign_bundle_versions version
    where version.organization_id = target_organization_id
      and version.id = run_row.base_version_id;
  end if;

  return pg_catalog.jsonb_build_object(
    'campaign_id', run_row.campaign_id,
    'source_snapshot_id', run_row.source_snapshot_id,
    'kind', run_row.kind,
    'facts', snapshot_row.facts,
    'assertions', snapshot_row.assertions,
    'brand_asset_version_ids', pg_catalog.to_jsonb(snapshot_row.brand_asset_version_ids),
    'reference_slots', snapshot_row.reference_slots,
    'negative_rules', snapshot_row.negative_rules,
    'resolver_version', snapshot_row.resolver_version,
    'resolution_outcome', snapshot_row.resolution_outcome,
    'subject_profile_id', snapshot_row.subject_profile_id,
    'subject_description', snapshot_row.subject_description,
    'campaign_title', campaign_row.title,
    'latest_version_id', latest_version_id,
    'operator_prompt', run_row.operator_prompt,
    'patch_scope', run_row.patch_scope,
    'base_version', case
      when base_version_row.id is null then 'null'::jsonb
      else pg_catalog.jsonb_build_object(
        'id', base_version_row.id,
        'digest', base_version_row.digest,
        'manifest', base_version_row.manifest,
        'source_snapshot_id', base_version_row.source_snapshot_id,
        'asset_storage_paths', coalesce(
          (
            select pg_catalog.jsonb_object_agg(asset.asset_key::text, asset.storage_path)
            from public.campaign_assets asset
            where asset.organization_id = target_organization_id
              and asset.bundle_version_id = base_version_row.id
          ),
          '{}'::jsonb
        )
      )
    end
  );
end;
$$;

revoke all on function public.create_campaign_with_source(uuid, jsonb)
  from public, anon, service_role;
grant execute on function public.create_campaign_with_source(uuid, jsonb) to authenticated;

revoke all on function public.load_campaign_generation_context(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.load_campaign_generation_context(uuid, jsonb) to service_role;
