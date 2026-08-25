import { assetRouteHandlers } from "@/modules/campaigns/infrastructure/asset-route-wiring";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; assetId: string }> },
) {
  return assetRouteHandlers.reserveVersion(request, params);
}
