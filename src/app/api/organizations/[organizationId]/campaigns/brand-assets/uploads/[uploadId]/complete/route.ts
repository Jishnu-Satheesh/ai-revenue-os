import { assetRouteHandlers } from "@/modules/campaigns/infrastructure/asset-route-wiring";

/** Deployed compatibility URL; canonical completion derives both ids from its path. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; uploadId: string }> },
) {
  return assetRouteHandlers.completeLegacy(request, params);
}
