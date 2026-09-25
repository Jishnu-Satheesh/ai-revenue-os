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

  it("nudges Quick threads needing research to DeepThink instead of spending", () => {
    const out = routeAgentMessage({
      ...baseInput,
      text: "research the downtown lunch crowd",
      threadMode: "quick",
      model: { kind: "stub", intent: "research_once", confidence: "high", missing: [] },
    });
    expect(out.intent).toBe("research_once");
    expect(out.questionnaire?.kind).toBe("deepthink_upgrade");
    expect(out.reasonCodes).toContain("DEEPTHINK_UPGRADE_REQUIRED");
  });

  it("routes directly when no thread mode is given (backward compatible)", () => {
    const out = routeAgentMessage({
      ...baseInput,
      text: "research the downtown lunch crowd",
      model: { kind: "stub", intent: "research_once", confidence: "high", missing: [] },
    });
    expect(out.intent).toBe("research_once");
    expect(out.questionnaire).toBeNull();
  });

  it("routes directly for DeepThink threads needing research", () => {
    const out = routeAgentMessage({
      ...baseInput,
      text: "research the downtown lunch crowd",
      threadMode: "deepthink",
      model: { kind: "stub", intent: "research_once", confidence: "high", missing: [] },
    });
    expect(out.intent).toBe("research_once");
    expect(out.questionnaire).toBeNull();
  });

  it("keeps the permission gate above the Quick upgrade nudge", () => {
    const out = routeAgentMessage({
      ...baseInput,
      text: "research the downtown lunch crowd",
      threadMode: "quick",
      role: "viewer",
      permissions: [],
      model: { kind: "stub", intent: "research_once", confidence: "high", missing: [] },
    });
    expect(out.intent).toBe("answer_memory");
    expect(out.questionnaire?.kind).not.toBe("deepthink_upgrade");
  });

  it("keeps low confidence above the Quick upgrade nudge", () => {
    const out = routeAgentMessage({
      ...baseInput,
      text: "maybe research something",
      threadMode: "quick",
      model: { kind: "stub", intent: "research_once", confidence: "low", missing: [] },
    });
    expect(out.intent).toBe("answer_memory");
    expect(out.questionnaire?.kind).toBe("clarify");
  });

  it("offers a DeepThink retry on the low-confidence fallback", () => {
    const out = routeAgentMessage({
      ...baseInput,
      text: "hmm what about that thing",
      model: { kind: "stub", intent: "research_once", confidence: "low", missing: [] },
    });
    expect(out.questionnaire?.items.some((item) => item.key === "retry_deepthink")).toBe(true);
  });

  it("offers a DeepThink retry on the fail-closed card", () => {
    const out = routeAgentMessage(
      { ...baseInput, text: "keep watching competitors", model: { kind: "live" } },
      { propose: () => ({ intent: "nonsense" }) as unknown as RouterProposal },
    );
    expect(out.questionnaire?.items.some((item) => item.key === "retry_deepthink")).toBe(true);
  });

  it("picks the evidence-window card only when the window is missing", () => {
    const withWindow = routeAgentMessage({
      ...baseInput,
      text: "draft a campaign for this",
      permissions: ["campaign.create"],
      model: { kind: "stub", intent: "campaign_advice", confidence: "high", missing: ["evidence_window"] },
    });
    expect(withWindow.questionnaire?.kind).toBe("evidence_window");

    const withoutWindow = routeAgentMessage({
      ...baseInput,
      text: "draft a campaign for this",
      permissions: ["campaign.create"],
      model: { kind: "stub", intent: "campaign_advice", confidence: "high", missing: ["branch"] },
    });
    expect(withoutWindow.questionnaire?.kind).toBe("missing_fields");
  });
});
