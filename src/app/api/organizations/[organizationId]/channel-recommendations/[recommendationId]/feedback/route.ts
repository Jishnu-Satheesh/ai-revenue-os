import { NextResponse } from "next/server";
import { z } from "zod";

import { apiErrorResponse, getOrganizationContext } from "@/lib/api/organization-context";
import { logger } from "@/lib/logger";
import { recordFeedback } from "@/modules/analysis/application/triage";
import { assertGovernedChannelAnalysisEnabled } from "@/modules/integrations/application/feature-access";

/**
 * Grade one recommendation: helpful or not, one vote per member, upserted in
 * place by the definer function. Grading the narrator takes less authority
 * than answering it, so any member may vote and no permission is checked
 * beyond membership itself.
 */

const paramsSchema = z.object({
  organizationId: z.string().uuid(),
  recommendationId: z.string().uuid(),
});

const bodySchema = z
  .object({
    helpful: z.boolean(),
  })
  .strict();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; recommendationId: string }> },
) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  try {
    const routeParams = paramsSchema.parse(await params);
    const context = await getOrganizationContext(
      Promise.resolve({ organizationId: routeParams.organizationId }),
    );

    // Enforced before any work, so an organization the slice is off for
    // cannot reach it through a hand-typed URL.
    assertGovernedChannelAnalysisEnabled(routeParams.organizationId);

    const body = bodySchema.parse(await request.json().catch(() => ({})));
    await recordFeedback(
      {
        organizationId: routeParams.organizationId,
        recommendationId: routeParams.recommendationId,
        helpful: body.helpful,
      },
      { supabase: context.supabase, actorId: context.user.id },
    );

    // The vote lives where it belongs -- on the storage row, beside the
    // actor who cast it. The log stays identifier-free by allowlist.
    logger.info("channel_recommendation.feedback_recorded", {
      organizationId: routeParams.organizationId,
      recommendationId: routeParams.recommendationId,
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
