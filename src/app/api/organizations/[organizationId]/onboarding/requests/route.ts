import { NextResponse } from "next/server";
import { z } from "zod";

import { createEventPublisher } from "@/domain/events/publisher";
import { onboardingRequestInputSchema } from "@/domain/onboarding/types";
import { apiErrorResponse, getOrganizationContext } from "@/lib/api/organization-context";
import { createOnboardingService } from "@/modules/onboarding/application/service";
import { createOnboardingRepository } from "@/modules/onboarding/infrastructure/repository";

const paramsSchema = z.object({ organizationId: z.string().uuid() });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  try {
    const parsedParams = paramsSchema.parse(await params);
    const context = await getOrganizationContext(Promise.resolve(parsedParams), [
      "owner",
      "admin",
      "operator",
    ]);
    const input = onboardingRequestInputSchema.parse(await request.json());
    const service = createOnboardingService({
      repository: createOnboardingRepository(context.supabase),
      publisher: createEventPublisher(),
    });
    const onboardingRequest = await service.createRequest({
      ...input,
      organizationId: context.organizationId,
      userId: context.user.id,
    });
    return NextResponse.json({ request: onboardingRequest }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
