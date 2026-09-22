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
import {
  fingerprintMonitoringScope,
  MONITORING_UPDATE_TERMINAL_STAGES,
  startMonitoringUpdate,
} from "@/modules/growth-intelligence/application/market-monitoring-update";
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
 * reported — never silently applied. A pin whose update already settled
 * terminal (failed, cancelled, or otherwise finished) is not joinable: the
 * retry falls through to a fresh update, because the worker replays terminal
 * updates without reworking and joining one could never retry honestly.
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

const failedUpdateRowSchema = z
  .object({
    project_id: z.string().uuid(),
    update_id: z.string().uuid(),
    stage: z.enum(["research_failed", "synthesis_failed"]),
  })
  .passthrough();

const projectOptInRowSchema = z
  .object({
    id: z.string().uuid(),
    agent_lane_opt_in: z.boolean(),
  })
  .passthrough();

const UUID_ZERO = "00000000-0000-0000-0000-000000000000";

const optInBodySchema = z
  .object({
    project_id: z.string().uuid(),
    agent_lane_opt_in: z.boolean(),
  })
  .strict();

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
    // Terminally failed updates per project, newest first. A pinned scope
    // whose update failed with no report reads as failed instead of
    // claiming research is still running; an unreadable row degrades to
    // absent (researching) rather than failing the whole list.
    const failedUpdatesByProject: Record<string, { updateId: string; stage: string }[]> = {};
    if (projectIds.length > 0) {
      const [reportRows, revisionRows, failedRows] = await Promise.all([
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
        context.supabase
          .from("growth_intelligence_monitoring_updates")
          .select("project_id,update_id,stage")
          .eq("organization_id", organizationId)
          .in("project_id", projectIds)
          .in("stage", ["research_failed", "synthesis_failed"])
          .order("updated_at", { ascending: false })
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
      const failedData = (failedRows as { data: unknown }).data;
      if (Array.isArray(failedData)) {
        for (const row of failedData) {
          const parsed = failedUpdateRowSchema.safeParse(row);
          if (!parsed.success) continue;
          const list = failedUpdatesByProject[parsed.data.project_id] ?? [];
          if (list.length >= 5) continue;
          list.push({ updateId: parsed.data.update_id, stage: parsed.data.stage });
          failedUpdatesByProject[parsed.data.project_id] = list;
        }
      }
    }

    // Agent-lane opt-in flags per project, best-effort. The column lands
    // via a migration that is dry-run only in this slice, so a missing
    // column (or any read failure) degrades to absent flags instead of
    // failing the list; the toggle then renders unchecked until saved.
    const agentLaneOptInByProject = new Map<string, boolean>();
    if (projectIds.length > 0) {
      try {
        const flagResult = (await context.supabase
          .from("growth_intelligence_research_projects")
          .select("id,agent_lane_opt_in")
          .eq("organization_id", organizationId)
          .in("id", projectIds)
          .limit(projectIds.length)) as { data: unknown; error: unknown };
        if (!flagResult.error && Array.isArray(flagResult.data)) {
          for (const row of flagResult.data) {
            const parsed = projectOptInRowSchema.safeParse(row);
            if (parsed.success) agentLaneOptInByProject.set(parsed.data.id, parsed.data.agent_lane_opt_in);
          }
        }
      } catch {
        // Degraded flags stay degraded; the project list still loads.
      }
    }

    const response = NextResponse.json({
      projects: summaries.map((project) => ({
        ...project,
        branchName: branchNames.get(project.branchId) ?? project.branchId,
        ...(agentLaneOptInByProject.has(project.projectId)
          ? { agentLaneOptIn: agentLaneOptInByProject.get(project.projectId) }
          : {}),
      })),
      reportsByProject,
      revisionsByProject,
      failedUpdatesByProject,
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
    // identically-scoped live project is joined, never recreated. The keyed
    // create below closes what the read-then-create cannot: the client's
    // per-press key replays a redelivered start, a reused key with another
    // body conflicts honestly through the existing DOMAIN_ERROR mapping,
    // and an identical scope under another key converges on the kept
    // project instead of forking paid work.
    const siblings = await projects.listActiveProjects({
      organizationId,
      branchId: body.branchId,
      limit: 50,
    });
    const twin = siblings.find(
      (project) =>
        project.title === title && project.question === body.question && project.mode === body.mode,
    );
    const scopeFingerprint = fingerprintMonitoringScope({
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
      frequency,
    });
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
            idempotencyKey: body.idempotencyKey,
            scopeFingerprint,
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
    // A terminally settled pin is not joinable: retrying a failed,
    // cancelled, or otherwise finished update must fall through to
    // startMonitoringUpdate for a fresh update. The stage read is
    // best-effort: a failed read or a missing row keeps today's join, so a
    // transient failure never forks paid work.
    let pinnedUpdateTerminal = false;
    if (pinnedToUpdateId && latestRevision && !reportedRevisionIds.has(latestRevision.id)) {
      try {
        const stageResult = await context.supabase
          .from("growth_intelligence_monitoring_updates")
          .select("stage")
          .eq("organization_id", organizationId)
          .eq("update_id", pinnedToUpdateId)
          .limit(1);
        const stageRows = (stageResult as { data: unknown }).data;
        const stage = Array.isArray(stageRows)
          ? (stageRows[0] as { stage?: unknown } | undefined)?.stage
          : undefined;
        pinnedUpdateTerminal =
          typeof stage === "string" &&
          (MONITORING_UPDATE_TERMINAL_STAGES as readonly string[]).includes(stage);
      } catch {
        pinnedUpdateTerminal = false;
      }
    }
    const activeUpdateId =
      pinnedToUpdateId &&
      latestRevision &&
      !reportedRevisionIds.has(latestRevision.id) &&
      !pinnedUpdateTerminal
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
        // Idempotent convergence: the retry joins the running (non-terminal)
        // update. A best-effort re-nudge assures delivery of work that lost
        // its wake-up.
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

/**
 * Agent fallback lane opt-in toggle.
 *
 * PATCH flips `agent_lane_opt_in` for a single project pinned to the
 * caller's own organization: the update carries both the session
 * organization and the project id, so an unknown id or another
 * organization's project updates zero rows and reads as not-found (404),
 * never as a permission leak. Managers only; viewers are refused before
 * touching persistence.
 */
export async function PATCH(
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
        "You do not have permission to update Market Intelligence research.",
      );
    }
    correlationId = correlation.parseAfterAuthorization();

    const body = optInBodySchema.parse(await request.json().catch(() => ({})));

    const updated = (await context.supabase
      .from("growth_intelligence_research_projects")
      .update({ agent_lane_opt_in: body.agent_lane_opt_in })
      .eq("organization_id", organizationId)
      .eq("id", body.project_id)
      .select("id,agent_lane_opt_in")) as { data: unknown; error: unknown };
    if (updated.error) {
      throw new DomainError(
        "UNEXPECTED_ERROR",
        "The agent lane setting could not be saved. Try again.",
        updated.error,
      );
    }
    const updatedRows = Array.isArray(updated.data) ? updated.data : [];
    const parsed = projectOptInRowSchema.safeParse(updatedRows[0]);
    if (!parsed.success) {
      throw new DomainError(
        "TENANT_SCOPE_ERROR",
        "This research project was not found in your organization.",
      );
    }

    logger.info("growth_intelligence.monitoring_project_opt_in_updated", {
      organizationId,
      correlationId,
    });
    const response = NextResponse.json({
      project: { projectId: parsed.data.id, agentLaneOptIn: parsed.data.agent_lane_opt_in },
      correlationId,
    });
    response.headers.set("x-correlation-id", correlationId);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    logger.warn("growth_intelligence.monitoring_project_opt_in_api_failed", {
      organizationId,
      correlationId,
      errorCode: toPublicError(error).code,
    });
    return marketProfileApiErrorResponse(error, correlationId);
  }
}
