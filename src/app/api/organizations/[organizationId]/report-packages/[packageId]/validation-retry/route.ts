import { retryReportPackageSchema } from "@/domain/reports/schemas";
import {
  reportPackageRouteParamsSchema,
  reportRequest,
  runReportRoute,
} from "@/modules/reports/application/api";
import { requestReportPackageValidation } from "@/modules/reports/application/dispatch";

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
      const reportPackage = await context.service.retryValidation(
        context,
        context.params.packageId,
        body.idempotencyKey,
      );
      const snapshot = await context.service.listSnapshot(context);
      const latestRun = snapshot.validationRuns.find(
        (run) => run.report_package_id === reportPackage.id,
      );
      const contractVersionId = latestRun?.report_contract_version_id ?? snapshot.contractVersions.find(
        (version) => version.report_package_id === reportPackage.id && snapshot.contractDecisions.some(
          (decision) => decision.report_contract_version_id === version.id && decision.decision === "approved",
        ),
      )?.id;
      const validationQueued = contractVersionId
        ? await requestReportPackageValidation({
            organizationId: context.organizationId,
            packageId: reportPackage.id,
            contractVersionId,
            correlationId: context.correlationId,
          })
        : false;
      return { body: { reportPackage, validationQueued } };
    },
  });
}
