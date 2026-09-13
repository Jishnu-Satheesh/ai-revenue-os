-- Spec 023/024 release 1 close (swarm 1): per-attempt channel provenance.
--
-- Capture, channel adapters, dispatch, manifests/assembly RPCs, and narration
-- share-mode plumbing are live. This slice pins what the narrator actually
-- used: one row per filed recommendation binding it to the exact context
-- manifest whose entries were placed in its prompt, with the provided-vs-cited
-- split the drawer renders. Writes are worker-only through the record RPC
-- below; reads ride the existing member select path (report.read), so the
-- drawer never needs a privileged id.
--
-- Digest canonicalization, safe summaries, budgets, revalidation, and consume
-- binding stay owned by the `business_memory_context_manifests` migration and
-- its RPCs. Nothing here recomputes a summary or a digest: the record RPC only
-- checks that every provided ref is pinned under the manifest and every cited
-- ref was provided. A narration that ran evidence-only (memory unavailable,
-- disabled, or empty) records no row at all rather than a row claiming
-- untracked context use.

-- Provenance ------------------------------------------------------------------

create table public.channel_recommendation_contexts (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recommendation_id uuid not null,
  manifest_id uuid not null,
  share_mode text not null check (share_mode in ('internal_only', 'grounded_share')),
  provided_refs text[] not null default '{}' check (
    pg_catalog.array_position(provided_refs, null) is null
    and pg_catalog.cardinality(provided_refs) <= 24
  ),
  cited_refs text[] not null default '{}' check (
    pg_catalog.array_position(cited_refs, null) is null
    and pg_catalog.cardinality(cited_refs) <= 24
  ),
  created_at timestamptz not null default now(),
  primary key (organization_id, recommendation_id),
  constraint channel_recommendation_contexts_recommendation_fk
    foreign key (organization_id, recommendation_id)
    references public.channel_recommendations (organization_id, id) on delete cascade,
  constraint channel_recommendation_contexts_manifest_fk
    foreign key (organization_id, manifest_id)
    references public.memory_context_manifests (organization_id, id) on delete restrict
);

comment on table public.channel_recommendation_contexts is
  'Per-recommendation context provenance: the exact manifest whose entries were placed in the prompt, with provided-vs-cited refs. Worker-written only; never by a session.';
comment on column public.channel_recommendation_contexts.provided_refs is
  'Every context_ref placed in the prompt shared block. Empty only when share_mode is internal_only.';
comment on column public.channel_recommendation_contexts.cited_refs is
  'Subset of provided_refs the answer actually rests on. Shared entries are never finding evidence; this names which provided entries informed wording.';

create index channel_recommendation_contexts_manifest
  on public.channel_recommendation_contexts (organization_id, manifest_id);
create index channel_recommendation_contexts_org_time
  on public.channel_recommendation_contexts (organization_id, created_at desc);

alter table public.channel_recommendation_contexts enable row level security;
alter table public.channel_recommendation_contexts force row level security;
revoke all on table public.channel_recommendation_contexts from public, anon, authenticated;

create policy "members with report read can view channel recommendation contexts"
on public.channel_recommendation_contexts for select to authenticated
using (private.has_organization_permission(organization_id, 'report.read'));

grant select on table public.channel_recommendation_contexts to authenticated;

-- Immutability: provenance is written once by the worker and never edited -----

create or replace function private.prevent_channel_recommendation_context_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'channel recommendation context is immutable' using errcode = '23514';
end;
$$;

revoke all on function private.prevent_channel_recommendation_context_mutation() from public;

create trigger channel_recommendation_contexts_immutable
before update or delete on public.channel_recommendation_contexts
for each row execute function private.prevent_channel_recommendation_context_mutation();

-- Record: worker-only, tenant-scoped, ref-validated ----------------------------

