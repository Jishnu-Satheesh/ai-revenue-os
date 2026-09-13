import { creativeHistoryRouteHandlers } from "@/modules/campaigns/infrastructure/creative-history-route-wiring";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  return creativeHistoryRouteHandlers.listFolders(request, params);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  return creativeHistoryRouteHandlers.createFolder(request, params);
}
