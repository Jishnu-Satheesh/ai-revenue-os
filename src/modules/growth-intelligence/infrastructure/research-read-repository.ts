import "server-only";

import { z } from "zod";

import { RESEARCH_PIPELINE_STAGES } from "@/domain/growth-intelligence/research-pipeline";
import { DomainError } from "@/lib/errors";
import type { Database } from "@/lib/supabase/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildResearchPipelineView,
  clampActivityLimit,
  clampHistoryLimit,
  decodeResearchHistoryCursor,
  describeResearchActivityEvent,
  encodeResearchHistoryCursor,
  researchStatusPath,
  type ResearchActivityEvent,
  type ResearchItemProvenance,
  type ResearchPipelineRowInput,
  type ResearchPipelineView,
  type ResearchSourceRowInput,
} from "@/modules/growth-intelligence/application/research-read-model";

/**
 * Session-bound pipeline status, history and retry reads.
 *
 * Every query pins the organization id on the signed-in client, so tenant
 * isolation stays with RLS and this layer only shapes rows. History lookup
 * is display-only and separate from eligibility: old settings never become
 * current support, and a retained success never becomes the current
 * pipeline. Stored raw content (excerpts, quotations) is never selected.
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

export type ResearchReadPersistence = {
  from(table: string): QueryBuilder<unknown>;
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

type DatabaseClient = SupabaseClient<Database> | ResearchReadPersistence;

const ACTIVE_PIPELINE_STAGES = ["queued", "researching", "preparing_insights"];
const SUCCESS_PIPELINE_STAGES = ["ready", "partial"];

const pipelineRowSchema = z
  .object({
    id: z.string().uuid(),
    organization_id: z.string().uuid(),
    branch_id: z.string().uuid(),
    market_profile_id: z.string().uuid(),
    market_profile_version_id: z.string().uuid(),
    research_request_id: z.string().uuid().nullable(),
    synthesis_request_id: z.string().uuid().nullable(),
    stage: z.enum(RESEARCH_PIPELINE_STAGES),
    coverage: z.unknown(),
    stage_changed_at: z.string().datetime({ offset: true }),
    safe_failure_code: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{2,80}$/)
      .nullable(),
    created_at: z.string().datetime({ offset: true }),
  })
  .strict()
  .passthrough();

type PipelineRow = z.infer<typeof pipelineRowSchema>;

const PIPELINE_COLUMNS =
  "id,organization_id,branch_id,market_profile_id,market_profile_version_id,research_request_id,synthesis_request_id,stage,coverage,stage_changed_at,safe_failure_code,created_at";

// Sources expose public metadata only: excerpts and quotations are never
// selected, so erased or unavailable rows cannot leak stored raw content.
const SOURCE_COLUMNS =
  "id,source_url,source_domain,publisher,source_class,availability,erased_at,retrieved_at,published_at,observed_at";

const CLAIM_ID_LIMIT = 1000;
const SOURCE_ROW_LIMIT = 200;

function query<T>(persistence: ResearchReadPersistence, table: string): QueryBuilder<T> {
  return persistence.from(table) as QueryBuilder<T>;
}

function readFailure(): never {
  throw new DomainError("DOMAIN_ERROR", "Market research status could not be loaded.");
}

function parsePipelineRow(row: unknown): PipelineRow {
  const parsed = pipelineRowSchema.safeParse(row);
  if (!parsed.success) readFailure();
  return parsed.data;
}

function mapSource(row: Record<string, unknown>): ResearchSourceRowInput {
  return {
    id: String(row.id),
    url: String(row.source_url),
    domain: String(row.source_domain),
    publisher: row.publisher === null ? null : String(row.publisher),
    sourceClass: String(row.source_class),
    availability: String(row.availability),
    erasedAt: row.erased_at === null ? null : String(row.erased_at),
    retrievedAt: String(row.retrieved_at),
    publishedAt: row.published_at === null ? null : String(row.published_at),
    observedAt: row.observed_at === null ? null : String(row.observed_at),
  };
}

export type ResearchReadRepository = {
  readPipeline(input: {
    organizationId: string;
    pipelineId: string;
  }): Promise<ResearchPipelineView | null>;
  /** The live pipeline only: terminal history never satisfies this read. */
  readCurrentPipeline(input: {
    organizationId: string;
    branchId: string;
  }): Promise<ResearchPipelineView | null>;
  listPipelineHistory(input: {
    organizationId: string;
    branchId: string;
    limit?: number;
    cursor?: string | null;
  }): Promise<{ pipelines: ResearchPipelineView[]; nextCursor: string | null }>;
  /**
   * Same-branch last success, independent of the profile's current version.
   * Display only: the view flags earlier settings via settingsMatchCurrent.
   */
  readLastSuccessfulPipeline(input: {
    organizationId: string;
    branchId: string;
    currentVersionId: string | null;
  }): Promise<ResearchPipelineView | null>;
  listItemProvenance(input: {
    organizationId: string;
    items: readonly { itemId: string; runId: string }[];
  }): Promise<Record<string, ResearchItemProvenance>>;
  listResearchActivity(input: {
    organizationId: string;
    branchId: string | null;
    limit?: number;
  }): Promise<ResearchActivityEvent[]>;
  retrySynthesis(input: {
    organizationId: string;
    pipelineId: string;
    actorId: string;
    idempotencyKey: string;
    correlationId: string;
  }): Promise<{ requestId: string; status: string; replayed: boolean }>;
};

