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
      // The service currently exposes an optional creation marker so a future
      // transaction port can report an upsert outcome without leaking storage details.
      const created = "created" in result && result.created === true;
      return {
        body: { connection: result.connection, initialTest: result.initialTest },
        status: created ? 201 : 200,
      };
    },
  });
}
