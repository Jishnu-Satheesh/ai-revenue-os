import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";
import { tasks } from "@trigger.dev/sdk";

import { createEventPublisher } from "@/domain/events/publisher";
import { IntegrationError } from "@/domain/integrations/errors";
import { createProviderRegistry } from "@/domain/integrations/provider-registry";
import type { OrganizationRole } from "@/domain/organizations/types";
import { DomainError } from "@/lib/errors";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { logger } from "@/lib/logger";
import {
  createIntegrationService,
  type AuthenticatedIntegrationContext,
  type IntegrationTaskDispatcher,
  type IntegrationTaskPayload,
} from "@/modules/integrations/application/service";
import { createAuthenticatedIntegrationRepository } from "@/modules/integrations/infrastructure/repository";
import { googleBusinessProfileDefinition } from "@/modules/integrations/providers/google-business-profile/definition";
import { createGoogleBusinessProfileFixtureAdapter } from "@/modules/integrations/providers/google-business-profile/fixture-adapter";

export const organizationRouteParamsSchema = z.object({
  organizationId: z.string().uuid(),
});

export const connectionRouteParamsSchema = organizationRouteParamsSchema.extend({
  connectionId: z.string().uuid(),
});

const idempotencyKeySchema = z.string().trim().min(1).max(200);

export const fixtureConnectRequestSchema = z
  .object({
    providerKey: z.string().trim().min(1).max(120),
    externalAccountId: z.string().trim().min(1).max(500),
    externalAccountLabel: z.string().trim().min(1).max(500),
    grantedScopes: z.array(z.string().trim().min(1).max(300)).max(50),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const queuedOperationRequestSchema = z
  .object({ idempotencyKey: idempotencyKeySchema })
  .strict();

export const replaceMappingsRequestSchema = z
  .object({
    idempotencyKey: idempotencyKeySchema,
    mappings: z
      .array(
        z
          .object({
            externalResourceId: z.string().trim().min(1).max(500),
            externalResourceLabel: z.string().trim().min(1).max(500),
            branchId: z.string().uuid().nullable().optional(),
            status: z.enum(["unmapped", "mapped", "ignored"]),
          })
          .strict(),
      )
      .max(100),
  })
  .strict()
  .superRefine(({ mappings }, context) => {
    for (const [index, mapping] of mappings.entries()) {
      if (mapping.status === "mapped" && !mapping.branchId) {
        context.addIssue({
          code: "custom",
          path: ["mappings", index, "branchId"],
          message: "Mapped resources require a branch.",
        });
      }
    }
  });

export const disconnectRequestSchema = z
  .object({
    idempotencyKey: idempotencyKeySchema,
    // Confirmation must reach the service unchanged so it can compare the
    // phrase to the displayed external account label exactly.
    confirmation: z.string().min(1).max(500),
  })
  .strict();

type TriggerTaskClient = {
  trigger(
    taskName: IntegrationTaskPayload["taskName"],
    payload: IntegrationTaskPayload,
    options: { idempotencyKey: string },
  ): Promise<{ id: string }>;
};

function createTriggerDispatcher(): IntegrationTaskDispatcher {
  const triggerTasks = tasks as unknown as TriggerTaskClient;
  return {
    async dispatch(input) {
      const run = await triggerTasks.trigger(input.taskName, input, {
        idempotencyKey: input.idempotencyKey,
      });
      return { triggerRunId: run.id };
    },
  };
}

/**
 * Builds the RLS-backed Integration Hub service for a request that already has
 * an authenticated organization context. Route handlers and the organization
 * React Server Component share it so both read through the same permissions,
 * validation, and tenant scoping. It never touches worker credentials.
 */
export function createIntegrationHubService(input: {
  supabase: Awaited<ReturnType<typeof getOrganizationContext>>["supabase"];
}) {
  const { repository } = createAuthenticatedIntegrationRepository({
    supabase: input.supabase,
    catalog: [googleBusinessProfileDefinition],
  });
  return createIntegrationService({
    repository,
    providers: createProviderRegistry({
      definitions: [googleBusinessProfileDefinition],
      adapters: { read: [createGoogleBusinessProfileFixtureAdapter()] },
    }),
    dispatcher: createTriggerDispatcher(),
    publisher: createEventPublisher(),
    branchLookup: {
      async findBranch({ organizationId, branchId }) {
        const { data, error } = await input.supabase
          .from("branches")
          .select("id")
          .eq("organization_id", organizationId)
          .eq("id", branchId)
          .maybeSingle();
        return !error && Boolean(data);
      },
    },
    sourceObjectValidator: {
      async assertAvailable({ storagePath }) {
        const segments = storagePath.split("/");
        const folder = segments.slice(0, 3).join("/");
        const filename = segments[3];
        const listed = await input.supabase.storage.from("integration-imports").list(folder, {
          limit: 2,
          search: filename,
        });
        if (listed.error || !listed.data.some((candidate) => candidate.name === filename)) {
          throw new IntegrationError("NOT_FOUND", "The import file is unavailable.", false);
        }
      },
    },
  });
}

type RouteContext = AuthenticatedIntegrationContext & {
  supabase: Awaited<ReturnType<typeof getOrganizationContext>>["supabase"];
};

export type IntegrationHubService = ReturnType<typeof createIntegrationService>;

type RouteHandler<TParams> = (input: {
  context: RouteContext;
  params: TParams;
  service: IntegrationHubService;
}) => Promise<{ body: unknown; status?: number }>;

function readCorrelationId(request: Request): string {
  const supplied = request.headers.get("x-correlation-id");
  if (!supplied) return crypto.randomUUID();
  return z.string().uuid().parse(supplied);
}

export async function parseRequestBody<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema,
): Promise<z.output<TSchema>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new DomainError("VALIDATION_ERROR", "Please check the submitted fields.");
  }
  return schema.parse(body);
}

