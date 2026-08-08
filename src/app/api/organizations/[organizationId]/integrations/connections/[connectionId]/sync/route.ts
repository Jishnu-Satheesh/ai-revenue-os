import {
  connectionRouteParamsSchema,
  parseRequestBody,
  queuedOperationRequestSchema,
  runIntegrationRoute,
} from "@/modules/integrations/application/api-schemas";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; connectionId: string }> },
) {
  return runIntegrationRoute({
    request,
    params,
    paramsSchema: connectionRouteParamsSchema,
    handler: async ({ context, params: route, service }) => {
      const input = await parseRequestBody(request, queuedOperationRequestSchema);
      return {
        body: await service.requestSync({
          ...context,
          connectionId: route.connectionId,
          idempotencyKey: input.idempotencyKey,
        }),
        status: 202,
      };
    },
  });
}
