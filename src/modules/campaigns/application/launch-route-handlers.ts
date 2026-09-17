import { NextResponse } from "next/server";
import { z } from "zod";

import { DomainError, toPublicError } from "@/lib/errors";
import { logger } from "@/lib/logger";
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

export type LaunchEventPublisher = (input: {
  organizationId: string;
  userId: string;
  eventName: "campaign.launch_approved";
  payload: { campaignId: string; bundleVersionId: string; launchApprovalId: string };
}) => Promise<void>;

export type LaunchRouteHandlerDependencies = {
  context(params: LaunchRouteParams, permission: LaunchPermission): Promise<LaunchRouteContext>;
  serviceFor(context: LaunchRouteContext): CampaignLaunchService;
  /**
   * Announced once per authority, not per click: a double-click replays the
   * same authority and must not announce a second approval that never happened.
   */
  publish(input: Parameters<LaunchEventPublisher>[0]): Promise<void>;
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

        const outcome = await dependencies.serviceFor(context).approve({
          organizationId: context.organizationId,
          request: { manifest: body.manifest, idempotencyKey: body.idempotencyKey },
        });

        // Only a newly saved authority is announced. A replay, a refusal, or
        // any other outcome describes work that did not happen now, and
        // announcing it would put a second approval on the record that nobody gave.
        if (outcome.status === "saved") {
          try {
            await dependencies.publish({
              organizationId: context.organizationId,
              userId: context.user.id,
              eventName: "campaign.launch_approved",
              payload: {
                campaignId: body.manifest.campaignId,
                bundleVersionId: body.manifest.bundleVersionId,
                launchApprovalId: outcome.launchApprovalId,
              },
            });
          } catch {
            // The approval stands with or without its announcement: the
            // authority row is the record, the event is a notification about
            // it. Failing the request here would report an error over work
            // that happened, and the retry would replay silently — losing the
            // event anyway while also lying about the outcome. So the loss is
            // logged, with the identifiers needed to reconcile it, and the
            // saved authority is still returned.
            logger.warn("campaign.launch_approved_announcement_failed", {
              organizationId: context.organizationId,
              campaignId: body.manifest.campaignId,
            });
          }
        }

        return outcomeResponse(outcome);
      } catch (error) {
        return apiErrorResponse(error);
      }
    },
  };
}

export type LaunchRouteHandlers = ReturnType<typeof createLaunchRouteHandlers>;
