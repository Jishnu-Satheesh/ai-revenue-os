import { channelCreateInputSchema } from "@/domain/channels/types";
import {
  channelRequest,
  organizationChannelRouteParamsSchema,
  runChannelRoute,
} from "@/modules/channels/application/api";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  return runChannelRoute({
    request,
    params,
    paramsSchema: organizationChannelRouteParamsSchema,
    handler: async ({ service, ...context }) => ({
      body: { channels: await service.listChannels(context) },
    }),
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  return runChannelRoute({
    request,
    params,
    paramsSchema: organizationChannelRouteParamsSchema,
    handler: async ({ service, ...context }) => ({
      status: 201,
      body: {
        channel: await service.createChannel(
          context,
          await channelRequest(request, channelCreateInputSchema),
        ),
      },
    }),
  });
}
