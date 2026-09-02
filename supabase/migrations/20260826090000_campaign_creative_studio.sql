-- Campaign Creative Studio: templates, renders, plate edits, and the mask bucket.
--
-- The division this schema encodes, from ADR 0042: an image model draws food
-- convincingly and spells badly; a layout engine spells perfectly and cannot
-- draw food. So the plate carries no text, every visible word is composited by
-- deterministic code from an approved manifest value, and a render is a pure
-- function of its pinned inputs.
--
-- Three things here are deliberate absences, and each is load-bearing:
--
--   * `campaign_poster_renders` has no `truth_class` column. Truth class
--     describes the plate (spec 020 sec 7.8) and is read through
--     `plate_asset_id`. A column of that name on a poster row is an invitation
--     to fill it in, and `synthetic_composite` means "drawn from the client's
--     photograph", not "layers composited". Conflating the two mislabels a
--     truth claim shown to a client.
--   * `campaign_plate_edits` has no `blueprint` or `plan_model_id`. An edit does
--     not run the art-direction stage: a blueprint is direction for a whole
--     image and would fight the mask it is supposed to respect.
--   * A poster is not a `campaign_assets` row. Those require a bundle version
--     and a not-null truth class, and are written only by
--     `create_campaign_bundle_version` -- so filing a poster there would make
--     every render a new campaign version and invalidate approval each time
--     somebody rendered.

-- ---------------------------------------------------------------------------
-- Structural validators
-- ---------------------------------------------------------------------------
--
-- These check shape, not business rules. Caps and vocabularies that change with
-- judgement live in versioned domain code, where changing them is a code review
-- rather than a migration against live staging.

create function private.poster_template_layout_valid(input_layout jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select
    input_layout is not null
    and pg_catalog.jsonb_typeof(input_layout) = 'object'
    and pg_catalog.jsonb_typeof(input_layout -> 'safeArea') = 'object'
    and pg_catalog.jsonb_typeof(input_layout -> 'textBoxes') = 'array'
    and pg_catalog.jsonb_array_length(input_layout -> 'textBoxes') between 1 and 12
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements(input_layout -> 'textBoxes') as box(value)
      where pg_catalog.jsonb_typeof(box.value) <> 'object'
        or coalesce(box.value ->> 'slot', '') not in ('caption', 'body', 'footer', 'extra')
    )
    -- One box per named slot. Two boxes bound to the same manifest value would
    -- render the same words twice with no way to say which was intended.
    and (
      select pg_catalog.count(distinct box.value ->> 'slot')
      from pg_catalog.jsonb_array_elements(input_layout -> 'textBoxes') as box(value)
    ) = pg_catalog.jsonb_array_length(input_layout -> 'textBoxes');
$$;

create function private.plate_edit_annotations_valid(input_annotations jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select
    input_annotations is not null
    and pg_catalog.jsonb_typeof(input_annotations) = 'array'
    and pg_catalog.jsonb_array_length(input_annotations) between 1 and 8
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements(input_annotations)
        with ordinality as annotation(value, position)
      where pg_catalog.jsonb_typeof(annotation.value) <> 'object'
        or pg_catalog.jsonb_typeof(annotation.value -> 'bounds') <> 'object'
        or pg_catalog.jsonb_typeof(annotation.value -> 'ordinal') <> 'number'
        -- Ordinals are the replay order, so they must be exactly 1..n in order.
        or (annotation.value ->> 'ordinal')::numeric is distinct from annotation.position::numeric
        or annotation.value ->> 'instruction' is null
        or pg_catalog.char_length(pg_catalog.btrim(annotation.value ->> 'instruction'))
             not between 1 and 500
    );
$$;

revoke all on function private.poster_template_layout_valid(jsonb) from public;
revoke all on function private.plate_edit_annotations_valid(jsonb) from public;

-- ---------------------------------------------------------------------------
-- Template registry
-- ---------------------------------------------------------------------------
--
-- Platform-owned and versioned, mirroring `creative_review_reasons`. Release 1
-- carries only `core` rows, and they are seeded by a later migration once the
-- compositor has proved it can render one: a template row tells an operator the
-- template is available, and one the compositor cannot satisfy is a promise
-- that does not work.

