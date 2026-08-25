import { assetRouteHandlers } from "@/modules/campaigns/infrastructure/asset-route-wiring";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  return assetRouteHandlers.review(request, params);
}
