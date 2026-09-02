import { assetRouteHandlers } from "@/modules/campaigns/infrastructure/asset-route-wiring";

/** Deployed compatibility URL; canonical creation lives at `/assets`. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  return assetRouteHandlers.reserveLegacy(request, params);
}