create table public.campaign_poster_templates (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  key text not null check (key ~ '^[a-z][a-z0-9_]*$'),
  version integer not null check (version > 0),
  placement text not null check (placement in ('feed_image', 'image_story')),
  canvas_width_px integer not null check (canvas_width_px between 240 and 4096),
  canvas_height_px integer not null check (canvas_height_px between 240 and 4096),
  layout jsonb not null,
  owner_scope text not null check (owner_scope in ('core', 'pack', 'organization')),
  pack_slug text check (
    pack_slug is null
    or (
      pg_catalog.char_length(pack_slug) between 1 and 80
      and pack_slug ~ '^[a-z][a-z0-9-]*$'
    )
  ),
  -- Set only by an `organization` scoped template. The column exists so the
  -- declared seam in spec 020 sec 5.2 is real rather than decorative: without
  -- it, an `organization` row would be a template owned by nobody, readable by
  -- every tenant.
  organization_id uuid references public.organizations(id) on delete cascade,
  state text not null default 'active' check (state in ('active', 'retired')),
  created_at timestamptz not null default pg_catalog.now(),
  unique (key, version),
  check ((owner_scope = 'pack') = (pack_slug is not null)),
  check ((owner_scope = 'organization') = (organization_id is not null)),
  check (private.poster_template_layout_valid(layout))
);

create index campaign_poster_templates_available_idx
  on public.campaign_poster_templates (placement, state, key, version desc);
create index campaign_poster_templates_organization_idx
  on public.campaign_poster_templates (organization_id)
  where organization_id is not null;

comment on table public.campaign_poster_templates is
  'Versioned, platform-owned poster layouts. A template version is immutable; a change is a new version.';
comment on column public.campaign_poster_templates.layout is
  'Declarative layout. Structure is checked here; the full contract is the versioned domain schema.';

-- ---------------------------------------------------------------------------
-- Renders
-- ---------------------------------------------------------------------------
--
-- One row per render attempt, refusals included. Spec 020 sec 12 tracks refusal
-- rates by script -- a Malayalam refusal rate materially above Latin means the
-- font coverage is wrong rather than the operator -- and a refusal that was
-- never written down cannot be counted.
--
-- `render_digest` is taken over the *inputs*: plate hash, template key and
-- version, text values, script, and the font manifest. A refused attempt
-- therefore still has one, and it is what makes a re-render idempotent.
-- `output_content_hash` is taken over the bytes, so determinism is the
-- observation that one digest always yields one hash.

