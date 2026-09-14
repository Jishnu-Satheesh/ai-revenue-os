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
import { renderMarketMonitoringReportPdf } from "@/workflows/reports/market-monitoring-report-pdf";

/**
 * Slice 5 report PDF download.
 *
 * GET renders PDF bytes from the same assembled report version the reader
 * route serves (report row + pinned brief revision + evidence digest), so
 * the download and the dialog can never disagree. Same authorization as
 * the reader: organization scope plus growth_intelligence.read, which
 * viewers hold.
 */

const paramsSchema = z
  .object({ organizationId: z.string().uuid(), reportVersionId: z.string().uuid() })
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

    const view = await loadAssembledReportView(
      context.supabase as unknown as ReportReaderPersistence,
      { organizationId, reportVersionId: parsedParams.reportVersionId },
    );
    const rendered = renderMarketMonitoringReportPdf(view);

    const response = new NextResponse(new Uint8Array(rendered.bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${rendered.filename}"`,
        "content-length": String(rendered.bytes.length),
        "x-correlation-id": correlationId,
        "Cache-Control": "no-store",
      },
    });
    return response;
  } catch (error) {
    logger.warn("growth_intelligence.monitoring_report_download_api_failed", {
      organizationId,
      correlationId,
      errorCode: toPublicError(error).code,
    });
    return marketProfileApiErrorResponse(error, correlationId);
  }
}
