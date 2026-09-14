import { NextResponse } from "next/server";
import { z } from "zod";

import { hasOrganizationPermission } from "@/domain/access/permissions";
import { createEventPublisher } from "@/domain/events/publisher";
import type { OrganizationRole } from "@/domain/organizations/types";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { DomainError, toPublicError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  marketProfileApiErrorResponse,
  marketProfileCorrelationState,
} from "@/modules/growth-intelligence/application/api-schemas";
import {
  createMarketMonitoringAcceptanceService,
  type AcceptanceReportLoader,
} from "@/modules/growth-intelligence/application/acceptance-service";
import { assertGrowthIntelligenceAccess } from "@/modules/growth-intelligence/application/feature-access";
import {
  loadAssembledReportView,
  type ReportReaderPersistence,
} from "@/modules/growth-intelligence/application/report-reader";
import { createAuthenticatedResearchProjectRepository } from "@/modules/growth-intelligence/infrastructure/research-project-repository";

/**
 * Slice 6 draft-advice acceptance.
 *
 * POST accepts the selected draft items of one pinned report version through
 * the owning module's fenced `accept_draft_item` RPC — one call per item on
 * the exact key of report version id plus item key. Replays converge on the
 * kept row and report `already_accepted` with an explanation instead of
 * duplicating feed items. Accepted actions route to Recommendations and
 * accepted findings to Insights, each keeping its exact source-report link
 * (report version, project, pinned brief revision). Acceptance never grants
 * Campaign execution approval, spending or publication.
 *
 * POST with `{ markReviewed: true }` records an explicit review for reports
 * with zero draft items (reviewer identity plus audit event, no feed
 * writes); it never accepts anything.
 */

const paramsSchema = z
  .object({ organizationId: z.string().uuid(), reportVersionId: z.string().uuid() })
  .strict();

const acceptItemSchema = z
  .object({
    itemKey: z.string().trim().min(1).max(160),
    kind: z.enum(["action", "finding"]),
  })
  .strict();

const acceptItemsBodySchema = z
  .object({
    items: z.array(acceptItemSchema).min(1).max(100),
    idempotencyKey: z.string().trim().min(1).max(200),
    branchId: z.string().uuid().optional(),
  })
  .strict();

const markReviewedBodySchema = z
  .object({
    markReviewed: z.literal(true),
    idempotencyKey: z.string().trim().min(1).max(200),
    branchId: z.string().uuid().optional(),
  })
  .strict();

const bodySchema = z.union([acceptItemsBodySchema, markReviewedBodySchema]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; reportVersionId: string }> },
) {
  const correlation = marketProfileCorrelationState(request);
  let correlationId = correlation.responseId;
  let organizationId: string | undefined;
  let reportVersionId: string | undefined;
  try {
    const parsedParams = paramsSchema.parse(await params);
    const context = await getOrganizationContext(
      Promise.resolve({ organizationId: parsedParams.organizationId }),
    );
    organizationId = context.organizationId;
    reportVersionId = parsedParams.reportVersionId;

    assertGrowthIntelligenceAccess(organizationId, "market");
    if (
      !hasOrganizationPermission(
        context.membership.role as OrganizationRole,
        "growth_intelligence.manage",
      )
    ) {
      throw new DomainError(
        "AUTHORIZATION_ERROR",
        "You do not have permission to accept Market Intelligence research.",
      );
    }
    correlationId = correlation.parseAfterAuthorization();

    const body = bodySchema.parse(await request.json().catch(() => ({})));
    const persistence = context.supabase as unknown as ReportReaderPersistence;
    const loader: AcceptanceReportLoader = (input) => loadAssembledReportView(persistence, input);
    const service = createMarketMonitoringAcceptanceService({
      loader,
      writer: createAuthenticatedResearchProjectRepository(
        context.supabase as unknown as Parameters<
          typeof createAuthenticatedResearchProjectRepository
        >[0],
      ),
      events: createEventPublisher(),
    });

    if ("markReviewed" in body) {
      const reviewed = await service.markReportReviewed({
        organizationId,
        reportVersionId,
        ...(body.branchId ? { branchId: body.branchId } : {}),
        actorId: context.user.id,
        correlationId,
      });
      logger.info("growth_intelligence.monitoring_report_reviewed", {
        organizationId,
        correlationId,
      });
      const response = NextResponse.json({ ...reviewed, correlationId });
      response.headers.set("x-correlation-id", correlationId);
      response.headers.set("Cache-Control", "no-store");
      return response;
    }

    const accepted = await service.acceptSelectedItems({
      organizationId,
      reportVersionId,
      ...(body.branchId ? { branchId: body.branchId } : {}),
      actorId: context.user.id,
      correlationId,
      idempotencyKey: body.idempotencyKey,
      items: body.items,
    });
    logger.info("growth_intelligence.monitoring_report_accepted", {
      organizationId,
      correlationId,
    });
    const response = NextResponse.json({ ...accepted, correlationId });
    response.headers.set("x-correlation-id", correlationId);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    logger.warn("growth_intelligence.monitoring_report_accept_api_failed", {
      organizationId,
      correlationId,
      errorCode: toPublicError(error).code,
    });
    return marketProfileApiErrorResponse(error, correlationId);
  }
}
