import { NextResponse } from "next/server";
import { z } from "zod";

import { hasOrganizationPermission } from "@/domain/access/permissions";
import { createEventPublisher } from "@/domain/events/publisher";
import {
  BRIEF_INVESTIGATION_AREAS,
  briefCompetitorSchema,
  briefRevisionSchema,
} from "@/domain/growth-intelligence/brief";
import { researchProjectScheduleSchema } from "@/domain/growth-intelligence/project";
import { marketMonitoringReportSchema } from "@/domain/growth-intelligence/report";
import type { OrganizationRole } from "@/domain/organizations/types";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { DomainError, toPublicError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  marketProfileApiErrorResponse,
  marketProfileCorrelationState,
} from "@/modules/growth-intelligence/application/api-schemas";
import { assertGrowthIntelligenceAccess } from "@/modules/growth-intelligence/application/feature-access";
import { startMonitoringUpdate } from "@/modules/growth-intelligence/application/market-monitoring-update";
import {
  createEphemeralMonitoringUpdateStore,
  isSameMonitoringScope,
} from "@/modules/growth-intelligence/application/monitoring-scope";
import {
  createAuthenticatedResearchProjectRepository,
  type ResearchProjectRepository,
} from "@/modules/growth-intelligence/infrastructure/research-project-repository";
import { triggerMarketMonitoringUpdate } from "@/trigger/growth-intelligence";

/**
 * Slice 4 project list/start routes for the report-led Market Watch.
 *
 * GET serves projects with their latest-report states for the caller's own
 * organization (RLS plus explicit organization pins on every read).
 * POST starts research through the Slice 3 orchestration with the pinned
 * brief revision: an identical active scope joins existing progress instead
 * of duplicating paid work, and a changed scope during active work is
 * reported — never silently applied.
 */

const listQuerySchema = z
  .object({
    branchId: z.string().uuid().nullable().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

const branchRowSchema = z.object({ id: z.string().uuid(), name: z.string() });

const reportContentRowSchema = z
  .object({
    project_id: z.string().uuid(),
    brief_revision_id: z.string().uuid(),
    report_version_id: z.string().uuid(),
    review_state: z.string(),
    content: z.unknown(),
    created_at: z.string().datetime({ offset: true }),
  })
  .passthrough();

const revisionRowSchema = z
  .object({
    id: z.string().uuid(),
    project_id: z.string().uuid(),
    revision_number: z.number().int(),
    document: z.unknown(),
    pinned_to_update_id: z.string().uuid().nullable(),
    created_at: z.string().datetime({ offset: true }),
  })
  .passthrough();

const briefRevisionIdRowSchema = z
  .object({ brief_revision_id: z.string().uuid() })
  .passthrough();

const UUID_ZERO = "00000000-0000-0000-0000-000000000000";

const startBodySchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    question: z.string().trim().min(1).max(2000),
    eventDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((value) => {
        const parsed = new Date(`${value}T00:00:00.000Z`);
        return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
      }, "Event date must be a real calendar date (YYYY-MM-DD).")
      .optional(),
    branchId: z.string().uuid(),
    researchArea: z.string().trim().min(1).max(160),
    competitors: z.array(briefCompetitorSchema).max(20).default([]),
    investigationAreas: z.array(z.enum(BRIEF_INVESTIGATION_AREAS)).min(1).max(5).default([
      "demand",
      "presence",
      "offers",
      "reviews",
      "observable_performance",
    ]),
    mode: z.enum(["one-time", "recurring"]),
    schedule: researchProjectScheduleSchema.optional(),
    businessContextSnapshotId: z.string().uuid().optional(),
    idempotencyKey: z.string().trim().min(16).max(200),
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
    const normalized = input.competitors.map((competitor) =>
      competitor.name.trim().replace(/\s+/g, " ").toLowerCase(),
    );
    if (new Set(normalized).size !== normalized.length) {
      context.addIssue({
        code: "custom",
        path: ["competitors"],
        message: "Competitor names must be unique.",
      });
    }
  });

