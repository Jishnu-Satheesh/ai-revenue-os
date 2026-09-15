import "server-only";

import { z } from "zod";

import {
  briefRevisionSchema,
  marketMonitoringReportSchema,
  RESEARCH_PROJECT_LIFECYCLES,
  researchProjectScheduleSchema,
} from "@/domain/growth-intelligence";
import type { EventPublisher } from "@/domain/events/types";
import { DomainError } from "@/lib/errors";
import type { Database } from "@/lib/supabase/database.types";
import {
  marketResearchBriefRevisionSavedPayloadSchema,
  marketResearchProjectCreatedPayloadSchema,
  marketResearchReportReadyPayloadSchema,
} from "@/modules/growth-intelligence/application/acceptance-service";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Session-bound research project, brief, report and acceptance persistence.
 *
 * Every query pins the organization id on the signed-in client, so tenant
 * isolation stays with RLS and this layer only shapes rows and wires the
 * four fenced RPCs. Writes never touch tables directly: creation, revision
 * saves, report persists and acceptance all go through the governed
 * operations that recheck tenant bindings inside the transaction. Reads are
 * bounded: list calls clamp to 50 rows with deterministic keyset order and
 * never issue an unbounded scan.
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

export type ResearchProjectPersistence = {
  from(table: string): QueryBuilder<unknown>;
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

type DatabaseClient = SupabaseClient<Database> | ResearchProjectPersistence;

function query<T>(persistence: ResearchProjectPersistence, table: string): QueryBuilder<T> {
  return persistence.from(table) as QueryBuilder<T>;
}

function readFailure(): never {
  throw new DomainError("DOMAIN_ERROR", "Market research could not be loaded.");
}

function writeFailure(): never {
  throw new DomainError("DOMAIN_ERROR", "Market research could not be saved.");
}

const HISTORY_LIMIT_DEFAULT = 20;
const HISTORY_LIMIT_MAX = 50;

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return HISTORY_LIMIT_DEFAULT;
  if (!Number.isInteger(limit)) {
    throw new DomainError("VALIDATION_ERROR", "The page size could not be understood.");
  }
  return Math.min(Math.max(limit, 1), HISTORY_LIMIT_MAX);
}

const historyCursorSchema = z
  .object({ createdAt: z.string().datetime({ offset: true }), id: z.string().uuid() })
  .strict();

