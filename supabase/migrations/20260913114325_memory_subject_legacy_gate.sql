-- Subject drafting on the governed context port: legacy-corpus gate.
--
-- Spec 023 requires new AI consumers to exclude the unqualified legacy corpus.
-- Until now no layer enforced it: the search RPC, the selection code, and the
-- manifest finalization RPC all read legacy rows when asked. This slice gates
-- it at the search boundary, tenant-first inside `filtered` like every other
-- predicate, defaulting to EXCLUDE:
--
-- - `search_memory_items` gains `p_include_legacy` (default false). The
--   default is the secure one: a caller that never heard of the flag cannot
--   inherit the legacy corpus. The organization workspace passes true
--   explicitly; it remains the one surface that shows pre-shared-context rows.
-- - The signature change (14 to 15 arguments) cannot travel by
--   CREATE OR REPLACE, which forbids argument-list changes, so the old shape
--   is dropped first in the same transaction. All live callers use named or
--   short positional arguments with defaults, so nothing else changes.
-- - `read_subject_context_gate` gives the authenticated subject path one
--   member-checked read of the flags it must honor (subject purpose enabled,
--   legacy qualification, policy version). No table grant; service_role has no
--   use for it and is revoked.
--
-- The three SET clauses on the search function are restated because
-- CREATE OR REPLACE FUNCTION replaces the whole definition including its
-- configuration (learned 2026-08-09 with hnsw recall).
--
-- v_ prefixes every plpgsql local; empty search_path; fully qualified
-- objects; bare coalesce (syntax, never schema-qualified).

drop function if exists public.search_memory_items(
  uuid, text, extensions.vector(1536), uuid, text[], text[], integer, boolean, boolean,
  real, real, integer, integer
);