export function createAuthenticatedResearchReadRepository(
  client: DatabaseClient,
): ResearchReadRepository {
  const persistence = client as unknown as ResearchReadPersistence;

  async function readBranchNames(input: {
    organizationId: string;
    branchIds: readonly string[];
  }): Promise<Map<string, string>> {
    const unique = [...new Set(input.branchIds)];
    if (unique.length === 0) return new Map();
    const result = await query<Record<string, unknown>[]>(persistence, "branches")
      .select("id,name")
      .eq("organization_id", input.organizationId)
      .in("id", unique);
    if (result.error) readFailure();
    const names = new Map<string, string>();
    for (const row of result.data ?? []) {
      if (typeof row.name === "string") names.set(String(row.id), row.name);
    }
    return names;
  }

  async function readVersionDocuments(input: {
    organizationId: string;
    versionIds: readonly string[];
  }): Promise<Map<string, unknown>> {
    const unique = [...new Set(input.versionIds)];
    if (unique.length === 0) return new Map();
    const versions = await query<Record<string, unknown>[]>(
      persistence,
      "organization_market_profile_versions",
    )
      .select("id,document")
      .eq("organization_id", input.organizationId)
      .in("id", unique);
    if (versions.error) readFailure();
    const documents = new Map<string, unknown>();
    for (const row of versions.data ?? []) {
      documents.set(String(row.id), row.document ?? null);
    }
    return documents;
  }

  async function readCurrentVersionIds(input: {
    organizationId: string;
    profileIds: readonly string[];
  }): Promise<Map<string, string | null>> {
    const unique = [...new Set(input.profileIds)];
    if (unique.length === 0) return new Map();
    const result = await query<Record<string, unknown>[]>(
      persistence,
      "organization_market_profiles",
    )
      .select("id,current_version_id")
      .eq("organization_id", input.organizationId)
      .in("id", unique);
    if (result.error) readFailure();
    const current = new Map<string, string | null>();
    for (const row of result.data ?? []) {
      current.set(
        String(row.id),
        row.current_version_id === null ? null : String(row.current_version_id),
      );
    }
    return current;
  }

  async function readRunIdsByRequest(input: {
    organizationId: string;
    requestIds: readonly string[];
  }): Promise<Map<string, string[]>> {
    const unique = [...new Set(input.requestIds.filter((id) => id.length > 0))];
    const byRequest = new Map<string, string[]>();
    if (unique.length === 0) return byRequest;
    const result = await query<Record<string, unknown>[]>(persistence, "market_research_runs")
      .select("id,growth_intelligence_request_id")
      .eq("organization_id", input.organizationId)
      .in("growth_intelligence_request_id", unique);
    if (result.error) readFailure();
    for (const row of result.data ?? []) {
      const requestId = String(row.growth_intelligence_request_id);
      const runIds = byRequest.get(requestId) ?? [];
      runIds.push(String(row.id));
      byRequest.set(requestId, runIds);
    }
    return byRequest;
  }

  async function readSourcesByRuns(input: {
    organizationId: string;
    runIds: readonly string[];
  }): Promise<Map<string, ResearchSourceRowInput[]>> {
    const unique = [...new Set(input.runIds)];
    const byRun = new Map<string, ResearchSourceRowInput[]>();
    if (unique.length === 0) return byRun;
    const result = await query<Record<string, unknown>[]>(persistence, "market_evidence_sources")
      .select(SOURCE_COLUMNS)
      .eq("organization_id", input.organizationId)
      .in("market_research_run_id", unique)
      .limit(SOURCE_ROW_LIMIT);
    if (result.error) readFailure();
    for (const row of result.data ?? []) {
      const runId = String(row.market_research_run_id);
      const sources = byRun.get(runId) ?? [];
      sources.push(mapSource(row));
      byRun.set(runId, sources);
    }
    return byRun;
  }

  async function countClaimsByRuns(input: {
    organizationId: string;
    runIds: readonly string[];
  }): Promise<Map<string, number>> {
    const unique = [...new Set(input.runIds)];
    const counts = new Map<string, number>();
    if (unique.length === 0) return counts;
    const result = await query<Record<string, unknown>[]>(persistence, "market_evidence_claims")
      .select("id,market_research_run_id")
      .eq("organization_id", input.organizationId)
      .in("market_research_run_id", unique)
      .limit(CLAIM_ID_LIMIT);
    if (result.error) readFailure();
    for (const row of result.data ?? []) {
      const runId = String(row.market_research_run_id);
      counts.set(runId, (counts.get(runId) ?? 0) + 1);
    }
    return counts;
  }

  async function assembleViews(rows: readonly PipelineRow[]): Promise<ResearchPipelineView[]> {
    if (rows.length === 0) return [];
    const organizationId = rows[0]!.organization_id;
    const [branchNames, documents, currentVersions] = await Promise.all([
      readBranchNames({ organizationId, branchIds: rows.map((row) => row.branch_id) }),
      readVersionDocuments({
        organizationId,
        versionIds: rows.map((row) => row.market_profile_version_id),
      }),
      readCurrentVersionIds({
        organizationId,
        profileIds: rows.map((row) => row.market_profile_id),
      }),
    ]);
    const requestIds = rows
      .map((row) => row.research_request_id)
      .filter((id): id is string => id !== null);
    const runIdsByRequest = await readRunIdsByRequest({ organizationId, requestIds });
    const allRunIds = [...new Set([...runIdsByRequest.values()].flat())];
    const [sourcesByRun, claimCounts] = await Promise.all([
      readSourcesByRuns({ organizationId, runIds: allRunIds }),
      countClaimsByRuns({ organizationId, runIds: allRunIds }),
    ]);
    return rows.map((row) => {
      const runIds = row.research_request_id
        ? (runIdsByRequest.get(row.research_request_id) ?? [])
        : [];
      const sources = runIds.flatMap((runId) => sourcesByRun.get(runId) ?? []);
      const claimCount = runIds.reduce((total, runId) => total + (claimCounts.get(runId) ?? 0), 0);
      const viewInput: ResearchPipelineRowInput = {
        pipelineId: row.id,
        organizationId: row.organization_id,
        branchId: row.branch_id,
        marketProfileId: row.market_profile_id,
        marketProfileVersionId: row.market_profile_version_id,
        researchRequestId: row.research_request_id,
        synthesisRequestId: row.synthesis_request_id,
        stage: row.stage,
        coverage: row.coverage,
        observedAt: row.created_at,
        stageChangedAt: row.stage_changed_at,
        safeFailureCode: row.safe_failure_code,
        branchName: branchNames.get(row.branch_id) ?? null,
        versionDocument: documents.get(row.market_profile_version_id) ?? null,
        currentVersionId: currentVersions.get(row.market_profile_id) ?? null,
        sources,
        claimCount,
      };
      return buildResearchPipelineView(viewInput);
    });
  }

  return {
    async readPipeline(input) {
      const result = await query<PipelineRow | null>(
        persistence,
        "growth_intelligence_research_pipelines",
      )
        .select(PIPELINE_COLUMNS)
        .eq("organization_id", input.organizationId)
        .eq("id", input.pipelineId)
        .maybeSingle();
      if (result.error) readFailure();
      if (!result.data) return null;
      const [view] = await assembleViews([parsePipelineRow(result.data)]);
      return view ?? null;
    },

    async readCurrentPipeline(input) {
      const result = await query<PipelineRow[]>(
        persistence,
        "growth_intelligence_research_pipelines",
      )
        .select(PIPELINE_COLUMNS)
        .eq("organization_id", input.organizationId)
        .eq("branch_id", input.branchId)
        .in("stage", ACTIVE_PIPELINE_STAGES)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(1);
      if (result.error) readFailure();
      const row = (result.data ?? [])[0] ?? null;
      if (!row) return null;
      const parsed = parsePipelineRow(row);
      if (!ACTIVE_PIPELINE_STAGES.includes(parsed.stage)) return null;
      const [view] = await assembleViews([parsed]);
      return view ?? null;
    },

    async listPipelineHistory(input) {
      const limit = clampHistoryLimit(input.limit);
      const cursor = decodeResearchHistoryCursor(input.cursor ?? null);
      if (input.cursor && !cursor) {
        throw new DomainError("DOMAIN_ERROR", "The pagination cursor is not usable.");
      }
      let builder = query<PipelineRow[]>(persistence, "growth_intelligence_research_pipelines")
        .select(PIPELINE_COLUMNS)
        .eq("organization_id", input.organizationId)
        .eq("branch_id", input.branchId);
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
      const rows = (result.data ?? []).map(parsePipelineRow);
      const page = rows.slice(0, limit);
      const views = await assembleViews(page);
      // A full page may hide more rows; the next page proves the end by
      // returning short. The over-fetched row is never rendered.
      const nextCursor =
        page.length === limit && rows.length > limit
          ? encodeResearchHistoryCursor({
              createdAt: page[page.length - 1]!.created_at,
              id: page[page.length - 1]!.id,
            })
          : null;
      return { pipelines: views, nextCursor };
    },

    async readLastSuccessfulPipeline(input) {
      const result = await query<PipelineRow[]>(
        persistence,
        "growth_intelligence_research_pipelines",
      )
        .select(PIPELINE_COLUMNS)
        .eq("organization_id", input.organizationId)
        .eq("branch_id", input.branchId)
        .in("stage", SUCCESS_PIPELINE_STAGES)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(1);
      if (result.error) readFailure();
      const row = (result.data ?? [])[0] ?? null;
      if (!row) return null;
      const parsed = parsePipelineRow(row);
      if (!SUCCESS_PIPELINE_STAGES.includes(parsed.stage)) return null;
      const [view] = await assembleViews([parsed]);
      return view ?? null;
    },

    async listItemProvenance(input) {
      if (input.items.length === 0) return {};
      const runIds = [...new Set(input.items.map((item) => item.runId))];
      const runs = await query<Record<string, unknown>[]>(
        persistence,
        "growth_intelligence_synthesis_runs",
      )
        .select("id,growth_intelligence_request_id")
        .eq("organization_id", input.organizationId)
        .in("id", runIds);
      if (runs.error) readFailure();
      const requestIds = [
        ...new Set((runs.data ?? []).map((row) => String(row.growth_intelligence_request_id))),
      ];
      if (requestIds.length === 0) return {};
      const requests = await query<Record<string, unknown>[]>(
        persistence,
        "growth_intelligence_requests",
      )
        .select("id,pipeline_id,phase")
        .eq("organization_id", input.organizationId)
        .in("id", requestIds);
      if (requests.error) readFailure();
      const pipelineIds = [
        ...new Set(
          (requests.data ?? [])
            .filter((row) => row.pipeline_id !== null && row.phase === "synthesis")
            .map((row) => String(row.pipeline_id)),
        ),
      ];
      if (pipelineIds.length === 0) return {};
      const pipelines = await query<PipelineRow[]>(
        persistence,
        "growth_intelligence_research_pipelines",
      )
        .select(PIPELINE_COLUMNS)
        .eq("organization_id", input.organizationId)
        .in("id", pipelineIds);
      if (pipelines.error) readFailure();
      const itemIds = input.items.map((item) => item.itemId);
      const links = await query<Record<string, unknown>[]>(
        persistence,
        "growth_intelligence_item_market_claims",
      )
        .select("growth_intelligence_item_id,market_evidence_claim_id")
        .eq("organization_id", input.organizationId)
        .in("growth_intelligence_item_id", itemIds);
      if (links.error) readFailure();

      const requestByRun = new Map(
        (runs.data ?? []).map((row) => [
          String(row.id),
          String(row.growth_intelligence_request_id),
        ]),
      );
      const pipelineByRequest = new Map(
        (requests.data ?? [])
          .filter((row) => row.pipeline_id !== null && row.phase === "synthesis")
          .map((row) => [String(row.id), String(row.pipeline_id)]),
      );
      const pipelineById = new Map((pipelines.data ?? []).map((row) => [String(row.id), row]));
      const claimsByItem = new Map<string, string[]>();
      for (const row of links.data ?? []) {
        const itemId = String(row.growth_intelligence_item_id);
        const claimIds = claimsByItem.get(itemId) ?? [];
        claimIds.push(String(row.market_evidence_claim_id));
        claimsByItem.set(itemId, claimIds);
      }

      const provenance: Record<string, ResearchItemProvenance> = {};
      for (const item of input.items) {
        const requestId = requestByRun.get(item.runId);
        const pipelineId = requestId ? pipelineByRequest.get(requestId) : undefined;
        const pipeline = pipelineId ? pipelineById.get(pipelineId) : undefined;
        if (!pipeline) continue;
        const stage = z.enum(RESEARCH_PIPELINE_STAGES).safeParse(pipeline.stage);
        if (!stage.success) continue;
        provenance[item.itemId] = {
          pipelineId: String(pipeline.id),
          branchId: String(pipeline.branch_id),
          stage: stage.data,
          statusPath: researchStatusPath(input.organizationId, String(pipeline.id)),
          supportingClaimIds: claimsByItem.get(item.itemId) ?? [],
        };
      }
      return provenance;
    },

    async listResearchActivity(input) {
      const limit = clampActivityLimit(input.limit);
      let builder = query<PipelineRow[]>(persistence, "growth_intelligence_research_pipelines")
        .select(PIPELINE_COLUMNS)
        .eq("organization_id", input.organizationId);
      if (input.branchId !== null) {
        builder = builder.eq("branch_id", input.branchId);
      }
      const result = await builder
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit);
      if (result.error) readFailure();
      const rows = (result.data ?? []).map(parsePipelineRow).slice(0, limit);
      if (rows.length === 0) return [];
      const branchNames = await readBranchNames({
        organizationId: input.organizationId,
        branchIds: rows.map((row) => row.branch_id),
      });
      const pipelineIds = rows.map((row) => row.id);
      const retries = await query<Record<string, unknown>[]>(persistence, "audit_events")
        .select("entity_id,occurred_at")
        .eq("organization_id", input.organizationId)
        .eq("entity_type", "growth_intelligence_research_pipeline")
        .eq("event_name", "growth_intelligence.research_retried")
        .in("entity_id", pipelineIds)
        .order("occurred_at", { ascending: false })
        .limit(limit);
      if (retries.error) readFailure();

      const events: ResearchActivityEvent[] = [];
      for (const row of rows) {
        const scopeLabel = branchNames.get(row.branch_id) ?? "Organization";
        events.push(
          describeResearchActivityEvent({
            kind: "started",
            pipelineId: row.id,
            branchId: row.branch_id,
            scopeLabel,
            stage: null,
            occurredAt: row.created_at,
          }),
        );
        if (!ACTIVE_PIPELINE_STAGES.includes(row.stage)) {
          events.push(
            describeResearchActivityEvent({
              kind: "finished",
              pipelineId: row.id,
              branchId: row.branch_id,
              scopeLabel,
              stage: row.stage,
              occurredAt: row.stage_changed_at,
            }),
          );
        }
      }
      for (const row of retries.data ?? []) {
        const pipeline = rows.find((candidate) => candidate.id === String(row.entity_id));
        if (!pipeline) continue;
        events.push(
          describeResearchActivityEvent({
            kind: "retried",
            pipelineId: pipeline.id,
            branchId: pipeline.branch_id,
            scopeLabel: branchNames.get(pipeline.branch_id) ?? "Organization",
            stage: pipeline.stage,
            occurredAt: String(row.occurred_at),
          }),
        );
      }
      events.sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
      return events.slice(0, limit);
    },

    async retrySynthesis(input) {
      const parsed = z
        .object({
          organizationId: z.string().uuid(),
          pipelineId: z.string().uuid(),
          actorId: z.string().uuid(),
          idempotencyKey: z.string().trim().min(16).max(200),
          correlationId: z.string().uuid(),
        })
        .strict()
        .safeParse(input);
      if (!parsed.success) {
        throw new DomainError("VALIDATION_ERROR", "The retry request could not be understood.");
      }
      let result: { data: unknown; error: unknown };
      try {
        result = await persistence.rpc("retry_market_research_synthesis", {
          p_organization_id: parsed.data.organizationId,
          p_pipeline_id: parsed.data.pipelineId,
          p_actor_id: parsed.data.actorId,
          p_idempotency_key: parsed.data.idempotencyKey,
          p_correlation_id: parsed.data.correlationId,
        });
      } catch {
        throw new DomainError("DOMAIN_ERROR", "The analysis could not be retried.");
      }
      if (result.error) throw mapRetryError(result.error);
      const outcome = z
        .object({
          requestId: z.string().uuid(),
          status: z.string(),
          replayed: z.boolean(),
        })
        .passthrough()
        .safeParse(result.data);
      if (!outcome.success) {
        throw new DomainError("DOMAIN_ERROR", "The analysis could not be retried.");
      }
      return {
        requestId: outcome.data.requestId,
        status: outcome.data.status,
        replayed: outcome.data.replayed,
      };
    },
  };
}

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "";
}

