import { channelUpdateInputSchema } from "@/domain/channels/types";
import {
  channelRequest,
  channelRouteParamsSchema,
  runChannelRoute,
} from "@/modules/channels/application/api";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; channelId: string }> },
) {
  return runChannelRoute({
    request,
    params,
    paramsSchema: channelRouteParamsSchema,
    handler: async ({ service, params: routeParams, ...context }) => ({
      body: {
        channel: await service.updateChannel(
          context,
          routeParams.channelId,
          await channelRequest(request, channelUpdateInputSchema),
        ),
      },
    }),
  });
}
