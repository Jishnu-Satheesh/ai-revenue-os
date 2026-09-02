import { channelAliasInputSchema } from "@/domain/channels/types";
import {
  channelRequest,
  channelRouteParamsSchema,
  runChannelRoute,
} from "@/modules/channels/application/api";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; channelId: string }> },
) {
  return runChannelRoute({
    request,
    params,
    paramsSchema: channelRouteParamsSchema,
    handler: async ({ service, params: routeParams, ...context }) => ({
      status: 201,
      body: {
        alias: await service.createAlias(
          context,
          routeParams.channelId,
          await channelRequest(request, channelAliasInputSchema),
        ),
      },
    }),
  });
}
