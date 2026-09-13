import { proposalRouteHandlers } from "@/modules/campaigns/infrastructure/proposal-route-wiring";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; proposalId: string }> },
) {
  return proposalRouteHandlers.decide(request, params);
}