create or replace function public.record_channel_recommendation_context(
  p_organization_id uuid,
  p_recommendation_id uuid,
  p_manifest_id uuid,
  p_share_mode text,
  p_provided_refs text[],
  p_cited_refs text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recommendation public.channel_recommendations;
  v_manifest public.memory_context_manifests;
  v_provided text[] := coalesce(p_provided_refs, '{}');
  v_cited text[] := coalesce(p_cited_refs, '{}');
  v_missing integer;
  v_outside integer;
  v_existing public.channel_recommendation_contexts;
begin
  if p_organization_id is null
    or p_recommendation_id is null
    or p_manifest_id is null
    or p_share_mode is null
    or p_share_mode not in ('internal_only', 'grounded_share')
    or pg_catalog.array_position(v_provided, null) is not null
    or pg_catalog.array_position(v_cited, null) is not null
    or pg_catalog.cardinality(v_provided) > 24
    or pg_catalog.cardinality(v_cited) > 24 then
    raise exception 'channel recommendation context input is invalid' using errcode = '23514';
  end if;

  if p_share_mode = 'internal_only' and pg_catalog.cardinality(v_provided) <> 0 then
    raise exception 'channel recommendation context input is invalid' using errcode = '23514';
  end if;

  select * into v_recommendation
  from public.channel_recommendations stored_recommendation
  where stored_recommendation.organization_id = p_organization_id
    and stored_recommendation.id = p_recommendation_id;

  if not found then
    raise exception 'channel recommendation was not found' using errcode = 'P0002';
  end if;

  select * into v_manifest
  from public.memory_context_manifests stored_manifest
  where stored_manifest.organization_id = p_organization_id
    and stored_manifest.id = p_manifest_id;

  if not found then
    raise exception 'memory context manifest was not found' using errcode = 'P0002';
  end if;

  -- The manifest must belong to the same analysis run the recommendation was
  -- filed for. A cross-run binding would let one run's advice claim another
  -- run's evidence, so it is refused as unauthorized rather than stored.
  if v_manifest.analysis_run_id is null
    or v_manifest.analysis_run_id is distinct from v_recommendation.analysis_run_id then
    raise exception 'channel recommendation context scope is not authorized' using errcode = '42501';
  end if;

  -- Every provided ref must be pinned under the manifest; anything else is a
  -- caller-invented ref and is refused, never stored.
  select pg_catalog.count(*) into v_missing
  from pg_catalog.unnest(v_provided) as provided_ref(value)
  where not exists (
    select 1
    from public.memory_context_entries pinned_entry
    where pinned_entry.organization_id = p_organization_id
      and pinned_entry.manifest_id = p_manifest_id
      and pinned_entry.context_ref = provided_ref.value
  );

  if v_missing > 0 then
    raise exception 'channel recommendation context refs are invalid' using errcode = '23514';
  end if;

  -- Cited refs name which provided entries informed wording; citing something
  -- never provided is refused, never stored.
  select pg_catalog.count(*) into v_outside
  from pg_catalog.unnest(v_cited) as cited_ref(value)
  where cited_ref.value <> all (v_provided);

  if v_outside > 0 then
    raise exception 'channel recommendation context refs are invalid' using errcode = '23514';
  end if;

  -- A same-recommendation retry replays the pinned row instead of minting a
  -- second provenance claim.
  select * into v_existing
  from public.channel_recommendation_contexts stored_context
  where stored_context.organization_id = p_organization_id
    and stored_context.recommendation_id = p_recommendation_id;

  if found then
    if v_existing.manifest_id = p_manifest_id
      and v_existing.share_mode = p_share_mode
      and v_existing.provided_refs = v_provided
      and v_existing.cited_refs = v_cited then
      return pg_catalog.jsonb_build_object(
        'recommendationId', v_existing.recommendation_id,
        'manifestId', v_existing.manifest_id,
        'shareMode', v_existing.share_mode,
        'providedCount', pg_catalog.cardinality(v_existing.provided_refs),
        'citedCount', pg_catalog.cardinality(v_existing.cited_refs),
        'replayed', true
      );
    end if;
    raise exception 'channel recommendation context already recorded' using errcode = '23505';
  end if;

  insert into public.channel_recommendation_contexts (
    organization_id, recommendation_id, manifest_id, share_mode, provided_refs, cited_refs
  ) values (
    p_organization_id, p_recommendation_id, p_manifest_id, p_share_mode, v_provided, v_cited
  );

  return pg_catalog.jsonb_build_object(
    'recommendationId', p_recommendation_id,
    'manifestId', p_manifest_id,
    'shareMode', p_share_mode,
    'providedCount', pg_catalog.cardinality(v_provided),
    'citedCount', pg_catalog.cardinality(v_cited),
    'replayed', false
  );
end;
$$;

revoke all on function public.record_channel_recommendation_context(uuid, uuid, uuid, text, text[], text[])
  from public, anon, authenticated;
grant execute on function public.record_channel_recommendation_context(uuid, uuid, uuid, text, text[], text[])
  to service_role;
revoke all on function public.record_channel_recommendation_context(uuid, uuid, uuid, text, text[], text[])
  from authenticated;
