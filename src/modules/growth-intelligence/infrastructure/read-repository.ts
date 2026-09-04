import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { DomainError } from "@/lib/errors";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Session-bound Market Watch reads.
 *
 * Every query carries the organization scope to the signed-in client, so
 * organization isolation stays with RLS and this layer only shapes rows.
 * Pagination uses newest-first keyset cursors; batched link, source, and
 * event reads are skipped entirely when there is nothing to resolve, keeping
 * empty watches to exactly one round trip.
 */

type QueryBuilder<T> = PromiseLike<{ data: T; error: unknown }> & {
  select(columns: string): QueryBuilder<T>;
  eq(column: string, value: unknown): QueryBuilder<T>;
  in(column: string, values: readonly unknown[]): QueryBuilder<T>;
  or(filters: string): QueryBuilder<T>;
  order(column: string, options?: { ascending?: boolean }): QueryBuilder<T>;
  limit(count: number): QueryBuilder<T>;
  maybeSingle(): PromiseLike<{ data: T; error: unknown }>;
};

export type MarketWatchPersistence = {
  from(table: string): QueryBuilder<unknown>;
};

type DatabaseClient = SupabaseClient<Database> | MarketWatchPersistence;

const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;

const cursorSchema = z
  .object({ createdAt: z.string().datetime({ offset: true }), id: z.string().uuid() })
  .strict();

export type ClaimCursor = z.infer<typeof cursorSchema>;

