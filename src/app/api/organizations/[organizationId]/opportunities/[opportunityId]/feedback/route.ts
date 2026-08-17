import { NextResponse } from "next/server";
import { z } from "zod";

import { DomainError } from "@/lib/errors";
import {
  apiErrorResponse,
  getOrganizationContext,
  publishOrganizationEvent,
} from "@/lib/api/organization-context";
import { decisionFeedbackInputSchema } from "@/modules/decisions/application/ports";
import { createDecisionRepository } from "@/modules/decisions/infrastructure/repository";
import type { DecisionPersistence } from "@/modules/decisions/infrastructure/repository";

/**
 * The operator's answer to one opportunity.
 *
 * Feedback is append-only: an answer records what a human decided at a moment,
 * and rewriting it later would destroy the evidence the Decision Engine learns
 * from. The organization and opportunity come from the route, never the body,
 * so a request cannot redirect a write to another tenant's row.
 */
const requestBodySchema = z.strictObject({
  feedbackKind: z.enum(["approved", "rejected", "snoozed", "edited", "more_evidence_requested"]),
  reason: z.string().trim().min(1).max(500).nullable(),
  editDiff: z
    .strictObject({
      title: z.string().max(240).optional(),
      summary: z.string().max(4000).optional(),
      assumptions: z.array(z.string().max(500)).max(50).optional(),
    })
    .optional(),
});

const opportunityIdSchema = z.string().uuid();

/** The lifecycle transition an answer causes, where it causes one. */
const LIFECYCLE_EVENTS = {
  approved: "opportunity.approved",
  rejected: "opportunity.rejected",
  snoozed: "opportunity.snoozed",
} as const;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; opportunityId: string }> },
) {
  try {
    const { opportunityId: rawOpportunityId } = await params;
    const context = await getOrganizationContext(params, ["owner", "admin", "operator"]);

    const opportunityId = opportunityIdSchema.safeParse(rawOpportunityId);
    if (!opportunityId.success) {
      throw new DomainError("VALIDATION_ERROR", "Opportunity ID is invalid.");
    }

    const parsedBody = await request.json().catch(() => {
      throw new DomainError("VALIDATION_ERROR", "The request body is not valid JSON.");
    });
    const body = requestBodySchema.parse(parsedBody);

    // Re-parsed through the port schema so the route and the repository agree
    // on one contract, including the rule that an edit must carry its diff.
    const input = decisionFeedbackInputSchema.parse({
      organizationId: context.organizationId,
      opportunityId: opportunityId.data,
      feedbackKind: body.feedbackKind,
      reason: body.reason,
      editDiff: body.editDiff ?? null,
      correlationId: crypto.randomUUID(),
    });

    const repository = createDecisionRepository(context.supabase as unknown as DecisionPersistence);
    const feedbackId = await repository.appendFeedback(input);

    // Published only after the append is confirmed, and carrying identifiers
    // only: the operator's reason is business context, not event payload.
    await publishOrganizationEvent({
      organizationId: context.organizationId,
      userId: context.user.id,
      eventName: "decision.feedback_captured",
      payload: { opportunityId: opportunityId.data, feedbackId },
    });

    const lifecycleEvent =
      LIFECYCLE_EVENTS[body.feedbackKind as keyof typeof LIFECYCLE_EVENTS] ?? null;
    if (lifecycleEvent) {
      await publishOrganizationEvent({
        organizationId: context.organizationId,
        userId: context.user.id,
        eventName: lifecycleEvent,
        payload: { opportunityId: opportunityId.data, feedbackId },
      });
    }

    return NextResponse.json({ feedbackId }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