function decodeHistoryCursor(cursor: string | null): { createdAt: string; id: string } | null {
  if (cursor === null) return null;
  try {
    const parsed = historyCursorSchema.safeParse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function encodeHistoryCursor(cursor: { createdAt: string; id: string }): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

const projectRowSchema = z
  .object({
    id: z.string().uuid(),
    organization_id: z.string().uuid(),
    branch_id: z.string().uuid(),
    title: z.string(),
    question: z.string(),
    mode: z.enum(["one-time", "recurring"]),
    schedule: z.unknown(),
    lifecycle: z.enum(RESEARCH_PROJECT_LIFECYCLES),
    created_at: z.string().datetime({ offset: true }),
    updated_at: z.string().datetime({ offset: true }),
  })
  .strict()
  .passthrough();

const briefRevisionRowSchema = z
  .object({
    id: z.string().uuid(),
    organization_id: z.string().uuid(),
    project_id: z.string().uuid(),
    revision_number: z.number().int(),
    document: z.unknown(),
    pinned_to_update_id: z.string().uuid().nullable(),
    created_at: z.string().datetime({ offset: true }),
  })
  .strict()
  .passthrough();

const reportRowSchema = z
  .object({
    id: z.string().uuid(),
    organization_id: z.string().uuid(),
    project_id: z.string().uuid(),
    branch_id: z.string().uuid(),
    brief_revision_id: z.string().uuid(),
    report_version_id: z.string().uuid(),
    evidence_digest: z.string(),
    content: z.unknown(),
    review_state: z.enum(["pending_review", "accepted"]),
    created_at: z.string().datetime({ offset: true }),
  })
  .strict()
  .passthrough();

const PROJECT_COLUMNS =
  "id,organization_id,branch_id,title,question,mode,schedule,lifecycle,created_at,updated_at";
const BRIEF_REVISION_COLUMNS =
  "id,organization_id,project_id,revision_number,document,pinned_to_update_id,created_at";
const REPORT_COLUMNS =
  "id,organization_id,project_id,branch_id,brief_revision_id,report_version_id,evidence_digest,content,review_state,created_at";

export type ResearchProjectSummary = {
  projectId: string;
  organizationId: string;
  branchId: string;
  title: string;
  question: string;
  mode: "one-time" | "recurring";
  lifecycle: (typeof RESEARCH_PROJECT_LIFECYCLES)[number];
  createdAt: string;
};

export type BriefRevisionSummary = {
  revisionId: string;
  projectId: string;
  revisionNumber: number;
  pinnedToUpdateId: string | null;
  createdAt: string;
};

export type MonitoringReportSummary = {
  reportId: string;
  reportVersionId: string;
  projectId: string;
  reviewState: "pending_review" | "accepted";
  createdAt: string;
};

export type MonitoringUpdateLifecycleSummary = {
  updateId: string;
  projectId: string;
  briefRevisionId: string | null;
  stage:
    | "queued"
    | "researching"
    | "preparing_insights"
    | "ready"
    | "partial"
    | "empty"
    | "no_findings"
    | "research_failed"
    | "synthesis_failed"
    | "cancelled";
  reasonCode: string | null;
  retryable: boolean;
  coverage: unknown;
  knownCostMicrosUsd: number;
  unknownCostCount: number;
  attempts: number;
  updatedAt: string;
};

const monitoringUpdateLifecycleRowSchema = z
  .object({
    update_id: z.string().uuid(),
    organization_id: z.string().uuid(),
    project_id: z.string().uuid(),
    brief_revision_id: z.string().uuid().nullable(),
    stage: z.enum([
      "queued",
      "researching",
      "preparing_insights",
      "ready",
      "partial",
      "empty",
      "no_findings",
      "research_failed",
      "synthesis_failed",
      "cancelled",
    ]),
    reason_code: z.string().nullable(),
    retryable: z.boolean(),
    coverage: z.unknown(),
    known_cost_micros_usd: z.number().int().min(0),
    unknown_cost_count: z.number().int().min(0),
    attempts: z.number().int().min(0),
    updated_at: z.string().datetime({ offset: true }),
  })
  .strict()
  .passthrough();

const MONITORING_UPDATE_LIFECYCLE_COLUMNS =
  "update_id,organization_id,project_id,brief_revision_id,stage,reason_code,retryable,coverage,known_cost_micros_usd,unknown_cost_count,attempts,updated_at";

const createProjectInputSchema = z
  .object({
    organizationId: z.string().uuid(),
    branchId: z.string().uuid(),
    title: z.string().trim().min(1).max(200),
    question: z.string().trim().min(1).max(2000),
    mode: z.enum(["one-time", "recurring"]),
    schedule: researchProjectScheduleSchema.optional(),
    actorId: z.string().uuid(),
    /**
     * Slice 7 keyed create: when present, creation goes through
     * create_research_project_keyed, so the same key with the same body
     * replays the kept project and the same key with another body
     * conflicts. Absent preserves the unkeyed operation exactly.
     */
    idempotencyKey: z.string().trim().min(1).max(200).optional(),
    scopeFingerprint: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.mode === "recurring" && !input.schedule) {
      context.addIssue({
        code: "custom",
        path: ["schedule"],
        message: "A recurring project needs a schedule.",
      });
    }
    if (input.mode === "one-time" && input.schedule) {
      context.addIssue({
        code: "custom",
        path: ["schedule"],
        message: "A one-time project runs on explicit starts and carries no schedule.",
      });
    }
  });

const saveBriefRevisionInputSchema = z
  .object({
    organizationId: z.string().uuid(),
    projectId: z.string().uuid(),
    revisionNumber: z.number().int().min(1),
    document: briefRevisionSchema,
    pinnedToUpdateId: z.string().uuid().nullable(),
    actorId: z.string().uuid(),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      input.document.organizationId !== input.organizationId ||
      input.document.projectId !== input.projectId ||
      input.document.revisionNumber !== input.revisionNumber
    ) {
      context.addIssue({
        code: "custom",
        path: ["document"],
        message: "The brief document names another organization, project, or revision.",
      });
    }
    if ((input.document.pinnedToUpdateId ?? null) !== input.pinnedToUpdateId) {
      context.addIssue({
        code: "custom",
        path: ["pinnedToUpdateId"],
        message: "The revision pin must match the document pin.",
      });
    }
  });

