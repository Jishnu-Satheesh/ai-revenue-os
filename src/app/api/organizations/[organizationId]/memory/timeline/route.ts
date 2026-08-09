import { z } from "zod";

import { MemoryError, safeMemoryErrorCopy } from "@/domain/memory/errors";
import { createMemoryWorkspaceApi, runMemoryRoute } from "@/modules/memory/application/api";
import { timelineCursorSchema, timelineQuerySchema } from "@/modules/memory/application/api-schemas";

const paramsSchema = z.object({ organizationId: z.string().uuid() });

function decodeCursor(value: string | null) {
  if (!value) return undefined;
  try {
    return timelineCursorSchema.parse(JSON.parse(value));
  } catch {
    throw new MemoryError("VALIDATION_ERROR", safeMemoryErrorCopy.VALIDATION_ERROR);
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  return runMemoryRoute({
    request,
    params,
    paramsSchema,
    createApi: createMemoryWorkspaceApi,
    handler: async ({ context, service }) => {
      const url = new URL(request.url);
      const query = timelineQuerySchema.parse({
        branchId: url.searchParams.get("branchId") ?? undefined,
        sourceSystems: url.searchParams.getAll("sourceSystem"),
        limit: url.searchParams.get("limit") ?? undefined,
        cursor: decodeCursor(url.searchParams.get("cursor")),
      });
      const result = await service.listTimeline({
        organizationId: context.organizationId,
        actor: context.actor,
        ...query,
      });
      return {
        body: {
          items: result.items,
          ...(result.nextCursor ? { nextCursor: JSON.stringify(result.nextCursor) } : {}),
        },
      };
    },
  });
}
