import { retryReportPackageSchema } from "@/domain/reports/schemas";
import { isGovernedReportValidationEnabled } from "@/modules/integrations/application/feature-access";
import {
  reportPackageRouteParamsSchema,
  reportRequest,
  runReportRoute,
} from "@/modules/reports/application/api";
import { requestReportPackageValidation } from "@/modules/reports/application/dispatch";
import { resolveValidationContractVersion } from "@/modules/reports/application/validation-contract-version";

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
      const resolution = await resolveValidationContractVersion(
        {
          packageId: reportPackage.id,
          admittedUnderAdmissionId: reportPackage.admitted_under_admission_id,
          validationRuns: snapshot.validationRuns,
          contractVersions: snapshot.contractVersions,
          contractDecisions: snapshot.contractDecisions,
        },
        async (admissionId) =>
          context.admissionService.findAdmissionById({
            organizationId: context.organizationId,
            admissionId,
          }),
      );
      // Three separate things can stop a dispatch, and the operator has to be
      // told which one, because the fix for each is different: wait for a
      // rollout, approve a structure, or press the button again. Reporting
      // all three as "not enabled for this organization" sent people looking
      // for a flag that was already on.
      const featureEnabled = isGovernedReportValidationEnabled(context.organizationId);
      const validationQueued =
        featureEnabled && resolution.source !== "unresolved"
          ? await requestReportPackageValidation({
              organizationId: context.organizationId,
              packageId: reportPackage.id,
              contractVersionId: resolution.contractVersionId,
              correlationId: context.correlationId,
            })
          : false;
      const reason = validationQueued
        ? undefined
        : !featureEnabled
          ? ("feature_disabled" as const)
          : resolution.source === "unresolved"
            ? ("contract_unresolved" as const)
            : ("dispatch_failed" as const);
      return { body: { reportPackage, validationQueued, reason } };
    },
  });
}
