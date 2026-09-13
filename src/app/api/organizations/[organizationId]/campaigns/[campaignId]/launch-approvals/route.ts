import { launchRouteHandlers } from "@/modules/campaigns/infrastructure/launch-route-wiring";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; campaignId: string }> },
) {
  return launchRouteHandlers.approve(request, params);
}
