-- Finished deliverables, and the review that gates publishing one.
--
-- A deliverable is "the English feed post for this campaign" — stable, the
-- thing a person means when they say "the post". A deliverable VERSION is one
-- exact set of finished bytes and words, immutable, with a content hash. A
-- review binds to the version and its hash, never to the deliverable.
--
-- That separation is the whole point. Approving "the post" and then changing
-- the picture would leave an approval pointing at something its approver never
-- saw. So a new version starts unreviewed and inherits nothing — confirmed
-- decision D05, and the second gate in
-- `adrs/0057-campaign-preparation-approval-vs-exact-output-publication.md`.
-- The proposal approval authorized preparation; this is what authorizes
-- publication, and only for the exact bytes reviewed.
--
-- Additive and forward-only. No existing table is altered, and the bundle
-- manifest stays at schema version 2 — C04 gates manifest V3 on its
-- schema/validator/digest/backward-reader design being approved first, so it is
-- deliberately NOT introduced here.

-- 1. Logical identity ----------------------------------------------------------

create table public.campaign_deliverables (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null,
  -- What this deliverable IS, as a person would name it. One post per channel,
  -- placement, language and format; a second English feed post is a second
  -- deliverable, not a second version of the first.
  channel text not null check (char_length(channel) between 1 and 60),
  placement text not null check (char_length(placement) between 1 and 60),
  language text not null check (char_length(language) between 1 and 40),
  format text not null check (char_length(format) between 1 and 60),
  ordinal integer not null default 1 check (ordinal > 0),
  current_version_id uuid,
  state text not null default 'preparing' check (
    state in ('preparing', 'ready_for_review', 'approved', 'rejected', 'failed', 'archived')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, campaign_id, channel, placement, language, format, ordinal),
  foreign key (organization_id, campaign_id)
    references public.campaigns (organization_id, id) on delete cascade
);

create index campaign_deliverables_campaign_idx
  on public.campaign_deliverables (organization_id, campaign_id, state);

-- 2. Immutable finished versions -----------------------------------------------

create table public.campaign_deliverable_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  deliverable_id uuid not null,
  campaign_id uuid not null,
  version integer not null check (version > 0),
  -- The exact bundle version whose approval this output was prepared under.
  bundle_version_id uuid not null,
  direction_key uuid not null,
  creative_variant_id uuid,

  -- Exactly one source of finished bytes, and it is an explicit choice.
  -- `finished_poster` is a composed render. `final_image` is an image someone
  -- decided publishes as it stands. A textless plate is neither until a person
  -- says so, which is why there is no third arm and no default.
  source_kind text not null check (source_kind in ('finished_poster', 'final_image')),
  poster_render_id uuid,
  final_asset_id uuid,

  copy jsonb not null,
  -- Every input that changes the pixels: free line, template version, fonts,
  -- brand mark, script, engine. Identical inputs reuse; anything else is a new
  -- version that nobody has reviewed.
  render_inputs jsonb not null,
  render_digest text not null check (char_length(render_digest) between 1 and 4000),
  -- What a review binds to. Never a URL: a signed URL is a credential, and a
  -- record of what was approved must not expire.
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  verification jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  unique (organization_id, id),
  unique (organization_id, deliverable_id, version),
  foreign key (organization_id, deliverable_id)
    references public.campaign_deliverables (organization_id, id) on delete cascade,
  foreign key (organization_id, campaign_id)
    references public.campaigns (organization_id, id) on delete cascade,
  foreign key (organization_id, bundle_version_id)
    references public.campaign_bundle_versions (organization_id, id) on delete restrict,
  foreign key (organization_id, poster_render_id)
    references public.campaign_poster_renders (organization_id, id) on delete restrict,
  check (
    (source_kind = 'finished_poster' and poster_render_id is not null and final_asset_id is null)
    or (source_kind = 'final_image' and final_asset_id is not null and poster_render_id is null)
  )
);

alter table public.campaign_deliverables
  add constraint campaign_deliverables_current_version_fkey
  foreign key (organization_id, current_version_id)
  references public.campaign_deliverable_versions (organization_id, id) on delete restrict;

