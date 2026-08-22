import { proposeReportContractSchema } from "@/domain/reports/schemas";
import {
  reportPackageRouteParamsSchema,
  reportRequest,
  runReportRoute,
} from "@/modules/reports/application/api";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; packageId: string }> },
) {
  return runReportRoute({
    request,
    params,
    paramsSchema: reportPackageRouteParamsSchema,
    handler: async (context) => {
      const body = await reportRequest(request, proposeReportContractSchema);
      return {
        status: 201,
        body: {
          reportContractVersion: await context.service.proposeContract(
            context,
            context.params.packageId,
            body,
            body.idempotencyKey,
          ),
        },
      };
    },
  });
}
