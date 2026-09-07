import { z } from "zod";

import { hasReportPermission } from "@/domain/reports/permissions";
import { DomainError } from "@/lib/errors";
import { assertGovernedReportProjectionEnabled } from "@/modules/integrations/application/feature-access";
import {
  reportProjectionVersionRouteParamsSchema,
  reportRequest,
  runReportRoute,
} from "@/modules/reports/application/api";

/**
 * What "Declare" submits: the output whose vocabulary grows, and the one
 * label to grow it by. Both shapes repeat the database guard's own rules, so
 * a request the RPC would refuse is refused here with a 400 instead.
 */
const declareProjectionCategoricalValueSchema = z
  .object({
    outputKey: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    value: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
  })
  .strict();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; projectionVersionId: string }> },
) {
  return runReportRoute({
    request,
    params,
    paramsSchema: reportProjectionVersionRouteParamsSchema,
    handler: async (context) => {
      assertGovernedReportProjectionEnabled(context.organizationId);
      // The write below happens on the operator's behalf the moment this
      // check passes, so it runs before it rather than trusting the
      // permission check the RPC already carries: an operator's request must
      // never start a declaration it is not allowed to approve later.
      if (!hasReportPermission(context.role, "report.contract_approve")) {
        throw new DomainError(
          "AUTHORIZATION_ERROR",
          "You do not have permission to declare a label. Ask an organization owner or admin.",
        );
      }
      const body = await reportRequest(request, declareProjectionCategoricalValueSchema);
      const projectionVersionId = context.params.projectionVersionId;
      // Keyed to the declaration rather than to the click. Declaring one
      // label into one output of one version is always the same proposal, so
      // a second click replays the first instead of stacking an identical
      // version beside it.
      const idempotencyKey = `report-projection-declare:${projectionVersionId}:${body.outputKey}:${body.value}`;
      const reportProjectionVersion = await context.service.proposeProjectionWithDeclaredValue(
        context,
        projectionVersionId,
        body.outputKey,
        body.value,
        idempotencyKey,
      );
      return { status: 201, body: { reportProjectionVersion } };
    },
  });
}
