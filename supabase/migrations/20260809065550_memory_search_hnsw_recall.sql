-- Fix filtered HNSW recall in public.search_memory_items.
--
-- Measured against a 1430-item seeded corpus, the default settings returned
-- 1 of the 20 true nearest neighbours for a normal operator query: 5% recall.
--
-- The cause is post-filtering. An HNSW scan walks roughly `hnsw.ef_search`
-- (default 40) globally nearest candidates and only then applies the query's
-- WHERE clause. Business Memory's retrieval filter is not incidental — it drops
-- customer_content the caller may not read, proposed items, superseded items,
-- and expired items, which together are close to half a realistic corpus. Very
-- few of the 40 global candidates survive it, so the semantic half of hybrid
-- retrieval silently returned almost nothing.
--
-- This was invisible before the corpus existed: on a small table Postgres
-- sequential-scans and returns exact results regardless of index settings.
--
-- pgvector 0.8.0 added iterative index scans for exactly this case. With
-- `relaxed_order` the scan continues fetching batches until enough rows pass
-- the filter or `hnsw.max_scan_tuples` is reached. Relaxed rather than strict
-- ordering is correct here because the function re-sorts every candidate by
-- trust rank and then blended relevance anyway, so approximate ordering coming
-- out of the vector scan is discarded.
--
-- Both settings are attached to the function rather than the database so they
-- apply exactly where the filtered vector search happens, and no other query
-- inherits a larger scan budget.

alter function public.search_memory_items(
  uuid, text, extensions.vector, uuid, text[], text[], integer, boolean, boolean,
  real, real, integer, integer
) set hnsw.iterative_scan = 'relaxed_order';

alter function public.search_memory_items(
  uuid, text, extensions.vector, uuid, text[], text[], integer, boolean, boolean,
  real, real, integer, integer
) set hnsw.ef_search = 200;
