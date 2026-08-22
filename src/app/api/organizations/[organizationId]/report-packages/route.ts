import {
  runReportRoute,
  organizationReportRouteParamsSchema,
} from "@/modules/reports/application/api";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  return runReportRoute({
    request,
    params,
    paramsSchema: organizationReportRouteParamsSchema,
    handler: async ({ service, organizationId, actorId, role, correlationId }) => ({
      body: await service.listSnapshot({ organizationId, actorId, role, correlationId }),
    }),
  });
}
