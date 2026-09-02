import { NextResponse } from "next/server";
import { z } from "zod";

import {
  creativeAssetReviewSchema,
  conditioningRoleSchema,
  scriptCodeSchema,
} from "@/domain/campaigns/asset-library";
import {
  referenceResolutionRequestSchema,
  resolveReferences,
} from "@/domain/campaigns/reference-resolution";
import type { OrganizationPermission } from "@/domain/access/permissions";
import type { OrganizationRole } from "@/domain/organizations/types";
import { DomainError, toPublicError } from "@/lib/errors";
import {
  brandAssetCompleteRequestSchema,
  brandAssetUploadRequestSchema,
} from "@/modules/campaigns/application/api-schemas";
import {
  brandAssetClassificationSchema,
  brandAssetClassificationWithOwnershipSchema,
  createAssetLibraryService,
} from "@/modules/campaigns/application/asset-library-service";
import type { createBrandAssetService } from "@/modules/campaigns/application/brand-asset-service";

type AssetPermission = Extract<
  OrganizationPermission,
  "asset.read" | "asset.manage" | "asset.review"
>;
type AssetRouteParams = Promise<{
  organizationId: string;
  assetId?: string;
  versionId?: string;
  uploadId?: string;
}>;
export type AssetRouteContext = {
  organizationId: string;
  user: { id: string };
  supabase: unknown;
  membership: { role: OrganizationRole };
};
type AssetLibraryRouteService = ReturnType<typeof createAssetLibraryService>;
type BrandAssetRouteService = ReturnType<typeof createBrandAssetService>;

export type AssetRouteHandlerDependencies = {
  context(params: AssetRouteParams, permission: AssetPermission): Promise<AssetRouteContext>;
  servicesFor(context: AssetRouteContext): {
    library: AssetLibraryRouteService;
    brandAssets: BrandAssetRouteService;
  };
};

const uuidSchema = z.string().uuid();
const newAssetSchema = z.strictObject({
  label: z.string().trim().min(1).max(160),
  assetRole: z.enum(["logo", "product", "venue", "team", "other"]),
  classification: brandAssetClassificationWithOwnershipSchema,
});
const metadataPatchSchema = z
  .strictObject({
    classification: brandAssetClassificationSchema.optional(),
    archived: z.boolean().optional(),
  })
  .superRefine((input, context) => {
    if (input.classification === undefined && input.archived === undefined) {
      context.addIssue({ code: "custom", message: "At least one asset change is required." });
    }
  });
const listQuerySchema = z.strictObject({
  role: conditioningRoleSchema.optional(),
  verdict: z.enum(["approved", "rejected", "unreviewed"]).optional(),
  tag: z.string().trim().min(1).max(60).optional(),
  includeArchived: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});

const LIST_QUERY_KEYS = new Set(["role", "verdict", "tag", "includeArchived"]);
const RESOLUTION_QUERY_KEYS = new Set([
  "subjectTag",
  "subjectDescription",
  "settingTag",
  "occasionTag",
  "styleTag",
  "script",
]);

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

function strictSearchParams(request: Request, allowedKeys: ReadonlySet<string>): URLSearchParams {
  const searchParams = new URL(request.url).searchParams;
  for (const key of searchParams.keys()) {
    if (!allowedKeys.has(key)) {
      throw new DomainError("VALIDATION_ERROR", `Query field ${key} is not supported.`);
    }
  }
  return searchParams;
}

function parseAssetId(value: string | undefined): string {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) throw new DomainError("VALIDATION_ERROR", "Asset ID is invalid.");
  return parsed.data;
}

function parseVersionId(value: string | undefined): string {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) throw new DomainError("VALIDATION_ERROR", "Asset version ID is invalid.");
  return parsed.data;
}

function responseForCompletion(result: Awaited<ReturnType<BrandAssetRouteService["complete"]>>) {
  return NextResponse.json(result, { status: result.status === "usable" ? 201 : 200 });
}

