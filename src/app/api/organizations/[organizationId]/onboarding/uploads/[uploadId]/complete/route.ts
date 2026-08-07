import { NextResponse } from "next/server";
import { z } from "zod";

import { createEventPublisher } from "@/domain/events/publisher";
import { apiErrorResponse, getOrganizationContext } from "@/lib/api/organization-context";
import { createOnboardingExtractionRepository } from "@/modules/onboarding/infrastructure/repository";
import { runOnboardingExtraction } from "@/modules/onboarding/application/extraction-service";
import { DomainError } from "@/lib/errors";

const paramsSchema = z.object({ organizationId: z.string().uuid(), uploadId: z.string().uuid() });

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ organizationId: string; uploadId: string }> },
) {
  try {
    const route = paramsSchema.parse(await params);
    const context = await getOrganizationContext(
      Promise.resolve({ organizationId: route.organizationId }),
      ["owner", "admin", "operator"],
    );
    const repository = createOnboardingExtractionRepository(context.supabase);
    const upload = await repository.findUpload({
      organizationId: context.organizationId,
      uploadId: route.uploadId,
    });
    if (!upload)
      throw new DomainError("TENANT_SCOPE_ERROR", "The onboarding upload is not available.");
    const extraction = await repository.createExtraction({
      organization_id: context.organizationId,
      upload_id: upload.id,
      status: "pending",
      provider: null,
      model: null,
      retry_count: 0,
      error_summary: null,
      started_at: null,
      completed_at: null,
    });
    await repository.updateUpload({
      organizationId: context.organizationId,
      uploadId: upload.id,
      patch: { status: "uploaded" },
    });
    await createEventPublisher().publish({
      eventId: crypto.randomUUID(),
      eventName: "onboarding.upload.completed",
      occurredAt: new Date().toISOString(),
      organizationId: context.organizationId,
      actorType: "user",
      actorId: context.user.id,
      correlationId: crypto.randomUUID(),
      schemaVersion: 1,
      payload: { uploadId: upload.id, extractionId: extraction.id },
    });
    const result = await runOnboardingExtraction({
      repository,
      organizationId: context.organizationId,
      uploadId: upload.id,
      extractionId: extraction.id,
      readText: async (source) => {
        const { data, error } = await context.supabase.storage
          .from("onboarding-files")
          .download(source.storagePath);
        if (error || !data)
          throw new DomainError(
            "INTEGRATION_ERROR",
            "The uploaded source could not be read.",
            error,
          );
        return data.text();
      },
    });
    return NextResponse.json(
      {
        upload: await repository.findUpload({
          organizationId: context.organizationId,
          uploadId: upload.id,
        }),
        extraction: result.extraction,
        candidateCount: result.candidateCount,
      },
      { status: 200 },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
