import { retryReportPackageSchema } from "@/domain/reports/schemas";
import {
  reportPackageRouteParamsSchema,
  reportRequest,
  runReportRoute,
} from "@/modules/reports/application/api";
import { requestReportPackageProfiling } from "@/modules/reports/application/dispatch";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; packageId: string }> },
) {
  return runReportRoute({
    request,
    params,
    paramsSchema: reportPackageRouteParamsSchema,
    handler: async (context) => {
      const body = await reportRequest(request, retryReportPackageSchema);
      const reportPackage = await context.service.retryProfiling(
        context,
        context.params.packageId,
        body.idempotencyKey,
      );
      const profilingQueued = await requestReportPackageProfiling({
        organizationId: context.organizationId,
        packageId: reportPackage.id,
        correlationId: context.correlationId,
      });
      return { body: { reportPackage, profilingQueued } };
    },
  });
}
