import {
  connectionRouteParamsSchema,
  disconnectRequestSchema,
  parseRequestBody,
  runIntegrationRoute,
} from "@/modules/integrations/application/api-schemas";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; connectionId: string }> },
) {
  return runIntegrationRoute({
    request,
    params,
    paramsSchema: connectionRouteParamsSchema,
    handler: async ({ context, params: route, service }) => {
      const input = await parseRequestBody(request, disconnectRequestSchema);
      return {
        body: await service.disconnectConnection({
          ...context,
          connectionId: route.connectionId,
          idempotencyKey: input.idempotencyKey,
          confirmation: input.confirmation,
        }),
        status: 202,
      };
    },
  });
}
