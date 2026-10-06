import { deliverableRouteHandlers } from "@/modules/campaigns/infrastructure/deliverable-route-wiring";

export async function POST(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      organizationId: string;
      campaignId: string;
      deliverableVersionId: string;
    }>;
  },
) {
  return deliverableRouteHandlers.review(request, params);
}
