import { NextResponse } from "next/server";
import { z } from "zod";

import { createEventPublisher } from "@/domain/events/publisher";
import { apiErrorResponse, getOrganizationContext } from "@/lib/api/organization-context";
import { createOnboardingService } from "@/modules/onboarding/application/service";
import { createOnboardingRepository } from "@/modules/onboarding/infrastructure/repository";

const paramsSchema = z.object({ organizationId: z.string().uuid() });

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  try {
    const rawParams = await params;
    const parsedParams = paramsSchema.parse(rawParams);
    const context = await getOrganizationContext(Promise.resolve(parsedParams), [
      "owner",
      "admin",
      "operator",
    ]);
    const service = createOnboardingService({
      repository: createOnboardingRepository(context.supabase),
      publisher: createEventPublisher(),
    });
    await service.startOrResumeSession({
      organizationId: context.organizationId,
      userId: context.user.id,
    });
    const snapshot = await service.getSnapshot(context.organizationId);
    return NextResponse.json({ snapshot });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
