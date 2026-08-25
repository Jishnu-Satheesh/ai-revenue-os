import { NextResponse } from "next/server";
import { z } from "zod";

import { hasOrganizationPermission } from "@/domain/access/permissions";
import { apiErrorResponse, getOrganizationContext } from "@/lib/api/organization-context";
import { DomainError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { triageRecommendation } from "@/modules/analysis/application/triage";
import { assertGovernedChannelAnalysisEnabled } from "@/modules/integrations/application/feature-access";
import type { OrganizationRole } from "@/domain/organizations/types";

/**
 * Answer one recommendation: acknowledged, planned, or dismissed with a
 * reason. The answer is appended where it happened -- the definer function
 * re-checks actor, membership, and tenant inside the database; this route only
 * decides who is allowed to ask and what shape an answer may take.
 */

const paramsSchema = z.object({
  organizationId: z.string().uuid(),
  recommendationId: z.string().uuid(),
});

const bodySchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("acknowledged") }).strict(),
  z.object({ decision: z.literal("planned") }).strict(),
  z.object({
    decision: z.literal("dismissed"),
    /** Why it is being dismissed; a dismissal without one says nothing. */
    reason: z.string().min(3),
  }).strict(),
]);

export async function POST(
  request: Request,
  {
    params,
  }: { params: Promise<{ organizationId: string; recommendationId: string }> },
) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  try {
    const routeParams = paramsSchema.parse(await params);
    const context = await getOrganizationContext(
      Promise.resolve({ organizationId: routeParams.organizationId }),
    );

    // Enforced before the permission check, so an organization the slice is
    // off for cannot reach it through a hand-typed URL.
    assertGovernedChannelAnalysisEnabled(routeParams.organizationId);

    if (
      !hasOrganizationPermission(
        context.membership.role as OrganizationRole,
        "recommendation.triage",
      )
    ) {
      throw new DomainError(
        "AUTHORIZATION_ERROR",
        "You do not have permission to answer recommendations for this organization.",
      );
    }

    const body = bodySchema.parse(await request.json().catch(() => ({})));
    await triageRecommendation(
      {
        organizationId: routeParams.organizationId,
        recommendationId: routeParams.recommendationId,
        decision: body.decision,
        reason: body.decision === "dismissed" ? body.reason : undefined,
      },
      { supabase: context.supabase, actorId: context.user.id },
    );

    // Ids and the decision kind only: why the operator dismissed it is their
    // words, stored for them, never echoed into a log line.
    logger.info("channel_recommendation.triaged", {
      organizationId: routeParams.organizationId,
      recommendationId: routeParams.recommendationId,
      decisionKind: body.decision,
      correlationId,
    });

    return NextResponse.json(
      { recommendationId: routeParams.recommendationId, correlationId },
      { status: 200 },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
