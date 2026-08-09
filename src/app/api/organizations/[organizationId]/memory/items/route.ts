import { z } from "zod";

import { createMemoryWorkspaceApi, memoryRequest, runMemoryRoute } from "@/modules/memory/application/api";
import { createMemoryItemSchema } from "@/modules/memory/application/api-schemas";
import { assertMemoryPermission } from "@/modules/memory/application/authorization";

const paramsSchema = z.object({ organizationId: z.string().uuid() });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  return runMemoryRoute({
    request,
    params,
    paramsSchema,
    createApi: createMemoryWorkspaceApi,
    handler: async ({ context, service }) => {
      assertMemoryPermission(context.actor, "memory.write");
      return {
        body: {
          item: await service.createItem({
            organizationId: context.organizationId,
            actor: context.actor,
            body: await memoryRequest(request, createMemoryItemSchema),
          }),
        },
      };
    },
  });
}
