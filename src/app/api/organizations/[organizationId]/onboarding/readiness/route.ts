import { NextResponse } from "next/server";
import { z } from "zod";

import { createEventPublisher } from "@/domain/events/publisher";
import { apiErrorResponse, getOrganizationContext } from "@/lib/api/organization-context";
import { createOnboardingService } from "@/modules/onboarding/application/service";
import { createOnboardingRepository } from "@/modules/onboarding/infrastructure/repository";

const paramsSchema = z.object({ organizationId: z.string().uuid() });
const requestSchema = z.object({ sessionId: z.string().min(1).max(100) });

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
    const input = requestSchema.parse(await request.json());
    const service = createOnboardingService({
      repository: createOnboardingRepository(context.supabase),
      publisher: createEventPublisher(),
    });
    const readiness = await service.generateReadiness({
      organizationId: context.organizationId,
      userId: context.user.id,
      sessionId: input.sessionId,
    });
    return NextResponse.json({ readiness });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
