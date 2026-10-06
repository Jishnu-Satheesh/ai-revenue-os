import { creativeHistoryRouteHandlers } from "@/modules/campaigns/infrastructure/creative-history-route-wiring";

/** Finishing a batch of uploads, where each file answers for itself. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  return creativeHistoryRouteHandlers.completeBatch(request, params);
}
