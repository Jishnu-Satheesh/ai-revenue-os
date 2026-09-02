import { NextResponse } from "next/server";
import { z } from "zod";

import type { OrganizationRole } from "@/domain/organizations/types";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { DomainError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { assertGovernedEconomicsReadinessEnabled } from "@/modules/integrations/application/feature-access";
import { createEvidenceReadinessService } from "@/modules/economics/application/readiness-service";
import { createAuthenticatedEvidenceReadinessRepository } from "@/modules/economics/infrastructure/readiness-repository";

const paramsSchema = z.object({ organizationId: z.string().uuid() });

function responseForError(error: unknown): NextResponse {
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
          : // A feature nobody has been given is indistinguishable from a route
            // that does not exist, and saying otherwise leaks the roadmap.
            error.code === "TENANT_SCOPE_ERROR" || error.code === "FEATURE_NOT_AVAILABLE"
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

/**
 * Governed economics evidence readiness for one organization.
 *
 * Read-only by construction: the service has no write path, the repository
 * selects no value column, and the flag is asserted before a session is even
 * resolved so a disabled organization costs nothing to refuse.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  let organizationId: string | undefined;

  try {
    const parsed = paramsSchema.parse(await params);
    organizationId = parsed.organizationId;
    assertGovernedEconomicsReadinessEnabled(organizationId);

    const context = await getOrganizationContext(Promise.resolve({ organizationId }));
    const service = createEvidenceReadinessService(
      createAuthenticatedEvidenceReadinessRepository(context.supabase),
    );

    const body = await service.loadReadiness({
      organizationId: context.organizationId,
      role: context.membership.role as OrganizationRole,
    });

    const response = NextResponse.json(body);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("x-correlation-id", correlationId);
    return response;
  } catch (error) {
    const response = responseForError(error);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("x-correlation-id", correlationId);
    // Identifiers and a code only. Readiness reads evidence about money, and a
    // log line is the easiest place for that to escape unnoticed.
    logger.warn("economics_readiness_api.failed", {
      organizationId,
      correlationId,
      errorCode: error instanceof DomainError ? error.code : "UNEXPECTED_ERROR",
    });
    return response;
  }
}
