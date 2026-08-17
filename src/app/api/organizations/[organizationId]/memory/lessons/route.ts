import { z } from "zod";

import { createMemoryWorkspaceApi, runMemoryRoute } from "@/modules/memory/application/api";

const paramsSchema = z.object({ organizationId: z.string().uuid() });
const querySchema = z
  .object({ limit: z.coerce.number().int().positive().max(100).default(50) })
  .strict();

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
      const query = querySchema.parse({ limit: url.searchParams.get("limit") ?? undefined });
      return {
        body: await service.listLessons({
          organizationId: context.organizationId,
          actor: context.actor,
          limit: query.limit,
        }),
      };
    },
  });
}
