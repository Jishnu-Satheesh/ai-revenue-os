-- Swarm 3: per-item memory context associations.
--
-- Each synthesized item records the governed memory manifests it was built
-- with, by reference only (manifest id + digest + purpose/kind). Research
-- briefs (growth_research/brief) stay distinguishable from synthesis packs
-- (growth_synthesis/synthesis) for operators. No private bytes live here:
-- summaries stay in memory_context_entries; this table carries identity.
--
-- Memory never changes priority or eligibility: associations are recorded
-- after deterministic admission/persistence, never read back into ranking.
-- Claim/finding ids stay in their evidence link tables, never here.
--
-- RLS forced, fully revoked, no grants: reads go through the service_role
-- fenced path and org-scoped API routes, never direct client sessions.

create table public.growth_intelligence_item_contexts (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  growth_intelligence_item_id uuid not null,
  manifest_id uuid not null,
  context_digest text not null check (context_digest ~ '^[0-9a-f]{64}$'),
  purpose text not null check (purpose in ('growth_research', 'growth_synthesis')),
  kind text not null check (kind in ('brief', 'synthesis')),
  created_at timestamptz not null default pg_catalog.now(),
  primary key (organization_id, growth_intelligence_item_id, manifest_id),
  constraint growth_intelligence_item_contexts_item_fk
    foreign key (organization_id, growth_intelligence_item_id)
    references public.growth_intelligence_items (organization_id, id) on delete cascade,
  constraint growth_intelligence_item_contexts_manifest_fk
    foreign key (organization_id, manifest_id)
    references public.memory_context_manifests (organization_id, id) on delete restrict,
  constraint growth_intelligence_item_contexts_kind_purpose check (
    (kind = 'brief' and purpose = 'growth_research')
    or (kind = 'synthesis' and purpose = 'growth_synthesis')
  )
);

create index growth_intelligence_item_contexts_item_idx
  on public.growth_intelligence_item_contexts (organization_id, growth_intelligence_item_id);
create index growth_intelligence_item_contexts_manifest_idx
  on public.growth_intelligence_item_contexts (organization_id, manifest_id);

alter table public.growth_intelligence_item_contexts enable row level security;
alter table public.growth_intelligence_item_contexts force row level security;
revoke all on table public.growth_intelligence_item_contexts from public, anon, authenticated, service_role;