/**
 * Safe retry refusals: every branch names the operator's next step without
 * exposing pipeline existence, budget internals or evidence state.
 */
function mapRetryError(error: unknown): DomainError {
  const message = errorMessage(error);
  if (message.includes("growth_intelligence_retry_forbidden")) {
    return new DomainError(
      "AUTHORIZATION_ERROR",
      "You do not have permission to retry Market Intelligence work.",
    );
  }
  if (message.includes("growth_intelligence_retry_idempotency_conflict")) {
    return new DomainError(
      "DOMAIN_ERROR",
      "This retry was already recorded with different details.",
    );
  }
  if (message.includes("market_research_synthesis_evidence_stale")) {
    return new DomainError(
      "DOMAIN_ERROR",
      "The saved evidence is stale; start new research instead.",
    );
  }
  if (
    message.includes("market_research_synthesis_retry_budget_exhausted") ||
    message.includes("market_research_synthesis_retry_not_prequoted")
  ) {
    return new DomainError(
      "DOMAIN_ERROR",
      "The research budget for this run is exhausted; start new research when budget allows.",
    );
  }
  if (
    message.includes("market_research_pipeline_scope_mismatch") ||
    message.includes("market_research_pipeline_superseded")
  ) {
    return new DomainError(
      "DOMAIN_ERROR",
      "The research settings changed; start new research instead.",
    );
  }
  return new DomainError("DOMAIN_ERROR", "This analysis cannot be retried in its current state.");
}