const persistReportVersionInputSchema = z
  .object({
    organizationId: z.string().uuid(),
    projectId: z.string().uuid(),
    branchId: z.string().uuid(),
    briefRevisionId: z.string().uuid(),
    reportVersionId: z.string().uuid(),
    evidenceDigest: z.string().trim().min(1).max(512),
    content: marketMonitoringReportSchema,
    actorId: z.string().uuid(),
  })
  .strict()
  .superRefine((input, context) => {
    const content = input.content;
    if (
      content.organizationId !== input.organizationId ||
      content.projectId !== input.projectId ||
      content.locationId !== input.branchId ||
      content.briefRevisionId !== input.briefRevisionId ||
      content.reportVersionId !== input.reportVersionId ||
      content.evidenceDigest !== input.evidenceDigest
    ) {
      context.addIssue({
        code: "custom",
        path: ["content"],
        message: "The report content pins another project, branch, revision, or evidence.",
      });
    }
  });

const acceptDraftItemInputSchema = z
  .object({
    organizationId: z.string().uuid(),
    reportVersionId: z.string().uuid(),
    itemKey: z.string().trim().min(1).max(160),
    kind: z.enum(["action", "finding"]),
    actorId: z.string().uuid(),
  })
  .strict();

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "";
}

/**
 * Safe write refusals: every branch names the operator's next step without
 * exposing foreign-project existence, evidence state, or budget internals.
 */
function mapWriteError(error: unknown, scope: string): DomainError {
  const message = errorMessage(error);
  if (message.includes("forbidden")) {
    return new DomainError(
      "AUTHORIZATION_ERROR",
      "You do not have permission to change Market Intelligence research.",
    );
  }
  if (message.includes("pinned") || message.includes("conflict")) {
    return new DomainError(
      "DOMAIN_ERROR",
      `This ${scope} was already saved with different details; reload and try again.`,
    );
  }
  if (message.includes("not_found") || message.includes("mismatch")) {
    return new DomainError(
      "DOMAIN_ERROR",
      `This ${scope} could not be found in your organization.`,
    );
  }
  return new DomainError("DOMAIN_ERROR", `This ${scope} could not be saved.`);
}

async function callRpc(
  persistence: ResearchProjectPersistence,
  name: string,
  args: Record<string, unknown>,
  scope: string,
): Promise<Record<string, unknown>> {
  let result: { data: unknown; error: unknown };
  try {
    result = await persistence.rpc(name, args);
  } catch {
    writeFailure();
  }
  if (result.error) throw mapWriteError(result.error, scope);
  const parsed = z.record(z.string(), z.unknown()).safeParse(result.data);
  if (!parsed.success) writeFailure();
  return parsed.data as Record<string, unknown>;
}

function stringField(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") writeFailure();
  return value as string;
}

function booleanField(row: Record<string, unknown>, key: string): boolean {
  const value = row[key];
  if (typeof value !== "boolean") writeFailure();
  return value as boolean;
}

/**
 * Identifier-only audit emission for the owning flows. Titles, questions,
 * summaries and evidence never enter an event: the stream says what
 * happened to which record. A missing correlation id is minted, never
 * borrowed: the event correlates to the write that produced it.
 */
export type ResearchProjectEventOptions = {
  events?: EventPublisher;
  correlationId?: string;
};

async function publishResearchEvent(
  options: ResearchProjectEventOptions | undefined,
  input: {
    organizationId: string;
    actorId: string;
    eventName:
      | "market_research.project_created"
      | "market_research.brief_revision_saved"
      | "market_research.report_ready";
    payload: Record<string, unknown>;
  },
): Promise<void> {
  if (!options?.events) return;
  await options.events.publish({
    organizationId: input.organizationId,
    eventId: crypto.randomUUID(),
    eventName: input.eventName,
    occurredAt: new Date().toISOString(),
    actorType: "user",
    actorId: input.actorId,
    correlationId: options.correlationId ?? crypto.randomUUID(),
    schemaVersion: 1,
    payload: input.payload,
  });
}

