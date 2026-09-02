import { channelBranchMappingInputSchema } from "@/domain/channels/types";
import {
  channelRequest,
  channelRouteParamsSchema,
  runChannelRoute,
} from "@/modules/channels/application/api";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; channelId: string }> },
) {
  return runChannelRoute({
    request,
    params,
    paramsSchema: channelRouteParamsSchema,
    handler: async ({ service, params: routeParams, ...context }) => ({
      body: {
        mapping: await service.upsertBranchMapping(
          context,
          routeParams.channelId,
          await channelRequest(request, channelBranchMappingInputSchema),
        ),
      },
    }),
  });
}
