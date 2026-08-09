import { z } from "zod";

import { operatorCeiling } from "@/modules/memory/application/authorization";
import { createMemoryWorkspaceApi, memoryRequest, runMemoryRoute } from "@/modules/memory/application/api";
import { searchMemorySchema } from "@/modules/memory/application/api-schemas";

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
    handler: async ({ context, retrieval }) => {
      const body = await memoryRequest(request, searchMemorySchema);
      const response = await retrieval.retrieve({
        ...body,
        organizationId: context.organizationId,
        sensitivityAllowance: body.sensitivityAllowance ?? operatorCeiling(context.actor),
        correlationId: context.correlationId,
      });
      const { builtAt: _builtAt, ...publicResponse } = response;
      return { body: { ...publicResponse, servedFromCache: false } };
    },
  });
}
