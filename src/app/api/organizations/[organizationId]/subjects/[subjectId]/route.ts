import { subjectRouteHandlers } from "@/modules/campaigns/infrastructure/subject-route-wiring";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; subjectId: string }> },
) {
  return subjectRouteHandlers.update(request, params);
}
