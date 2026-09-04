import { NextResponse } from "next/server";
import { z } from "zod";

import { hasOrganizationPermission } from "@/domain/access/permissions";
import type { OrganizationRole } from "@/domain/organizations/types";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { DomainError, toPublicError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  marketProfileApiErrorResponse,
  marketProfileCorrelationState,
} from "@/modules/growth-intelligence/application/api-schemas";
import { assertGrowthIntelligenceAccess } from "@/modules/growth-intelligence/application/feature-access";

const paramsSchema = z
  .object({ organizationId: z.string().uuid(), requestId: z.string().uuid() })
  .strict();

const bodySchema = z.object({ idempotencyKey: z.string().trim().min(16).max(200) }).strict();

const retryOutcomeSchema = z
  .object({
    requestId: z.string().uuid(),
    status: z.string(),
    replayed: z.boolean(),
  })
  .passthrough();

function retryFailure(message: string): DomainError {
  if (message.includes("growth_intelligence_retry_forbidden")) {
    return new DomainError(
      "AUTHORIZATION_ERROR",
      "You do not have permission to retry Market Intelligence work.",
    );
  }
  // Ineligible state (already terminal, attempts exhausted, unknown request)
  // is a safe client-visible outcome, never a server error.
  return new DomainError("DOMAIN_ERROR", "This request cannot be retried in its current state.");
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; requestId: string }> },
) {
  const correlation = marketProfileCorrelationState(request);
  let correlationId = correlation.responseId;
  let organizationId: string | undefined;
  try {
    const rawParams = await params;
    const context = await getOrganizationContext(
      Promise.resolve({ organizationId: rawParams.organizationId }),
    );
    organizationId = context.organizationId;

    assertGrowthIntelligenceAccess(organizationId, "market");
    if (
      !hasOrganizationPermission(
        context.membership.role as OrganizationRole,
        "growth_intelligence.manage",
      )
    ) {
      throw new DomainError(
        "AUTHORIZATION_ERROR",
        "You do not have permission to retry Market Intelligence work.",
      );
    }
    correlationId = correlation.parseAfterAuthorization();

    const routeParams = paramsSchema.parse(rawParams);
    const body = bodySchema.parse(await request.json().catch(() => ({})));
    // Scope, actor, and correlation stay server-owned: the body carries only
    // the idempotency key, and the RPC rechecks manage permission itself.
    const { data, error } = await context.supabase.rpc("retry_growth_intelligence_request", {
      // Tenant scope stays server-owned: routeParams only validates shape,
      // while the RPC receives the context organization the session proved.
      p_organization_id: context.organizationId,
      p_actor_id: context.user.id,
      p_request_id: routeParams.requestId,
      p_idempotency_key: body.idempotencyKey,
      p_correlation_id: correlationId,
    });
    if (error) throw retryFailure(typeof error.message === "string" ? error.message : "");
    const outcome = retryOutcomeSchema.parse(data);
    const response = NextResponse.json({ request: outcome, correlationId });
    response.headers.set("x-correlation-id", correlationId);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    logger.warn("growth_intelligence.request_retry_api_failed", {
      organizationId,
      correlationId,
      errorCode: toPublicError(error).code,
    });
    return marketProfileApiErrorResponse(error, correlationId);
  }
}
