import {
  connectionRouteParamsSchema,
  parseRequestBody,
  replaceMappingsRequestSchema,
  runIntegrationRoute,
} from "@/modules/integrations/application/api-schemas";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; connectionId: string }> },
) {
  return runIntegrationRoute({
    request,
    params,
    paramsSchema: connectionRouteParamsSchema,
    handler: async ({ context, params: route, service }) => {
      const input = await parseRequestBody(request, replaceMappingsRequestSchema);
      return {
        body: {
          mappings: await service.replaceMappings({
            ...context,
            connectionId: route.connectionId,
            mappings: input.mappings,
          }),
        },
      };
    },
  });
}
