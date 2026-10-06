import { deliverableRouteHandlers } from "@/modules/campaigns/infrastructure/deliverable-route-wiring";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; campaignId: string }> },
) {
  return deliverableRouteHandlers.list(request, params);
}
