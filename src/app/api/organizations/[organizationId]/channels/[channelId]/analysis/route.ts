import { NextResponse } from "next/server";
import { z } from "zod";

import { hasOrganizationPermission } from "@/domain/access/permissions";
import { apiErrorResponse, getOrganizationContext } from "@/lib/api/organization-context";
import { DomainError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { requestChannelAnalysis } from "@/modules/analysis/application/dispatch";
import { createAuthenticatedChannelAnalysisRepository } from "@/modules/analysis/infrastructure/read-repository";
import { assertGovernedChannelAnalysisEnabled } from "@/modules/integrations/application/feature-access";
import type { OrganizationRole } from "@/domain/organizations/types";

/**
 * Start a deterministic analysis of one channel for one calendar month.
 *
 * The month is selected, never inferred and never accompanied by caller
 * dates: the server resolves the window, the zone, and the grain from the
 * channel's declared packages, and the worker re-resolves the evidence and
 * cache key under its lease before using a prior result. A month the reports
 * do not declare is refused here, before any work starts.
 *
 * This route starts work; it does not decide anything. The claim RPC re-resolves
 * the channel, the branch timezone, and the metric vocabulary, and refuses a
 * request it cannot bind. Nothing here reaches a table directly.
 */

const paramsSchema = z.object({
  organizationId: z.string().uuid(),
  channelId: z.string().uuid(),
});

const bodySchema = z
  .object({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use a YYYY-MM month."),
  })
  .strict();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; channelId: string }> },
) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  try {
    const routeParams = paramsSchema.parse(await params);
    const context = await getOrganizationContext(
      Promise.resolve({ organizationId: routeParams.organizationId }),
    );

    // Enforced before the read, so an organization the slice is off for cannot
    // reach it through a hand-typed URL.
    assertGovernedChannelAnalysisEnabled(routeParams.organizationId);

    // Running an analysis recomputes over evidence that already exists. It
    // writes no evidence of its own, which is why it sits with retry rather
    // than with contract approval.
    if (!hasOrganizationPermission(context.membership.role as OrganizationRole, "report.retry")) {
      throw new DomainError(
        "AUTHORIZATION_ERROR",
        "You do not have permission to run an analysis for this organization.",
      );
    }

    const body = bodySchema.parse(await request.json().catch(() => ({})));
    // Monthly selection is channel-wide: the picker names no branch, so the
    // run analyses every branch this channel trades through.
    const resolved = await createAuthenticatedChannelAnalysisRepository(
      context.supabase,
    ).resolveMonthInput({
      organizationId: routeParams.organizationId,
      channelId: routeParams.channelId,
      month: body.month,
    });
    if (resolved === null) {
      throw new DomainError(
        "VALIDATION_ERROR",
        "That month is outside this channel's reported timeline. Pick a month your approved reports declare.",
      );
    }

    const analysisRunId = crypto.randomUUID();
    const dispatched = await requestChannelAnalysis({
      organizationId: routeParams.organizationId,
      channelId: routeParams.channelId,
      branchId: null,
      windowStart: resolved.windowStart,
      windowEnd: resolved.windowEnd,
      periodGrain: resolved.grain,
      month: body.month,
      windowTimezone: resolved.timeZone,
      analysisRunId,
      correlationId,
    });

    // A dispatch that did not happen is reported as one. A button that silently
    // does nothing sends an operator back to a page that never changes.
    if (!dispatched) {
      throw new DomainError(
        "INTEGRATION_ERROR",
        "The analysis could not be started. Try again in a moment.",
      );
    }

    logger.info("channel_analysis.requested", {
      organizationId: routeParams.organizationId,
      channelId: routeParams.channelId,
      month: body.month,
      runId: analysisRunId,
      correlationId,
    });

    return NextResponse.json({ analysisRunId, correlationId }, { status: 202 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
