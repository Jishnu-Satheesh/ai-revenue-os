import { describe, expect, it } from "vitest";

import {
  buildBusinessFactSummary,
  buildBusinessProfileSummary,
  buildCampaignVersionSummary,
  buildCaptureEventSummary,
  buildConstraintSummary,
  buildContextCanonicalText,
  buildGoalSummary,
  buildMemoryItemSummary,
  capSummary,
  charLength,
  CONTEXT_MAX_BYTES,
  CONTEXT_MAX_ENTRIES,
  CONTEXT_OBSERVATIONS_AI_CAP,
  CONTEXT_POLICY_VERSION_DEFAULT,
  CONTEXT_SCHEMA_VERSION,
  CONTEXT_SECTION_BUDGETS,
  CONTEXT_SECTION_CANDIDATE_LIMIT,
  CONTEXT_SUMMARY_MAX_CHARS,
  escapeContextText,
  contextRequestSchema,
  pgJsonbText,
  purposesForConsumerKind,
  utf8ByteLength,
} from "@/domain/memory/context";

describe("context vocabulary", () => {
  it("pins the SQL-mirrored budget constants", () => {
    expect(CONTEXT_SCHEMA_VERSION).toBe(1);
    expect(CONTEXT_MAX_ENTRIES).toBe(24);
    expect(CONTEXT_MAX_BYTES).toBe(16_384);
    expect(CONTEXT_SUMMARY_MAX_CHARS).toBe(600);
    expect(CONTEXT_SECTION_CANDIDATE_LIMIT).toBe(50);
    expect(CONTEXT_SECTION_BUDGETS).toEqual({ current: 6, intent: 6, observations: 8, lessons: 4 });
    expect(CONTEXT_OBSERVATIONS_AI_CAP).toBe(3);
    expect(CONTEXT_POLICY_VERSION_DEFAULT).toBe("shared-context-v1");
  });

  it("binds consumer kinds to their purposes", () => {
    expect(purposesForConsumerKind("analysis_run")).toEqual(["channel_advice"]);
    expect(purposesForConsumerKind("growth_request")).toEqual(["growth_research", "growth_synthesis"]);
    expect(purposesForConsumerKind("campaign_generation_run")).toEqual([
      "campaign_generation",
      "campaign_revision",
    ]);
    expect(purposesForConsumerKind("subject_operation")).toEqual(["subject_drafting"]);
  });

  it("refuses a consumer kind serving the wrong purpose", () => {
    const parsed = contextRequestSchema.safeParse({
      organizationId: "11111111-1111-4111-8111-111111111111",
      purpose: "campaign_generation",
      consumerKind: "analysis_run",
      consumerId: "22222222-2222-4222-8222-222222222222",
      attemptKey: "attempt-1",
      correlationId: "33333333-3333-4333-8333-333333333333",
      query: "What should this branch do next?",
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a well-formed request with defaults", () => {
    const parsed = contextRequestSchema.safeParse({
      organizationId: "11111111-1111-4111-8111-111111111111",
      purpose: "channel_advice",
      consumerKind: "analysis_run",
      consumerId: "22222222-2222-4222-8222-222222222222",
      attemptKey: "attempt-1",
      correlationId: "33333333-3333-4333-8333-333333333333",
      query: "What should this branch do next?",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.policyVersion).toBe("shared-context-v1");
  });

  it("bounds the task description at 500 characters", () => {
    const parsed = contextRequestSchema.safeParse({
      organizationId: "11111111-1111-4111-8111-111111111111",
      purpose: "channel_advice",
      consumerKind: "analysis_run",
      consumerId: "22222222-2222-4222-8222-222222222222",
      attemptKey: "attempt-1",
      correlationId: "33333333-3333-4333-8333-333333333333",
      query: `q`.repeat(501),
    });
    expect(parsed.success).toBe(false);
  });
});

describe("buildContextCanonicalText", () => {
  it("sorts by contextRef so insertion order cannot move the digest", () => {
    const first = buildContextCanonicalText([
      { contextRef: "ctx-0002", sourceKind: "goal", sourceId: "b", sourceRevision: null, summary: "Two" },
      { contextRef: "ctx-0001", sourceKind: "memory_item", sourceId: "a", sourceRevision: 3, summary: "One" },
    ]);
    const second = buildContextCanonicalText([
      { contextRef: "ctx-0001", sourceKind: "memory_item", sourceId: "a", sourceRevision: 3, summary: "One" },
      { contextRef: "ctx-0002", sourceKind: "goal", sourceId: "b", sourceRevision: null, summary: "Two" },
    ]);
    expect(first).toBe(second);
    expect(first).toBe("ctx-0001|memory_item|a|3|One\nctx-0002|goal|b||Two");
  });

  it("canonicalizes the empty pack to the empty string", () => {
    expect(buildContextCanonicalText([])).toBe("");
  });
});

describe("summary helpers", () => {
  it("caps summaries at 600 code points without splitting surrogate pairs", () => {
    expect(charLength("a".repeat(600))).toBe(600);
    expect(capSummary("a".repeat(601))).toBe("a".repeat(600));
    const astral = "𐀀".repeat(601);
    expect(charLength(astral)).toBe(601);
    expect(charLength(capSummary(astral))).toBe(600);
  });

  it("counts UTF-8 bytes like SQL octet_length", () => {
    expect(utf8ByteLength("hello")).toBe(5);
    expect(utf8ByteLength(" مرحبا ")).toBe(12);
  });

  it("escapes tags at the serialization boundary", () => {
    expect(escapeContextText("<script>alert&</script>")).toBe("&lt;script&gt;alert&amp;&lt;/script&gt;");
    // Budgets apply to the raw form, not the escaped form.
    expect(utf8ByteLength("<b>")).toBe(3);
  });
});

describe("canonical summary builders", () => {
  it("builds the memory-item summary as title plus body", () => {
    expect(buildMemoryItemSummary({ title: "T", body: "B" })).toBe("T\nB");
    expect(buildMemoryItemSummary({ title: "T", body: null })).toBe("T");
  });

  it("builds the fact summary with key, status, source, and value", () => {
    expect(
      buildBusinessFactSummary({ factKey: "avg_ticket", status: "verified", source: "pos", value: 42 }),
    ).toBe("avg_ticket [verified] pos :: 42");
  });

  it("builds the profile summary from the two registered text columns", () => {
    expect(buildBusinessProfileSummary({ businessModel: "Dine-in", valueProposition: null })).toBe(
      "Dine-in\n",
    );
  });

  it("builds goal, constraint, capture, and version summaries deterministically", () => {
    expect(
      buildGoalSummary({ name: "Grow", metric: "revenue", targetValue: "100", unit: "AED" }),
    ).toBe("Grow [revenue] target 100 AED");
    expect(
      buildConstraintSummary({ name: "No discounts", constraintType: "pricing", severity: "hard", value: true }),
    ).toBe("No discounts [pricing/hard] true");
    expect(buildCaptureEventSummary({ kind: "finding" })).toBe(`{"kind": "finding"}`);
    expect(
      buildCampaignVersionSummary({
        version: 2,
        generationProfile: "brand_guided",
        executionMode: "best_effort",
        campaignId: "11111111-1111-4111-8111-111111111111",
        digest: "ab".repeat(32),
      }).startsWith("v2 brand_guided/best_effort 11111111-1111-4111-8111-111111111111 "),
    ).toBe(true);
  });

  it("caps every builder at 600 characters", () => {
    expect(
      [...buildMemoryItemSummary({ title: "t".repeat(700), body: null })].length,
    ).toBeLessThanOrEqual(600);
  });
});

describe("pgJsonbText", () => {
  it("renders scalars like jsonb::text", () => {
    expect(pgJsonbText(null)).toBe("null");
    expect(pgJsonbText(42)).toBe("42");
    expect(pgJsonbText("hello")).toBe(`"hello"`);
    expect(pgJsonbText(true)).toBe("true");
  });

  it("sorts object keys by byte length then bytewise", () => {
    expect(pgJsonbText({ b: 1, a: 2 })).toBe(`{"a": 2, "b": 1}`);
    expect(pgJsonbText({ bb: 1, a: 2 })).toBe(`{"a": 2, "bb": 1}`);
    expect(pgJsonbText({ list: [1, "x"] })).toBe(`{"list": [1, "x"]}`);
  });
});