create index campaign_deliverable_versions_deliverable_idx
  on public.campaign_deliverable_versions (organization_id, deliverable_id, version desc);

-- 3. Append-only reviews -------------------------------------------------------

create table public.campaign_deliverable_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  deliverable_id uuid not null,
  deliverable_version_id uuid not null,
  -- Carried beside the version id deliberately. The id says which row; the hash
  -- says which bytes. Publication requires both to still match, which is what
  -- stops an approval sliding onto a re-render.
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  actor_id uuid not null references auth.users(id) on delete restrict,
  decision text not null check (decision in ('approved', 'rejected')),
  reason_codes text[] not null default '{}'::text[],
  note text check (char_length(note) between 1 and 2000),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  reviewed_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, deliverable_version_id, idempotency_key),
  foreign key (organization_id, deliverable_id)
    references public.campaign_deliverables (organization_id, id) on delete cascade,
  foreign key (organization_id, deliverable_version_id)
    references public.campaign_deliverable_versions (organization_id, id) on delete restrict,
  -- A rejection with no reason is not a review, it is a shrug. The person who
  -- has to act on it cannot.
  --
  -- `cardinality`, not `array_length`: `array_length('{}', 1)` is NULL, and a
  -- CHECK treats NULL as passing, so the array_length form silently permits
  -- exactly the empty-reason rejection it looks like it forbids.
  check (decision = 'approved' or cardinality(reason_codes) >= 1)
);

create index campaign_deliverable_reviews_version_idx
  on public.campaign_deliverable_reviews (organization_id, deliverable_version_id, reviewed_at desc);

-- 4. Immutability --------------------------------------------------------------

create function private.reject_campaign_deliverable_version_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'campaign_deliverable_version_immutable' using errcode = '42501';
end;
$$;

create function private.reject_campaign_deliverable_review_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'campaign_deliverable_review_immutable' using errcode = '42501';
end;
$$;

create trigger campaign_deliverable_versions_immutable
  before update or delete on public.campaign_deliverable_versions
  for each row execute function private.reject_campaign_deliverable_version_mutation();

create trigger campaign_deliverable_reviews_immutable
  before update or delete on public.campaign_deliverable_reviews
  for each row execute function private.reject_campaign_deliverable_review_mutation();

-- 5. Tenancy -------------------------------------------------------------------

alter table public.campaign_deliverables enable row level security;
alter table public.campaign_deliverables force row level security;
alter table public.campaign_deliverable_versions enable row level security;
alter table public.campaign_deliverable_versions force row level security;
alter table public.campaign_deliverable_reviews enable row level security;
alter table public.campaign_deliverable_reviews force row level security;

create policy "members read campaign deliverables" on public.campaign_deliverables
  for select to authenticated
  using ((select private.has_organization_permission(organization_id, 'campaign.read')));
create policy "members read campaign deliverable versions" on public.campaign_deliverable_versions
  for select to authenticated
  using ((select private.has_organization_permission(organization_id, 'campaign.read')));
create policy "members read campaign deliverable reviews" on public.campaign_deliverable_reviews
  for select to authenticated
  using ((select private.has_organization_permission(organization_id, 'campaign.read')));

revoke all on table public.campaign_deliverables, public.campaign_deliverable_versions,
  public.campaign_deliverable_reviews from public, anon, authenticated;
grant select on table public.campaign_deliverables, public.campaign_deliverable_versions,
  public.campaign_deliverable_reviews to authenticated;

-- 6. Writers -------------------------------------------------------------------
--
-- Recording a finished output is worker work: it happens when a render
-- completes. Reviewing one is a person's work and cannot be done by a worker at
-- all. The two are split accordingly, and neither role holds the other's grant.

