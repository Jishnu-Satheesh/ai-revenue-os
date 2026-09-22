-- Organisation competitors for the New research dialog (Track C1 P2).
--
-- A new table (not a column on organizations) because the dialog needs
-- per-competitor identity: list, add, edit and delete one rival without
-- rewriting the whole set. A jsonb column would force read-modify-write races
-- and could not enforce de-duplication; a unique (organization_id,
-- normalized_name) constraint enforces it at the database. Normalization folds
-- case and whitespace only (matching the brief contract), so distinct
-- diacritic or non-Latin names keep distinct rows.
--
-- Idempotent: create-if-not-exists, add-column-if-not-exists for reruns,
-- drop-policy-if-exists before each create, grants reissued safely.
-- Least privilege mirroring growth_intelligence_research_projects: SELECT to
-- authenticated + service_role, INSERT/UPDATE/DELETE to authenticated only,
-- RLS policies gating read on growth_intelligence.read and writes on
-- growth_intelligence.manage (the route refuses viewers before touching
-- persistence, the database matches it).
-- Dry-run only: this migration is NOT pushed by the agent; staging applies it
-- separately. Repository code degrades when the table is absent so research
-- starts never fail on the missing relation.

create table if not exists public.growth_intelligence_organization_competitors (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (name = pg_catalog.btrim(name) and pg_catalog.char_length(name) between 1 and 160),
  normalized_name text not null check (normalized_name = pg_catalog.btrim(normalized_name) and pg_catalog.char_length(normalized_name) between 1 and 160),
  website text check (website is null or (website = pg_catalog.btrim(website) and pg_catalog.char_length(website) between 1 and 2048)),
  location_hint text check (location_hint is null or (location_hint = pg_catalog.btrim(location_hint) and pg_catalog.char_length(location_hint) between 1 and 240)),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (organization_id, normalized_name),
  unique (organization_id, id)
);

comment on table public.growth_intelligence_organization_competitors is
  'Competitors an organisation named in Market Watch research, saved permanently for reuse. De-duplicated by normalized name per organisation.';

create unique index if not exists growth_intelligence_organization_competitors_org_name_idx
  on public.growth_intelligence_organization_competitors (organization_id, normalized_name);

create index if not exists growth_intelligence_organization_competitors_org_idx
  on public.growth_intelligence_organization_competitors (organization_id);

alter table public.growth_intelligence_organization_competitors enable row level security;
alter table public.growth_intelligence_organization_competitors force row level security;

drop policy if exists "members with Growth Intelligence read organization competitors"
  on public.growth_intelligence_organization_competitors;
create policy "members with Growth Intelligence read organization competitors"
  on public.growth_intelligence_organization_competitors
  for select to authenticated
  using (private.has_organization_permission(organization_id, 'growth_intelligence.read'));

drop policy if exists "members with Growth Intelligence insert organization competitors"
  on public.growth_intelligence_organization_competitors;
create policy "members with Growth Intelligence insert organization competitors"
  on public.growth_intelligence_organization_competitors
  for insert to authenticated
  with check (private.has_organization_permission(organization_id, 'growth_intelligence.manage'));

drop policy if exists "members with Growth Intelligence update organization competitors"
  on public.growth_intelligence_organization_competitors;
create policy "members with Growth Intelligence update organization competitors"
  on public.growth_intelligence_organization_competitors
  for update to authenticated
  using (private.has_organization_permission(organization_id, 'growth_intelligence.manage'))
  with check (private.has_organization_permission(organization_id, 'growth_intelligence.manage'));

drop policy if exists "members with Growth Intelligence delete organization competitors"
  on public.growth_intelligence_organization_competitors;
create policy "members with Growth Intelligence delete organization competitors"
  on public.growth_intelligence_organization_competitors
  for delete to authenticated
  using (private.has_organization_permission(organization_id, 'growth_intelligence.manage'));

grant select on table public.growth_intelligence_organization_competitors to authenticated;
grant insert, update, delete on table public.growth_intelligence_organization_competitors to authenticated;
grant select on table public.growth_intelligence_organization_competitors to service_role;
