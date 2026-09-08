import { NextResponse } from "next/server";
import { z } from "zod";

import { hasOrganizationPermission } from "@/domain/access/permissions";
import { apiErrorResponse, getOrganizationContext } from "@/lib/api/organization-context";
import { consumeAnalysisRunAllowance } from "@/lib/cache/rate-limit";
import { localDaysBetween } from "@/domain/analysis/calendar";
import { MAX_ANALYSIS_WINDOW_DAYS } from "@/domain/analysis/window-selection";
import { DomainError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { requestChannelAnalysis } from "@/modules/analysis/application/dispatch";
import { createAuthenticatedChannelAnalysisRepository } from "@/modules/analysis/infrastructure/read-repository";
import { assertGovernedChannelAnalysisEnabled } from "@/modules/integrations/application/feature-access";
import type { OrganizationRole } from "@/domain/organizations/types";

/**
 * Start a deterministic analysis of one channel over a picked date range.
 *
 * The range is the operator's, but its admissibility is not: the resolver
 * below re-decides it against the channel's declared coverage, and the worker
 * re-decides it a second time under its own lease before using a prior
 * result. A range the reports do not cover is refused here, before any work
 * starts.
 *
 * Authorization and cost control are orthogonal and both apply, in that
 * order: `report.retry` decides who may ask at all, and an organization-scoped
 * rate limit caps how often someone who may ask can spend a detector pass and
 * an AI narration. Neither substitutes for the other. See ADR 0048.
 *
 * This route starts work; it does not decide anything. The claim RPC re-resolves
 * the channel, the branch timezone, and the metric vocabulary, and refuses a
 * request it cannot bind. Nothing here reaches a table directly.
 */

const paramsSchema = z.object({
  organizationId: z.string().uuid(),
  channelId: z.string().uuid(),
});

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A picked range, not a month.
 *
 * The dates are the operator's, but their admissibility is not: the resolver
 * below re-decides it against the channel's declared coverage, and the worker
 * decides it a second time under its lease. See ADR 0048.
 */
const bodySchema = z
  .object({
    from: z.string().regex(LOCAL_DATE, "Use a YYYY-MM-DD date."),
    to: z.string().regex(LOCAL_DATE, "Use a YYYY-MM-DD date."),
  })
  .strict()
  .superRefine((value, ctx) => {
    let span: number;
    try {
      // Rejects the 31st of February rather than rolling it into March.
      span = localDaysBetween(value.from, value.to);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "That is not a real date." });
      return;
    }
    if (span < 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "The end date is before the start." });
    }
    // `>` not `>=`, matching the database's `<= 400` check exactly. See Task 1.
    if (span > MAX_ANALYSIS_WINDOW_DAYS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "That range is wider than one analysis can cover. Pick a shorter period.",
      });
    }
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
    // Channel-wide: the picker names no branch, so the run analyses every
    // branch this channel trades through.
    const resolved = await createAuthenticatedChannelAnalysisRepository(
      context.supabase,
    ).resolveWindowInput({
      organizationId: routeParams.organizationId,
      channelId: routeParams.channelId,
      from: body.from,
      to: body.to,
    });
    if (resolved === null) {
      throw new DomainError(
        "VALIDATION_ERROR",
        "That range is outside this channel's reported dates. Pick a period your approved reports declare.",
      );
    }

    // After coverage, never before: a mistyped date must not cost the
    // organization part of its allowance. Starting a run costs a detector
    // pass and an AI narration; the permission check above already decided
    // this caller may ask at all, and this caps how often. Reading an
    // already-computed range never reaches here.
    if (!(await consumeAnalysisRunAllowance(routeParams.organizationId))) {
      throw new DomainError(
        "RATE_LIMITED",
        "This organization has started a lot of analyses in the last hour. Ranges you have already analysed still open instantly; try a new one again shortly.",
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
      windowStart: resolved.windowStart,
      windowEnd: resolved.windowEnd,
      runId: analysisRunId,
      correlationId,
    });

    return NextResponse.json({ analysisRunId, correlationId }, { status: 202 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
