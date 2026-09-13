import { NextResponse } from "next/server";
import { z } from "zod";

import type { OrganizationPermission } from "@/domain/access/permissions";
import type { OrganizationRole } from "@/domain/organizations/types";
import { DomainError, toPublicError } from "@/lib/errors";
import {
  completeCreativeUploadRequestSchema,
  confirmCreativeMetadataRequestSchema,
  createCreativeFolderRequestSchema,
  creativeHistoryReviewRequestSchema,
  reserveCreativeItemRequestSchema,
  reserveCreativeVersionRequestSchema,
  type CreativeHistoryCompletionOutcome,
  type CreativeHistoryService,
} from "@/modules/campaigns/application/creative-history-service";

/**
 * The HTTP edge of the design library.
 *
 * Three things are load-bearing here:
 *
 * The permission is named per handler, not per route file, and `asset.manage`
 * and `asset.review` are different names. Uploading a design and deciding the
 * design was good are separate acts, and one person holding both is a choice a
 * client's role map makes, not something this API assumes.
 *
 * A refusal does not arrive as 200. C06 is explicit that a 200 carrying a
 * refused outcome is how an interface ends up showing "Uploaded" over a file
 * that was thrown away, so a refusal is 422, a changed-bytes replay is 409, and
 * only a genuinely usable version is 201.
 *
 * Nothing reads the actor or the organization out of request JSON. Both come
 * from the session through `context`, which is also where the campaign rollout
 * gate is checked — after membership, so an outsider cannot learn which
 * organizations exist by comparing refusals.
 */

type CreativeHistoryPermission = Extract<
  OrganizationPermission,
  "asset.read" | "asset.manage" | "asset.review"
>;

type CreativeHistoryRouteParams = Promise<{
  organizationId: string;
  itemId?: string;
  versionId?: string;
}>;

export type CreativeHistoryRouteContext = {
  organizationId: string;
  user: { id: string };
  supabase: unknown;
  membership: { role: OrganizationRole };
};

export type CreativeHistoryRouteHandlerDependencies = {
  context(
    params: CreativeHistoryRouteParams,
    permission: CreativeHistoryPermission,
  ): Promise<CreativeHistoryRouteContext>;
  serviceFor(context: CreativeHistoryRouteContext): CreativeHistoryService;
};

const uuidSchema = z.string().uuid();

const listQuerySchema = z.strictObject({
  folderId: uuidSchema.nullable().optional(),
  includeArchived: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  eligibility: z
    .enum(["eligible_approved", "eligible_rejected", "archived", "metadata_unconfirmed", "unreviewed"])
    .optional(),
});
const LIST_QUERY_KEYS = new Set(["folderId", "includeArchived", "eligibility"]);

const completeBatchRequestSchema = z.strictObject({
  uploads: z.array(completeCreativeUploadRequestSchema).min(1).max(25),
});

const archiveRequestSchema = z.strictObject({ archived: z.literal(true) });

const itemPatchSchema = z.union([confirmCreativeMetadataRequestSchema.omit({ itemId: true }), archiveRequestSchema]);

function apiErrorResponse(error: unknown) {
  const publicError = toPublicError(error);
  const status =
    publicError.code === "AUTHENTICATION_ERROR"
      ? 401
      : publicError.code === "AUTHORIZATION_ERROR"
        ? 403
        : publicError.code === "VALIDATION_ERROR"
          ? 400
          : // A tenant-scope refusal is "not there", never "not yours": telling
            // the two apart is how somebody enumerates another client's library.
            publicError.code === "TENANT_SCOPE_ERROR"
            ? 404
            : publicError.code === "FEATURE_NOT_AVAILABLE"
              ? 403
              : 422;
  return NextResponse.json({ error: publicError }, { status });
}

async function parseJsonBody(request: Request): Promise<unknown> {
  return request.json().catch(() => {
    throw new DomainError("VALIDATION_ERROR", "The request body is not valid JSON.");
  });
}

