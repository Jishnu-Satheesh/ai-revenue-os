import { subjectRouteHandlers } from "@/modules/campaigns/infrastructure/subject-route-wiring";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  return subjectRouteHandlers.list(request, params);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  return subjectRouteHandlers.create(request, params);
}