create table public.campaign_poster_renders (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null,
  bundle_version_id uuid not null,
  plate_asset_id uuid not null,
  -- The run that produced the plate, when one did. Null for a client's own
  -- photograph and for an edited plate, neither of which has a generation run.
  -- Recorded directly because the reverse path does not always exist: a
  -- `variants` run succeeds with a null `result_version_id` by constraint, so
  -- asset -> bundle version -> "the run whose result_version_id matches" has
  -- nothing to match on for a plate produced that way.
  plate_generation_run_id uuid,
  template_key text not null,
  template_version integer not null,
  script text not null check (script in ('Latn', 'Mlym', 'Arab')),
  -- Exactly the strings drawn, so a poster can be compared against the manifest
  -- it claims to quote rather than read by eye.
  text_values jsonb not null check (pg_catalog.jsonb_typeof(text_values) = 'object'),
  font_manifest jsonb not null check (pg_catalog.jsonb_typeof(font_manifest) = 'object'),
  render_digest text not null check (render_digest ~ '^[0-9a-f]{64}$'),
  state text not null check (state in ('rendered', 'refused')),
  -- Stable refusal codes are owned by versioned domain code, like the negative
  -- rule caps: the format is checked here, the vocabulary lives where changing
  -- it is a code review rather than a migration against live staging.
  refusal_code text check (
    refusal_code is null
    or (
      pg_catalog.char_length(refusal_code) between 3 and 120
      and refusal_code ~ '^[a-z][a-z0-9_]*$'
    )
  ),
  refusal_detail jsonb check (
    refusal_detail is null or pg_catalog.jsonb_typeof(refusal_detail) = 'object'
  ),
  output_storage_path text check (
    output_storage_path is null
    or pg_catalog.char_length(output_storage_path) between 1 and 1024
  ),
  output_content_hash text check (
    output_content_hash is null or output_content_hash ~ '^[0-9a-f]{64}$'
  ),
  output_mime_type text check (
    output_mime_type is null
    or output_mime_type in ('image/png', 'image/jpeg', 'image/webp')
  ),
  output_width_px integer check (output_width_px is null or output_width_px > 0),
  output_height_px integer check (output_height_px is null or output_height_px > 0),
  verification jsonb not null default '{}'::jsonb check (
    pg_catalog.jsonb_typeof(verification) = 'object'
  ),
  rendered_at timestamptz not null default pg_catalog.now(),
  created_at timestamptz not null default pg_catalog.now(),
  unique (organization_id, id),
  -- An identical re-render is the same render. This is the idempotency fence,
  -- and it is content-addressed rather than lease-based because the render is
  -- deterministic by construction.
  unique (
    organization_id, bundle_version_id, template_key, template_version, script, render_digest
  ),
  foreign key (organization_id, campaign_id)
    references public.campaigns (organization_id, id) on delete cascade,
  foreign key (organization_id, bundle_version_id)
    references public.campaign_bundle_versions (organization_id, id) on delete cascade,
  foreign key (organization_id, plate_asset_id)
    references public.campaign_assets (organization_id, id) on delete restrict,
  foreign key (organization_id, plate_generation_run_id)
    references public.campaign_generation_runs (organization_id, id)
    on delete set null (plate_generation_run_id),
  foreign key (template_key, template_version)
    references public.campaign_poster_templates (key, version) on delete restrict,
  -- A rendered row carries every output field; a refused row carries none of
  -- them and carries a code instead. Neither half can be recorded alone.
  check ((state = 'rendered') = (output_storage_path is not null)),
  check ((state = 'rendered') = (output_content_hash is not null)),
  check ((state = 'rendered') = (output_mime_type is not null)),
  check ((state = 'rendered') = (output_width_px is not null)),
  check ((state = 'rendered') = (output_height_px is not null)),
  check ((state = 'refused') = (refusal_code is not null))
);

create index campaign_poster_renders_campaign_idx
  on public.campaign_poster_renders (organization_id, campaign_id, rendered_at desc, id desc);
create index campaign_poster_renders_refusal_idx
  on public.campaign_poster_renders (organization_id, script, refusal_code)
  where state = 'refused';
create index campaign_poster_renders_plate_idx
  on public.campaign_poster_renders (organization_id, plate_asset_id);
create index campaign_poster_renders_plate_run_idx
  on public.campaign_poster_renders (organization_id, plate_generation_run_id)
  where plate_generation_run_id is not null;

comment on table public.campaign_poster_renders is
  'One row per render attempt, refusals included. Carries no truth class: that describes the plate, read through plate_asset_id.';
comment on column public.campaign_poster_renders.render_digest is
  'Digest over the render inputs -- plate hash, template version, text values, script, font manifest. Present even when refused.';
comment on column public.campaign_poster_renders.output_content_hash is
  'Digest over the produced bytes. One render_digest must always yield one output_content_hash.';

-- ---------------------------------------------------------------------------
-- Plate edits
-- ---------------------------------------------------------------------------
--
-- Append-only lineage, and the edit's own receipt. An edit spends model money
-- and produces a new plate version, so it deserves a record like any other
-- generation -- but it does not belong in `campaign_generation_runs`, which is
-- shaped around bundle generation and whose kind constraint was replaced as
-- recently as 20260825120000.
--
-- One row is written per *completed* edit. The unique idempotency key makes a
-- duplicate write impossible; preventing a duplicate model *call* is the
-- worker's own idempotency key, since without a run row there is no claim token
-- or lease to fence with. That split is stated rather than hidden.