function publicError(error: unknown): {
  status: number;
  error: { code: string; message: string; retryable?: boolean };
} {
  if (error instanceof IntegrationError) {
    const statusByCode: Record<IntegrationError["code"], number> = {
      AUTHORIZATION_ERROR: 403,
      TENANT_SCOPE_ERROR: 404,
      VALIDATION_ERROR: 400,
      FEATURE_NOT_AVAILABLE: 404,
      CONFLICT: 409,
      NOT_FOUND: 404,
      AUTHENTICATION_FAILED: 502,
      AUTHORIZATION_SCOPE_MISSING: 502,
      RATE_LIMITED: 429,
      PROVIDER_UNAVAILABLE: 503,
      INVALID_PROVIDER_RESPONSE: 502,
      RESOURCE_NOT_FOUND: 404,
      UNKNOWN_PROVIDER_ERROR: 502,
    };
    return {
      status: statusByCode[error.code],
      error: { code: error.code, message: error.message, retryable: error.retryable },
    };
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
    return { status, error: { code: error.code, message: error.message } };
  }
  if (error instanceof z.ZodError) {
    return {
      status: 400,
      error: { code: "VALIDATION_ERROR", message: "Please check the submitted fields." },
    };
  }
  return {
    status: 500,
    error: { code: "UNEXPECTED_ERROR", message: "Something went wrong. Please try again." },
  };
}

/**
 * Shared composition boundary for every user-facing Integration Hub route.
 * It intentionally uses the authenticated Supabase client returned by the
 * session context; Trigger worker credentials are never available here.
 */
export async function runIntegrationRoute<TParams>(input: {
  request: Request;
  params: Promise<TParams>;
  paramsSchema: z.ZodType<TParams>;
  handler: RouteHandler<TParams>;
}): Promise<NextResponse> {
  const startedAt = performance.now();
  let organizationId: string | undefined;
  let correlationId: string | undefined;
  try {
    const params = input.paramsSchema.parse(await input.params);
    const typedParams = params as TParams & { organizationId: string };
    organizationId = typedParams.organizationId;
    correlationId = readCorrelationId(input.request);
    const organizationContext = await getOrganizationContext(
      Promise.resolve({ organizationId: typedParams.organizationId }),
    );
    const context: RouteContext = {
      organizationId: organizationContext.organizationId,
      actorId: organizationContext.user.id,
      role: organizationContext.membership.role as OrganizationRole,
      correlationId,
      supabase: organizationContext.supabase,
    };
    const result = await input.handler({
      context,
      params,
      service: createIntegrationHubService({ supabase: organizationContext.supabase }),
    });
    const response = NextResponse.json(result.body, { status: result.status ?? 200 });
    response.headers.set("x-correlation-id", correlationId);
    logger.info("integration_api.completed", { organizationId, correlationId });
    return response;
  } catch (error) {
    const publicResponse = publicError(error);
    const response = NextResponse.json(
      { error: publicResponse.error },
      { status: publicResponse.status },
    );
    if (correlationId) response.headers.set("x-correlation-id", correlationId);
    logger.warn("integration_api.failed", {
      organizationId,
      correlationId,
      durationMs: Math.round(performance.now() - startedAt),
      errorCode: publicResponse.error.code,
      httpStatus: publicResponse.status,
    });
    return response;
  } finally {
    const durationMs = Math.round(performance.now() - startedAt);
    logger.info("integration_api.latency", { organizationId, correlationId, durationMs });
  }
}
