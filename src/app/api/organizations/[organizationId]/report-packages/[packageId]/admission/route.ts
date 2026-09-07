import { z } from "zod";

import { reportContractDocumentSchema } from "@/domain/reports/contracts";
import { guidedReportMappingSchema } from "@/domain/reports/guided-mapping";
import { reportProjectionDocumentSchema } from "@/domain/reports/projection";
import { hasReportPermission } from "@/domain/reports/permissions";
import { DomainError } from "@/lib/errors";
import {
  admissionIdempotencyKeys,
  UnprofiledReportPackageError,
} from "@/modules/reports/application/admissions";
import {
  reportPackageRouteParamsSchema,
  reportRequest,
  runReportRoute,
} from "@/modules/reports/application/api";
import { requestReportPackageValidation } from "@/modules/reports/application/dispatch";

/**
 * What "Approve" submits: the same mapping-and-projection vocabulary the
 * existing two-step manual flow uses (`proposeReportContractSchema` /
 * `proposeReportProjectionSchema`), minus a caller-chosen idempotency key.
 * A grant is one click, not five separately-keyed requests, so all five
 * idempotency keys are derived from the package id below rather than taken
 * from the body. See ADR 0046.
 */
const contractContentSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("human"), mappingDocument: reportContractDocumentSchema }).strict(),
  z
    .object({ source: z.literal("library"), providerDefinitionKey: z.string().trim().min(2).max(80) })
    .strict(),
  z.object({ source: z.literal("guided"), guided: guidedReportMappingSchema }).strict(),
]);

const projectionContentSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("human"), projectionDocument: reportProjectionDocumentSchema }).strict(),
  z
    .object({ source: z.literal("library"), providerDefinitionKey: z.string().trim().min(2).max(80) })
    .strict(),
  z.object({ source: z.literal("guided") }).strict(),
]);

const grantAdmissionRequestSchema = z
  .object({
    contract: contractContentSchema,
    projection: projectionContentSchema,
  })
  .strict();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; packageId: string }> },
) {
  return runReportRoute({
    request,
    params,
    paramsSchema: reportPackageRouteParamsSchema,
    handler: async (context) => {
      // Every write below happens on the operator's behalf the moment this
      // check passes, so it runs before any of them rather than trusting the
      // permission check each RPC already carries: an operator's request
      // must never start writing a contract version it is not allowed to
      // approve.
      if (!hasReportPermission(context.role, "report.contract_approve")) {
        throw new DomainError(
          "AUTHORIZATION_ERROR",
          "You do not have permission to grant a standing admission for this report structure.",
        );
      }

      const body = await reportRequest(request, grantAdmissionRequestSchema);
      const packageId = context.params.packageId;
      const keys = admissionIdempotencyKeys(packageId);

      try {
        const contractVersion = await context.service.proposeContract(
          context,
          packageId,
          { ...body.contract, idempotencyKey: keys.contractPropose },
          keys.contractPropose,
        );
        await context.service.decideContract(
          context,
          contractVersion.id,
          "approved",
          undefined,
          keys.contractDecide,
        );
        const projectionVersion = await context.service.proposeProjection(
          context,
          contractVersion.id,
          { ...body.projection, idempotencyKey: keys.projectionPropose },
          keys.projectionPropose,
        );
        await context.service.decideProjection(
          context,
          projectionVersion.id,
          "approved",
          undefined,
          keys.projectionDecide,
        );

        // The library key travels with the shipped documents that produced
        // it, never with the caller's say-so, and only when both halves
        // came from the very same recognised family -- a contract and
        // projection that only partly match the library are a hand-built
        // mapping in every way ADR 0046 cares about, so they get no key.
        const reportFamilyKey =
          contractVersion.provider_definition_key !== null &&
          contractVersion.provider_definition_key === projectionVersion.provider_definition_key
            ? contractVersion.provider_definition_key
            : null;

        const admission = await context.admissionService.grantAdmission({
          organizationId: context.organizationId,
          actorId: context.actorId,
          packageId,
          contractVersionId: contractVersion.id,
          projectionVersionId: projectionVersion.id,
          reportFamilyKey,
          correlationId: context.correlationId,
        });

        // And start the upload the operator was actually looking at.
        //
        // Every *later* upload of this structure is carried by profiling,
        // which finds the standing admission and dispatches validation
        // itself (`continueAdmittedReportPackage`, Link A). This one was
        // profiled before the admission existed, so nothing in that path
        // ever reaches it. Without this call the package that earned the
        // grant sits at `awaiting_validation` with no run, no failure, and
        // nothing on the page to say why -- the approval appears to have
        // done nothing at all.
        //
        // The same call the manual contract-decision route makes, with the
        // same contract version. Its feature-flag guard and idempotency key
        // are its own; nothing is duplicated here.
        const validationQueued = await requestReportPackageValidation({
          organizationId: context.organizationId,
          packageId,
          contractVersionId: contractVersion.id,
          correlationId: context.correlationId,
        });

        return { status: 200, body: { admission, validationQueued } };
      } catch (error) {
        // Named plainly rather than left to fall through to the generic 422
        // every other grant failure gets: the operator's next move is to
        // wait for profiling, not to change anything about this request.
        // Nothing here is rolled back -- by the time this throws, an
        // approved contract version and an approved projection version
        // already exist for this package, which is exactly the state the
        // existing manual per-upload flow already handles.
        if (error instanceof UnprofiledReportPackageError) {
          return {
            status: 409,
            body: { error: { code: error.code, message: error.message } },
          };
        }
        throw error;
      }
    },
  });
}
