import { NextResponse } from "next/server";
import { z } from "zod";

import { createEventPublisher } from "@/domain/events/publisher";
import { onboardingSectionKeySchema, sectionSaveSchema } from "@/domain/onboarding/types";
import { apiErrorResponse, getOrganizationContext } from "@/lib/api/organization-context";
import { createOnboardingService } from "@/modules/onboarding/application/service";
import { createOnboardingRepository } from "@/modules/onboarding/infrastructure/repository";

const routeParamsSchema = z.object({
  organizationId: z.string().uuid(),
  sectionKey: onboardingSectionKeySchema,
});

const sectionRequestSchema = z.object({
  sessionId: z.string().min(1),
  status: sectionSaveSchema.shape.status,
  payload: sectionSaveSchema.shape.payload,
  sourceMetadata: sectionSaveSchema.shape.sourceMetadata.optional(),
  idempotencyKey: sectionSaveSchema.shape.idempotencyKey,
  correlationId: z.string().uuid().optional(),
});

/**
 * Reprices margins once the operator has stated what their costs are.
 *
 * Fire and forget. The rates are already saved and are the durable answer; a
 * recompute that could not be queued means yesterday's margins are stale for a
 * while, not that the operator's work was lost. Failing the save here would
 * discard a completed section over a queue hiccup.
 *
 * Without this the operator types their commission, saves, and nothing they can
 * see changes — which reads as the form not working.
 */
async function queueLedgerRecompute(organizationId: string): Promise<void> {
  try {
    const { tasks } = await import("@trigger.dev/sdk");
    await tasks.trigger(
      "economics.recompute-ledger",
      { organizationId, reason: "rates_changed" },
      { concurrencyKey: organizationId },
    );
  } catch {
    // Swallowed on purpose; see above. The next import reprices anyway.
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; sectionKey: string }> },
) {
  try {
    const rawParams = await params;
    const route = routeParamsSchema.parse(rawParams);
    const context = await getOrganizationContext(
      Promise.resolve({ organizationId: route.organizationId }),
      ["owner", "admin", "operator"],
    );
    const input = sectionRequestSchema.parse(await request.json());
    const service = createOnboardingService({
      repository: createOnboardingRepository(context.supabase),
      publisher: createEventPublisher(),
    });
    const state = await service.saveSection({
      organizationId: context.organizationId,
      userId: context.user.id,
      sessionId: input.sessionId,
      sectionKey: route.sectionKey,
      status: input.status,
      payload: input.payload,
      sourceMetadata: input.sourceMetadata,
      idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId,
    });

    if (route.sectionKey === "cost_structure" && input.status === "complete")
      await queueLedgerRecompute(context.organizationId);

    return NextResponse.json({ state });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
