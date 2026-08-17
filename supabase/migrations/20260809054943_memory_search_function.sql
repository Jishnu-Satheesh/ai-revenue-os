-- Hybrid retrieval for Business Memory. See specs/004-business-memory.md section 9.
--
-- SECURITY INVOKER is load-bearing: the function runs under the caller's own
-- RLS context, so it can never answer a question the database would refuse.
-- The organization predicate is applied inside `filtered`, before any
-- similarity is computed, so the vector index is never searched across tenants.
--
-- `filtered` is NOT MATERIALIZED so Postgres inlines it into both candidate
-- branches and can still use the GIN and HNSW indexes. Materializing it would
-- silently turn every search into a sequential scan.

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
  p_candidate_limit integer default 200
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
as $$
  with filtered as not materialized (
    select item.*
    from public.memory_items item
    where item.organization_id = p_organization_id
      and (p_branch_id is null or item.branch_id = p_branch_id)
      and (p_memory_types is null or item.memory_type = any(p_memory_types))
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
    from filtered,
      pg_catalog.websearch_to_tsquery('english', coalesce(p_query, '')) as search_query(query)
    where p_query is not null
      and search_query.query is not null
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
      -- The stored tier omits the wall-clock demotion of provider data past its
      -- review date, because a stored value would go stale as the clock moves.
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
  uuid, text, extensions.vector, uuid, text[], text[], integer, boolean, boolean,
  real, real, integer, integer
) from public, anon;

grant execute on function public.search_memory_items(
  uuid, text, extensions.vector, uuid, text[], text[], integer, boolean, boolean,
  real, real, integer, integer
) to authenticated;
