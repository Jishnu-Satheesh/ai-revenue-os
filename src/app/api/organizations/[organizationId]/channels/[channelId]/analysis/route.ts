import { NextResponse } from "next/server";
import { z } from "zod";

import { hasOrganizationPermission } from "@/domain/access/permissions";
import { apiErrorResponse, getOrganizationContext } from "@/lib/api/organization-context";
import { DomainError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { requestChannelAnalysis } from "@/modules/analysis/application/dispatch";
import { assertGovernedChannelAnalysisEnabled } from "@/modules/integrations/application/feature-access";
import type { OrganizationRole } from "@/domain/organizations/types";

/**
 * Start a deterministic analysis of one channel over a declared window.
 *
 * The window is supplied, never inferred. A window derived from whatever
 * evidence happens to exist can never report a gap at its own edges: three days
 * of January would look like a complete three-day window rather than a January
 * missing twenty-eight days.
 *
 * This route starts work; it does not decide anything. The claim RPC re-resolves
 * the channel, the branch timezone, and the metric vocabulary, and refuses a
 * request it cannot bind. Nothing here reaches a table directly.
 */

const paramsSchema = z.object({
  organizationId: z.string().uuid(),
  channelId: z.string().uuid(),
});

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.");

const bodySchema = z
  .object({
    windowStart: localDate,
    windowEnd: localDate,
    periodGrain: z.enum(["day", "week", "month", "span"]),
    /** Optional: absent analyses every branch this channel trades through. */
    branchId: z.string().uuid().nullable().default(null),
  })
  .strict()
  .refine((body) => body.windowEnd >= body.windowStart, {
    message: "The window must end on or after it starts.",
    path: ["windowEnd"],
  });

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
    const analysisRunId = crypto.randomUUID();
    const dispatched = await requestChannelAnalysis({
      organizationId: routeParams.organizationId,
      channelId: routeParams.channelId,
      branchId: body.branchId,
      windowStart: body.windowStart,
      windowEnd: body.windowEnd,
      periodGrain: body.periodGrain,
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
      runId: analysisRunId,
      correlationId,
    });

    return NextResponse.json({ analysisRunId, correlationId }, { status: 202 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
