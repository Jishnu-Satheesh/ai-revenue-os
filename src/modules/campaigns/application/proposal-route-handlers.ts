import { NextResponse } from "next/server";
import { z } from "zod";

import { DomainError, toPublicError } from "@/lib/errors";
import type { OrganizationPermission } from "@/domain/access/permissions";
import type { OrganizationRole } from "@/domain/organizations/types";
import {
  campaignProposalDocumentSchema,
  campaignProposalDecisionKindSchema,
  campaignProposalSourceKindSchema,
} from "@/domain/campaigns/proposal";
import {
  proposalOutcomeStatus,
  type CampaignProposalService,
  type ProposalOutcome,
} from "@/modules/campaigns/application/proposal-service";

/**
 * The HTTP surface for proposals.
 *
 * Two rules shape everything here. The tenant and the actor come from the
 * session, never from the request body — a body may name a proposal, but it may
 * not name who is approving it or on whose behalf. And the status code is
 * derived from the domain outcome in one place, so a route cannot quietly
 * report a refusal as a success or a conflict as a server fault.
 *
 * Approval is capability-gated at `campaign.proposal_approve`, which owners and
 * admins hold and operators do not. The database checks it again inside the
 * transaction; this check exists so the interface refuses early and clearly,
 * not as the thing that makes it safe.
 */

type ProposalPermission = Extract<
  OrganizationPermission,
  "campaign.read" | "campaign.create" | "campaign.edit" | "campaign.proposal_approve"
>;

type ProposalRouteParams = Promise<{ organizationId: string; proposalId?: string }>;

export type ProposalRouteContext = {
  organizationId: string;
  user: { id: string };
  supabase: unknown;
  membership: { role: OrganizationRole };
};

export type ProposalRouteHandlerDependencies = {
  context(
    params: ProposalRouteParams,
    permission: ProposalPermission,
  ): Promise<ProposalRouteContext>;
  serviceFor(context: ProposalRouteContext): CampaignProposalService;
};

const uuidSchema = z.string().uuid();

/**
 * What a client may send. `strictObject` throughout, so an unexpected field is
 * a refusal rather than something silently ignored — including, pointedly,
 * anything that looks like `actorId` or `organizationId`.
 */
const requestBodySchema = z.strictObject({
  sourceKind: campaignProposalSourceKindSchema,
  sourceId: uuidSchema.nullable().optional(),
  dedupeFingerprint: z.string().trim().min(1).max(200).nullable().optional(),
});

const revisionBodySchema = z.strictObject({
  document: campaignProposalDocumentSchema,
  sourceRevisionManifest: z.record(z.string(), z.unknown()).optional(),
  marketClaimKeys: z.array(z.string().trim().min(1).max(160)).max(60).optional(),
});

const decisionBodySchema = z.strictObject({
  proposalVersionId: uuidSchema,
  proposalDigest: z.string().regex(/^[0-9a-f]{64}$/, "A digest must be SHA-256 hex."),
  decision: campaignProposalDecisionKindSchema,
  reason: z.string().trim().min(1).max(4000).nullable().optional(),
  instructions: z.string().trim().min(1).max(4000).nullable().optional(),
  snoozedUntil: z.string().datetime({ offset: false }).nullable().optional(),
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
            // them is how somebody enumerates another client's proposals.
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

function parseProposalId(value: string | undefined): string {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) throw new DomainError("VALIDATION_ERROR", "Proposal ID is invalid.");
  return parsed.data;
}

/**
 * One place turns an outcome into a response.
 *
 * A refusal is reported as the refusal it is, with its reason code, rather than
 * as an empty success — the interface has to be able to say "this cannot be
 * reviewed yet, and here is what is missing" without pretending it saved.
 */
function outcomeResponse<TValue>(outcome: ProposalOutcome<TValue>): NextResponse {
  const status = proposalOutcomeStatus(outcome);

  switch (outcome.status) {
    case "saved":
    case "replayed":
      return NextResponse.json({ outcome: outcome.status, ...outcome.value }, { status });
    case "needs_input":
      return NextResponse.json(
        {
          outcome: "needs_input",
          reasonCode: outcome.reasonCode,
          declaredGaps: outcome.declaredGaps,
        },
        { status },
      );
    default:
      return NextResponse.json({ outcome: outcome.status }, { status });
  }
}

export function createProposalRouteHandlers(dependencies: ProposalRouteHandlerDependencies) {
  return {
    async requestProposal(request: Request, params: ProposalRouteParams) {
      try {
        const context = await dependencies.context(params, "campaign.create");
        const body = requestBodySchema.parse(await parseJsonObject(request));

        return outcomeResponse(
          await dependencies.serviceFor(context).request({
            organizationId: context.organizationId,
            request: {
              sourceKind: body.sourceKind,
              sourceId: body.sourceId ?? null,
              dedupeFingerprint: body.dedupeFingerprint ?? null,
            },
          }),
        );
      } catch (error) {
        return apiErrorResponse(error);
      }
    },

    async requestRevision(request: Request, params: ProposalRouteParams) {
      try {
        const context = await dependencies.context(params, "campaign.edit");
        const proposalId = parseProposalId((await params).proposalId);
        const body = revisionBodySchema.parse(await parseJsonObject(request));

        return outcomeResponse(
          await dependencies.serviceFor(context).requestRevision({
            organizationId: context.organizationId,
            request: {
              proposalId,
              document: body.document,
              sourceRevisionManifest: body.sourceRevisionManifest ?? {},
              marketClaimKeys: body.marketClaimKeys ?? [],
            },
          }),
        );
      } catch (error) {
        return apiErrorResponse(error);
      }
    },

    async decide(request: Request, params: ProposalRouteParams) {
      try {
        const body = decisionBodySchema.parse(await parseJsonObject(request));

        // The capability required depends on WHAT is being decided. Agreeing to
        // a proposal is an owner/admin act; asking for changes, snoozing or
        // dismissing is ordinary review an operator may record.
        const permission: ProposalPermission =
          body.decision === "approved_for_preparation"
            ? "campaign.proposal_approve"
            : "campaign.edit";

        const context = await dependencies.context(params, permission);
        const proposalId = parseProposalId((await params).proposalId);

        return outcomeResponse(
          await dependencies.serviceFor(context).decide({
            organizationId: context.organizationId,
            request: {
              proposalId,
              proposalVersionId: body.proposalVersionId,
              proposalDigest: body.proposalDigest,
              decision: body.decision,
              reason: body.reason ?? null,
              instructions: body.instructions ?? null,
              snoozedUntil: body.snoozedUntil ?? null,
              idempotencyKey: body.idempotencyKey,
            },
          }),
        );
      } catch (error) {
        return apiErrorResponse(error);
      }
    },
  };
}

export type ProposalRouteHandlers = ReturnType<typeof createProposalRouteHandlers>;
