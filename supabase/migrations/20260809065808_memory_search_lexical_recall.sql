-- Widen the lexical half of hybrid retrieval from AND to OR over lexemes.
--
-- Measured against the seeded 1430-item corpus:
--
--   "biryani margin discount talabat"  AND 1 row    OR 202 rows
--   "packaging leaked delivery"        AND 1 row    OR  15 rows
--   "contribution margin floor"        AND 30 rows  OR  76 rows
--
-- `websearch_to_tsquery` joins every term with AND, so a natural operator
-- question of four words only matches a document containing all four. On a real
-- corpus that reduces the lexical half of hybrid retrieval to almost nothing,
-- which in turn makes the blended score effectively semantic-only.
--
-- Precision belongs in the ranking, not in the filter: candidates are ordered by
-- `ts_rank_cd`, capped at `p_candidate_limit`, and then re-sorted by trust rank
-- and blended relevance. A document matching one weak term ranks last rather
-- than being excluded outright.
--
-- The query is turned into lexemes by `to_tsvector` before being rebuilt as an
-- OR'd `tsquery`, so the input is normalised and stemmed by Postgres and never
-- interpolated as raw text.
--
-- The three SET clauses are restated because CREATE OR REPLACE FUNCTION
-- replaces the whole definition, including its configuration. Dropping them
-- here would silently undo 20260809065550 and return filtered HNSW recall to
-- 5%.

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
