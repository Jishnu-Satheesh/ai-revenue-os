import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/api/organization-context";
import type { Database } from "@/lib/supabase/database.types";
import { createStudioRepository } from "@/modules/creative-studio/infrastructure/repository";
import {
  createStudioUploadReserver,
  parseStudioJsonBody,
  studioUploadReserveRequestSchema,
  studioUploadRouteContext,
} from "@/modules/creative-studio/infrastructure/upload-intake";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  try {
    const context = await studioUploadRouteContext(params, "studio.edit");
    const body = studioUploadReserveRequestSchema.parse(await parseStudioJsonBody(request));

    const repository = createStudioRepository(context.supabase as SupabaseClient<Database>);
    const reserver = createStudioUploadReserver({
      reserveReservation: (input) => repository.reserveUpload(input),
    });
    const reservation = await reserver.reserve({
      organizationId: context.organizationId,
      request: body,
    });

    return NextResponse.json(reservation, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
