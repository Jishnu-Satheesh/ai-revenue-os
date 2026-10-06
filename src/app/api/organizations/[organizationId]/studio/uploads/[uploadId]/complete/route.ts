import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/api/organization-context";
import type { Database } from "@/lib/supabase/database.types";
import { ingestCampaignImage } from "@/modules/campaigns/infrastructure/asset-intake";
import { createStudioUploadRecordReader } from "@/modules/creative-studio/infrastructure/reference-reader";
import type { StudioUploadRecordPersistence } from "@/modules/creative-studio/infrastructure/reference-reader";
import { createStudioRepository } from "@/modules/creative-studio/infrastructure/repository";
import {
  createStudioUploadCompleter,
  createStudioUploadServiceClient,
  createSupabaseStudioUploadObjectStore,
  parseStudioOptionalJsonBody,
  parseStudioUploadId,
  studioUploadCompleteRequestSchema,
  studioUploadRouteContext,
} from "@/modules/creative-studio/infrastructure/upload-intake";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; uploadId: string }> },
) {
  try {
    // Session and org role authorize first; the service client below is
    // constructed only once they have. Reservation ownership is verified by
    // the completer before the credential is used for anything.
    const context = await studioUploadRouteContext(params, "studio.edit");
    const routeParams = await params;
    const uploadId = parseStudioUploadId(routeParams.uploadId);
    const body = studioUploadCompleteRequestSchema.parse(await parseStudioOptionalJsonBody(request));

    const service = createStudioUploadServiceClient();
    const workerRepository = createStudioRepository(service as SupabaseClient<Database>);
    const reader = createStudioUploadRecordReader(
      context.supabase as unknown as StudioUploadRecordPersistence,
    );
    const completer = createStudioUploadCompleter({
      readReservation: (organizationId, id) => reader.read(organizationId, id),
      objects: createSupabaseStudioUploadObjectStore(service),
      ingest: ingestCampaignImage,
      settleReservation: (input) => workerRepository.completeUpload(input),
    });
    const outcome = await completer.complete({
      organizationId: context.organizationId,
      uploadId,
      callerId: context.user.id,
      declaredMime: body.declaredMime,
    });

    // A first finalization creates the usable reference; every replay,
    // refusal, and expiry answers 200.
    return NextResponse.json(outcome, {
      status: outcome.status === "ready" && !outcome.replayed ? 201 : 200,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
