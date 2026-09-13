import { NextResponse } from "next/server";
import { z } from "zod";

import { DomainError, toPublicError } from "@/lib/errors";
import type { OrganizationPermission } from "@/domain/access/permissions";
import type { OrganizationRole } from "@/domain/organizations/types";
import { deliverableReviewDecisionSchema } from "@/domain/campaigns/deliverable";
import {
  deliverableOutcomeStatus,
  type CampaignDeliverableService,
  type DeliverableOutcome,
} from "@/modules/campaigns/application/deliverable-service";

/**
 * The HTTP surface for finished outputs.
 *
 * Only reviewing is here. Recording a finished output is deliberately absent:
 * `record_campaign_deliverable_version` is granted to the render worker alone,
 * so a member-facing route for it could do nothing but fail. Leaving it out
 * keeps the split visible in the code rather than only in a database grant —
 * the point being that nobody can hand-write a "finished output" that no render
 * actually produced.
 *
 * The version being reviewed is named in the path, not the body. The reviewer
 * is never named at all: the database reads `auth.uid()` inside the transaction,
 * so a forged reviewer in a request body has nowhere to land.
 */

type DeliverablePermission = Extract<
  OrganizationPermission,
  "campaign.read" | "campaign.approve"
>;

type DeliverableRouteParams = Promise<{
  organizationId: string;
  campaignId?: string;
  deliverableVersionId?: string;
}>;

export type DeliverableRouteContext = {
  organizationId: string;
  user: { id: string };
  supabase: unknown;
  membership: { role: OrganizationRole };
};

export type DeliverableRouteHandlerDependencies = {
  context(
    params: DeliverableRouteParams,
    permission: DeliverablePermission,
  ): Promise<DeliverableRouteContext>;
  serviceFor(context: DeliverableRouteContext): CampaignDeliverableService;
};

const uuidSchema = z.string().uuid();

/**
 * What a reviewer may send.
 *
 * `strictObject`, so an unexpected field is a refusal rather than something
 * silently ignored — including anything resembling `actorId`, `organizationId`
 * or `deliverableVersionId`, none of which a body may name.
 */
const reviewBodySchema = z.strictObject({
  contentHash: z.string().regex(/^[0-9a-f]{64}$/, "A content hash must be SHA-256 hex."),
  decision: deliverableReviewDecisionSchema,
  reasonCodes: z.array(z.string().trim().min(1).max(80)).max(15).optional(),
  note: z.string().trim().min(1).max(2000).nullable().optional(),
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
          : // Not yours and not there are answered identically. Distinguishing
            // them is how somebody enumerates another client's outputs.
            publicError.code === "TENANT_SCOPE_ERROR"
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

function parsePathId(value: string | undefined, label: string): string {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) throw new DomainError("VALIDATION_ERROR", `${label} is invalid.`);
  return parsed.data;
}

/**
 * One place turns an outcome into a response.
 *
 * A refusal is reported as the refusal it is, with its reason, rather than as
 * an empty success. "This output moved while you were looking at it" has to be
 * something the interface can actually say.
 */
function outcomeResponse<TValue>(outcome: DeliverableOutcome<TValue>): NextResponse {
  const status = deliverableOutcomeStatus(outcome);

  switch (outcome.status) {
    case "saved":
    case "replayed":
      return NextResponse.json({ outcome: outcome.status, ...outcome.value }, { status });
    case "needs_input":
      return NextResponse.json(
        { outcome: "needs_input", reasonCode: outcome.reasonCode },
        { status },
      );
    default:
      return NextResponse.json({ outcome: outcome.status }, { status });
  }
}

export function createDeliverableRouteHandlers(
  dependencies: DeliverableRouteHandlerDependencies,
) {
  return {
    /**
     * Records a person's verdict on one exact output.
     *
     * `campaign.approve` is the operator-level right to approve a version for
     * execution. It is deliberately NOT `campaign.publish`: saying "these bytes
     * are correct" is a different act from saying "send this to the public", and
     * C04 keeps them apart so that reviewing work does not confer the right to
     * publish it.
     */
    async review(request: Request, params: DeliverableRouteParams) {
      try {
        const context = await dependencies.context(params, "campaign.approve");
        const resolved = await params;
        const deliverableVersionId = parsePathId(
          resolved.deliverableVersionId,
          "Deliverable version ID",
        );
        const body = reviewBodySchema.parse(await parseJsonObject(request));

        return outcomeResponse(
          await dependencies.serviceFor(context).reviewVersion({
            organizationId: context.organizationId,
            request: {
              deliverableVersionId,
              contentHash: body.contentHash,
              decision: body.decision,
              reasonCodes: body.reasonCodes ?? [],
              note: body.note ?? null,
              idempotencyKey: body.idempotencyKey,
            },
          }),
        );
      } catch (error) {
        return apiErrorResponse(error);
      }
    },

    /**
     * Every finished output for a campaign, each with its publication verdict.
     *
     * Read-only, and computed fresh every time rather than cached. The whole
     * value of the verdict is that it reflects the review record at this
     * instant; a cached "publishable" would be a claim about a moment that has
     * already passed.
     *
     * Deliverables that were planned but never produced appear too, so the
     * screen can show an incomplete campaign as incomplete.
     */
    async list(_request: Request, params: DeliverableRouteParams) {
      try {
        const context = await dependencies.context(params, "campaign.read");
        const campaignId = parsePathId((await params).campaignId, "Campaign ID");

        const deliverables = await dependencies.serviceFor(context).listForCampaign({
          organizationId: context.organizationId,
          campaignId,
        });

        return NextResponse.json({ deliverables }, { status: 200 });
      } catch (error) {
        return apiErrorResponse(error);
      }
    },
  };
}

export type DeliverableRouteHandlers = ReturnType<typeof createDeliverableRouteHandlers>;
