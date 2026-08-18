-- Creative variants: the instances an approved policy authorizes.
--
-- A variant is not a bundle version. It is an immutable child of one approved
-- version that varies only the pitch — image, hook, caption, hashtags, CTA —
-- while the promise stays fixed by the approval above it. See ADR 0020.
--
-- The interesting part of this migration is how the caps are enforced. A CHECK
-- cannot count rows, and a counting trigger loses to two concurrent inserts.
-- So each variant instead carries a slot number and the cap it was written
-- under, the cap arrives by composite foreign key from the version rather than
-- being copied by the application, and the slot is unique. The result is that
-- exceeding a cap is not something the database declines to do — it is
-- something it cannot represent, by any path, including a direct insert that
-- skips the RPC entirely.

-- The caps have to be uniquely addressable before a child row can reference
-- them. They are generated columns on the version, so this index is what lets
-- a variant inherit them instead of restating them.
create unique index campaign_bundle_versions_variant_caps_key
  on public.campaign_bundle_versions (
    organization_id, id, max_variants_per_direction, max_variants_total
  );

create table public.campaign_creative_variants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null,
  bundle_version_id uuid not null,
  direction_key uuid not null,

  -- Slot numbers, not counts. `direction_ordinal` is this variant's place
  -- within its direction; `total_ordinal` its place within the whole version.
  direction_ordinal integer not null check (direction_ordinal >= 1),
  total_ordinal integer not null check (total_ordinal >= 1),

  -- Inherited from the version by the composite foreign key below, never
  -- written independently, so the two can never disagree.
  max_variants_per_direction integer not null,
  max_variants_total integer not null,

  asset_id uuid not null,
  channel text not null check (channel in ('instagram', 'facebook')),
  placement text not null check (placement in ('feed_image', 'image_story')),

  hook text not null check (char_length(hook) between 1 and 200),
  caption text not null check (char_length(caption) between 1 and 2200),
  call_to_action text not null check (char_length(call_to_action) between 1 and 120),
  hashtags text[] not null default '{}',

  -- What makes two variants the same variant. Excludes the id, since a fresh
  -- id is exactly how a duplicate would otherwise slip through.
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),

  provenance jsonb not null check (jsonb_typeof(provenance) = 'object'),

  state text not null default 'draft' check (
    state in (
      'draft', 'scheduled', 'published',
      'paused_by_agent', 'paused_by_operator',
      'failed', 'provider_outcome_unknown'
    )
  ),

  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),

  -- The caps, declaratively. Nothing may occupy a slot beyond them.
  check (direction_ordinal <= max_variants_per_direction),
  check (total_ordinal <= max_variants_total),

  unique (organization_id, id),
  -- One variant per slot. This is what makes the cap survive concurrency:
  -- two racing inserts computing the same ordinal cannot both land.
  unique (organization_id, bundle_version_id, direction_key, direction_ordinal),
  unique (organization_id, bundle_version_id, total_ordinal),
  -- A duplicate creative splits the same budget and teaches nothing.
  unique (organization_id, bundle_version_id, content_hash),

  foreign key (organization_id, campaign_id)
    references public.campaigns (organization_id, id) on delete cascade,
  foreign key (organization_id, bundle_version_id, max_variants_per_direction, max_variants_total)
    references public.campaign_bundle_versions (
      organization_id, id, max_variants_per_direction, max_variants_total
    ) on delete cascade,
  foreign key (organization_id, bundle_version_id, direction_key)
    references public.campaign_creative_directions (
      organization_id, bundle_version_id, direction_key
    ) on delete cascade,
  foreign key (organization_id, asset_id)
    references public.campaign_assets (organization_id, id) on delete restrict
);

create index campaign_creative_variants_version_idx
  on public.campaign_creative_variants (organization_id, bundle_version_id, direction_key);
create index campaign_creative_variants_campaign_idx
  on public.campaign_creative_variants (organization_id, campaign_id, created_at desc);
create index campaign_creative_variants_state_idx
  on public.campaign_creative_variants (organization_id, state);
create index campaign_creative_variants_created_by_idx
  on public.campaign_creative_variants (created_by);
create index campaign_creative_variants_asset_idx
  on public.campaign_creative_variants (organization_id, asset_id);

comment on table public.campaign_creative_variants is
  'Immutable creative instances produced under an approved generation policy. Varies image, hook, caption, hashtags and CTA only; the promise is fixed by the approval on the bundle version.';

-- Immutability -------------------------------------------------------------
--
-- A variant's words and image are what an approval covers, so a correction is
-- a new variant. `state` is the one thing that legitimately moves, and it moves
-- through its own RPC rather than a general update.
create function private.reject_campaign_variant_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'campaign_creative_variant_is_immutable' using errcode = '23514';
end;
$$;

create trigger campaign_creative_variants_immutable
  before update or delete on public.campaign_creative_variants
  for each row execute function private.reject_campaign_variant_mutation();

-- Tenancy -------------------------------------------------------------------

alter table public.campaign_creative_variants enable row level security;
alter table public.campaign_creative_variants force row level security;

create policy "members read creative variants" on public.campaign_creative_variants
  for select to authenticated using (private.is_organization_member(organization_id));

revoke all on table public.campaign_creative_variants from anon;
revoke all on table public.campaign_creative_variants from authenticated;
grant select on table public.campaign_creative_variants to authenticated;

-- Appending a variant -------------------------------------------------------
--
-- The slot numbers are assigned under a lock on the version row, so two workers
-- cannot compute the same next ordinal. The unique constraints above would
-- catch them anyway; the lock is what turns a hard failure into an orderly one.
create function public.append_campaign_creative_variant(
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
  order by approval.created_at desc
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

-- Worker-only. A variant is generated by a durable run, never assembled in a
-- browser session, so the authenticated role never holds this.
revoke all on function public.append_campaign_creative_variant(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.append_campaign_creative_variant(uuid, jsonb) to service_role;
