import { z } from "zod";

import { createMemoryWorkspaceApi, runMemoryRoute } from "@/modules/memory/application/api";

const paramsSchema = z.object({ organizationId: z.string().uuid() });

export async function GET(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  return runMemoryRoute({
    request,
    params,
    paramsSchema,
    createApi: createMemoryWorkspaceApi,
    handler: async ({ context, service }) => ({
      body: { snapshot: await service.getSnapshot({ organizationId: context.organizationId, actor: context.actor }) },
    }),
  });
}
