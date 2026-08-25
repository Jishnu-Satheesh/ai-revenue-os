import { assetRouteHandlers } from "@/modules/campaigns/infrastructure/asset-route-wiring";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  return assetRouteHandlers.list(request, params);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  return assetRouteHandlers.reserve(request, params);
}