export type ResearchProjectRepository = {
  createProject(
    input: {
      organizationId: string;
      branchId: string;
      title: string;
      question: string;
      mode: "one-time" | "recurring";
      schedule?: z.infer<typeof researchProjectScheduleSchema>;
      actorId: string;
      idempotencyKey?: string;
      scopeFingerprint?: string;
    },
    options?: ResearchProjectEventOptions,
  ): Promise<{ projectId: string; lifecycle: string; replayed: boolean }>;
  saveBriefRevision(
    input: {
      organizationId: string;
      projectId: string;
      revisionNumber: number;
      document: unknown;
      pinnedToUpdateId: string | null;
      actorId: string;
    },
    options?: ResearchProjectEventOptions,
  ): Promise<{ revisionId: string; revisionNumber: number; replayed: boolean }>;
  persistReportVersion(
    input: {
      organizationId: string;
      projectId: string;
      branchId: string;
      briefRevisionId: string;
      reportVersionId: string;
      evidenceDigest: string;
      content: unknown;
      actorId: string;
    },
    options?: ResearchProjectEventOptions,
  ): Promise<{
    reportId: string;
    reportVersionId: string;
    reviewState: string;
    draftItemCount: number | null;
    replayed: boolean;
  }>;
  acceptDraftItem(input: {
    organizationId: string;
    reportVersionId: string;
    itemKey: string;
    kind: "action" | "finding";
    actorId: string;
  }): Promise<{
    acceptanceKey: string;
    destination: string;
    outcome: string;
    /**
     * Slice 6 acceptance handoff reads this through: the RPC always returns
     * false (the table CHECK forbids true), and the service fails closed on
     * anything else, so accepting research advice can never approve Campaign
     * execution, spending or publication.
     */
    grantsExecutionApproval: boolean;
  }>;
  /** The project list without archived rows, newest first, bounded. */
  listActiveProjects(input: {
    organizationId: string;
    branchId?: string;
    limit?: number;
  }): Promise<ResearchProjectSummary[]>;
  /** One project's brief history, newest revision first, bounded. */
  listBriefRevisions(input: {
    organizationId: string;
    projectId: string;
    limit?: number;
  }): Promise<BriefRevisionSummary[]>;
  /**
   * Explicit item-less review through the fenced mark_report_reviewed RPC.
   * Idempotent per report version: replays return the kept reviewer row.
   * Reports with draft items are refused (reviewed item by item instead).
   */
  markReportReviewed(
    input: {
      organizationId: string;
      reportVersionId: string;
      actorId: string;
    },
    options?: ResearchProjectEventOptions,
  ): Promise<{
    reportVersionId: string;
    reviewedBy: string;
    reviewedAt: string;
    replayed: boolean;
  }>;
  /**
   * Durable update-lifecycle read. Failed updates read as failed with their
   * safe reason and retry flag (Slice 4's failed state); running updates
   * read their real stage, never an invented percentage.
   */
  readMonitoringUpdate(input: {
    organizationId: string;
    updateId: string;
  }): Promise<MonitoringUpdateLifecycleSummary | null>;
  /** One project's report history, newest first, bounded with a keyset cursor. */
  listProjectReports(input: {
    organizationId: string;
    projectId: string;
    limit?: number;
    cursor?: string | null;
  }): Promise<{ reports: MonitoringReportSummary[]; nextCursor: string | null }>;
  readReport(input: {
    organizationId: string;
    reportVersionId: string;
  }): Promise<MonitoringReportSummary | null>;
};

