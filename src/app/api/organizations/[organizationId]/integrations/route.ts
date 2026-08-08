import {
  organizationRouteParamsSchema,
  runIntegrationRoute,
} from "@/modules/integrations/application/api-schemas";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  return runIntegrationRoute({
    request,
    params,
    paramsSchema: organizationRouteParamsSchema,
    handler: async ({ context, service }) => ({
      body: { snapshot: await service.getSnapshot(context) },
    }),
  });
}
