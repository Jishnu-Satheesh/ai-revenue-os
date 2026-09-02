import { NextResponse } from "next/server";
import { z } from "zod";

import type { OrganizationPermission } from "@/domain/access/permissions";
import type { OrganizationRole } from "@/domain/organizations/types";
import { DomainError, toPublicError } from "@/lib/errors";
import {
  createSubjectService,
  subjectDraftRequestSchema,
  subjectProfileContentSchema,
} from "@/modules/campaigns/application/subject-service";

type SubjectPermission = Extract<OrganizationPermission, "asset.read" | "subject.manage">;
type SubjectRouteParams = Promise<{ organizationId: string; subjectId?: string }>;
export type SubjectRouteContext = {
  organizationId: string;
  user: { id: string };
  supabase: unknown;
  membership: { role: OrganizationRole };
};
type SubjectRouteService = ReturnType<typeof createSubjectService>;

export type SubjectRouteHandlerDependencies = {
  context(params: SubjectRouteParams, permission: SubjectPermission): Promise<SubjectRouteContext>;
  serviceFor(context: SubjectRouteContext): SubjectRouteService;
};

const uuidSchema = z.string().uuid();
const manualCreateSchema = subjectProfileContentSchema.omit({ organizationId: true }).extend({
  draftDescription: z.literal(false).optional(),
});
const draftedCreateSchema = subjectDraftRequestSchema
  .omit({ organizationId: true, correlationId: true })
  .extend({ draftDescription: z.literal(true) });
const editSchema = subjectProfileContentSchema.omit({ organizationId: true }).extend({
  action: z.literal("edit"),
});
const subjectPatchSchema = z.discriminatedUnion("action", [
  editSchema,
  z.strictObject({ action: z.literal("confirm") }),
  z.strictObject({ action: z.literal("archive") }),
]);

/**
 * Confirming is the privileged act, per spec 019 §11.
 *
 * `subject.manage` lets a role write a draft; it does not by itself let a role
 * approve one. Confirmation is the moment a sentence stops being a proposal and
 * becomes the thing the platform will draw and publish, so it takes the same
 * roles the repository already reserves for privileged organization acts.
 * Editing and archiving stay open to everyone holding `subject.manage`.
 */
const CONFIRMING_ROLES: readonly OrganizationRole[] = ["owner", "admin"];

function apiErrorResponse(error: unknown) {
  const publicError = toPublicError(error);
  const status =
    publicError.code === "AUTHENTICATION_ERROR"
      ? 401
      : publicError.code === "AUTHORIZATION_ERROR"
        ? 403
        : publicError.code === "VALIDATION_ERROR"
          ? 400
          : 422;
  return NextResponse.json({ error: publicError }, { status });
}

async function parseJsonBody(request: Request): Promise<unknown> {
  return request.json().catch(() => {
    throw new DomainError("VALIDATION_ERROR", "The request body is not valid JSON.");
  });
}

function subjectIdFrom(params: { subjectId?: string }): string {
  const parsed = uuidSchema.safeParse(params.subjectId);
  if (!parsed.success) throw new DomainError("VALIDATION_ERROR", "Subject ID is invalid.");
  return parsed.data;
}

function correlationState(request: Request) {
  const supplied = request.headers.get("x-correlation-id");
  const fallback = crypto.randomUUID();
  return {
    responseId: uuidSchema.safeParse(supplied).success ? supplied! : fallback,
    parseAfterAuthorization() {
      return supplied === null ? fallback : uuidSchema.parse(supplied);
    },
  };
}

function withCorrelation(response: NextResponse, correlationId: string): NextResponse {
  response.headers.set("x-correlation-id", correlationId);
  return response;
}

export function createSubjectRouteHandlers(dependencies: SubjectRouteHandlerDependencies) {
  return {
    async list(request: Request, params: SubjectRouteParams) {
      const correlation = correlationState(request);
      try {
        const context = await dependencies.context(params, "asset.read");
        const correlationId = correlation.parseAfterAuthorization();
        const subjects = await dependencies.serviceFor(context).list(context.organizationId);
        return withCorrelation(NextResponse.json({ subjects }), correlationId);
      } catch (error) {
        return withCorrelation(apiErrorResponse(error), correlation.responseId);
      }
    },

    async create(request: Request, params: SubjectRouteParams) {
      const correlation = correlationState(request);
      try {
        const context = await dependencies.context(params, "subject.manage");
        const correlationId = correlation.parseAfterAuthorization();
        const body = z
          .union([draftedCreateSchema, manualCreateSchema])
          .parse(await parseJsonBody(request));
        const service = dependencies.serviceFor(context);
        const result =
          body.draftDescription === true
            ? await service.draft({
                organizationId: context.organizationId,
                correlationId,
                name: body.name,
                slug: body.slug,
                operatorNotes: body.operatorNotes,
                tags: body.tags,
                namesByScript: body.namesByScript,
                mustNotAppear: body.mustNotAppear,
                illustratedStyle: body.illustratedStyle,
              })
            : await service.create({
                organizationId: context.organizationId,
                name: body.name,
                slug: body.slug,
                description: body.description,
                tags: body.tags,
                namesByScript: body.namesByScript,
                mustNotAppear: body.mustNotAppear,
                illustratedStyle: body.illustratedStyle,
              });
        return withCorrelation(NextResponse.json(result, { status: 201 }), correlationId);
      } catch (error) {
        return withCorrelation(apiErrorResponse(error), correlation.responseId);
      }
    },

    async update(request: Request, params: SubjectRouteParams) {
      const correlation = correlationState(request);
      try {
        const context = await dependencies.context(params, "subject.manage");
        const correlationId = correlation.parseAfterAuthorization();
        const routeParams = await params;
        const subjectProfileId = subjectIdFrom(routeParams);
        const body = subjectPatchSchema.parse(await parseJsonBody(request));
        if (body.action === "confirm" && !CONFIRMING_ROLES.includes(context.membership.role)) {
          throw new DomainError(
            "AUTHORIZATION_ERROR",
            "Confirming a subject description is reserved for an owner or admin.",
          );
        }
        const service = dependencies.serviceFor(context);
        const target = { organizationId: context.organizationId, subjectProfileId };
        const result =
          body.action === "confirm"
            ? await service.confirm(target)
            : body.action === "archive"
              ? await service.archive(target)
              : await service.edit({
                  ...target,
                  name: body.name,
                  slug: body.slug,
                  description: body.description,
                  tags: body.tags,
                  namesByScript: body.namesByScript,
                  mustNotAppear: body.mustNotAppear,
                  illustratedStyle: body.illustratedStyle,
                });
        return withCorrelation(NextResponse.json(result), correlationId);
      } catch (error) {
        return withCorrelation(apiErrorResponse(error), correlation.responseId);
      }
    },
  };
}
