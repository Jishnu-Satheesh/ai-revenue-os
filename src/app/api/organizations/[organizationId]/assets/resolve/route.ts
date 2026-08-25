import { assetRouteHandlers } from "@/modules/campaigns/infrastructure/asset-route-wiring";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  return assetRouteHandlers.resolve(request, params);
}
