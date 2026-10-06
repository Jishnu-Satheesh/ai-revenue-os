import { describe, expect, it } from "vitest";

import { resolveAgentReportScope } from "./report-intake-scope";

const channelId = "11111111-1111-4111-8111-111111111111";
const otherChannelId = "22222222-2222-4222-8222-222222222222";
const branchId = "33333333-3333-4333-8333-333333333333";
const otherBranchId = "44444444-4444-4444-8444-444444444444";
const metadata = {
  channels: [{ id: channelId, label: "Talabat Delivery", key: "talabat" }],
  aliases: [{ channelId, label: "Talabat" }],
  branches: [{ id: branchId, label: "Downtown", currency: "AED" }],
  mappings: [],
  reportTypes: [{ channelId, reportType: "performance_daily", aliases: ["performance report"] }],
};

describe("report scope from the stored user message", () => {
  it("prefers a named stored report type over broad provider aliases", () => {
    expect(
      resolveAgentReportScope({
        question: "Talabat Performance report 2026-08-01 to 2026-08-31",
        metadata: {
          ...metadata,
          reportTypes: [
            ...metadata.reportTypes,
            { channelId, reportType: "Performance", aliases: ["performance"] },
          ],
        },
      }),
    ).toMatchObject({ kind: "resolved", scope: { reportType: "Performance" } });
  });
  it("uses the supplied channel and date range without asking the same questions again", () => {
    const result = resolveAgentReportScope({
      question:
        "This is a talabat performance report from Oct 1 to Oct 30 - 2026. What do you think about it?",
      metadata,
    });
    expect(result).toEqual({
      kind: "resolved",
      scope: {
        channelId,
        branchId,
        reportType: "performance_daily",
        periodStart: "2026-10-01",
        periodEnd: "2026-10-30",
        currency: "AED",
      },
    });
  });

  it("asks only the unknown report type and branch when channel and ISO dates are provided", () => {
    const result = resolveAgentReportScope({
      question: "Review Talabat from 2026-10-01 to 2026-10-30.",
      metadata: {
        ...metadata,
        branches: [...metadata.branches, { id: otherBranchId, label: "Marina", currency: "AED" }],
      },
    });
    expect(result.kind).toBe("metadata_required");
    if (result.kind !== "metadata_required") return;
    expect(result.fields.map((field) => field.key)).toEqual(["branchId", "reportType"]);
    expect(result.known).toEqual({
      channelId,
      periodStart: "2026-10-01",
      periodEnd: "2026-10-30",
      currency: "AED",
    });
  });

  it("merges only tenant-valid answers and refuses cross-organization ids", () => {
    const base = { question: "Review Talabat from 2026-10-01 to 2026-10-30", metadata };
    expect(
      resolveAgentReportScope({ ...base, answers: { reportType: "performance_daily" } }).kind,
    ).toBe("resolved");
    expect(() =>
      resolveAgentReportScope({ ...base, answers: { channelId: otherChannelId } }),
    ).toThrow("available");
  });

  it("does not choose between ambiguous channel aliases", () => {
    const result = resolveAgentReportScope({
      question: "Talabat performance report 2026-10-01 to 2026-10-30",
      metadata: {
        ...metadata,
        channels: [
          ...metadata.channels,
          { id: otherChannelId, label: "Talabat Marketplace", key: "talabat-second" },
        ],
        aliases: [...metadata.aliases, { channelId: otherChannelId, label: "Talabat" }],
      },
    });
    expect(result.kind).toBe("metadata_required");
    if (result.kind === "metadata_required")
      expect(result.fields.map((field) => field.key)).toEqual(["channelId"]);
  });

  it("asks channel first and only offers that channel's branches after the stored answer", () => {
    const scoped = {
      ...metadata,
      channels: [...metadata.channels, { id: otherChannelId, label: "Noon", key: "noon" }],
      branches: [...metadata.branches, { id: otherBranchId, label: "Marina", currency: "AED" }],
      mappings: [
        { channelId, branchId, effectiveFrom: null, effectiveTo: null },
        {
          channelId: otherChannelId,
          branchId: otherBranchId,
          effectiveFrom: null,
          effectiveTo: null,
        },
      ],
    };
    const first = resolveAgentReportScope({
      question: "Please review 2026-10-01 to 2026-10-30",
      metadata: scoped,
    });
    expect(first.kind).toBe("metadata_required");
    if (first.kind === "metadata_required")
      expect(first.fields.map((field) => field.key)).toEqual(["channelId"]);
    const next = resolveAgentReportScope({
      question: "Please review 2026-10-01 to 2026-10-30",
      metadata: scoped,
      answers: { channelId },
    });
    expect(next.kind).toBe("metadata_required");
    if (next.kind === "metadata_required") {
      expect(next.known.branchId).toBe(branchId);
      expect(next.fields.map((field) => field.key)).toEqual(["reportType"]);
    }
  });

  it("does not read capitalized instructions as currency or silently choose between two currencies", () => {
    const question = "Talabat performance report 2026-10-01 to 2026-10-30. DO NOT publish.";
    expect(resolveAgentReportScope({ question, metadata })).toMatchObject({
      kind: "resolved",
      scope: { currency: "AED" },
    });
    const ambiguous = resolveAgentReportScope({
      question: `${question} Currency USD or AED`,
      metadata,
    });
    expect(ambiguous.kind).toBe("metadata_required");
    if (ambiguous.kind === "metadata_required")
      expect(ambiguous.fields.map((field) => field.key)).toEqual(["currency"]);
  });

  it("keeps invalid or conflicting dates unresolved instead of normalizing them", () => {
    for (const question of [
      "Talabat performance report Feb 30 to Feb 31 2026",
      "Talabat performance report 2026-10-30 to 2026-10-01",
      "Talabat performance report 2026-09-01 to 2026-09-30 or 2026-10-01 to 2026-10-30",
    ]) {
      const result = resolveAgentReportScope({ question, metadata });
      expect(result.kind).toBe("metadata_required");
      if (result.kind === "metadata_required")
        expect(result.fields.map((field) => field.key)).toEqual(["periodStart", "periodEnd"]);
    }
  });

  it("respects channel branch applicability for the full declared period", () => {
    expect(() =>
      resolveAgentReportScope({
        question: "Talabat performance report 2026-10-01 to 2026-10-30",
        metadata: {
          ...metadata,
          mappings: [{ channelId, branchId, effectiveFrom: "2026-11-01", effectiveTo: null }],
        },
      }),
    ).toThrow("unavailable");
  });
});