function frequencyForMode(mode: "one-time" | "recurring", cadence?: string): string {
  if (mode === "one-time") return "once";
  return cadence ?? "weekly";
}

function deriveTitle(question: string): string {
  const trimmed = question.trim();
  if (trimmed.length <= 80) return trimmed;
  return `${trimmed.slice(0, 80).trimEnd()}…`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  const correlation = marketProfileCorrelationState(request);
  let correlationId = correlation.responseId;
  let organizationId: string | undefined;
  try {
    const rawParams = await params;
    const context = await getOrganizationContext(
      Promise.resolve({ organizationId: rawParams.organizationId }),
    );
    organizationId = context.organizationId;

    assertGrowthIntelligenceAccess(organizationId, "market");
    if (
      !hasOrganizationPermission(
        context.membership.role as OrganizationRole,
        "growth_intelligence.read",
      )
    ) {
      throw new DomainError(
        "AUTHORIZATION_ERROR",
        "You do not have permission to read Market Intelligence for this organization.",
      );
    }
    correlationId = correlation.parseAfterAuthorization();

    const url = new URL(request.url);
    const query = listQuerySchema.parse({
      branchId: url.searchParams.get("branchId"),
      limit: url.searchParams.get("limit") ?? undefined,
    });

    const projects = createAuthenticatedResearchProjectRepository(context.supabase);
    const summaries = await projects.listActiveProjects({
      organizationId,
      ...(query.branchId ? { branchId: query.branchId } : {}),
      limit: query.limit,
    });
    const projectIds = summaries.map((project) => project.projectId);

    // Branch names for the location filter. A failed list degrades to ids;
    // the location column never invents a name.
    const branchNames = new Map<string, string>();
    try {
      const { data: branchRows, error: branchError } = (await context.supabase
        .from("branches")
        .select("id,name")
        .eq("organization_id", organizationId)
        .order("name")) as { data: unknown; error: unknown };
      if (!branchError && Array.isArray(branchRows)) {
        for (const row of branchRows) {
          const parsed = branchRowSchema.safeParse(row);
          if (parsed.success) branchNames.set(parsed.data.id, parsed.data.name);
        }
      }
    } catch {
      // Degraded branch names stay degraded; the project list still loads.
    }

    // Reports and revisions per project, newest first. Content rows are
    // parsed through the report contract; an unreadable row degrades its
    // takeaway to null instead of failing the whole list.
    const reportsByProject: Record<
      string,
      {
        reportVersionId: string;
        briefRevisionId: string;
        reviewState: string;
        createdAt: string;
        takeaway: string | null;
      }[]
    > = {};
    const revisionsByProject: Record<
      string,
      {
        revisionId: string;
        revisionNumber: number;
        pinnedToUpdateId: string | null;
        createdAt: string;
      }[]
    > = {};
    if (projectIds.length > 0) {
      const [reportRows, revisionRows] = await Promise.all([
        context.supabase
          .from("growth_intelligence_reports")
          .select("project_id,brief_revision_id,report_version_id,review_state,content,created_at")
          .eq("organization_id", organizationId)
          .in("project_id", projectIds)
          .order("created_at", { ascending: false })
          .limit(projectIds.length * 5),
        context.supabase
          .from("growth_intelligence_brief_revisions")
          .select("id,project_id,revision_number,document,pinned_to_update_id,created_at")
          .eq("organization_id", organizationId)
          .in("project_id", projectIds)
          .order("revision_number", { ascending: false })
          .limit(projectIds.length * 5),
      ]);
      const reportData = (reportRows as { data: unknown }).data;
      if (Array.isArray(reportData)) {
        for (const row of reportData) {
          const parsed = reportContentRowSchema.safeParse(row);
          if (!parsed.success) continue;
          const content = marketMonitoringReportSchema.safeParse(parsed.data.content);
          const list = reportsByProject[parsed.data.project_id] ?? [];
          if (list.length >= 5) continue;
          list.push({
            reportVersionId: parsed.data.report_version_id,
            briefRevisionId: parsed.data.brief_revision_id,
            reviewState: parsed.data.review_state,
            createdAt: parsed.data.created_at,
            takeaway: content.success ? content.data.summary : null,
          });
          reportsByProject[parsed.data.project_id] = list;
        }
      }
      const revisionData = (revisionRows as { data: unknown }).data;
      if (Array.isArray(revisionData)) {
        for (const row of revisionData) {
          const parsed = revisionRowSchema.safeParse(row);
          if (!parsed.success) continue;
          const list = revisionsByProject[parsed.data.project_id] ?? [];
          if (list.length >= 5) continue;
          list.push({
            revisionId: parsed.data.id,
            revisionNumber: parsed.data.revision_number,
            pinnedToUpdateId: parsed.data.pinned_to_update_id,
            createdAt: parsed.data.created_at,
          });
          revisionsByProject[parsed.data.project_id] = list;
        }
      }
    }

    const response = NextResponse.json({
      projects: summaries.map((project) => ({
        ...project,
        branchName: branchNames.get(project.branchId) ?? project.branchId,
      })),
      reportsByProject,
      revisionsByProject,
      correlationId,
    });
    response.headers.set("x-correlation-id", correlationId);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    logger.warn("growth_intelligence.monitoring_projects_api_failed", {
      organizationId,
      correlationId,
      errorCode: toPublicError(error).code,
    });
    return marketProfileApiErrorResponse(error, correlationId);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  const correlation = marketProfileCorrelationState(request);
  let correlationId = correlation.responseId;
  let organizationId: string | undefined;
  try {
    const rawParams = await params;
    const context = await getOrganizationContext(
      Promise.resolve({ organizationId: rawParams.organizationId }),
    );
    organizationId = context.organizationId;

    assertGrowthIntelligenceAccess(organizationId, "market");
    if (
      !hasOrganizationPermission(
        context.membership.role as OrganizationRole,
        "growth_intelligence.manage",
      )
    ) {
      throw new DomainError(
        "AUTHORIZATION_ERROR",
        "You do not have permission to start Market Intelligence research.",
      );
    }
    correlationId = correlation.parseAfterAuthorization();

    const body = startBodySchema.parse(await request.json().catch(() => ({})));
    const title = body.title ?? deriveTitle(body.question);
    const frequency = frequencyForMode(body.mode, body.schedule?.cadence);
    const businessContextSnapshotId = body.businessContextSnapshotId ?? UUID_ZERO;

    const projects: ResearchProjectRepository = createAuthenticatedResearchProjectRepository(
      context.supabase,
    );

    // Twin reuse narrows the duplicate-project race before creating: an
    // identically-scoped live project is joined, never recreated.
    const siblings = await projects.listActiveProjects({
      organizationId,
      branchId: body.branchId,
      limit: 50,
    });
    const twin = siblings.find(
      (project) =>
        project.title === title && project.question === body.question && project.mode === body.mode,
    );
    const projectId = twin
      ? twin.projectId
      : (
          await projects.createProject({
            organizationId,
            branchId: body.branchId,
            title,
            question: body.question,
            mode: body.mode,
            ...(body.schedule ? { schedule: body.schedule } : {}),
            actorId: context.user.id,
          })
        ).projectId;

    // Convergence reads the durable pin: the latest brief revision row with
    // its pin, plus every reported revision row for the project.
    const [revisionResult, reportedResult] = await Promise.all([
      context.supabase
        .from("growth_intelligence_brief_revisions")
        .select("id,project_id,revision_number,document,pinned_to_update_id,created_at")
        .eq("organization_id", organizationId)
        .eq("project_id", projectId)
        .order("revision_number", { ascending: false })
        .limit(1),
      context.supabase
        .from("growth_intelligence_reports")
        .select("brief_revision_id")
        .eq("organization_id", organizationId)
        .eq("project_id", projectId)
        .limit(50),
    ]);
    const revisionRows = (revisionResult as { data: unknown }).data;
    const reportedRows = (reportedResult as { data: unknown }).data;
    const latestRow = Array.isArray(revisionRows) ? revisionRowSchema.safeParse(revisionRows[0]) : null;
    const reportedRevisionIds = new Set<string>();
    if (Array.isArray(reportedRows)) {
      for (const row of reportedRows) {
        const parsed = briefRevisionIdRowSchema.safeParse(row);
        if (parsed.success) reportedRevisionIds.add(parsed.data.brief_revision_id);
      }
    }

    const latestRevision = latestRow && latestRow.success ? latestRow.data : null;
    const parsedDocument = latestRevision
      ? briefRevisionSchema.safeParse(latestRevision.document)
      : null;
    const brief = parsedDocument && parsedDocument.success ? parsedDocument.data : null;
    const pinnedToUpdateId = latestRevision?.pinned_to_update_id ?? null;
    const activeUpdateId =
      pinnedToUpdateId && latestRevision && !reportedRevisionIds.has(latestRevision.id)
        ? pinnedToUpdateId
        : null;

    if (activeUpdateId && brief && latestRevision) {
      const sameScope = isSameMonitoringScope(brief, {
        title,
        question: body.question,
        branchId: body.branchId,
        researchArea: body.researchArea,
        competitors: body.competitors,
        investigationAreas: body.investigationAreas,
        businessContextSnapshotId,
        frequency,
      });
      if (sameScope) {
        // Idempotent convergence: the retry joins the running update. A
        // best-effort re-nudge assures delivery of work that lost its wake-up.
        try {
          await triggerMarketMonitoringUpdate({
            organizationId,
            projectId,
            updateId: activeUpdateId,
            briefRevisionId: latestRevision.id,
            brief,
            actorId: context.user.id,
            correlationId,
          });
        } catch {
          // Lost nudges are recovered by the cadence sweep; the join still counts.
        }
        const response = NextResponse.json(
          {
            start: {
              outcome: "opened_progress",
              projectId,
              updateId: activeUpdateId,
              correlationId,
            },
            correlationId,
          },
          { status: 200 },
        );
        response.headers.set("x-correlation-id", correlationId);
        response.headers.set("Cache-Control", "no-store");
        return response;
      }
      // Scope drift: the changed settings are not applied to the running
      // update. They are reported beside the active progress instead of
      // silently replacing it; saving them for the next run belongs to the
      // project-management slice with its explicit stop control.
      const response = NextResponse.json(
        {
          start: {
            outcome: "opened_progress",
            projectId,
            updateId: activeUpdateId,
            correlationId,
          },
          notice: {
            code: "SCOPE_DRIFT_ACTIVE_PROGRESS",
            message:
              "Changed settings not applied, showing active progress. Wait for the current update to finish, then start again with the new brief.",
          },
          correlationId,
        },
        { status: 200 },
      );
      response.headers.set("x-correlation-id", correlationId);
      response.headers.set("Cache-Control", "no-store");
      return response;
    }

    const started = await startMonitoringUpdate(
      {
        organizationId,
        branchId: body.branchId,
        title,
        question: body.question,
        mode: body.mode,
        ...(body.schedule ? { schedule: body.schedule } : {}),
        researchArea: body.researchArea,
        competitors: body.competitors,
        investigationAreas: body.investigationAreas,
        businessContextSnapshotId,
        actorId: context.user.id,
        idempotencyKey: body.idempotencyKey,
        correlationId,
        refresh: false,
      },
      {
        projects: {
          createProject: (input) => projects.createProject(input),
          saveBriefRevision: (input) => projects.saveBriefRevision(input),
          listBriefRevisions: (input) => projects.listBriefRevisions(input),
          listActiveProjects: (input) => projects.listActiveProjects(input),
        },
        updates: createEphemeralMonitoringUpdateStore(),
        dispatch: {
          nudge: (input) => triggerMarketMonitoringUpdate(input),
        },
        events: createEventPublisher(),
      },
    );
    const response = NextResponse.json(
      { start: started, correlationId },
      { status: started.outcome === "started" ? 201 : 200 },
    );
    response.headers.set("x-correlation-id", correlationId);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    logger.warn("growth_intelligence.monitoring_start_api_failed", {
      organizationId,
      correlationId,
      errorCode: toPublicError(error).code,
    });
    return marketProfileApiErrorResponse(error, correlationId);
  }
}
