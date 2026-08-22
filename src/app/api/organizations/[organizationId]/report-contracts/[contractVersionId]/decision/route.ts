import { decideReportContractSchema } from "@/domain/reports/schemas";
import {
  reportContractVersionRouteParamsSchema,
  reportRequest,
  runReportRoute,
} from "@/modules/reports/application/api";
import { requestReportPackageValidation } from "@/modules/reports/application/dispatch";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; contractVersionId: string }> },
) {
  return runReportRoute({
    request,
    params,
    paramsSchema: reportContractVersionRouteParamsSchema,
    handler: async (context) => {
      const body = await reportRequest(request, decideReportContractSchema);
      const reportContractDecision = await context.service.decideContract(
        context,
        context.params.contractVersionId,
        body.decision,
        body.reason,
        body.idempotencyKey,
      );
      const version =
        body.decision === "approved"
          ? await context.service.findContractVersion(context, context.params.contractVersionId)
          : null;
      const validationQueued =
        version === null
          ? false
          : await requestReportPackageValidation({
              organizationId: context.organizationId,
              packageId: version.report_package_id,
              contractVersionId: version.id,
              correlationId: context.correlationId,
            });
      return {
        body: {
          reportContractDecision,
          validationQueued,
        },
      };
    },
  });
}
