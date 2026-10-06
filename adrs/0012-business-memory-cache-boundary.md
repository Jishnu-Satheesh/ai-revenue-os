# ADR 0012: Cache Business Memory rankings, never content, outside the RLS boundary

## Status

Accepted design; the Redis ranking cache is not wired into the inspected retrieval path as of 2026-09-10. Optional invalidation interfaces exist. The underlying Memory module is implemented separately; this cache status is not the status of Business Memory as a whole.

## Context

Business Memory retrieval is the most expensive read the platform performs. Each query embeds the query text through an external provider, probes an HNSW index, matches a GIN index, projects and merges `business_facts`, and ranks the union. Worker purposes repeat similar queries, and the workspace snapshot recomputes aggregates on every page load.

A Redis cache addresses that cost, but Redis sits outside Postgres. Row Level Security is the platform's only real enforcement of who may read which row, and AGENTS.md prohibits bypassing RLS in user-facing request paths. A cache that stores rows and returns them directly is a second read path with no tenancy enforcement at all — structurally the same defect as a service-role client in a request handler, arrived at through a performance argument instead of an authorization one.

Business Memory also has correctness rules that a naive cache silently violates. Superseded, rejected, and expired items must be excluded; freshness derives from wall-clock time; and the sensitivity ceiling differs per caller, so the same query text produces different legitimate results for an operator and an admin.

The feature already ships with no rollout flag, so a failing cache must not be able to take retrieval down with it.

## Decision

- Redis is a derived, disposable projection. Postgres remains the sole source of business state, and RLS remains the sole enforcement of visibility.
- **Cache the ranking, never the content.** Entries hold result identifiers and their scores. Rows are hydrated from Postgres by primary key under the caller's own RLS context on every hit.
- Never write item titles, bodies, structured values, query text, credentials, provider payloads, or reviewer names to Redis. Cacheable values are identifiers, scores, aggregate counts, and query embedding vectors.
- The effective sensitivity ceiling, branch scope, and filter set are all components of the cache key. A key identified only by organization and query text is a privilege-escalation defect.
- Invalidate by bumping a per-organization version stamp that is part of every key. Never scan or delete key ranges; `KEYS` and unbounded `SCAN` are prohibited.
- The version stamp is epoch milliseconds, not an incrementing counter. A missing stamp resolves to current server time, which is strictly greater than any previously used value, so an evicted stamp produces a miss instead of resurrecting entries. An `INCR` counter would reset to 1 after eviction and could collide with live keys.
- Every write path invalidates: creation, verification, rejection, supersession, proposal confirmation, fact promotion, ingestion projection, embedding completion, and the expiry sweep.
- Query embeddings are cached under a content hash rather than the text, are organization-independent because they are a pure function of model and input, and hold a vector and nothing else.
- Access is through a `MemoryCache` port. `REDIS_URL` is server-only and optional; its absence is a supported configuration in which every read runs directly against Postgres.
- Cache operations are bounded at 250 ms, never retried inside a request, and every failure mode degrades to a direct read. A cache write failure is logged and swallowed.
- A daily Trigger.dev task warms and repairs per-organization snapshot aggregates and recurring-purpose embeddings, staggered, lock-guarded, and bounded. It is explicitly not the invalidation mechanism.
- Cache state is not business state. No domain event is emitted for a cache write, hit, miss, or rebuild.

## Consequences

- A hit still costs one indexed Postgres read, so the win is smaller than a content cache would give. What it buys is that every exclusion rule and every RLS policy keeps applying on the hit path, and that customer content never leaves the database boundary.
- Staleness degrades gracefully in the one direction that matters. A stale ranking can only reference items that hydration then filters, so the failure mode is a shorter result list, never a leaked or resurrected one.
- Correctness no longer depends on invalidation being perfect, which is the property worth paying an indexed lookup for.
- Cold, warm, and absent caches must return identical results, and that equality is a test rather than an aspiration. It also means the cache can be flushed at any time, in any environment, with no coordination.
- Keying by sensitivity ceiling fragments the cache. An organization with mixed roles holds several entries for one query, and the hit rate is lower than a single-key design would show. That cost is accepted.
- The daily rebuild earns its cadence because freshness derives from wall-clock time, so aggregates rot with no write to invalidate them. Write-driven invalidation cannot catch the passage of midnight.
- The rebuild adds a scheduled job that touches every organization. It must stagger, cap concurrency, hold a per-organization lock, and survive a single-organization failure, or it becomes a nightly load spike against the same database the cache exists to protect.
- Warming embeddings costs real money per run. Only recurring worker purposes are warmed; arbitrary historical operator queries are not.
- Redis becomes a new operational dependency with its own availability, memory limits, and eviction policy, none of which can affect correctness by construction.
- The TCP-client adapter assumes a long-lived server runtime. A serverless deployment target requires swapping the adapter for an HTTP client, which the port confines to one file.

## References

- `specs/004-business-memory.md` section 12
- `adrs/0011-business-memory-read-through-facts.md`
- `AGENTS.md` sections 2 and 4
- `context/06-multi-tenancy-and-security.md`
- `context/17-observability-cost-governance.md`
