import { NextResponse } from "next/server";
import { z } from "zod";

import { createEventPublisher } from "@/domain/events/publisher";
import { saveBusinessFact } from "@/modules/organizations/infrastructure/repository";
import { apiErrorResponse, getOrganizationContext } from "@/lib/api/organization-context";
import { validateCandidateReview } from "@/modules/onboarding/application/extraction-service";
import { createOnboardingExtractionRepository } from "@/modules/onboarding/infrastructure/repository";
import { DomainError } from "@/lib/errors";

const paramsSchema = z.object({
  organizationId: z.string().uuid(),
  candidateId: z.string().uuid(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; candidateId: string }> },
) {
  try {
    const route = paramsSchema.parse(await params);
    const context = await getOrganizationContext(
      Promise.resolve({ organizationId: route.organizationId }),
      ["owner", "admin", "operator"],
    );
    const repository = createOnboardingExtractionRepository(context.supabase);
    const candidate = await repository.findCandidate({
      organizationId: context.organizationId,
      candidateId: route.candidateId,
    });
    if (!candidate)
      throw new DomainError("TENANT_SCOPE_ERROR", "The onboarding candidate is not available.");
    const review = validateCandidateReview(await request.json(), candidate.section_key as never);
    const nextStatus =
      review.action === "confirm"
        ? "confirmed"
        : review.action === "edit"
          ? "edited"
          : review.action === "reject"
            ? "rejected"
            : "unknown";
    const reviewedCandidate = await repository.updateCandidate({
      organizationId: context.organizationId,
      candidateId: candidate.id,
      patch: {
        status: nextStatus,
        candidate_payload: review.payload ?? candidate.candidate_payload,
        evidence: review.evidence,
        reviewed_by: context.user.id,
        reviewed_at: new Date().toISOString(),
      },
    });
    if (review.action === "confirm" || review.action === "edit") {
      const factKey = candidate.fact_key ?? `onboarding.${candidate.id.replaceAll("-", "")}`;
      await saveBusinessFact(context.supabase, context.organizationId, context.user.id, {
        factKey,
        value: review.payload ?? candidate.candidate_payload,
        source: "upload",
        sourceReference: review.evidence[0]?.sourceReference,
        status: "verified",
        confidence: candidate.confidence,
      });
      await createEventPublisher().publish({
        eventId: crypto.randomUUID(),
        eventName: "onboarding.fact_confirmed",
        occurredAt: new Date().toISOString(),
        organizationId: context.organizationId,
        actorType: "user",
        actorId: context.user.id,
        correlationId: crypto.randomUUID(),
        schemaVersion: 1,
        payload: {
          candidateId: candidate.id,
          sectionKey: candidate.section_key,
          action: review.action,
        },
      });
    }
    return NextResponse.json({ candidate: reviewedCandidate });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