export function createAuthenticatedResearchProjectRepository(
  client: DatabaseClient,
): ResearchProjectRepository {
  const persistence = client as unknown as ResearchProjectPersistence;

  return {
    async createProject(input, options) {
      const parsed = createProjectInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new DomainError("VALIDATION_ERROR", "The research project could not be understood.");
      }
      const outcome =
        parsed.data.idempotencyKey === undefined
          ? await callRpc(
              persistence,
              "create_research_project",
              {
                p_organization_id: parsed.data.organizationId,
                p_actor_id: parsed.data.actorId,
                p_branch_id: parsed.data.branchId,
                p_title: parsed.data.title,
                p_question: parsed.data.question,
                p_mode: parsed.data.mode,
                p_schedule: parsed.data.schedule ?? null,
              },
              "research project",
            )
          : await callRpc(
              persistence,
              "create_research_project_keyed",
              {
                p_organization_id: parsed.data.organizationId,
                p_actor_id: parsed.data.actorId,
                p_branch_id: parsed.data.branchId,
                p_title: parsed.data.title,
                p_question: parsed.data.question,
                p_mode: parsed.data.mode,
                p_schedule: parsed.data.schedule ?? null,
                p_idempotency_key: parsed.data.idempotencyKey,
                p_scope_fingerprint: parsed.data.scopeFingerprint ?? null,
              },
              "research project",
            );
      const created = {
        projectId: stringField(outcome, "projectId"),
        lifecycle: stringField(outcome, "lifecycle"),
        replayed: booleanField(outcome, "replayed"),
      };
      await publishResearchEvent(options, {
        organizationId: parsed.data.organizationId,
        actorId: parsed.data.actorId,
        eventName: "market_research.project_created",
        payload: marketResearchProjectCreatedPayloadSchema.parse({
          projectId: created.projectId,
          branchId: parsed.data.branchId,
          mode: parsed.data.mode,
        }),
      });
      return created;
    },

    async saveBriefRevision(input, options) {
      const parsed = saveBriefRevisionInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new DomainError("VALIDATION_ERROR", "The brief revision could not be understood.");
      }
      const row = await callRpc(
        persistence,
        "save_brief_revision",
        {
          p_organization_id: parsed.data.organizationId,
          p_actor_id: parsed.data.actorId,
          p_project_id: parsed.data.projectId,
          p_revision_number: parsed.data.revisionNumber,
          p_document: parsed.data.document,
          p_pinned_to_update_id: parsed.data.pinnedToUpdateId,
        },
        "brief revision",
      );
      const revisionNumber = row["revisionNumber"];
      if (typeof revisionNumber !== "number") writeFailure();
      const saved = {
        revisionId: stringField(row, "revisionId"),
        revisionNumber: revisionNumber as number,
        replayed: booleanField(row, "replayed"),
      };
      await publishResearchEvent(options, {
        organizationId: parsed.data.organizationId,
        actorId: parsed.data.actorId,
        eventName: "market_research.brief_revision_saved",
        payload: marketResearchBriefRevisionSavedPayloadSchema.parse({
          projectId: parsed.data.projectId,
          revisionId: saved.revisionId,
          revisionNumber: saved.revisionNumber,
        }),
      });
      return saved;
    },

    async persistReportVersion(input, options) {
      const parsed = persistReportVersionInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new DomainError("VALIDATION_ERROR", "The report version could not be understood.");
      }
      const row = await callRpc(
        persistence,
        "persist_report_version",
        {
          p_organization_id: parsed.data.organizationId,
          p_actor_id: parsed.data.actorId,
          p_project_id: parsed.data.projectId,
          p_branch_id: parsed.data.branchId,
          p_brief_revision_id: parsed.data.briefRevisionId,
          p_report_version_id: parsed.data.reportVersionId,
          p_evidence_digest: parsed.data.evidenceDigest,
          p_content: parsed.data.content,
        },
        "report version",
      );
      const draftItemCount = row["draftItemCount"];
      const persisted = {
        reportId: stringField(row, "reportId"),
        reportVersionId: stringField(row, "reportVersionId"),
        reviewState: stringField(row, "reviewState"),
        draftItemCount: typeof draftItemCount === "number" ? draftItemCount : null,
        replayed: booleanField(row, "replayed"),
      };
      await publishResearchEvent(options, {
        organizationId: parsed.data.organizationId,
        actorId: parsed.data.actorId,
        eventName: "market_research.report_ready",
        payload: marketResearchReportReadyPayloadSchema.parse({
          projectId: parsed.data.projectId,
          reportVersionId: persisted.reportVersionId,
          briefRevisionId: parsed.data.briefRevisionId,
          draftItemCount: persisted.draftItemCount ?? 0,
        }),
      });
      return persisted;
    },

    async acceptDraftItem(input) {
      const parsed = acceptDraftItemInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new DomainError("VALIDATION_ERROR", "The draft acceptance could not be understood.");
      }
      const row = await callRpc(
        persistence,
        "accept_draft_item",
        {
          p_organization_id: parsed.data.organizationId,
          p_actor_id: parsed.data.actorId,
          p_report_version_id: parsed.data.reportVersionId,
          p_item_key: parsed.data.itemKey,
          p_kind: parsed.data.kind,
        },
        "draft acceptance",
      );
      return {
        acceptanceKey: stringField(row, "acceptanceKey"),
        destination: stringField(row, "destination"),
        outcome: stringField(row, "outcome"),
        grantsExecutionApproval: booleanField(row, "grantsExecutionApproval"),
      };
    },

    async listActiveProjects(input) {
      const parsed = z
        .object({
          organizationId: z.string().uuid(),
          branchId: z.string().uuid().optional(),
          limit: z.number().int().optional(),
        })
        .strict()
        .safeParse(input);
      if (!parsed.success) {
        throw new DomainError("VALIDATION_ERROR", "The project list could not be understood.");
      }
      const limit = clampLimit(parsed.data.limit);
      let builder = query<Record<string, unknown>[]>(
        persistence,
        "growth_intelligence_research_projects",
      )
        .select(PROJECT_COLUMNS)
        .eq("organization_id", parsed.data.organizationId)
        .in("lifecycle", ["active", "paused"]);
      if (parsed.data.branchId !== undefined) {
        builder = builder.eq("branch_id", parsed.data.branchId);
      }
      const result = await builder
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit);
      if (result.error) readFailure();
      return (result.data ?? []).slice(0, limit).map((row) => {
        const parsedRow = projectRowSchema.safeParse(row);
        if (!parsedRow.success) readFailure();
        const data = parsedRow.data;
        return {
          projectId: data.id,
          organizationId: data.organization_id,
          branchId: data.branch_id,
          title: data.title,
          question: data.question,
          mode: data.mode,
          lifecycle: data.lifecycle,
          createdAt: data.created_at,
        };
      });
    },

    async listBriefRevisions(input) {
      const parsed = z
        .object({
          organizationId: z.string().uuid(),
          projectId: z.string().uuid(),
          limit: z.number().int().optional(),
        })
        .strict()
        .safeParse(input);
      if (!parsed.success) {
        throw new DomainError("VALIDATION_ERROR", "The brief history could not be understood.");
      }
      const limit = clampLimit(parsed.data.limit);
      const result = await query<Record<string, unknown>[]>(
        persistence,
        "growth_intelligence_brief_revisions",
      )
        .select(BRIEF_REVISION_COLUMNS)
        .eq("organization_id", parsed.data.organizationId)
        .eq("project_id", parsed.data.projectId)
        .order("revision_number", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit);
      if (result.error) readFailure();
      return (result.data ?? []).slice(0, limit).map((row) => {
        const parsedRow = briefRevisionRowSchema.safeParse(row);
        if (!parsedRow.success) readFailure();
        const data = parsedRow.data;
        return {
          revisionId: data.id,
          projectId: data.project_id,
          revisionNumber: data.revision_number,
          pinnedToUpdateId: data.pinned_to_update_id,
          createdAt: data.created_at,
        };
      });
    },

    async listProjectReports(input) {
      const parsed = z
        .object({
          organizationId: z.string().uuid(),
          projectId: z.string().uuid(),
          limit: z.number().int().optional(),
          cursor: z.string().nullable().optional(),
        })
        .strict()
        .safeParse(input);
      if (!parsed.success) {
        throw new DomainError("VALIDATION_ERROR", "The report history could not be understood.");
      }
      const limit = clampLimit(parsed.data.limit);
      const cursor = decodeHistoryCursor(parsed.data.cursor ?? null);
      if (parsed.data.cursor && !cursor) {
        throw new DomainError("DOMAIN_ERROR", "The pagination cursor is not usable.");
      }
      let builder = query<Record<string, unknown>[]>(
        persistence,
        "growth_intelligence_reports",
      )
        .select(REPORT_COLUMNS)
        .eq("organization_id", parsed.data.organizationId)
        .eq("project_id", parsed.data.projectId);
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
      const rows = (result.data ?? [])
        .map((row) => {
          const parsedRow = reportRowSchema.safeParse(row);
          if (!parsedRow.success) readFailure();
          return parsedRow.data;
        })
        .slice(0, limit + 1);
      const page = rows.slice(0, limit);
      // A full page may hide more rows; the next page proves the end by
      // returning short. The over-fetched row is never rendered.
      const nextCursor =
        page.length === limit && rows.length > limit
          ? encodeHistoryCursor({
              createdAt: page[page.length - 1]!.created_at,
              id: page[page.length - 1]!.id,
            })
          : null;
      return {
        reports: page.map((data) => ({
          reportId: data.id,
          reportVersionId: data.report_version_id,
          projectId: data.project_id,
          reviewState: data.review_state,
          createdAt: data.created_at,
        })),
        nextCursor,
      };
    },

    async readReport(input) {
      const parsed = z
        .object({ organizationId: z.string().uuid(), reportVersionId: z.string().uuid() })
        .strict()
        .safeParse(input);
      if (!parsed.success) {
        throw new DomainError("VALIDATION_ERROR", "The report lookup could not be understood.");
      }
      const result = await query<Record<string, unknown> | null>(
        persistence,
        "growth_intelligence_reports",
      )
        .select(REPORT_COLUMNS)
        .eq("organization_id", parsed.data.organizationId)
        .eq("report_version_id", parsed.data.reportVersionId)
        .maybeSingle();
      if (result.error) readFailure();
      if (!result.data) return null;
      const parsedRow = reportRowSchema.safeParse(result.data);
      if (!parsedRow.success) readFailure();
      const data = parsedRow.data;
      return {
        reportId: data.id,
        reportVersionId: data.report_version_id,
        projectId: data.project_id,
        reviewState: data.review_state,
        createdAt: data.created_at,
      };
    },

    async markReportReviewed(input) {
      const parsed = z
        .object({
          organizationId: z.string().uuid(),
          reportVersionId: z.string().uuid(),
          actorId: z.string().uuid(),
        })
        .strict()
        .safeParse(input);
      if (!parsed.success) {
        throw new DomainError("VALIDATION_ERROR", "The report review could not be understood.");
      }
      const row = await callRpc(
        persistence,
        "mark_report_reviewed",
        {
          p_organization_id: parsed.data.organizationId,
          p_actor_id: parsed.data.actorId,
          p_report_version_id: parsed.data.reportVersionId,
        },
        "report review",
      );
      return {
        reportVersionId: stringField(row, "reportVersionId"),
        reviewedBy: stringField(row, "reviewedBy"),
        reviewedAt: stringField(row, "reviewedAt"),
        replayed: booleanField(row, "replayed"),
      };
    },

    async readMonitoringUpdate(input) {
      const parsed = z
        .object({ organizationId: z.string().uuid(), updateId: z.string().uuid() })
        .strict()
        .safeParse(input);
      if (!parsed.success) {
        throw new DomainError("VALIDATION_ERROR", "The update lookup could not be understood.");
      }
      const result = await query<Record<string, unknown> | null>(
        persistence,
        "growth_intelligence_monitoring_updates",
      )
        .select(MONITORING_UPDATE_LIFECYCLE_COLUMNS)
        .eq("organization_id", parsed.data.organizationId)
        .eq("update_id", parsed.data.updateId)
        .maybeSingle();
      if (result.error) readFailure();
      if (!result.data) return null;
      const parsedRow = monitoringUpdateLifecycleRowSchema.safeParse(result.data);
      if (!parsedRow.success) readFailure();
      const data = parsedRow.data;
      return {
        updateId: data.update_id,
        projectId: data.project_id,
        briefRevisionId: data.brief_revision_id,
        stage: data.stage,
        reasonCode: data.reason_code,
        retryable: data.retryable,
        coverage: data.coverage ?? null,
        knownCostMicrosUsd: data.known_cost_micros_usd,
        unknownCostCount: data.unknown_cost_count,
        attempts: data.attempts,
        updatedAt: data.updated_at,
      };
    },
  };
}
