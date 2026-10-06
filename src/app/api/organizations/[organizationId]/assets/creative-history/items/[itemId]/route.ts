import { creativeHistoryRouteHandlers } from "@/modules/campaigns/infrastructure/creative-history-route-wiring";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; itemId: string }> },
) {
  return creativeHistoryRouteHandlers.readItem(request, params);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; itemId: string }> },
) {
  return creativeHistoryRouteHandlers.updateItem(request, params);
}
