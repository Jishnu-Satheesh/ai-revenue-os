import { z } from "zod";

import { DomainError } from "@/lib/errors";

/**
 * The signed-in member's request for a governed Campaign draft (spec 022
 * section 10.2). One atomic database operation admits or replays exactly one
 * durable request; this layer validates shape, translates refusals, and
 * returns the explicit outcome. It makes no model call, creates no Campaign,
 * grants no approval, and moves no spend — those belong to Tasks 22 and 23.
 */

const uuidSchema = z.string().uuid();

const assertionSchema = z
  .object({
    key: z.string().trim().min(1).max(200),
    expectedOutcome: z.string().trim().min(1).max(200),
  })
  .strict();

const requestInputSchema = z
  .object({
    organizationId: uuidSchema,
    actorId: uuidSchema,
    opportunityId: uuidSchema,
    opportunityVersion: z.number().int().positive(),
    actionKey: z.literal("campaign.governed_draft_v1"),
    objective: z.string().trim().min(1).max(500),
    audience: z.string().trim().min(1).max(500),
    assertions: z.array(assertionSchema).min(1).max(50),
    idempotencyKey: z.string().trim().min(16).max(200),
    correlationId: uuidSchema,
  })
  .strict();

export type CampaignDraftRequestInput = z.infer<typeof requestInputSchema>;

export type CampaignDraftRequestOutcome = {
  outcome: "created" | "replayed";
  requestId: string;
  draftRequestStatus: string;
};

export type CampaignDraftPersistence = {
  rpc(
    name: "request_campaign_draft_from_opportunity",
    args: {
      p_organization_id: string;
      p_actor_id: string;
      p_opportunity_id: string;
      p_opportunity_version: number;
      p_action_key: string;
      p_objective: string;
      p_audience: string;
      p_assertions: unknown;
      p_idempotency_key: string;
      p_correlation_id: string;
    },
  ): Promise<{
    data: { requestId: string; status: string; draftRequestStatus: string } | null;
    error: { code: string | null; message: string } | null;
  }>;
};

function mapRpcError(error: { code: string | null; message: string }): DomainError {
  switch (error.code) {
    case "42501":
      return new DomainError(
        "AUTHORIZATION_ERROR",
        "You do not have permission to request a governed draft.",
      );
    // An opportunity outside this tenant is refused exactly like one that
    // does not exist; saying which would describe the neighbours' drafts.
    case "P0002":
      return new DomainError(
        "TENANT_SCOPE_ERROR",
        "This opportunity was not found. It may have been removed.",
      );
    case "22023":
      return new DomainError("VALIDATION_ERROR", error.message);
    default:
      return new DomainError(
        "INTEGRATION_ERROR",
        "Your draft request could not be recorded. Try again in a moment.",
        error,
      );
  }
}

export function createCampaignDraftService(persistence: CampaignDraftPersistence) {
  return {
    async requestDraft(input: CampaignDraftRequestInput): Promise<CampaignDraftRequestOutcome> {
      const request = requestInputSchema.parse(input);
      const { data, error } = await persistence.rpc("request_campaign_draft_from_opportunity", {
        p_organization_id: request.organizationId,
        p_actor_id: request.actorId,
        p_opportunity_id: request.opportunityId,
        p_opportunity_version: request.opportunityVersion,
        p_action_key: request.actionKey,
        p_objective: request.objective,
        p_audience: request.audience,
        p_assertions: request.assertions,
        p_idempotency_key: request.idempotencyKey,
        p_correlation_id: request.correlationId,
      });
      if (error) throw mapRpcError(error);
      if (!data || (data.status !== "created" && data.status !== "replayed")) {
        throw new DomainError(
          "INTEGRATION_ERROR",
          "Your draft request could not be recorded. Try again in a moment.",
        );
      }
      return {
        outcome: data.status,
        requestId: data.requestId,
        draftRequestStatus: data.draftRequestStatus,
      };
    },
  };
}
