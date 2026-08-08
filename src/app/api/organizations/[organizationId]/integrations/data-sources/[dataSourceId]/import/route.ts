import {
  organizationRouteParamsSchema,
  parseRequestBody,
  queuedOperationRequestSchema,
  runIntegrationRoute,
} from "@/modules/integrations/application/api-schemas";
import { z } from "zod";

const paramsSchema = organizationRouteParamsSchema.extend({ dataSourceId: z.string().uuid() });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; dataSourceId: string }> },
) {
  return runIntegrationRoute({
    request,
    params,
    paramsSchema,
    handler: async ({ context, params: route, service }) => ({
      body: await service.requestImport({
        ...context,
        dataSourceId: route.dataSourceId,
        ...(await parseRequestBody(request, queuedOperationRequestSchema)),
      }),
      status: 202,
    }),
  });
}
