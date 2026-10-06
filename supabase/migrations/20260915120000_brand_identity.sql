-- Brand identity: the canonical logo and the rules generation must respect.
--
-- `hard_constraints`, `soft_conventions` and `restricted_terms` have been read
-- from `business_profiles.brand_context` by `load_campaign_creation_facts`,
-- rendered into the image prompt by `reference-prompt.ts`, and checked by
-- `content-policy.ts` since the generation context was written. Nothing has
-- ever written them, so every campaign in every organization has been built
-- against three empty arrays. These tables are the producers.
--
-- Tables rather than more keys inside `brand_context`, because a brand's
-- don'ts constrain what may be published in a client's name and "who changed
-- this, and when" has to be answerable. `brand_context` keeps `voice`, which
-- describes rather than constrains.
--
-- Additive. No column is dropped and no existing row is rewritten.

-- ---------------------------------------------------------------------------
-- Validators
-- ---------------------------------------------------------------------------

create function private.brand_palette_valid(input_palette jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select input_palette is not null
    and pg_catalog.jsonb_typeof(input_palette) = 'object'
    and not exists (
      select 1
      from pg_catalog.jsonb_each_text(input_palette) as slot(key, value)
      where slot.key not in ('primary', 'secondary', 'tertiary')
        or slot.value !~ '^#[0-9a-f]{6}$'
    );
$$;

-- Bounds mirror `brandGuidelinesSchema`, which mirrors `generationContextSchema`
-- — the value's actual consumer. A different bound here would either truncate
-- silently or admit a value the consumer rejects.
create function private.brand_rules_valid(input_rules jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select input_rules is not null
    and pg_catalog.jsonb_typeof(input_rules) = 'array'
    and pg_catalog.jsonb_array_length(input_rules) <= 120
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements(input_rules) as rule(value)
      where pg_catalog.jsonb_typeof(rule.value) <> 'object'
        -- Exactly two keys, so an unmarked rule cannot be stored with its
        -- strength smuggled in under another name. Spec 026 section 5.
        or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(rule.value)) <> 2
        or rule.value ->> 'strength' not in ('hard', 'soft')
        or pg_catalog.char_length(pg_catalog.btrim(coalesce(rule.value ->> 'text', '')))
             not between 3 and 400
    );
$$;

revoke all on function private.brand_palette_valid(jsonb) from public;
revoke all on function private.brand_rules_valid(jsonb) from public;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.organization_brand_guidelines (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  palette jsonb not null default '{}'::jsonb check (private.brand_palette_valid(palette)),
  rules jsonb not null default '[]'::jsonb check (private.brand_rules_valid(rules)),
  restricted_terms text[] not null default '{}'::text[]
    check (private.asset_library_text_array_valid(restricted_terms, 200, 80)),
  updated_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

create table public.organization_brand_logos (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  variant text not null check (variant in ('primary', 'dark')),
  brand_asset_version_id uuid not null,
  set_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  primary key (organization_id, variant),
  -- The tenant is inside the key, so a pointer at another organization's image
  -- cannot be written even by application code that forgot to check.
  constraint organization_brand_logos_version_fkey
    foreign key (organization_id, brand_asset_version_id)
    references public.organization_brand_asset_versions (organization_id, id) on delete restrict
);

create index organization_brand_logos_version_idx
  on public.organization_brand_logos (organization_id, brand_asset_version_id);
create index organization_brand_guidelines_updated_by_idx
  on public.organization_brand_guidelines (updated_by);
create index organization_brand_logos_set_by_idx
  on public.organization_brand_logos (set_by);

create trigger organization_brand_guidelines_set_updated_at
  before update on public.organization_brand_guidelines
  for each row execute function public.set_updated_at();
create trigger organization_brand_logos_set_updated_at
  before update on public.organization_brand_logos
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------

-- Its own function, deliberately, rather than `private.audit_asset_library_change`.
-- That one's else-branch reads `new.state`, `new.archived_at`, `new.confirmed_by`
-- and `new.id`, none of which these tables have — plpgsql resolves record fields
-- at execution time, so reusing it would have applied cleanly and failed on the
-- first insert. That exact failure has already happened twice in this schema.
create function private.audit_brand_identity_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_event_name text;
  target_entity_id uuid;
  target_payload jsonb;
begin
  if tg_table_name = 'organization_brand_logos' then
    target_event_name := 'brand.logo_set';
    target_entity_id := new.brand_asset_version_id;
    target_payload := pg_catalog.jsonb_build_object('variant', new.variant);
  else
    target_event_name := 'brand.guidelines_updated';
    -- The guidelines row is keyed by the organization and has no id of its own.
    target_entity_id := null;
    -- Counts, never the rules themselves. An audit trail is read in contexts
    -- where a client's unpublished brand rules do not belong.
    target_payload := pg_catalog.jsonb_build_object(
      'ruleCount', pg_catalog.jsonb_array_length(new.rules),
      'restrictedTermCount', pg_catalog.cardinality(new.restricted_terms),
      'paletteSlots', (
        select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(new.palette)
      ),
      'operation', tg_op
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
    (case when (select auth.uid()) is null then 'system' else 'user' end)::public.audit_actor_type,
    (select auth.uid()),
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

revoke all on function private.audit_brand_identity_change() from public;

create trigger organization_brand_guidelines_audit
  after insert or update on public.organization_brand_guidelines
  for each row execute function private.audit_brand_identity_change();
create trigger organization_brand_logos_audit
  after insert or update on public.organization_brand_logos
  for each row execute function private.audit_brand_identity_change();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.organization_brand_guidelines enable row level security;
alter table public.organization_brand_guidelines force row level security;
alter table public.organization_brand_logos enable row level security;
alter table public.organization_brand_logos force row level security;

create policy "members read brand guidelines"
on public.organization_brand_guidelines for select to authenticated
using (private.is_organization_member(organization_id));

create policy "brand managers write brand guidelines"
on public.organization_brand_guidelines for all to authenticated
using (private.has_organization_permission(organization_id, 'brand.manage'))
with check (private.has_organization_permission(organization_id, 'brand.manage'));

create policy "members read brand logos"
on public.organization_brand_logos for select to authenticated
using (private.is_organization_member(organization_id));

create policy "brand managers write brand logos"
on public.organization_brand_logos for all to authenticated
using (private.has_organization_permission(organization_id, 'brand.manage'))
with check (private.has_organization_permission(organization_id, 'brand.manage'));

grant select, insert, update, delete on table public.organization_brand_guidelines to authenticated;
grant select, insert, update, delete on table public.organization_brand_logos to authenticated;

-- ---------------------------------------------------------------------------
-- Permission
-- ---------------------------------------------------------------------------

-- The header line below is matched verbatim by `permissions.drift.test.ts`,
-- which reads the catalogue out of these migrations as text because vitest has
-- no database. Reflowing it hides the seed from that check, and the mirror in
-- `src/domain/access/permissions.ts` would then be free to drift silently.
insert into public.permissions (key, description, scope) values
  ('brand.manage', 'Set the organization logo and its brand guidelines.', 'organization')
-- No conflict target named here. That parser walks parentheses rather than
-- SQL, so a conflict target would read to it as a second, empty tuple.
on conflict do nothing;

insert into public.organization_role_permissions (organization_role, permission_key) values
  ('owner', 'brand.manage'),
  ('admin', 'brand.manage')
on conflict do nothing;
