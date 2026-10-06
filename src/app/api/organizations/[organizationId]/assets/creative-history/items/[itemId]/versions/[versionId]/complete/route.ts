import { creativeHistoryRouteHandlers } from "@/modules/campaigns/infrastructure/creative-history-route-wiring";

export async function POST(
  request: Request,
  {
    params,
  }: { params: Promise<{ organizationId: string; itemId: string; versionId: string }> },
) {
  return creativeHistoryRouteHandlers.completeVersion(request, params);
}
