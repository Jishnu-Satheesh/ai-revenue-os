import { NextResponse } from "next/server";
import { z } from "zod";

import { createEventPublisher } from "@/domain/events/publisher";
import { apiErrorResponse, getOrganizationContext } from "@/lib/api/organization-context";
import {
  validateUploadInput,
  buildOnboardingStoragePath,
} from "@/modules/onboarding/application/extraction-service";
import {
  createOnboardingExtractionRepository,
  createOnboardingRepository,
} from "@/modules/onboarding/infrastructure/repository";
import { DomainError } from "@/lib/errors";
import { createHash } from "node:crypto";

const paramsSchema = z.object({ organizationId: z.string().uuid() });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  try {
    const route = paramsSchema.parse(await params);
    const context = await getOrganizationContext(Promise.resolve(route), [
      "owner",
      "admin",
      "operator",
    ]);
    const isMultipart =
      request.headers.get("content-type")?.includes("multipart/form-data") ?? false;
    const formData = isMultipart ? await request.formData() : null;
    const file = formData?.get("file");
    const body = formData
      ? {
          sessionId: formData.get("sessionId"),
          sectionKey: formData.get("sectionKey"),
          originalFilename: file instanceof File ? file.name : "",
          mediaType: file instanceof File ? file.type : "",
          byteSize: file instanceof File ? file.size : 0,
          checksum:
            file instanceof File
              ? createHash("sha256")
                  .update(Buffer.from(await file.arrayBuffer()))
                  .digest("hex")
              : "",
        }
      : await request.json();
    const input = validateUploadInput({ ...body, organizationId: context.organizationId });
    const onboardingRepository = createOnboardingRepository(context.supabase);
    const session = await onboardingRepository.findSession(context.organizationId);
    if (!session || session.id !== input.sessionId)
      throw new DomainError("TENANT_SCOPE_ERROR", "The onboarding session is not available.");

    const extractionRepository = createOnboardingExtractionRepository(context.supabase);
    const existing = await extractionRepository.findUploadByChecksum({
      organizationId: context.organizationId,
      checksum: input.checksum,
    });
    if (existing) return NextResponse.json({ upload: existing, duplicate: true });
    const uploadId = crypto.randomUUID();
    const storagePath = buildOnboardingStoragePath(
      context.organizationId,
      input.sessionId,
      uploadId,
      input.originalFilename,
    );
    const upload = await extractionRepository.createUpload({
      organization_id: context.organizationId,
      session_id: input.sessionId,
      section_key: input.sectionKey,
      storage_path: storagePath,
      original_filename: input.originalFilename,
      media_type: input.mediaType,
      byte_size: input.byteSize,
      checksum: input.checksum,
      status: "pending",
      error_summary: null,
      source_metadata: { source: "operator_upload" },
      created_by: context.user.id,
    });
    if (file instanceof File) {
      const fileBytes = new Uint8Array(await file.arrayBuffer());
      const { error: storageError } = await context.supabase.storage
        .from("onboarding-files")
        .upload(storagePath, fileBytes, {
          contentType: input.mediaType,
          upsert: false,
        });
      if (storageError) {
        await extractionRepository.updateUpload({
          organizationId: context.organizationId,
          uploadId: upload.id,
          patch: { status: "failed", error_summary: "The private file upload failed." },
        });
        throw new DomainError("INTEGRATION_ERROR", "The private file upload failed.", storageError);
      }
      await extractionRepository.updateUpload({
        organizationId: context.organizationId,
        uploadId: upload.id,
        patch: { status: "uploaded" },
      });
    }
    const { data: signedUpload, error: signedUploadError } =
      file instanceof File
        ? { data: null, error: null }
        : await context.supabase.storage
            .from("onboarding-files")
            .createSignedUploadUrl(storagePath);
    if (signedUploadError)
      throw new DomainError(
        "INTEGRATION_ERROR",
        "A secure upload handoff could not be created.",
        signedUploadError,
      );
    await createEventPublisher().publish({
      eventId: crypto.randomUUID(),
      eventName: "onboarding.file_uploaded",
      occurredAt: new Date().toISOString(),
      organizationId: context.organizationId,
      actorType: "user",
      actorId: context.user.id,
      correlationId: crypto.randomUUID(),
      schemaVersion: 1,
      payload: {
        uploadId: upload.id,
        sectionKey: input.sectionKey,
        byteSize: input.byteSize,
        mediaType: input.mediaType,
      },
    });
    return NextResponse.json({ upload, signedUpload }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
