import {
  fixtureConnectRequestSchema,
  organizationRouteParamsSchema,
  parseRequestBody,
  runIntegrationRoute,
} from "@/modules/integrations/application/api-schemas";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  return runIntegrationRoute({
    request,
    params,
    paramsSchema: organizationRouteParamsSchema,
    handler: async ({ context, service }) => {
      const input = await parseRequestBody(request, fixtureConnectRequestSchema);
      const result = await service.connectFixture({ ...context, ...input });
      return {
        body: { connection: result.connection, initialTest: result.initialTest },
        status: result.created ? 201 : 200,
      };
    },
  });
}
