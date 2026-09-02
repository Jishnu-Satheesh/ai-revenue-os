import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { DomainError } from "@/lib/errors";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { logger } from "@/lib/logger";
import {
  createChannelService,
  type AuthenticatedChannelContext,
} from "@/modules/channels/application/service";
import { createAuthenticatedChannelRepository } from "@/modules/channels/infrastructure/repository";
import type { OrganizationRole } from "@/domain/organizations/types";

export const organizationChannelRouteParamsSchema = z.object({ organizationId: z.string().uuid() });
export const channelRouteParamsSchema = organizationChannelRouteParamsSchema.extend({
  channelId: z.string().uuid(),
});

export async function channelRequest<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema,
): Promise<z.output<TSchema>> {
  try {
    return schema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) throw error;
    throw new DomainError("VALIDATION_ERROR", "Please check the submitted fields.");
  }
}

function responseForError(error: unknown) {
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Please check the submitted fields." } },
      { status: 400 },
    );
  }
  if (error instanceof DomainError) {
    const status =
      error.code === "AUTHENTICATION_ERROR"
        ? 401
        : error.code === "AUTHORIZATION_ERROR"
          ? 403
          : error.code === "TENANT_SCOPE_ERROR" || error.code === "FEATURE_NOT_AVAILABLE"
            ? 404
            : error.code === "VALIDATION_ERROR"
              ? 400
              : 422;
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status });
  }
  return NextResponse.json(
    { error: { code: "UNEXPECTED_ERROR", message: "Something went wrong. Please try again." } },
    { status: 500 },
  );
}

type ChannelRouteContext = AuthenticatedChannelContext & {
  service: ReturnType<typeof createChannelService>;
  correlationId: string;
};

export async function runChannelRoute<TParams>(input: {
  request: Request;
  params: Promise<TParams>;
  paramsSchema: z.ZodType<TParams>;
  handler: (
    context: ChannelRouteContext & { params: TParams },
  ) => Promise<{ body: unknown; status?: number }>;
}): Promise<NextResponse> {
  let organizationId: string | undefined;
  const correlationId = input.request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  try {
    const params = input.paramsSchema.parse(await input.params);
    const typed = params as TParams & { organizationId: string };
    organizationId = typed.organizationId;
    const organization = await getOrganizationContext(Promise.resolve({ organizationId }));
    const service = createChannelService(
      createAuthenticatedChannelRepository(organization.supabase),
    );
    const result = await input.handler({
      organizationId,
      actorId: organization.user.id,
      role: organization.membership.role as OrganizationRole,
      service,
      correlationId,
      params,
    });
    const response = NextResponse.json(result.body, { status: result.status ?? 200 });
    response.headers.set("x-correlation-id", correlationId);
    return response;
  } catch (error) {
    const response = responseForError(error);
    response.headers.set("x-correlation-id", correlationId);
    logger.warn("channels_api.failed", {
      organizationId,
      correlationId,
      errorCode: error instanceof DomainError ? error.code : "UNEXPECTED_ERROR",
    });
    return response;
  }
}
