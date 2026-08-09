import { z } from "zod";

import { MemoryError, safeMemoryErrorCopy } from "@/domain/memory/errors";
import { createMemoryWorkspaceApi, memoryRequest, runMemoryRoute } from "@/modules/memory/application/api";
import { updateMemoryItemSchema } from "@/modules/memory/application/api-schemas";
import { assertMemoryPermission } from "@/modules/memory/application/authorization";

const paramsSchema = z.object({ organizationId: z.string().uuid(), itemId: z.string().uuid() });

async function assertMatchingBodyItemId(request: Request, itemId: string) {
  let body: unknown;
  try {
    body = await request.clone().json();
  } catch {
    throw new MemoryError("VALIDATION_ERROR", safeMemoryErrorCopy.VALIDATION_ERROR);
  }
  if (
    typeof body === "object" &&
    body !== null &&
    "itemId" in body &&
    (body as { itemId?: unknown }).itemId !== itemId
  ) {
    throw new MemoryError("VALIDATION_ERROR", safeMemoryErrorCopy.VALIDATION_ERROR);
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; itemId: string }> },
) {
  return runMemoryRoute({
    request,
    params,
    paramsSchema,
    createApi: createMemoryWorkspaceApi,
    handler: async ({ context, params: routeParams, service }) => ({
      body: await service.getItemDetail({
        organizationId: context.organizationId,
        actor: context.actor,
        itemId: routeParams.itemId,
      }),
    }),
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; itemId: string }> },
) {
  return runMemoryRoute({
    request,
    params,
    paramsSchema,
    createApi: createMemoryWorkspaceApi,
    handler: async ({ context, params: routeParams, service }) => {
      await assertMatchingBodyItemId(request, routeParams.itemId);
      const body = await memoryRequest(request, updateMemoryItemSchema);
      assertMemoryPermission(
        context.actor,
        body.action === "verify" || body.action === "reject" ? "memory.verify" : "memory.write",
      );
      return {
        body: {
          item: await service.updateItem({
            organizationId: context.organizationId,
            actor: context.actor,
            itemId: routeParams.itemId,
            body,
          }),
        },
      };
    },
  });
}
