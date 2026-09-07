import { NextResponse } from "next/server";
import { z } from "zod";

import { hasOrganizationPermission } from "@/domain/access/permissions";
import type { OrganizationRole } from "@/domain/organizations/types";
import { apiErrorResponse, getOrganizationContext } from "@/lib/api/organization-context";
import { DomainError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { requestChannelRecommendations } from "@/modules/analysis/application/dispatch";
import { createAuthenticatedChannelAnalysisRepository } from "@/modules/analysis/infrastructure/read-repository";
import { assertGovernedChannelAnalysisEnabled } from "@/modules/integrations/application/feature-access";

/**
 * Wake the narrator for a run that completed without one.
 *
 * The detector run already counted, so nothing here recomputes findings --
 * it re-fires the best-effort wake the analysis task sends on completion.
 * The run is read back first (completed, this tenant, this channel), and the
 * claim fence makes a duplicate wake harmless, so a twice-pressed button
 * cannot file a second narration.
 */

const paramsSchema = z.object({
  organizationId: z.string().uuid(),
  channelId: z.string().uuid(),
  analysisRunId: z.string().uuid(),
});

export async function POST(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ organizationId: string; channelId: string; analysisRunId: string }>;
  },
) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  try {
    const routeParams = paramsSchema.parse(await params);
    const context = await getOrganizationContext(
      Promise.resolve({ organizationId: routeParams.organizationId }),
    );

    assertGovernedChannelAnalysisEnabled(routeParams.organizationId);

    // Narrating spends model budget over evidence that already exists. It
    // writes no evidence of its own, which is why it sits with retry rather
    // than with contract approval.
    if (!hasOrganizationPermission(context.membership.role as OrganizationRole, "report.retry")) {
      throw new DomainError(
        "AUTHORIZATION_ERROR",
        "You do not have permission to request narration for this organization.",
      );
    }

    // Read by id rather than searched in the page's run list: that list is
    // capped at the handful a page shows, and a run older than the cap is
    // still a run whose narration is missing.
    const run = await createAuthenticatedChannelAnalysisRepository(context.supabase).loadRun({
      organizationId: routeParams.organizationId,
      channelId: routeParams.channelId,
      analysisRunId: routeParams.analysisRunId,
    });
    // A run from another channel reads as absent here on purpose: naming
    // which channel it belongs to would leak tenant state to the caller.
    if (!run) {
      throw new DomainError(
        "VALIDATION_ERROR",
        "That analysis run was not found for this channel.",
      );
    }
    if (run.status !== "completed") {
      throw new DomainError(
        "VALIDATION_ERROR",
        "Narration can only be requested for a completed analysis run.",
      );
    }

    const dispatched = await requestChannelRecommendations({
      organizationId: routeParams.organizationId,
      channelId: routeParams.channelId,
      analysisRunId: run.id,
      correlationId,
    });

    if (!dispatched) {
      throw new DomainError(
        "INTEGRATION_ERROR",
        "The narration could not be started. Try again in a moment.",
      );
    }

    logger.info("channel_recommendations.requested", {
      organizationId: routeParams.organizationId,
      channelId: routeParams.channelId,
      runId: run.id,
      correlationId,
    });

    return NextResponse.json({ analysisRunId: run.id, correlationId }, { status: 202 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