create table public.campaign_plate_edits (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null,
  parent_plate_asset_id uuid not null,
  child_plate_asset_id uuid not null,
  mask_storage_path text not null check (
    pg_catalog.char_length(mask_storage_path) between 1 and 1024
  ),
  mask_content_hash text not null check (mask_content_hash ~ '^[0-9a-f]{64}$'),
  -- Shape, not business schema. The declared minimum and maximum coverage are
  -- domain-owned and tighter: a region below the minimum is a mis-click, and a
  -- union above the maximum means the honest action is to regenerate.
  union_coverage_ratio numeric(7, 6) not null check (
    union_coverage_ratio > 0 and union_coverage_ratio <= 1
  ),
  annotations jsonb not null check (private.plate_edit_annotations_valid(annotations)),
  negative_rules jsonb not null default '[]'::jsonb check (
    pg_catalog.jsonb_typeof(negative_rules) = 'array'
    and pg_catalog.jsonb_array_length(negative_rules) <= 12
  ),
  model_id text not null check (
    pg_catalog.char_length(pg_catalog.btrim(model_id)) between 1 and 200
  ),
  -- Null means not measured. Zero would claim the edit was free.
  cost_minor bigint check (cost_minor >= 0),
  idempotency_key text not null check (
    pg_catalog.char_length(idempotency_key) between 8 and 200
  ),
  edited_by uuid not null references auth.users(id) on delete restrict,
  edited_at timestamptz not null default pg_catalog.now(),
  created_at timestamptz not null default pg_catalog.now(),
  unique (organization_id, id),
  unique (organization_id, idempotency_key),
  -- An edit that produced its own parent would be a lineage cycle of length
  -- one, and would read as a plate that edited itself.
  check (parent_plate_asset_id <> child_plate_asset_id),
  foreign key (organization_id, campaign_id)
    references public.campaigns (organization_id, id) on delete cascade,
  foreign key (organization_id, parent_plate_asset_id)
    references public.campaign_assets (organization_id, id) on delete restrict,
  foreign key (organization_id, child_plate_asset_id)
    references public.campaign_assets (organization_id, id) on delete restrict
);

create index campaign_plate_edits_parent_idx
  on public.campaign_plate_edits (organization_id, parent_plate_asset_id, edited_at desc, id desc);
create index campaign_plate_edits_child_idx
  on public.campaign_plate_edits (organization_id, child_plate_asset_id);
create index campaign_plate_edits_campaign_idx
  on public.campaign_plate_edits (organization_id, campaign_id, edited_at desc, id desc);
create index campaign_plate_edits_edited_by_idx
  on public.campaign_plate_edits (edited_by);

comment on table public.campaign_plate_edits is
  'Append-only masked-edit lineage and receipt. No blueprint columns: an edit does not run the art-direction stage.';
comment on column public.campaign_plate_edits.idempotency_key is
  'Fences a duplicate write. Fencing a duplicate model call is the worker key, since an edit has no run claim token.';

-- ---------------------------------------------------------------------------
-- Append-only enforcement
-- ---------------------------------------------------------------------------

create function private.reject_creative_studio_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '23514';
end;
$$;

create trigger campaign_poster_renders_append_only
  before update or delete on public.campaign_poster_renders
  for each row execute function private.reject_creative_studio_mutation();

create trigger campaign_plate_edits_append_only
  before update or delete on public.campaign_plate_edits
  for each row execute function private.reject_creative_studio_mutation();

revoke all on function private.reject_creative_studio_mutation() from public;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.campaign_poster_templates enable row level security;
alter table public.campaign_poster_templates force row level security;
alter table public.campaign_poster_renders enable row level security;
alter table public.campaign_poster_renders force row level security;
alter table public.campaign_plate_edits enable row level security;
alter table public.campaign_plate_edits force row level security;

-- Platform and pack templates are catalogue and readable by any signed-in user,
-- exactly as `creative_review_reasons` is. An organization-scoped template is
-- that tenant's alone.
create policy "signed-in users read shared poster templates"
  on public.campaign_poster_templates
  for select to authenticated
  using (
    organization_id is null
    or private.is_organization_member(organization_id)
  );

create policy "members read campaign poster renders"
  on public.campaign_poster_renders
  for select to authenticated
  using (private.is_organization_member(organization_id));

create policy "members read campaign plate edits"
  on public.campaign_plate_edits
  for select to authenticated
  using (private.is_organization_member(organization_id));