export function createAssetRouteHandlers(dependencies: AssetRouteHandlerDependencies) {
  return {
    async list(request: Request, params: AssetRouteParams) {
      try {
        const context = await dependencies.context(params, "asset.read");
        const searchParams = strictSearchParams(request, LIST_QUERY_KEYS);
        const query = listQuerySchema.parse({
          role: searchParams.get("role") ?? undefined,
          verdict: searchParams.get("verdict") ?? undefined,
          tag: searchParams.get("tag") ?? undefined,
          includeArchived: searchParams.get("includeArchived") ?? undefined,
        });
        const assets = await dependencies.servicesFor(context).library.list({
          organizationId: context.organizationId,
          ...query,
        });
        return NextResponse.json({ assets });
      } catch (error) {
        return apiErrorResponse(error);
      }
    },

    async reserve(request: Request, params: AssetRouteParams) {
      try {
        const context = await dependencies.context(params, "asset.manage");
        const body = newAssetSchema.parse(await parseJsonBody(request));
        const reservation = await dependencies.servicesFor(context).brandAssets.reserve({
          organizationId: context.organizationId,
          ...body,
        });
        return NextResponse.json(reservation, { status: 201 });
      } catch (error) {
        return apiErrorResponse(error);
      }
    },

    async reserveLegacy(request: Request, params: AssetRouteParams) {
      try {
        const context = await dependencies.context(params, "asset.manage");
        const body = brandAssetUploadRequestSchema.parse(await parseJsonBody(request));
        const reservation = await dependencies.servicesFor(context).brandAssets.reserve({
          organizationId: context.organizationId,
          label: body.label,
          assetRole: body.assetRole,
        });
        return NextResponse.json(reservation, { status: 201 });
      } catch (error) {
        return apiErrorResponse(error);
      }
    },

    async reserveVersion(_request: Request, params: AssetRouteParams) {
      try {
        const context = await dependencies.context(params, "asset.manage");
        const routeParams = await params;
        const reservation = await dependencies.servicesFor(context).brandAssets.reserve({
          organizationId: context.organizationId,
          brandAssetId: parseAssetId(routeParams.assetId),
        });
        return NextResponse.json(reservation, { status: 201 });
      } catch (error) {
        return apiErrorResponse(error);
      }
    },

    async completeVersion(_request: Request, params: AssetRouteParams) {
      try {
        const context = await dependencies.context(params, "asset.manage");
        const routeParams = await params;
        const assetId = parseAssetId(routeParams.assetId);
        const versionId = parseVersionId(routeParams.versionId);
        const result = await dependencies.servicesFor(context).brandAssets.complete({
          organizationId: context.organizationId,
          versionId,
          storagePath: `${context.organizationId}/${assetId}/${versionId}/source`,
        });
        return responseForCompletion(result);
      } catch (error) {
        return apiErrorResponse(error);
      }
    },

    async completeLegacy(request: Request, params: AssetRouteParams) {
      try {
        const context = await dependencies.context(params, "asset.manage");
        const body = brandAssetCompleteRequestSchema.parse(await parseJsonBody(request));
        const result = await dependencies.servicesFor(context).brandAssets.complete({
          organizationId: context.organizationId,
          versionId: body.versionId,
          storagePath: `${context.organizationId}/${body.brandAssetId}/${body.versionId}/source`,
        });
        return responseForCompletion(result);
      } catch (error) {
        return apiErrorResponse(error);
      }
    },

    async update(request: Request, params: AssetRouteParams) {
      try {
        const context = await dependencies.context(params, "asset.manage");
        const routeParams = await params;
        const body = metadataPatchSchema.parse(await parseJsonBody(request));
        const result = await dependencies.servicesFor(context).library.updateMetadata({
          organizationId: context.organizationId,
          brandAssetId: parseAssetId(routeParams.assetId),
          ...(body.classification ?? {}),
          ...(body.archived === undefined ? {} : { archived: body.archived }),
        });
        return NextResponse.json(result);
      } catch (error) {
        return apiErrorResponse(error);
      }
    },

    async review(request: Request, params: AssetRouteParams) {
      try {
        const context = await dependencies.context(params, "asset.review");
        const review = creativeAssetReviewSchema.parse(await parseJsonBody(request));
        const result = await dependencies.servicesFor(context).library.recordReview({
          organizationId: context.organizationId,
          ...review,
        });
        return NextResponse.json(result, { status: 201 });
      } catch (error) {
        return apiErrorResponse(error);
      }
    },

    async resolve(request: Request, params: AssetRouteParams) {
      try {
        const context = await dependencies.context(params, "asset.read");
        const searchParams = strictSearchParams(request, RESOLUTION_QUERY_KEYS);
        const resolutionRequest = referenceResolutionRequestSchema.parse({
          subjectTags: searchParams.getAll("subjectTag"),
          subjectDescription: searchParams.get("subjectDescription"),
          settingTags: searchParams.getAll("settingTag"),
          occasionTags: searchParams.getAll("occasionTag"),
          styleTags: searchParams.getAll("styleTag"),
          scripts: searchParams.getAll("script").map((script) => scriptCodeSchema.parse(script)),
        });
        const service = dependencies.servicesFor(context).library;
        const [references, reasons] = await Promise.all([
          service.list({ organizationId: context.organizationId, includeArchived: true }),
          service.reviewReasons(),
        ]);
        const resolution = resolveReferences({
          candidates: references.map((reference) => ({
            brandAssetId: reference.brandAssetId,
            brandAssetVersionId: reference.brandAssetVersionId,
            conditioningRoles: reference.conditioningRoles,
            tags: reference.tags,
            scripts: reference.scripts,
            ownership: reference.ownership,
            version: reference.version,
            currentVerdict: reference.currentVerdict,
            currentReasonCodes: reference.currentReasonCodes,
            currentReviewedAt: reference.currentReviewedAt,
            archivedAt: reference.archivedAt,
            requestedReferenceMode: "inspiration" as const,
          })),
          reasonRegistry: reasons.map((reason) => ({
            code: reason.code,
            description: reason.description,
          })),
          request: resolutionRequest,
        });
        return NextResponse.json({ resolution });
      } catch (error) {
        return apiErrorResponse(error);
      }
    },
  };
}
