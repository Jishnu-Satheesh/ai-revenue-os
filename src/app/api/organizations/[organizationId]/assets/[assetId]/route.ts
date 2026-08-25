import { assetRouteHandlers } from "@/modules/campaigns/infrastructure/asset-route-wiring";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; assetId: string }> },
) {
  return assetRouteHandlers.update(request, params);
}