revoke all on table public.campaign_poster_templates from anon, authenticated;
revoke all on table public.campaign_poster_renders from anon, authenticated;
revoke all on table public.campaign_plate_edits from anon, authenticated;

grant select on table public.campaign_poster_templates to authenticated;
grant select on table public.campaign_poster_renders to authenticated;
grant select on table public.campaign_plate_edits to authenticated;

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------

create function private.audit_creative_studio_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_event_name text;
  target_entity_id uuid;
  target_actor_id uuid;
  target_payload jsonb;
begin
  if tg_table_name = 'campaign_poster_renders' then
    target_event_name := case
      when new.state = 'refused' then 'campaign.render_refused'
      else 'campaign.poster_rendered'
    end;
    target_entity_id := new.id;
    target_actor_id := (select auth.uid());
    target_payload := pg_catalog.jsonb_build_object(
      'renderId', new.id,
      'campaignId', new.campaign_id,
      'bundleVersionId', new.bundle_version_id,
      'templateKey', new.template_key,
      'templateVersion', new.template_version,
      'script', new.script,
      'state', new.state,
      'refusalCode', new.refusal_code,
      'renderDigest', new.render_digest
    );
  else
    target_event_name := 'campaign.plate_edited';
    target_entity_id := new.id;
    target_actor_id := coalesce((select auth.uid()), new.edited_by);
    target_payload := pg_catalog.jsonb_build_object(
      'editId', new.id,
      'campaignId', new.campaign_id,
      'parentPlateAssetId', new.parent_plate_asset_id,
      'childPlateAssetId', new.child_plate_asset_id,
      'maskContentHash', new.mask_content_hash,
      'regionCount', pg_catalog.jsonb_array_length(new.annotations),
      'modelId', new.model_id
    );
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
    tg_table_name,
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

create trigger campaign_poster_renders_audit
  after insert on public.campaign_poster_renders
  for each row execute function private.audit_creative_studio_change();
create trigger campaign_plate_edits_audit
  after insert on public.campaign_plate_edits
  for each row execute function private.audit_creative_studio_change();

revoke all on function private.audit_creative_studio_change() from public;

-- ---------------------------------------------------------------------------
-- Permission vocabulary
-- ---------------------------------------------------------------------------

insert into public.permissions (key, description, scope) values
  ('poster.render', 'Render an approved campaign version as a poster.', 'organization');

insert into public.organization_role_permissions (organization_role, permission_key) values
  ('owner', 'poster.render'),
  ('admin', 'poster.render'),
  ('operator', 'poster.render');

-- ---------------------------------------------------------------------------
-- Worker writes
-- ---------------------------------------------------------------------------
--
-- Both writers are service-role only. The role is read from the actual `SET
-- ROLE` state rather than a JWT claim, and never from `current_user`, which
-- inside a `SECURITY DEFINER` function is the function owner and would never
-- match.

