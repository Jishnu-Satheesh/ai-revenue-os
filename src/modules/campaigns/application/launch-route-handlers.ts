import { NextResponse } from "next/server";
import { z } from "zod";

import { DomainError, toPublicError } from "@/lib/errors";
import type { OrganizationPermission } from "@/domain/access/permissions";
import type { OrganizationRole } from "@/domain/organizations/types";
import { campaignLaunchManifestSchema } from "@/domain/campaigns/launch";
import {
  launchOutcomeStatus,
  type CampaignLaunchService,
  type LaunchOutcome,
} from "@/modules/campaigns/application/launch-service";

/**
 * The HTTP surface for publication authority.
 *
 * This is the last gate, so it is the narrowest one: a single POST, requiring
 * `campaign.publish`, which sits above the operator line. An operator may
 * approve a version for execution; only an owner or admin may send it out.
 *
 * The digest is never accepted from the client. It is computed from the
 * manifest by the service, because the digest IS the binding — a caller-supplied
 * one would let the record say one thing while the terms said another.
 */

type LaunchPermission = Extract<OrganizationPermission, "campaign.publish">;

type LaunchRouteParams = Promise<{ organizationId: string; campaignId?: string }>;

export type LaunchRouteContext = {
  organizationId: string;
  user: { id: string };
  supabase: unknown;
  membership: { role: OrganizationRole };
};

export type LaunchRouteHandlerDependencies = {
  context(params: LaunchRouteParams, permission: LaunchPermission): Promise<LaunchRouteContext>;
  serviceFor(context: LaunchRouteContext): CampaignLaunchService;
};

const uuidSchema = z.string().uuid();

/**
 * What a client may send: the exact terms, and a key so a double-click cannot
 * authorize twice. Notably absent is `launchDigest` — see above.
 */
const approveBodySchema = z.strictObject({
  manifest: campaignLaunchManifestSchema,
  idempotencyKey: z.string().trim().min(8).max(200),
});

function apiErrorResponse(error: unknown) {
  const publicError = toPublicError(error);
  const status =
    publicError.code === "AUTHENTICATION_ERROR"
      ? 401
      : publicError.code === "AUTHORIZATION_ERROR"
        ? 403
        : publicError.code === "VALIDATION_ERROR"
          ? 400
          : publicError.code === "TENANT_SCOPE_ERROR"
            ? 404
            : 422;
  return NextResponse.json({ error: publicError }, { status });
}

async function parseJsonObject(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => {
    throw new DomainError("VALIDATION_ERROR", "The request body is not valid JSON.");
  });
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new DomainError("VALIDATION_ERROR", "The request body must be a JSON object.");
  }
  return body as Record<string, unknown>;
}

function parseCampaignId(value: string | undefined): string {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) throw new DomainError("VALIDATION_ERROR", "Campaign ID is invalid.");
  return parsed.data;
}

function outcomeResponse(outcome: LaunchOutcome): NextResponse {
  const status = launchOutcomeStatus(outcome);

  switch (outcome.status) {
    case "saved":
    case "replayed":
      return NextResponse.json(
        {
          outcome: outcome.status,
          launchApprovalId: outcome.launchApprovalId,
          launchDigest: outcome.launchDigest,
        },
        { status },
      );
    case "not_admissible":
      // Which output is blocking, and why. A blanket "cannot publish" would
      // leave the reviewer with nothing to act on.
      return NextResponse.json(
        {
          outcome: "not_admissible",
          reasonCode: outcome.reasonCode,
          deliverableVersionId: outcome.deliverableVersionId,
        },
        { status },
      );
    default:
      return NextResponse.json({ outcome: outcome.status }, { status });
  }
}

export function createLaunchRouteHandlers(dependencies: LaunchRouteHandlerDependencies) {
  return {
    async approve(request: Request, params: LaunchRouteParams) {
      try {
        const context = await dependencies.context(params, "campaign.publish");
        const campaignId = parseCampaignId((await params).campaignId);
        const body = approveBodySchema.parse(await parseJsonObject(request));

        // The manifest names its own campaign, and the database binds authority
        // to that name rather than to the URL. If the two disagree, the address
        // somebody reviewed is not the campaign they would be authorizing, so
        // this is a refusal rather than a preference for one of them.
        if (body.manifest.campaignId !== campaignId) {
          throw new DomainError(
            "VALIDATION_ERROR",
            "The launch manifest names a different campaign than the one being launched.",
          );
        }

        return outcomeResponse(
          await dependencies.serviceFor(context).approve({
            organizationId: context.organizationId,
            request: { manifest: body.manifest, idempotencyKey: body.idempotencyKey },
          }),
        );
      } catch (error) {
        return apiErrorResponse(error);
      }
    },
  };
}

export type LaunchRouteHandlers = ReturnType<typeof createLaunchRouteHandlers>;