create or replace function public.search_memory_items(
  p_organization_id uuid,
  p_query text,
  p_query_embedding extensions.vector(1536) default null,
  p_branch_id uuid default null,
  p_memory_types text[] default null,
  p_sensitivities text[] default array['public', 'internal'],
  p_max_age_days integer default null,
  p_include_superseded boolean default false,
  p_include_expired boolean default false,
  p_lexical_weight real default 0.5,
  p_semantic_weight real default 0.5,
  p_limit integer default 20,
  p_candidate_limit integer default 200,
  p_include_legacy boolean default false
)
returns table (
  id uuid,
  memory_type text,
  title text,
  body text,
  structured_value jsonb,
  origin text,
  source_tier smallint,
  source_system text,
  source_reference text,
  verification_state text,
  verified_at timestamptz,
  confidence numeric,
  sensitivity text,
  observed_at timestamptz,
  effective_from timestamptz,
  effective_to timestamptz,
  superseded_by_id uuid,
  trust_rank smallint,
  freshness text,
  lexical real,
  semantic real,
  blended real
)
language sql
stable
security invoker
set search_path = ''
set hnsw.iterative_scan = 'relaxed_order'
set hnsw.ef_search = 200
as $$
  with search_query as (
    select
      case
        when pg_catalog.cardinality(lexemes.terms) = 0 then null
        else pg_catalog.to_tsquery('english', pg_catalog.array_to_string(lexemes.terms, ' | '))
      end as query
    from (
      select pg_catalog.tsvector_to_array(
        pg_catalog.to_tsvector('english', coalesce(p_query, ''))
      ) as terms
    ) as lexemes
  ),
  filtered as not materialized (
    select item.*
    from public.memory_items item
    where item.organization_id = p_organization_id
      and (p_branch_id is null or item.branch_id = p_branch_id)
      and (p_memory_types is null or item.memory_type = any(p_memory_types))
      and (p_include_legacy or item.knowledge_kind <> 'legacy')
      and item.sensitivity = any(p_sensitivities)
      and item.verification_state not in ('proposed', 'rejected')
      and (p_include_superseded or item.superseded_by_id is null)
      and (
        p_include_expired
        or (
          (item.expires_at is null or item.expires_at >= pg_catalog.now())
          and (item.effective_to is null or item.effective_to >= pg_catalog.now())
        )
      )
      and (
        p_max_age_days is null
        or coalesce(item.observed_at, item.created_at)
          >= pg_catalog.now() - pg_catalog.make_interval(days => p_max_age_days)
      )
  ),
  lexical_candidates as (
    select
      filtered.id,
      pg_catalog.ts_rank_cd(filtered.search_vector, search_query.query, 32) as score
    from filtered, search_query
    where search_query.query is not null
      and filtered.search_vector @@ search_query.query
    order by score desc
    limit p_candidate_limit
  ),
  semantic_candidates as (
    select
      filtered.id,
      (1 - (filtered.embedding operator(extensions.<=>) p_query_embedding))::real as score
    from filtered
    where p_query_embedding is not null
      and filtered.embedding is not null
    order by filtered.embedding operator(extensions.<=>) p_query_embedding
    limit p_candidate_limit
  ),
  candidates as (
    select
      coalesce(lexical_candidates.id, semantic_candidates.id) as id,
      coalesce(lexical_candidates.score, 0)::real as lexical,
      coalesce(semantic_candidates.score, 0)::real as semantic
    from lexical_candidates
    full outer join semantic_candidates on semantic_candidates.id = lexical_candidates.id
  ),
  scored as (
    select
      item.id,
      item.memory_type,
      item.title,
      item.body,
      item.structured_value,
      item.origin,
      (case
        when item.origin = 'provider_imported'
          and item.verification_state <> 'verified'
          and item.review_due_at is not null
          and item.review_due_at < pg_catalog.now()
        then 4
        else item.source_tier
      end)::smallint as source_tier,
      item.source_system,
      item.source_reference,
      item.verification_state,
      item.verified_at,
      item.confidence,
      item.sensitivity,
      item.observed_at,
      item.effective_from,
      item.effective_to,
      item.superseded_by_id,
      item.review_due_at,
      item.expires_at,
      candidates.lexical,
      candidates.semantic
    from candidates
    join filtered item on item.id = candidates.id
  )
  select
    scored.id,
    scored.memory_type,
    scored.title,
    scored.body,
    scored.structured_value,
    scored.origin,
    scored.source_tier,
    scored.source_system,
    scored.source_reference,
    scored.verification_state,
    scored.verified_at,
    scored.confidence,
    scored.sensitivity,
    scored.observed_at,
    scored.effective_from,
    scored.effective_to,
    scored.superseded_by_id,
    (case
      when scored.verification_state in ('proposed', 'rejected') then 4
      when scored.verification_state = 'verified' and scored.source_tier = 1 then 0
      when scored.verification_state = 'verified' then 1
      when scored.source_tier = 1 then 1
      when scored.source_tier = 2 then 2
      when scored.source_tier in (3, 4) then 3
      else 4
    end)::smallint as trust_rank,
    (case
      when (scored.expires_at is not null and scored.expires_at < pg_catalog.now())
        or (scored.effective_to is not null and scored.effective_to < pg_catalog.now())
        then 'expired'
      when scored.superseded_by_id is not null then 'superseded'
      when scored.review_due_at is not null and scored.review_due_at < pg_catalog.now()
        then 'stale'
      when scored.review_due_at is not null
        and scored.review_due_at <= pg_catalog.now() + pg_catalog.make_interval(days => 7)
        then 'aging'
      else 'fresh'
    end) as freshness,
    scored.lexical,
    scored.semantic,
    (p_lexical_weight * scored.lexical + p_semantic_weight * scored.semantic)::real as blended
  from scored
  order by
    trust_rank asc,
    blended desc,
    scored.observed_at desc nulls last,
    scored.id asc
  limit least(coalesce(p_limit, 20), 50);
$$;

revoke all on function public.search_memory_items(
  uuid, text, extensions.vector(1536), uuid, text[], text[], integer, boolean, boolean,
  real, real, integer, integer, boolean
) from public, anon;

grant execute on function public.search_memory_items(
  uuid, text, extensions.vector(1536), uuid, text[], text[], integer, boolean, boolean,
  real, real, integer, integer, boolean
) to authenticated;

-- Member-checked flag read for the authenticated subject path -----------------

create function public.read_subject_context_gate(
  p_organization_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.memory_integration_settings;
begin
  if p_organization_id is null then
    raise exception 'subject context gate input is invalid' using errcode = '22023';
  end if;

  if (select auth.uid()) is null
    or not private.has_organization_permission(p_organization_id, 'memory.read') then
    raise exception 'subject context gate is not authorized' using errcode = '42501';
  end if;

  select settings_row.* into v_settings
  from public.memory_integration_settings settings_row
  where settings_row.organization_id = p_organization_id;

  if not found then
    return pg_catalog.jsonb_build_object(
      'subjectEnabled', false,
      'legacyQualified', false,
      'policyVersion', 'shared-context-v1'
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'subjectEnabled', v_settings.subject_context_enabled,
    'legacyQualified', v_settings.legacy_corpus_qualified,
    'policyVersion', v_settings.context_policy_version
  );
end;
$$;

revoke all on function public.read_subject_context_gate(uuid)
  from public, anon, service_role;
grant execute on function public.read_subject_context_gate(uuid) to authenticated;