export function encodeClaimCursor(cursor: ClaimCursor): string {
  // Total by construction: the ClaimCursor type (strict schema inference) guards the
  // single internal call site at compile time, while decodeClaimCursor safe-parses the
  // untrusted client-supplied cursor. Validating here would make encode partial for no
  // boundary benefit — garbage in still decodes to null.
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeClaimCursor(value: string | null | undefined): ClaimCursor | null {
  if (!value) return null;
  try {
    const parsed = cursorSchema.safeParse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export type MarketWatchClaimRow = {
  id: string;
  runId: string;
  profileVersionId: string;
  key: string;
  digest: string;
  subjectKind: string;
  subjectRef: string;
  claimKind: string;
  paraphrase: string;
  quotation: string | null;
  geographicLayer: string;
  geographyRef: string;
  claimCategory: string;
  freshnessClass: string;
  publishedAt: string | null;
  observedAt: string | null;
  staleAt: string;
  expiresAt: string;
  limitations: string[];
};

export type MarketWatchSourceRow = {
  id: string;
  runId: string;
  profileVersionId: string;
  key: string;
  url: string;
  domain: string;
  publisher: string | null;
  sourceClass: string;
  availability: string;
  contentDigest: string | null;
  safeFailureCode: string | null;
  retrievedAt: string;
  publishedAt: string | null;
  observedAt: string | null;
};

export type MarketWatchLinkRow = {
  claimId: string;
  sourceId: string | null;
  relatedClaimId: string | null;
  relation: "supports" | "corroborates" | "contradicts";
};

export type MarketWatchEventRow = {
  claimId: string;
  eventType: "observed" | "expired" | "withdrawn" | "excluded" | "corrected" | "superseded";
  occurredAt: string;
};

export type MarketWatchRequestRow = {
  id: string;
  kind: string;
  triggerReason: string;
  status: string;
  dueAt: string;
  safeFailureCode: string | null;
  correlationId: string;
  attemptCount: number;
  maxAttempts: number;
};

export type GrowthIntelligenceReadRepository = {
  listClaimPage(input: {
    organizationId: string;
    profileVersionId: string;
    limit: number;
    cursor?: string | null;
  }): Promise<{ claims: MarketWatchClaimRow[]; nextCursor: string | null }>;
  listSourcesByRuns(input: {
    organizationId: string;
    runIds: readonly string[];
  }): Promise<MarketWatchSourceRow[]>;
  listLinksByClaims(input: {
    organizationId: string;
    claimIds: readonly string[];
  }): Promise<MarketWatchLinkRow[]>;
  listEventsByClaims(input: {
    organizationId: string;
    claimIds: readonly string[];
  }): Promise<MarketWatchEventRow[]>;
  listRequests(input: { organizationId: string; limit: number }): Promise<MarketWatchRequestRow[]>;
  readRequest(input: {
    organizationId: string;
    requestId: string;
  }): Promise<MarketWatchRequestRow | null>;
};

function query<T>(persistence: MarketWatchPersistence, table: string): QueryBuilder<T> {
  return persistence.from(table) as QueryBuilder<T>;
}

function readFailure(): never {
  throw new DomainError("DOMAIN_ERROR", "Market evidence could not be loaded.");
}

function clampLimit(limit: number): number {
  if (!Number.isInteger(limit)) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(limit, 1), MAX_PAGE_SIZE);
}

function mapClaim(row: Record<string, unknown>): MarketWatchClaimRow {
  return {
    id: String(row.id),
    runId: String(row.market_research_run_id),
    profileVersionId: String(row.market_profile_version_id),
    key: String(row.claim_key),
    digest: String(row.claim_digest),
    subjectKind: String(row.subject_kind),
    subjectRef: String(row.subject_ref),
    claimKind: String(row.claim_kind),
    paraphrase: String(row.paraphrase),
    quotation: row.quotation === null ? null : String(row.quotation),
    geographicLayer: String(row.geographic_layer),
    geographyRef: String(row.geography_ref),
    claimCategory: String(row.claim_category),
    freshnessClass: String(row.freshness_class),
    publishedAt: row.published_at === null ? null : String(row.published_at),
    observedAt: row.observed_at === null ? null : String(row.observed_at),
    staleAt: String(row.stale_at),
    expiresAt: String(row.expires_at),
    limitations: Array.isArray(row.limitations) ? row.limitations.map(String) : [],
  };
}

export function createAuthenticatedGrowthIntelligenceReadRepository(
  client: DatabaseClient,
): GrowthIntelligenceReadRepository {
  const persistence = client as unknown as MarketWatchPersistence;

  return {
    async listClaimPage(input) {
      const limit = clampLimit(input.limit);
      const cursor = decodeClaimCursor(input.cursor ?? null);
      if (input.cursor && !cursor) {
        throw new DomainError("DOMAIN_ERROR", "The pagination cursor is not usable.");
      }
      let builder = query<Record<string, unknown>[]>(persistence, "market_evidence_claims")
        .select(
          "id,market_research_run_id,market_profile_version_id,claim_key,claim_digest,subject_kind,subject_ref,claim_kind,paraphrase,quotation,geographic_layer,geography_ref,claim_category,freshness_class,published_at,observed_at,stale_at,expires_at,limitations,created_at",
        )
        .eq("organization_id", input.organizationId)
        .eq("market_profile_version_id", input.profileVersionId);
      if (cursor) {
        builder = builder.or(
          `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
        );
      }
      const result = await builder
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit + 1);
      if (result.error) readFailure();
      const rows = (result.data ?? []).map(mapClaim);
      const page = rows.slice(0, limit);
      // A full page may hide more rows; the next page proves the end by
      // returning short. The over-fetched row is never rendered.
      const nextCursor =
        page.length === limit
          ? encodeClaimCursor({
              createdAt: (result.data as Record<string, unknown>[])[page.length - 1]!
                .created_at as string,
              id: page[page.length - 1]!.id,
            })
          : null;
      return { claims: page, nextCursor };
    },

    async listSourcesByRuns(input) {
      if (input.runIds.length === 0) return [];
      const result = await query<Record<string, unknown>[]>(persistence, "market_evidence_sources")
        .select(
          "id,market_research_run_id,market_profile_version_id,source_key,source_url,source_domain,publisher,source_class,availability,source_content_digest,safe_failure_code,retrieved_at,published_at,observed_at",
        )
        .eq("organization_id", input.organizationId)
        .in("market_research_run_id", input.runIds);
      if (result.error) readFailure();
      return (result.data ?? []).map((row) => ({
        id: String(row.id),
        runId: String(row.market_research_run_id),
        profileVersionId: String(row.market_profile_version_id),
        key: String(row.source_key),
        url: String(row.source_url),
        domain: String(row.source_domain),
        publisher: row.publisher === null ? null : String(row.publisher),
        sourceClass: String(row.source_class),
        availability: String(row.availability),
        contentDigest:
          row.source_content_digest === null ? null : String(row.source_content_digest),
        safeFailureCode: row.safe_failure_code === null ? null : String(row.safe_failure_code),
        retrievedAt: String(row.retrieved_at),
        publishedAt: row.published_at === null ? null : String(row.published_at),
        observedAt: row.observed_at === null ? null : String(row.observed_at),
      }));
    },

    async listLinksByClaims(input) {
      if (input.claimIds.length === 0) return [];
      const result = await query<Record<string, unknown>[]>(persistence, "market_evidence_links")
        .select(
          "market_evidence_claim_id,market_evidence_source_id,related_market_evidence_claim_id,relation",
        )
        .eq("organization_id", input.organizationId)
        .in("market_evidence_claim_id", input.claimIds);
      if (result.error) readFailure();
      return (result.data ?? []).map((row) => ({
        claimId: String(row.market_evidence_claim_id),
        sourceId:
          row.market_evidence_source_id === null ? null : String(row.market_evidence_source_id),
        relatedClaimId:
          row.related_market_evidence_claim_id === null
            ? null
            : String(row.related_market_evidence_claim_id),
        relation: row.relation as "supports" | "corroborates" | "contradicts",
      }));
    },

    async listEventsByClaims(input) {
      if (input.claimIds.length === 0) return [];
      const result = await query<Record<string, unknown>[]>(
        persistence,
        "market_evidence_claim_events",
      )
        .select("market_evidence_claim_id,event_type,occurred_at")
        .eq("organization_id", input.organizationId)
        .in("market_evidence_claim_id", input.claimIds);
      if (result.error) readFailure();
      return (result.data ?? []).map((row) => ({
        claimId: String(row.market_evidence_claim_id),
        eventType: row.event_type as MarketWatchEventRow["eventType"],
        occurredAt: String(row.occurred_at),
      }));
    },

    async listRequests(input) {
      const result = await query<Record<string, unknown>[]>(
        persistence,
        "growth_intelligence_requests",
      )
        .select(
          "id,kind,trigger_reason,status,due_at,safe_failure_code,correlation_id,attempt_count,max_attempts",
        )
        .eq("organization_id", input.organizationId)
        .order("created_at", { ascending: false })
        .limit(clampLimit(input.limit));
      if (result.error) readFailure();
      return (result.data ?? []).map(mapRequest);
    },

    async readRequest(input) {
      const result = await query<Record<string, unknown> | null>(
        persistence,
        "growth_intelligence_requests",
      )
        .select(
          "id,kind,trigger_reason,status,due_at,safe_failure_code,correlation_id,attempt_count,max_attempts",
        )
        .eq("organization_id", input.organizationId)
        .eq("id", input.requestId)
        .maybeSingle();
      if (result.error) readFailure();
      if (!result.data) return null;
      return mapRequest(result.data);
    },
  };
}

function mapRequest(row: Record<string, unknown>): MarketWatchRequestRow {
  return {
    id: String(row.id),
    kind: String(row.kind),
    triggerReason: String(row.trigger_reason),
    status: String(row.status),
    dueAt: String(row.due_at),
    safeFailureCode: row.safe_failure_code === null ? null : String(row.safe_failure_code),
    correlationId: String(row.correlation_id),
    attemptCount: Number(row.attempt_count),
    maxAttempts: Number(row.max_attempts),
  };
}
