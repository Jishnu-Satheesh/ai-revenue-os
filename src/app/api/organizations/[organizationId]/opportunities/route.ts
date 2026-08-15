import { NextResponse } from "next/server";

import { apiErrorResponse, getOrganizationContext } from "@/lib/api/organization-context";
import { buildOpportunityFeed } from "@/modules/decisions/application/feed";
import { createDecisionRepository } from "@/modules/decisions/infrastructure/repository";
import type { DecisionPersistence } from "@/modules/decisions/infrastructure/repository";

/**
 * The operator's opportunity feed.
 *
 * Every member may read it, so no role list is passed: the Decision Engine's
 * reasoning is not privileged information inside an organization. What a
 * reader may *do* about an opportunity is decided per entry from their role,
 * and the write route enforces that again rather than trusting this shape.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  try {
    const context = await getOrganizationContext(params);
    const repository = createDecisionRepository(
      // The authenticated session client. Reads stay inside RLS; the feed has
      // no service-role path by construction.
      context.supabase as unknown as DecisionPersistence,
    );

    const items = await repository.listOpportunities(context.organizationId);
    const feed = buildOpportunityFeed({
      items,
      role: context.membership.role,
      now: new Date(),
      organizationId: context.organizationId,
    });

    return NextResponse.json({ feed });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
