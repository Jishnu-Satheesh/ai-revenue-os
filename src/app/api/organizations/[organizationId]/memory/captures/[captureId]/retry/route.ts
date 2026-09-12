import { z } from "zod";

import { DomainError } from "@/lib/errors";
import { runMemoryRoute } from "@/modules/memory/application/api";

const paramsSchema = z.object({
  organizationId: z.string().uuid(),
  captureId: z.string().uuid(),
});

const retryResponseSchema = z
  .object({ captureId: z.string().uuid(), status: z.string() })
  .catchall(z.unknown());

/**
 * Capture retry: owner/admin only, identifier-only.
 *
 * The request carries no body — the capture id in the path plus the
 * organization are the whole instruction — so there is nothing to validate
 * beyond identity and role. The response carries identifiers and the new
 * status only: a refusal (`failed`/`quarantined` required) surfaces as an
 * explicit error, never as a fresh-looking success.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; captureId: string }> },
) {
  return runMemoryRoute({
    request,
    params,
    paramsSchema,
    handler: async ({ context, params: routeParams }) => {
      if (context.role !== "owner" && context.role !== "admin") {
        throw new DomainError("AUTHORIZATION_ERROR", "Only owners and admins can retry a capture.");
      }
      const client = context.supabase as unknown as {
        rpc(
          name: string,
          args: Record<string, unknown>,
        ): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
      };
      const result = await client.rpc("retry_memory_capture", {
        p_organization_id: context.organizationId,
        p_actor_id: context.actorId,
        p_capture_id: routeParams.captureId,
        p_correlation_id: context.correlationId,
      });
      if (result.error) {
        if (result.error.code === "42501") {
          throw new DomainError("AUTHORIZATION_ERROR", "Only owners and admins can retry a capture.");
        }
        if (result.error.code === "P0002") {
          throw new DomainError("TENANT_SCOPE_ERROR", "The capture was not found.");
        }
        if (result.error.code === "23505") {
          throw new DomainError("DOMAIN_ERROR", "The capture cannot be retried in its current state.");
        }
        throw new DomainError("VALIDATION_ERROR", "The capture could not be retried.");
      }
      const retried = retryResponseSchema.parse(result.data);
      return { body: { captureId: retried.captureId, status: retried.status } };
    },
  });
}
