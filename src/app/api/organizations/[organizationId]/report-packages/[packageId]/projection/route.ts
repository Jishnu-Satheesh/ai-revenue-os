import { requestReportProjectionSchema } from "@/domain/reports/schemas";
import { assertGovernedReportProjectionEnabled } from "@/modules/integrations/application/feature-access";
import { requestReportPackageProjection } from "@/modules/reports/application/dispatch";
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
      assertGovernedReportProjectionEnabled(context.organizationId);
      const body = await reportRequest(request, requestReportProjectionSchema);
      const requested = await context.service.requestProjection(
        context,
        context.params.packageId,
        body.idempotencyKey,
      );
      const projectionQueued = await requestReportPackageProjection({
        organizationId: context.organizationId,
        packageId: requested.reportPackage.id,
        contractVersionId: requested.contractVersionId,
        projectionVersionId: requested.projectionVersionId,
        correlationId: context.correlationId,
      });
      return { body: { reportPackage: requested.reportPackage, projectionQueued } };
    },
  });
}
