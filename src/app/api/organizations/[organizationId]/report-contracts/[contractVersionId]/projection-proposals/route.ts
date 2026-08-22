import {
  normalizeReportProjectionProposalBody,
  proposeReportProjectionSchema,
} from "@/domain/reports/schemas";
import { assertGovernedReportProjectionEnabled } from "@/modules/integrations/application/feature-access";
import { reportContractVersionRouteParamsSchema, reportRequest, runReportRoute } from "@/modules/reports/application/api";

export async function POST(request: Request, { params }: { params: Promise<{ organizationId: string; contractVersionId: string }> }) {
  return runReportRoute({ request, params, paramsSchema: reportContractVersionRouteParamsSchema, handler: async (context) => {
    assertGovernedReportProjectionEnabled(context.organizationId);
    const body = await reportRequest(
      request,
      proposeReportProjectionSchema,
      "Projection declarations must include projectionDocument (schemaVersion 1, outputKind exact_range, valid outputs) and an idempotencyKey at least 16 characters long.",
      normalizeReportProjectionProposalBody,
    );
    return { status: 201, body: { reportProjectionVersion: await context.service.proposeProjection(context, context.params.contractVersionId, body.projectionDocument, body.idempotencyKey) } };
  } });
}
