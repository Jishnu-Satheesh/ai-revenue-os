import { describe, expect, it } from "vitest";

import {
  questionnaireSpecSchema,
  type QuestionnaireSpec,
  type RouterInput,
  type RouterProposal,
} from "@/domain/agent-router/contracts";
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
    // Genuine clarify is one text field only: B2 auto-escalates, so the
    // manual DeepThink-retry item is dead.
    expect(out.questionnaire?.items).toHaveLength(1);
    expect(out.questionnaire?.items.some((item) => item.key === "retry_deepthink")).toBe(false);
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

  it("routes business_advice directly for a reader holding channel.read", () => {
    const out = routeAgentMessage({
      ...baseInput,
      text: "what should we improve in the next month",
      role: "viewer",
      permissions: ["channel.read"],
      model: { kind: "stub", intent: "business_advice", confidence: "high", missing: [] },
    });
    expect(out.intent).toBe("answer_memory");
    expect(out.reasonCodes).toContain("VIEWER_RESTRICTED");
  });

  it("routes business_advice directly for an operator holding channel.read", () => {
    const out = routeAgentMessage({
      ...baseInput,
      text: "what should we improve in the next month",
      permissions: ["channel.read"],
      model: { kind: "stub", intent: "business_advice", confidence: "high", missing: [] },
    });
    expect(out.intent).toBe("business_advice");
    expect(out.questionnaire).toBeNull();
    expect(out.reasonCodes).toContain("MODEL_PROPOSAL_ACCEPTED");
  });

  it("routes channel_assessment directly for an operator holding channel.read", () => {
    const out = routeAgentMessage({
      ...baseInput,
      text: "assess our Talabat performance",
      permissions: ["channel.read"],
      model: { kind: "stub", intent: "channel_assessment", confidence: "high", missing: [] },
    });
    expect(out.intent).toBe("channel_assessment");
    expect(out.questionnaire).toBeNull();
  });

  it("routes report_intake directly for an operator holding report.upload", () => {
    const out = routeAgentMessage({
      ...baseInput,
      text: "here is our monthly report",
      permissions: ["report.upload"],
      model: { kind: "stub", intent: "report_intake", confidence: "high", missing: [] },
    });
    expect(out.intent).toBe("report_intake");
    expect(out.questionnaire).toBeNull();
  });

  it("gates report_intake behind report.upload", () => {
    const out = routeAgentMessage({
      ...baseInput,
      text: "here is our monthly report",
      permissions: ["channel.read"],
      model: { kind: "stub", intent: "report_intake", confidence: "high", missing: [] },
    });
    expect(out.intent).toBe("answer_memory");
    expect(out.reasonCodes).toContain("REPORT_REQUIRES_UPLOAD");
  });

  it("asks for clarification on low-confidence channel assessment instead of guessing", () => {
    const out = routeAgentMessage({
      ...baseInput,
      text: "hmm that channel thing",
      permissions: ["channel.read"],
      model: { kind: "stub", intent: "channel_assessment", confidence: "low", missing: [] },
    });
    expect(out.intent).toBe("answer_memory");
    expect(out.questionnaire?.kind).toBe("clarify");
  });

  it("fails closed to a memory answer with no questionnaire when the resolver returns garbage", () => {
    const out = routeAgentMessage(
      { ...baseInput, text: "keep watching competitors", model: { kind: "live" } },
      { propose: () => ({ intent: "nonsense" }) as unknown as RouterProposal },
    );
    expect(out.intent).toBe("answer_memory");
    expect(out.questionnaire).toBeNull();
    expect(out.reasonCodes).toContain("PROVIDER_FAIL_CLOSED");
    expect(out.routingNote).toContain("limitation=");
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

  it("auto-escalates Quick threads needing research instead of nudging (B2)", () => {
    const out = routeAgentMessage({
      ...baseInput,
      text: "research the downtown lunch crowd",
      threadMode: "quick",
      model: { kind: "stub", intent: "research_once", confidence: "high", missing: [] },
    });
    expect(out.intent).toBe("research_once");
    expect(out.questionnaire).toBeNull();
    expect(out.reasonCodes).toContain("DEEPTHINK_AUTO_ESCALATED");
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

  it("keeps the permission gate above Quick auto-escalation", () => {
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

  it("keeps low confidence above Quick auto-escalation", () => {
    const out = routeAgentMessage({
      ...baseInput,
      text: "maybe research something",
      threadMode: "quick",
      model: { kind: "stub", intent: "research_once", confidence: "low", missing: [] },
    });
    expect(out.intent).toBe("answer_memory");
    expect(out.questionnaire?.kind).toBe("clarify");
    expect(out.questionnaire?.items.some((item) => item.key === "retry_deepthink")).toBe(false);
  });

  it("never offers a DeepThink retry on the low-confidence fallback", () => {
    const out = routeAgentMessage({
      ...baseInput,
      text: "hmm what about that thing",
      model: { kind: "stub", intent: "research_once", confidence: "low", missing: [] },
    });
    expect(out.questionnaire?.items.some((item) => item.key === "retry_deepthink")).toBe(false);
  });

  it("fails closed with no questionnaire and an honest note, never a retry card", () => {
    const out = routeAgentMessage(
      { ...baseInput, text: "keep watching competitors", model: { kind: "live" } },
      { propose: () => ({ intent: "nonsense" }) as unknown as RouterProposal },
    );
    expect(out.questionnaire).toBeNull();
    expect(out.questionnaire?.items?.some((item) => item.key === "retry_deepthink") ?? false).toBe(
      false,
    );
    expect(out.routingNote).toContain("limitation=");
  });

  it("fails closed on a forged intent instead of routing it", () => {
    const out = routeAgentMessage(
      { ...baseInput, text: "keep watching competitors", model: { kind: "live" } },
      {
        propose: () =>
          ({ intent: "delete_everything", confidence: "high", missing: [] }) as unknown as RouterProposal,
      },
    );
    expect(out.intent).toBe("answer_memory");
    expect(out.questionnaire).toBeNull();
    expect(out.reasonCodes).toContain("PROVIDER_FAIL_CLOSED");
  });

  it("fails closed on missing fields outside the closed vocabulary", () => {
    const out = routeAgentMessage(
      { ...baseInput, text: "keep watching competitors", model: { kind: "live" } },
      {
        propose: () =>
          ({
            intent: "watch",
            confidence: "high",
            missing: ["social_security_number"],
          }) as unknown as RouterProposal,
      },
    );
    expect(out.intent).toBe("answer_memory");
    expect(out.questionnaire).toBeNull();
    expect(out.reasonCodes).toContain("PROVIDER_FAIL_CLOSED");
  });

  it("fails closed when the resolver throws, with an honest limitation", () => {
    const out = routeAgentMessage(
      { ...baseInput, text: "keep watching competitors", model: { kind: "live" } },
      {
        propose: () => {
          throw new Error("provider down");
        },
      },
    );
    expect(out.intent).toBe("answer_memory");
    expect(out.questionnaire).toBeNull();
    expect(out.reasonCodes).toContain("PROVIDER_FAIL_CLOSED");
    expect(out.routingNote).toContain("limitation=");
  });

  it("keeps the routing note to digests and safe ids, never user text", () => {
    const marker = "zebra-quasar-invoice-4242";
    const out = routeAgentMessage({
      ...baseInput,
      text: `do the thing with ${marker}`,
      model: { kind: "stub", intent: "answer_memory", confidence: "high", missing: [] },
    });
    expect(out.routingNote).not.toContain(marker);
    expect(out.routingNote).toContain("context_digest=");
    expect(out.routingNote).toContain("intent=answer_memory");
  });

  it("keeps unknown provider data out of the fail-closed note", () => {
    const marker = "zebra-quasar-invoice-4242";
    const out = routeAgentMessage(
      { ...baseInput, text: `do the thing with ${marker}`, model: { kind: "live" } },
      { propose: () => ({ intent: "nonsense" }) as unknown as RouterProposal },
    );
    expect(out.intent).toBe("answer_memory");
    expect(out.routingNote).not.toContain(marker);
    expect(out.reasonCodes).toContain("PROVIDER_FAIL_CLOSED");
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

function ideasSpec(
  options: Array<{ value: string; label: string; description?: string; recommended?: boolean }>,
): QuestionnaireSpec {
  return {
    kind: "campaign_ideas",
    title: "Campaign ideas",
    resumeKey: "router:campaign_advice:overview:abc123",
    items: [
      {
        key: "idea",
        label: "Which idea should become a draft?",
        kind: "single_select",
        required: true,
        options,
      },
    ],
  };
}

const VALID_IDEAS = ideasSpec([
  { value: "idea-a", label: "Lunch rush bundle", description: "Noon combo for nearby offices.", recommended: false },
  { value: "idea-b", label: "Weekend family table", description: "Saturday set menu for families.", recommended: true },
  { value: "idea-c", label: "Late-night dessert", description: "After-9pm dessert counter.", recommended: false },
]);

describe("campaign_ideas questionnaire spec", () => {
  it("accepts three ideas with exactly one recommended", () => {
    expect(questionnaireSpecSchema.parse(VALID_IDEAS).kind).toBe("campaign_ideas");
  });

  it("rejects ideas with none recommended", () => {
    const options = VALID_IDEAS.items[0]?.options?.map((option) => ({
      ...option,
      recommended: false,
    }));
    expect(() => questionnaireSpecSchema.parse(ideasSpec(options ?? []))).toThrow(
      /exactly one idea.*must be recommended/i,
    );
  });

  it("rejects ideas with two recommended", () => {
    const options = VALID_IDEAS.items[0]?.options?.map((option) => ({
      ...option,
      recommended: true,
    }));
    expect(() => questionnaireSpecSchema.parse(ideasSpec(options ?? []))).toThrow(
      /exactly one idea.*must be recommended/i,
    );
  });

  it("rejects an idea without a short description", () => {
    const options = (VALID_IDEAS.items[0]?.options ?? []).map((option, index) =>
      index === 0 ? { value: option.value, label: option.label, recommended: false } : option,
    );
    expect(() => questionnaireSpecSchema.parse(ideasSpec(options))).toThrow(
      /short description and an explicit recommended flag/i,
    );
  });

  it("rejects an idea without an explicit recommended flag", () => {
    const options = (VALID_IDEAS.items[0]?.options ?? []).map((option) => ({
      value: option.value,
      label: option.label,
      description: option.description,
    }));
    expect(() => questionnaireSpecSchema.parse(ideasSpec(options))).toThrow(
      /short description and an explicit recommended flag/i,
    );
  });

  it("rejects an ideas card with nothing to pick", () => {
    expect(() =>
      questionnaireSpecSchema.parse({
        kind: "campaign_ideas",
        title: "Campaign ideas",
        resumeKey: "router:campaign_advice:overview:abc123",
        items: [{ key: "idea", label: "Which idea?", kind: "text", required: true }],
      }),
    ).toThrow(/at least one idea to pick/i);
  });

  it("leaves older kinds untouched when options carry neither field", () => {
    expect(
      questionnaireSpecSchema.parse({
        kind: "missing_fields",
        title: "One more detail",
        resumeKey: "router:watch:overview:abc123",
        items: [
          {
            key: "frequency",
            label: "How often?",
            kind: "single_select",
            required: true,
            options: [
              { value: "daily", label: "Daily" },
              { value: "weekly", label: "Weekly" },
            ],
          },
        ],
      }).kind,
    ).toBe("missing_fields");
  });
});

describe("zero-click auto-escalation (B2)", () => {
  it("escalates a holder's Quick research read silently: no nudge card, escalate code", () => {
    const out = routeAgentMessage({
      ...baseInput,
      text: "research the downtown lunch crowd",
      threadMode: "quick",
      model: { kind: "stub", intent: "research_once", confidence: "high", missing: [] },
    });
    expect(out.intent).toBe("research_once");
    expect(out.questionnaire).toBeNull();
    expect(out.reasonCodes).toContain("DEEPTHINK_AUTO_ESCALATED");
    expect(out.reasonCodes).not.toContain("DEEPTHINK_UPGRADE_REQUIRED");
  });

  it("states the assumption inline when escalating on medium confidence", () => {
    const medium = routeAgentMessage({
      ...baseInput,
      text: "research the downtown lunch crowd",
      threadMode: "quick",
      model: { kind: "stub", intent: "research_once", confidence: "medium", missing: [] },
    });
    expect(medium.questionnaire).toBeNull();
    expect(medium.reasonCodes).toContain("DEEPTHINK_AUTO_ESCALATED");
    expect(medium.routingNote).toContain("assumption=");

    const high = routeAgentMessage({
      ...baseInput,
      text: "research the downtown lunch crowd",
      threadMode: "quick",
      model: { kind: "stub", intent: "research_once", confidence: "high", missing: [] },
    });
    expect(high.routingNote).not.toContain("assumption=");
  });

  it("never escalates for viewers: read-only answer with honest codes", () => {
    const out = routeAgentMessage({
      ...baseInput,
      text: "research the downtown lunch crowd",
      threadMode: "quick",
      role: "viewer",
      permissions: [],
      model: { kind: "stub", intent: "research_once", confidence: "high", missing: [] },
    });
    expect(out.intent).toBe("answer_memory");
    expect(out.reasonCodes).toContain("VIEWER_RESTRICTED");
    expect(out.reasonCodes).not.toContain("DEEPTHINK_AUTO_ESCALATED");
  });

  it("keeps grant-less operators on Quick with an honest note, never the flip", () => {
    const out = routeAgentMessage({
      ...baseInput,
      text: "research the downtown lunch crowd",
      threadMode: "quick",
      permissions: [],
      model: { kind: "stub", intent: "research_once", confidence: "high", missing: [] },
    });
    expect(out.intent).toBe("answer_memory");
    expect(out.questionnaire).toBeNull();
    expect(out.reasonCodes).toContain("RESEARCH_REQUIRES_MANAGE");
    expect(out.reasonCodes).not.toContain("DEEPTHINK_AUTO_ESCALATED");
  });

  it("still asks for missing scope instead of escalating blind", () => {
    const out = routeAgentMessage({
      ...baseInput,
      text: "research something",
      threadMode: "quick",
      model: { kind: "stub", intent: "research_once", confidence: "high", missing: ["research_area"] },
    });
    expect(out.intent).toBe("research_once");
    expect(out.questionnaire?.kind).toBe("missing_fields");
    expect(out.reasonCodes).not.toContain("DEEPTHINK_AUTO_ESCALATED");
  });

  it("never re-escalates an already-DeepThink thread", () => {
    const out = routeAgentMessage({
      ...baseInput,
      text: "research the downtown lunch crowd",
      threadMode: "deepthink",
      model: { kind: "stub", intent: "research_once", confidence: "high", missing: [] },
    });
    expect(out.questionnaire).toBeNull();
    expect(out.reasonCodes).not.toContain("DEEPTHINK_AUTO_ESCALATED");
    expect(out.reasonCodes).not.toContain("DEEPTHINK_UPGRADE_REQUIRED");
  });

  it("keeps old deepthink_upgrade rows parsing", () => {
    expect(
      questionnaireSpecSchema.parse({
        kind: "deepthink_upgrade",
        title: "Research needed — switch to DeepThink?",
        resumeKey: "router:research_once:overview:abc123",
        items: [
          {
            key: "confirm_upgrade",
            label: "Switch this thread to DeepThink?",
            kind: "confirm",
            required: true,
            helpText: "DeepThink may run one bounded research task. Quick never spends.",
          },
        ],
      }).kind,
    ).toBe("deepthink_upgrade");
  });
});
