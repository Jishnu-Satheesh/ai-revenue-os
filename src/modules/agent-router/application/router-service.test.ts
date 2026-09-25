import { describe, expect, it } from "vitest";

import type { RouterInput, RouterProposal } from "@/domain/agent-router/contracts";
import { routeAgentMessage } from "@/modules/agent-router/application/router-service";

const baseInput: Omit<RouterInput, "text" | "model"> = {
  page: "overview",
  role: "operator",
  permissions: ["growth_intelligence.manage"],
  contextDigest: "d".repeat(64),
  activeWatches: [],
};

describe("router", () => {
  it("routes watch intent with missing cadence to questionnaire", () => {
    const out = routeAgentMessage({
      ...baseInput,
      text: "keep watching competitors",
      model: { kind: "stub", intent: "watch", confidence: "high", missing: ["frequency"] },
    });
    expect(out.intent).toBe("watch");
    expect(out.questionnaire).not.toBeNull();
  });

  it("gates viewers to answer_memory even when the model proposes watch", () => {
    const out = routeAgentMessage({
      ...baseInput,
      text: "keep watching competitors",
      role: "viewer",
      permissions: [],
      model: { kind: "stub", intent: "watch", confidence: "high", missing: [] },
    });
    expect(out.intent).toBe("answer_memory");
    expect(out.reasonCodes).toContain("VIEWER_RESTRICTED");
  });

  it("falls back to answer_memory with a clarify card on low confidence", () => {
    const out = routeAgentMessage({
      ...baseInput,
      text: "hmm what about that thing",
      model: { kind: "stub", intent: "research_once", confidence: "low", missing: [] },
    });
    expect(out.intent).toBe("answer_memory");
    expect(out.questionnaire).not.toBeNull();
    expect(out.questionnaire?.kind).toBe("clarify");
  });

  it("caps missing fields at 3", () => {
    const out = routeAgentMessage({
      ...baseInput,
      text: "watch everything everywhere",
      model: {
        kind: "stub",
        intent: "watch",
        confidence: "high",
        missing: ["frequency", "branch", "research_area", "competitors", "end_date"],
      },
    });
    expect(out.missingFields.length).toBeLessThanOrEqual(3);
  });

  it("gates campaign_advice behind campaign.create", () => {
    const out = routeAgentMessage({
      ...baseInput,
      text: "draft a campaign for this",
      permissions: ["growth_intelligence.manage"],
      model: { kind: "stub", intent: "campaign_advice", confidence: "high", missing: [] },
    });
    expect(out.intent).toBe("answer_memory");
    expect(out.reasonCodes).toContain("CAMPAIGN_REQUIRES_CREATE");
  });

  it("fails closed to answer_memory with a clarify card when the resolver returns garbage", () => {
    const out = routeAgentMessage(
      { ...baseInput, text: "keep watching competitors", model: { kind: "live" } },
      { propose: () => ({ intent: "nonsense" }) as unknown as RouterProposal },
    );
    expect(out.intent).toBe("answer_memory");
    expect(out.questionnaire).not.toBeNull();
    expect(out.questionnaire?.kind).toBe("clarify");
    expect(out.reasonCodes).toContain("PROVIDER_FAIL_CLOSED");
  });

  it("rejects an over-long message instead of silently trimming it", () => {
    expect(() =>
      routeAgentMessage({
        ...baseInput,
        text: "x".repeat(20_001),
        model: { kind: "stub", intent: "answer_memory", confidence: "high", missing: [] },
      }),
    ).toThrow();
  });
});
