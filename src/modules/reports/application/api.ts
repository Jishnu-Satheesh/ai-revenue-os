import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { DomainError } from "@/lib/errors";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { logger } from "@/lib/logger";
import type { OrganizationRole } from "@/domain/organizations/types";
import { assertIntegrationHubEnabled } from "@/modules/integrations/application/feature-access";
import {
  createReportPackageService,
  type AuthenticatedReportContext,
} from "@/modules/reports/application/service";
import { createAuthenticatedReportPackageRepository } from "@/modules/reports/infrastructure/repository";
import { createAdmissionService } from "@/modules/reports/application/admissions";

export const organizationReportRouteParamsSchema = z.object({ organizationId: z.string().uuid() });
export const reportPackageRouteParamsSchema = organizationReportRouteParamsSchema.extend({
  packageId: z.string().uuid(),
});
export const reportContractVersionRouteParamsSchema = organizationReportRouteParamsSchema.extend({
  contractVersionId: z.string().uuid(),
});
export const reportProjectionVersionRouteParamsSchema = organizationReportRouteParamsSchema.extend({
  projectionVersionId: z.string().uuid(),
});
export const reportProjectionReconciliationRouteParamsSchema = organizationReportRouteParamsSchema.extend({
  reconciliationId: z.string().uuid(),
});

export async function reportRequest<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema,
  validationMessage = "Please check the submitted fields.",
  transform: (input: unknown) => unknown = (input) => input,
): Promise<z.output<TSchema>> {
  try {
    return schema.parse(transform(await request.json()));
  } catch (error) {
    if (error instanceof z.ZodError) throw new DomainError("VALIDATION_ERROR", validationMessage, error);
    throw new DomainError("VALIDATION_ERROR", validationMessage, error);
  }
}

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

type ReportRouteContext = AuthenticatedReportContext & {
  service: ReturnType<typeof createReportPackageService>;
  // Built from the same authenticated client as `service`, for the one route
  // (granting a standing admission) that needs a second, differently-shaped
  // set of operations against report data. Everything else keeps using
  // `service` alone.
  admissionService: ReturnType<typeof createAdmissionService>;
};

export async function runReportRoute<TParams>(input: {
  request: Request;
  params: Promise<TParams>;
  paramsSchema: z.ZodType<TParams>;
  handler: (
    context: ReportRouteContext & { params: TParams },
  ) => Promise<{ body: unknown; status?: number }>;
}): Promise<NextResponse> {
  let organizationId: string | undefined;
  const correlationId = input.request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  try {
    const params = input.paramsSchema.parse(await input.params);
    const typed = params as TParams & { organizationId: string };
    organizationId = typed.organizationId;
    assertIntegrationHubEnabled(organizationId);
    const organization = await getOrganizationContext(Promise.resolve({ organizationId }));
    const service = createReportPackageService(
      createAuthenticatedReportPackageRepository(organization.supabase),
    );
    const admissionService = createAdmissionService(organization.supabase);
    const result = await input.handler({
      organizationId,
      actorId: organization.user.id,
      role: organization.membership.role as OrganizationRole,
      correlationId,
      service,
      admissionService,
      params,
    });
    const response = NextResponse.json(result.body, { status: result.status ?? 200 });
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("x-correlation-id", correlationId);
    return response;
  } catch (error) {
    const response = responseForError(error);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("x-correlation-id", correlationId);
    logger.warn("report_packages_api.failed", {
      organizationId,
      correlationId,
      errorCode: error instanceof DomainError ? error.code : "UNEXPECTED_ERROR",
    });
    return response;
  }
}
