import { resolveReportProjectionOverlapSchema } from "@/domain/reports/schemas";
import {
  reportProjectionReconciliationRouteParamsSchema,
  reportRequest,
  runReportRoute,
} from "@/modules/reports/application/api";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; reconciliationId: string }> },
) {
  return runReportRoute({
    request,
    params,
    paramsSchema: reportProjectionReconciliationRouteParamsSchema,
    handler: async (context) => {
      const body = await reportRequest(request, resolveReportProjectionOverlapSchema);
      return {
        body: {
          resolution: await context.service.resolveProjectionOverlapGroup(
            context,
            context.params.reconciliationId,
            body.resolution,
            body.idempotencyKey,
          ),
        },
      };
    },
  });
}
