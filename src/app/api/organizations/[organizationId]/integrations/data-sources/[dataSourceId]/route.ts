import { z } from "zod";

import {
  organizationRouteParamsSchema,
  parseRequestBody,
  runIntegrationRoute,
} from "@/modules/integrations/application/api-schemas";

const paramsSchema = organizationRouteParamsSchema.extend({ dataSourceId: z.string().uuid() });
const patchSchema = z
  .object({
    name: z.string().trim().min(2).max(160).optional(),
    status: z.literal("archived").optional(),
    idempotencyKey: z.string().trim().min(16).max(200),
  })
  .strict()
  .refine((value) => value.name !== undefined || value.status !== undefined, {
    message: "A name or archive status is required.",
  });

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; dataSourceId: string }> },
) {
  return runIntegrationRoute({
    request,
    params,
    paramsSchema,
    handler: async ({ context, params: route, service }) => ({
      body: {
        dataSource: await service.updateDataSource({
          ...context,
          dataSourceId: route.dataSourceId,
          ...(await parseRequestBody(request, patchSchema)),
        }),
      },
    }),
  });
}
