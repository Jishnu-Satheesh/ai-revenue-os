import { NextResponse } from "next/server";
import { z } from "zod";

import { hasOrganizationPermission } from "@/domain/access/permissions";
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
  loadAssembledReportView,
  type ReportReaderPersistence,
} from "@/modules/growth-intelligence/application/report-reader";

/**
 * Slice 5 report reader payload.
 *
 * GET resolves one assembled report version — the report row plus its
 * pinned brief revision plus the evidence digest — so a history entry
 * always opens the exact version it ran against, even after later brief
 * edits. Viewers may read; the optional branchId narrows the lookup and a
 * mismatch reads as not-found, never as another location's content.
 */

const paramsSchema = z
  .object({ organizationId: z.string().uuid(), reportVersionId: z.string().uuid() })
  .strict();

const querySchema = z
  .object({ branchId: z.string().uuid().nullable().optional() })
  .strict();

export async function GET(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; reportVersionId: string }> },
) {
  const correlation = marketProfileCorrelationState(request);
  let correlationId = correlation.responseId;
  let organizationId: string | undefined;
  try {
    const parsedParams = paramsSchema.parse(await params);
    const context = await getOrganizationContext(
      Promise.resolve({ organizationId: parsedParams.organizationId }),
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
    const query = querySchema.parse({ branchId: url.searchParams.get("branchId") });

    const view = await loadAssembledReportView(
      context.supabase as unknown as ReportReaderPersistence,
      {
        organizationId,
        reportVersionId: parsedParams.reportVersionId,
        ...(query.branchId ? { branchId: query.branchId } : {}),
      },
    );

    const response = NextResponse.json({ report: view, correlationId });
    response.headers.set("x-correlation-id", correlationId);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    logger.warn("growth_intelligence.monitoring_report_api_failed", {
      organizationId,
      correlationId,
      errorCode: toPublicError(error).code,
    });
    return marketProfileApiErrorResponse(error, correlationId);
  }
}
