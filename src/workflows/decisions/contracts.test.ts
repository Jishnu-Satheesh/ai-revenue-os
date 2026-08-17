import { describe, expect, it } from "vitest";

import {
  campaignDecisionCyclePayloadSchema,
  decisionCycleRequestDigest,
  parseCampaignDecisionCyclePayload,
} from "@/workflows/decisions/contracts";

const payload = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  correlationId: "22222222-2222-4222-8222-222222222222",
  idempotencyKey: " campaign-cycle:2026-08-13 ",
  triggerType: "scheduled" as const,
};

describe("Campaign decision-cycle workflow contracts", () => {
  it("strictly parses and normalizes the bounded payload", () => {
    expect(parseCampaignDecisionCyclePayload(payload)).toEqual({
      ...payload,
      idempotencyKey: "campaign-cycle:2026-08-13",
    });
    expect(() =>
      campaignDecisionCyclePayloadSchema.parse({ ...payload, sourcePayload: {} }),
    ).toThrow();
    expect(() =>
      campaignDecisionCyclePayloadSchema.parse({ ...payload, triggerType: "webhook" }),
    ).toThrow();
  });

  it("hashes the normalized parsed payload in a stable field order", () => {
    const parsed = parseCampaignDecisionCyclePayload(payload);
    expect(decisionCycleRequestDigest(parsed)).toBe(
      "d05064d47add70fc97b9f1fa1c8090bf4ef9316147144d1631882574bc027e7a",
    );
    expect(
      decisionCycleRequestDigest(
        parseCampaignDecisionCyclePayload({
          triggerType: "scheduled",
          idempotencyKey: "campaign-cycle:2026-08-13",
          correlationId: payload.correlationId,
          organizationId: payload.organizationId,
        }),
      ),
    ).toBe(decisionCycleRequestDigest(parsed));
  });
});
