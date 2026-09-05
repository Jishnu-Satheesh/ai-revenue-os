import { describe, expect, it, vi } from "vitest";

import {
  createCampaignDraftService,
  type CampaignDraftPersistence,
} from "@/modules/decisions/application/campaign-draft-service";
import { DomainError } from "@/lib/errors";

const organizationId = "10000000-0000-4000-8000-000000000001";
const actorId = "20000000-0000-4000-8000-000000000002";
const opportunityId = "30000000-0000-4000-8000-000000000003";
const requestId = "40000000-0000-4000-8000-000000000004";
const correlationId = "60000000-0000-4000-8000-000000000006";

function input() {
  return {
    organizationId,
    actorId,
    opportunityId,
    opportunityVersion: 2,
    actionKey: "campaign.governed_draft_v1" as const,
    objective: "Lift September gross profit from the Friday dinner rush",
    audience: "Nearby residents ordering weekend delivery",
    assertions: [{ key: "budget_available", expectedOutcome: "pass" }],
    idempotencyKey: "draft-request-operator-0001",
    correlationId,
  };
}

function persistence(outcome: { requestId: string; status: string; draftRequestStatus: string }) {
  const rpc = vi.fn(async () => ({ data: outcome, error: null }));
  return { persistence: { rpc } as unknown as CampaignDraftPersistence, rpc };
}

describe("campaign draft service", () => {
  it("returns an explicit created outcome for a first admission", async () => {
    const db = persistence({ requestId, status: "created", draftRequestStatus: "pending" });

    const result = await createCampaignDraftService(db.persistence).requestDraft(input());

    expect(result).toEqual({ outcome: "created", requestId, draftRequestStatus: "pending" });
    expect(db.rpc).toHaveBeenCalledWith(
      "request_campaign_draft_from_opportunity",
      expect.objectContaining({
        p_organization_id: organizationId,
        p_actor_id: actorId,
        p_opportunity_id: opportunityId,
        p_opportunity_version: 2,
        p_action_key: "campaign.governed_draft_v1",
        p_idempotency_key: "draft-request-operator-0001",
      }),
    );
  });

  it("returns replayed for the same idempotent retry instead of a second request", async () => {
    const db = persistence({ requestId, status: "replayed", draftRequestStatus: "pending" });

    const result = await createCampaignDraftService(db.persistence).requestDraft(input());

    expect(result.outcome).toBe("replayed");
    expect(result.requestId).toBe(requestId);
  });

  it("refuses invented action keys and short idempotency keys before any RPC", async () => {
    const db = persistence({ requestId, status: "created", draftRequestStatus: "pending" });

    await expect(
      createCampaignDraftService(db.persistence).requestDraft({
        ...input(),
        // Deliberately wrong at runtime: the cast keeps TypeScript quiet so
        // the zod boundary can prove it refuses.
        actionKey: "campaign.something_else_v9" as "campaign.governed_draft_v1",
      }),
    ).rejects.toThrow();
    await expect(
      createCampaignDraftService(db.persistence).requestDraft({
        ...input(),
        idempotencyKey: "short",
      }),
    ).rejects.toThrow();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("maps a cross-tenant refusal to a tenant scope error", async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { code: "P0002", message: "campaign draft opportunity not found" },
    }));
    const service = createCampaignDraftService({ rpc } as unknown as CampaignDraftPersistence);

    const failure = await service.requestDraft(input()).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DomainError);
    expect((failure as DomainError).code).toBe("TENANT_SCOPE_ERROR");
  });

  it("makes no model or provider call on the request path", async () => {
    const db = persistence({ requestId, status: "created", draftRequestStatus: "pending" });

    await createCampaignDraftService(db.persistence).requestDraft(input());

    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(db.rpc).toHaveBeenCalledWith(
      "request_campaign_draft_from_opportunity",
      expect.anything(),
    );
  });
});