create function public.record_campaign_poster_render(
  target_organization_id uuid,
  input_render jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  render_campaign_id uuid := nullif(input_render ->> 'campaign_id', '')::uuid;
  render_bundle_version_id uuid := nullif(input_render ->> 'bundle_version_id', '')::uuid;
  render_plate_asset_id uuid := nullif(input_render ->> 'plate_asset_id', '')::uuid;
  render_plate_run_id uuid := nullif(input_render ->> 'plate_generation_run_id', '')::uuid;
  render_template_key text := input_render ->> 'template_key';
  render_template_version integer := nullif(input_render ->> 'template_version', '')::integer;
  render_script text := input_render ->> 'script';
  render_state text := input_render ->> 'state';
  render_digest_value text := input_render ->> 'render_digest';
  existing public.campaign_poster_renders;
  saved public.campaign_poster_renders;
begin
  if input_render is null or pg_catalog.jsonb_typeof(input_render) <> 'object' then
    raise exception 'campaign_poster_render_invalid' using errcode = '22023';
  end if;

  if target_organization_id is null
    or input_render ->> 'organization_id' is distinct from target_organization_id::text
  then
    raise exception 'campaign_poster_render_organization_mismatch' using errcode = '42501';
  end if;

  if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    raise exception 'campaign_poster_render_forbidden' using errcode = '42501';
  end if;

  if render_campaign_id is null
    or render_bundle_version_id is null
    or render_plate_asset_id is null
    or render_template_key is null
    or render_template_version is null
    or render_script not in ('Latn', 'Mlym', 'Arab')
    or render_state not in ('rendered', 'refused')
    or render_digest_value is null
  then
    raise exception 'campaign_poster_render_invalid' using errcode = '22023';
  end if;

  -- The plate must belong to this tenant *and* to the version being rendered.
  -- Composing an approved version's poster over another version's plate would
  -- produce a poster nobody approved, from parts that were each approved once.
  if not exists (
    select 1
    from public.campaign_assets asset
    where asset.organization_id = target_organization_id
      and asset.id = render_plate_asset_id
      and asset.bundle_version_id = render_bundle_version_id
  ) then
    raise exception 'campaign_poster_render_plate_not_found' using errcode = '23503';
  end if;

  select * into existing
  from public.campaign_poster_renders stored
  where stored.organization_id = target_organization_id
    and stored.bundle_version_id = render_bundle_version_id
    and stored.template_key = render_template_key
    and stored.template_version = render_template_version
    and stored.script = render_script
    and stored.render_digest = render_digest_value;

  if found then
    -- The same inputs must have produced the same bytes. If they did not,
    -- reproducibility has been lost, and that is a refusal rather than a row
    -- quietly overwritten -- the table is append-only in any case.
    if existing.state is distinct from render_state
      or existing.output_content_hash is distinct from
         nullif(input_render ->> 'output_content_hash', '')
      or existing.refusal_code is distinct from nullif(input_render ->> 'refusal_code', '')
    then
      raise exception 'campaign_poster_render_conflict' using errcode = '22023';
    end if;

    return pg_catalog.jsonb_build_object(
      'render_id', existing.id,
      'state', existing.state,
      'replayed', true
    );
  end if;

  insert into public.campaign_poster_renders (
    organization_id,
    campaign_id,
    bundle_version_id,
    plate_asset_id,
    plate_generation_run_id,
    template_key,
    template_version,
    script,
    text_values,
    font_manifest,
    render_digest,
    state,
    refusal_code,
    refusal_detail,
    output_storage_path,
    output_content_hash,
    output_mime_type,
    output_width_px,
    output_height_px,
    verification
  ) values (
    target_organization_id,
    render_campaign_id,
    render_bundle_version_id,
    render_plate_asset_id,
    render_plate_run_id,
    render_template_key,
    render_template_version,
    render_script,
    coalesce(input_render -> 'text_values', '{}'::jsonb),
    coalesce(input_render -> 'font_manifest', '{}'::jsonb),
    render_digest_value,
    render_state,
    nullif(input_render ->> 'refusal_code', ''),
    input_render -> 'refusal_detail',
    nullif(input_render ->> 'output_storage_path', ''),
    nullif(input_render ->> 'output_content_hash', ''),
    nullif(input_render ->> 'output_mime_type', ''),
    nullif(input_render ->> 'output_width_px', '')::integer,
    nullif(input_render ->> 'output_height_px', '')::integer,
    coalesce(input_render -> 'verification', '{}'::jsonb)
  )
  returning * into saved;

  return pg_catalog.jsonb_build_object(
    'render_id', saved.id,
    'state', saved.state,
    'replayed', false
  );
end;
$$;

create function public.record_campaign_plate_edit(
  target_organization_id uuid,
  input_edit jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  edit_campaign_id uuid := nullif(input_edit ->> 'campaign_id', '')::uuid;
  edit_parent_asset_id uuid := nullif(input_edit ->> 'parent_plate_asset_id', '')::uuid;
  edit_child_asset_id uuid := nullif(input_edit ->> 'child_plate_asset_id', '')::uuid;
  edit_idempotency_key text := input_edit ->> 'idempotency_key';
  edit_mask_hash text := input_edit ->> 'mask_content_hash';
  edit_edited_by uuid := nullif(input_edit ->> 'edited_by', '')::uuid;
  existing public.campaign_plate_edits;
  saved public.campaign_plate_edits;
begin
  if input_edit is null or pg_catalog.jsonb_typeof(input_edit) <> 'object' then
    raise exception 'campaign_plate_edit_invalid' using errcode = '22023';
  end if;

  if target_organization_id is null
    or input_edit ->> 'organization_id' is distinct from target_organization_id::text
  then
    raise exception 'campaign_plate_edit_organization_mismatch' using errcode = '42501';
  end if;

  if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    raise exception 'campaign_plate_edit_forbidden' using errcode = '42501';
  end if;

  if edit_campaign_id is null
    or edit_parent_asset_id is null
    or edit_child_asset_id is null
    or edit_idempotency_key is null
    or edit_mask_hash is null
    or edit_edited_by is null
  then
    raise exception 'campaign_plate_edit_invalid' using errcode = '22023';
  end if;

  -- The mask path is tenant-prefixed and is fetched by the worker, so the
  -- prefix is checked before the row exists rather than after the bytes are
  -- read.
  if pg_catalog.split_part(input_edit ->> 'mask_storage_path', '/', 1)
     is distinct from target_organization_id::text
  then
    raise exception 'campaign_plate_edit_mask_path_foreign' using errcode = '42501';
  end if;

  select * into existing
  from public.campaign_plate_edits stored
  where stored.organization_id = target_organization_id
    and stored.idempotency_key = edit_idempotency_key;

  if found then
    if existing.parent_plate_asset_id is distinct from edit_parent_asset_id
      or existing.child_plate_asset_id is distinct from edit_child_asset_id
      or existing.mask_content_hash is distinct from edit_mask_hash
    then
      raise exception 'campaign_plate_edit_conflict' using errcode = '22023';
    end if;

    return pg_catalog.jsonb_build_object(
      'edit_id', existing.id,
      'child_plate_asset_id', existing.child_plate_asset_id,
      'replayed', true
    );
  end if;

  insert into public.campaign_plate_edits (
    organization_id,
    campaign_id,
    parent_plate_asset_id,
    child_plate_asset_id,
    mask_storage_path,
    mask_content_hash,
    union_coverage_ratio,
    annotations,
    negative_rules,
    model_id,
    cost_minor,
    idempotency_key,
    edited_by
  ) values (
    target_organization_id,
    edit_campaign_id,
    edit_parent_asset_id,
    edit_child_asset_id,
    input_edit ->> 'mask_storage_path',
    edit_mask_hash,
    (input_edit ->> 'union_coverage_ratio')::numeric,
    coalesce(input_edit -> 'annotations', '[]'::jsonb),
    coalesce(input_edit -> 'negative_rules', '[]'::jsonb),
    input_edit ->> 'model_id',
    nullif(input_edit ->> 'cost_minor', '')::bigint,
    edit_idempotency_key,
    edit_edited_by
  )
  returning * into saved;

  return pg_catalog.jsonb_build_object(
    'edit_id', saved.id,
    'child_plate_asset_id', saved.child_plate_asset_id,
    'replayed', false
  );
end;
$$;

revoke all on function public.record_campaign_poster_render(uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.record_campaign_plate_edit(uuid, jsonb)
  from public, anon, authenticated, service_role;

grant execute on function public.record_campaign_poster_render(uuid, jsonb) to service_role;
grant execute on function public.record_campaign_plate_edit(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Mask storage
-- ---------------------------------------------------------------------------
--
-- Masks are uploaded from a browser and are untrusted like any other image:
-- the route reserves a path, the operator uploads, and the worker reads the
-- bytes back and validates them server-side.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'campaign-masks', 'campaign-masks', false, 15728640,
  array['image/png']::text[]
)
on conflict (id) do update set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Paths are `organizationId/campaignId/editId/mask.png`. The first segment is
-- the tenant, checked against live membership on every read and write.
create policy "members read campaign mask objects"
on storage.objects for select to authenticated
using (
  bucket_id = 'campaign-masks'
  and cardinality(storage.foldername(name)) = 3
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and private.is_organization_member(((storage.foldername(name))[1])::uuid)
);

create policy "operators upload campaign mask objects"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'campaign-masks'
  and cardinality(storage.foldername(name)) = 3
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and private.has_organization_role(
    ((storage.foldername(name))[1])::uuid,
    array['owner', 'admin', 'operator']::public.organization_role[]
  )
);