async function parseJsonObject(request: Request): Promise<Record<string, unknown>> {
  const body = await parseJsonBody(request);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new DomainError("VALIDATION_ERROR", "The request body must be a JSON object.");
  }
  return body as Record<string, unknown>;
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

function parseItemId(value: string | undefined): string {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) throw new DomainError("VALIDATION_ERROR", "Design ID is invalid.");
  return parsed.data;
}

function parseVersionId(value: string | undefined): string {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) throw new DomainError("VALIDATION_ERROR", "Design version ID is invalid.");
  return parsed.data;
}

/** The status and the outcome agree, so neither can be read as the other. */
export function completionStatusCode(outcome: CreativeHistoryCompletionOutcome): number {
  switch (outcome.status) {
    case "usable":
      return 201;
    case "conflict":
      return 409;
    case "refused":
      return 422;
  }
}

export function createCreativeHistoryRouteHandlers(
  dependencies: CreativeHistoryRouteHandlerDependencies,
) {
  return {
    /** What the browser may upload, and where to put it. No credential inside. */
    async intake(_request: Request, params: CreativeHistoryRouteParams) {
      try {
        const context = await dependencies.context(params, "asset.read");
        const service = dependencies.serviceFor(context);
        // The governed rejection reasons ship with the contract: a reviewer who
        // must pick a reason needs the list before the dialog opens.
        const reviewReasons = await service.reviewReasons();
        return NextResponse.json({ intake: service.intakeContract(), reviewReasons });
      } catch (error) {
        return apiErrorResponse(error);
      }
    },

    async listFolders(_request: Request, params: CreativeHistoryRouteParams) {
      try {
        const context = await dependencies.context(params, "asset.read");
        const folders = await dependencies
          .serviceFor(context)
          .listFolders({ organizationId: context.organizationId });
        return NextResponse.json({ folders });
      } catch (error) {
        return apiErrorResponse(error);
      }
    },

    async createFolder(request: Request, params: CreativeHistoryRouteParams) {
      try {
        const context = await dependencies.context(params, "asset.manage");
        const body = createCreativeFolderRequestSchema.parse(await parseJsonBody(request));
        const folder = await dependencies
          .serviceFor(context)
          .createFolder({ organizationId: context.organizationId, ...body });
        return NextResponse.json(folder, { status: 201 });
      } catch (error) {
        return apiErrorResponse(error);
      }
    },

    async listItems(request: Request, params: CreativeHistoryRouteParams) {
      try {
        const context = await dependencies.context(params, "asset.read");
        const searchParams = strictSearchParams(request, LIST_QUERY_KEYS);
        const query = listQuerySchema.parse({
          folderId: searchParams.get("folderId") ?? undefined,
          includeArchived: searchParams.get("includeArchived") ?? undefined,
          eligibility: searchParams.get("eligibility") ?? undefined,
        });
        const items = await dependencies.serviceFor(context).list({
          organizationId: context.organizationId,
          ...query,
        });
        return NextResponse.json({ items });
      } catch (error) {
        return apiErrorResponse(error);
      }
    },

    async readItem(_request: Request, params: CreativeHistoryRouteParams) {
      try {
        const context = await dependencies.context(params, "asset.read");
        const routeParams = await params;
        const item = await dependencies.serviceFor(context).read({
          organizationId: context.organizationId,
          itemId: parseItemId(routeParams.itemId),
        });
        return NextResponse.json({ item });
      } catch (error) {
        return apiErrorResponse(error);
      }
    },

    /** Step one: a design nobody has uploaded before. */
    async reserveItem(request: Request, params: CreativeHistoryRouteParams) {
      try {
        const context = await dependencies.context(params, "asset.manage");
        const body = reserveCreativeItemRequestSchema.parse(await parseJsonBody(request));
        const reservation = await dependencies
          .serviceFor(context)
          .reserveItem({ organizationId: context.organizationId, ...body });
        return NextResponse.json(reservation, { status: 201 });
      } catch (error) {
        return apiErrorResponse(error);
      }
    },

    /** Step one: a replacement file for a design that already exists. */
    async reserveVersion(request: Request, params: CreativeHistoryRouteParams) {
      try {
        const context = await dependencies.context(params, "asset.manage");
        const routeParams = await params;
        const body = reserveCreativeVersionRequestSchema
          .omit({ itemId: true })
          .parse(await parseJsonBody(request));
        const reservation = await dependencies.serviceFor(context).reserveVersion({
          organizationId: context.organizationId,
          itemId: parseItemId(routeParams.itemId),
          ...body,
        });
        return NextResponse.json(reservation, { status: 201 });
      } catch (error) {
        return apiErrorResponse(error);
      }
    },

    /** Step three, one file. */
    async completeVersion(_request: Request, params: CreativeHistoryRouteParams) {
      try {
        const context = await dependencies.context(params, "asset.manage");
        const routeParams = await params;
        const outcome = await dependencies.serviceFor(context).complete({
          organizationId: context.organizationId,
          itemId: parseItemId(routeParams.itemId),
          versionId: parseVersionId(routeParams.versionId),
        });
        return NextResponse.json(outcome, { status: completionStatusCode(outcome) });
      } catch (error) {
        return apiErrorResponse(error);
      }
    },

    /**
     * Step three, a batch.
     *
     * Always 200, because the interesting answer is per file and the batch as a
     * whole did happen. Each member carries its own status, and `retryable`
     * names exactly the ones worth sending again — never the ones that worked.
     */
    async completeBatch(request: Request, params: CreativeHistoryRouteParams) {
      try {
        const context = await dependencies.context(params, "asset.manage");
        const body = completeBatchRequestSchema.parse(await parseJsonBody(request));
        const result = await dependencies
          .serviceFor(context)
          .completeBatch({ organizationId: context.organizationId, uploads: body.uploads });
        return NextResponse.json(result);
      } catch (error) {
        return apiErrorResponse(error);
      }
    },

    /** Confirming what a design is a picture of, or archiving it. */
    async updateItem(request: Request, params: CreativeHistoryRouteParams) {
      try {
        const context = await dependencies.context(params, "asset.manage");
        const routeParams = await params;
        const itemId = parseItemId(routeParams.itemId);
        const body = itemPatchSchema.parse(await parseJsonBody(request));
        const service = dependencies.serviceFor(context);

        if ("archived" in body) {
          const archived = await service.archive({
            organizationId: context.organizationId,
            itemId,
          });
          return NextResponse.json(archived);
        }

        const confirmed = await service.confirmMetadata({
          organizationId: context.organizationId,
          itemId,
          confirmedMetadata: body.confirmedMetadata,
        });
        return NextResponse.json(confirmed);
      } catch (error) {
        return apiErrorResponse(error);
      }
    },

    /** A human verdict, on exact bytes. Gated by `asset.review`, not `asset.manage`. */
    async review(request: Request, params: CreativeHistoryRouteParams) {
      try {
        const context = await dependencies.context(params, "asset.review");
        const routeParams = await params;
        // The design comes from the URL, never from the body: a verdict aimed
        // at one design must not be able to name another one in its payload.
        const submitted = await parseJsonObject(request);
        const body = creativeHistoryReviewRequestSchema.safeParse({
          ...submitted,
          itemId: parseItemId(routeParams.itemId),
        });
        if (!body.success) {
          // A rejection with no reason is a business refusal, not a typo: the
          // reason is the only thing a later campaign can learn from.
          throw new DomainError(
            "VALIDATION_ERROR",
            body.error.issues[0]?.message ?? "Please check the review details.",
          );
        }
        const result = await dependencies
          .serviceFor(context)
          .review({ organizationId: context.organizationId, ...body.data });
        return NextResponse.json(result, { status: 201 });
      } catch (error) {
        return apiErrorResponse(error);
      }
    },
  };
}