create function public.record_campaign_deliverable_version(
  target_organization_id uuid,
  input_version jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_deliverable public.campaign_deliverables;
  existing public.campaign_deliverable_versions;
  saved public.campaign_deliverable_versions;
  next_version integer;
begin
  -- No role check here on purpose. The EXECUTE grant at the foot of this file
  -- is the gate: `authenticated` and `anon` hold nothing on this function, so a
  -- browser session cannot reach it at all. A check on `auth.role()` would be
  -- worse than useless — it reads a JWT claim, which a worker connecting as
  -- service_role does not set, so it would refuse the only caller allowed.

  -- The deliverable is found or opened by its natural identity, so a retry of
  -- the same finished output does not create a second "post".
  select * into target_deliverable
  from public.campaign_deliverables deliverable
  where deliverable.organization_id = target_organization_id
    and deliverable.campaign_id = (input_version ->> 'campaign_id')::uuid
    and deliverable.channel = input_version ->> 'channel'
    and deliverable.placement = input_version ->> 'placement'
    and deliverable.language = input_version ->> 'language'
    and deliverable.format = input_version ->> 'format'
    and deliverable.ordinal = coalesce((input_version ->> 'ordinal')::integer, 1)
  for update;

  if not found then
    insert into public.campaign_deliverables
      (organization_id, campaign_id, channel, placement, language, format, ordinal)
    values (
      target_organization_id,
      (input_version ->> 'campaign_id')::uuid,
      input_version ->> 'channel',
      input_version ->> 'placement',
      input_version ->> 'language',
      input_version ->> 'format',
      coalesce((input_version ->> 'ordinal')::integer, 1)
    )
    returning * into target_deliverable;
  end if;

  -- An identical retry reuses the version already recorded rather than paying
  -- to make the same picture twice and asking for a second review of it.
  select * into existing
  from public.campaign_deliverable_versions version_row
  where version_row.organization_id = target_organization_id
    and version_row.deliverable_id = target_deliverable.id
    and version_row.content_hash = input_version ->> 'content_hash'
    and version_row.render_digest = input_version ->> 'render_digest';

  if found then
    return pg_catalog.jsonb_build_object(
      'deliverable_id', target_deliverable.id,
      'deliverable_version_id', existing.id,
      'version', existing.version,
      'outcome', 'replayed'
    );
  end if;

  select coalesce(pg_catalog.max(version), 0) + 1 into next_version
  from public.campaign_deliverable_versions version_row
  where version_row.organization_id = target_organization_id
    and version_row.deliverable_id = target_deliverable.id;

  insert into public.campaign_deliverable_versions (
    organization_id, deliverable_id, campaign_id, version, bundle_version_id, direction_key,
    creative_variant_id, source_kind, poster_render_id, final_asset_id, copy, render_inputs,
    render_digest, content_hash, verification
  ) values (
    target_organization_id,
    target_deliverable.id,
    (input_version ->> 'campaign_id')::uuid,
    next_version,
    (input_version ->> 'bundle_version_id')::uuid,
    (input_version ->> 'direction_key')::uuid,
    nullif(input_version ->> 'creative_variant_id', '')::uuid,
    input_version ->> 'source_kind',
    nullif(input_version ->> 'poster_render_id', '')::uuid,
    nullif(input_version ->> 'final_asset_id', '')::uuid,
    coalesce(input_version -> 'copy', '{}'::jsonb),
    coalesce(input_version -> 'render_inputs', '{}'::jsonb),
    input_version ->> 'render_digest',
    input_version ->> 'content_hash',
    coalesce(input_version -> 'verification', '{}'::jsonb)
  )
  returning * into saved;

  -- The new version becomes current and the deliverable returns to needing
  -- review. It does NOT inherit the previous version's approval.
  update public.campaign_deliverables
  set current_version_id = saved.id,
      state = 'ready_for_review',
      updated_at = pg_catalog.now()
  where organization_id = target_organization_id
    and id = target_deliverable.id;

  return pg_catalog.jsonb_build_object(
    'deliverable_id', target_deliverable.id,
    'deliverable_version_id', saved.id,
    'version', saved.version,
    'outcome', 'saved'
  );
end;
$$;

create function public.review_campaign_deliverable_version(
  target_organization_id uuid,
  input_review jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_version public.campaign_deliverable_versions;
  target_deliverable public.campaign_deliverables;
  existing public.campaign_deliverable_reviews;
  saved public.campaign_deliverable_reviews;
  decision_kind text;
begin
  decision_kind := input_review ->> 'decision';

  if (select auth.uid()) is null
    or not private.has_organization_permission(target_organization_id, 'campaign.approve') then
    raise exception 'campaign_deliverable_forbidden' using errcode = '42501';
  end if;

  select * into target_version
  from public.campaign_deliverable_versions version_row
  where version_row.organization_id = target_organization_id
    and version_row.id = (input_review ->> 'deliverable_version_id')::uuid
  for update;

  if not found then
    raise exception 'campaign_deliverable_version_not_found' using errcode = 'P0002';
  end if;

  select * into target_deliverable
  from public.campaign_deliverables deliverable
  where deliverable.organization_id = target_organization_id
    and deliverable.id = target_version.deliverable_id
  for update;

  -- Reviewing anything but the current version is refused. A review of an
  -- output a newer render has already replaced authorizes nothing, and letting
  -- it be recorded would make the history read as though it did.
  if target_deliverable.current_version_id is distinct from target_version.id then
    raise exception 'campaign_deliverable_superseded' using errcode = '22023';
  end if;

  -- The hash the reviewer saw must still be the hash on the row. This is the
  -- check that catches bytes moving under an approval.
  if target_version.content_hash is distinct from input_review ->> 'content_hash' then
    raise exception 'campaign_deliverable_content_changed' using errcode = '22023';
  end if;

  select * into existing
  from public.campaign_deliverable_reviews review_row
  where review_row.organization_id = target_organization_id
    and review_row.deliverable_version_id = target_version.id
    and review_row.idempotency_key = input_review ->> 'idempotency_key';

  if found then
    if existing.decision is distinct from decision_kind
      or existing.content_hash is distinct from input_review ->> 'content_hash' then
      raise exception 'campaign_deliverable_idempotency_conflict' using errcode = '23505';
    end if;
    return pg_catalog.jsonb_build_object('review_id', existing.id, 'outcome', 'replayed');
  end if;

  insert into public.campaign_deliverable_reviews (
    organization_id, deliverable_id, deliverable_version_id, content_hash, actor_id,
    decision, reason_codes, note, idempotency_key
  ) values (
    target_organization_id,
    target_version.deliverable_id,
    target_version.id,
    target_version.content_hash,
    -- From the session. A body cannot name who reviewed something.
    (select auth.uid()),
    decision_kind,
    coalesce(
      (
        select pg_catalog.array_agg(value #>> '{}')
        from pg_catalog.jsonb_array_elements(coalesce(input_review -> 'reason_codes', '[]'::jsonb))
      ),
      '{}'::text[]
    ),
    nullif(pg_catalog.btrim(input_review ->> 'note'), ''),
    input_review ->> 'idempotency_key'
  )
  returning * into saved;

  update public.campaign_deliverables
  set state = case when decision_kind = 'approved' then 'approved' else 'rejected' end,
      updated_at = pg_catalog.now()
  where organization_id = target_organization_id
    and id = target_version.deliverable_id;

  return pg_catalog.jsonb_build_object('review_id', saved.id, 'outcome', 'saved');
end;
$$;

revoke all on function public.record_campaign_deliverable_version(uuid, jsonb),
  public.review_campaign_deliverable_version(uuid, jsonb)
  from public, anon, authenticated, service_role;
-- Recording a finished render is worker work; reviewing one is a person's, and
-- no worker may stand in for that.
grant execute on function public.record_campaign_deliverable_version(uuid, jsonb) to service_role;
grant execute on function public.review_campaign_deliverable_version(uuid, jsonb) to authenticated;

comment on function public.record_campaign_deliverable_version(uuid, jsonb) is
  'Records one exact finished output as a new immutable version, or replays the identical one. The new version is always unreviewed: approval is never inherited.';
comment on function public.review_campaign_deliverable_version(uuid, jsonb) is
  'Records a person''s review of one exact deliverable version and its content hash. Requires campaign.approve. Refuses a superseded version or a changed hash.';
