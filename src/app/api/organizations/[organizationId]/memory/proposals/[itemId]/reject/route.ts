import { z } from "zod";

import {
  createMemoryWorkspaceApi,
  memoryRequest,
  runMemoryRoute,
} from "@/modules/memory/application/api";
import { rejectProposalSchema } from "@/modules/memory/application/api-schemas";
import { assertMemoryPermission } from "@/modules/memory/application/authorization";

const paramsSchema = z.object({ organizationId: z.string().uuid(), itemId: z.string().uuid() });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; itemId: string }> },
) {
  return runMemoryRoute({
    request,
    params,
    paramsSchema,
    createApi: createMemoryWorkspaceApi,
    handler: async ({ context, params: routeParams, service }) => {
      assertMemoryPermission(context.actor, "memory.verify");
      return {
        body: await service.rejectProposal({
          organizationId: context.organizationId,
          actor: context.actor,
          itemId: routeParams.itemId,
          body: await memoryRequest(request, rejectProposalSchema),
          correlationId: context.correlationId,
        }),
      };
    },
  });
}
