import { decideReportProjectionSchema } from "@/domain/reports/schemas";
import { assertGovernedReportProjectionEnabled } from "@/modules/integrations/application/feature-access";
import { reportProjectionVersionRouteParamsSchema, reportRequest, runReportRoute } from "@/modules/reports/application/api";

export async function POST(request: Request, { params }: { params: Promise<{ organizationId: string; projectionVersionId: string }> }) {
  return runReportRoute({ request, params, paramsSchema: reportProjectionVersionRouteParamsSchema, handler: async (context) => {
    assertGovernedReportProjectionEnabled(context.organizationId);
    const body = await reportRequest(request, decideReportProjectionSchema);
    return { body: { reportProjectionDecision: await context.service.decideProjection(context, context.params.projectionVersionId, body.decision, body.reason, body.idempotencyKey) } };
  } });
}
