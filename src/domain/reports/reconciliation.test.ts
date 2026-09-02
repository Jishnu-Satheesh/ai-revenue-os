import { describe, expect, it } from "vitest";

import {
  classifyExactRangeOverlap,
  createReportReconciliationDigest,
} from "@/domain/reports/reconciliation";
import { getReconciliationNextStep } from "@/domain/reports/reconciliation-copy";

const context = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  channelId: "22222222-2222-4222-8222-222222222222",
  branchId: "33333333-3333-4333-8333-333333333333",
  metricDefinitionId: "44444444-4444-4444-8444-444444444444",
  projectionOutputKey: "gross_revenue",
  periodStart: "2026-01-01",
  periodEnd: "2026-01-31",
  periodTimezone: "Asia/Dubai",
  currency: "AED",
  contentSha256: "a".repeat(64),
  validationResultDigest: "b".repeat(64),
  contractMappingDigest: "c".repeat(64),
  projectionDigest: "d".repeat(64),
  calculationVersion: 1,
  sourceDigest: "e".repeat(64),
};

describe("governed report reconciliation", () => {
  it("classifies an identical exact context and digest as a replay", () => {
    expect(
      classifyExactRangeOverlap({
        candidate: { ...context, reconciliationDigest: "f".repeat(64) },
        active: [
          {
            id: "55555555-5555-4555-8555-555555555555",
            periodStart: "2026-01-01",
            periodEnd: "2026-01-31",
            reconciliationDigest: "f".repeat(64),
          },
        ],
      }),
    ).toEqual({
      kind: "exact_duplicate",
      observationIds: ["55555555-5555-4555-8555-555555555555"],
    });
  });

  it("keeps non-overlapping exact ranges eligible together", () => {
    expect(
      classifyExactRangeOverlap({
        candidate: { ...context, reconciliationDigest: "f".repeat(64) },
        active: [
          {
            id: "55555555-5555-4555-8555-555555555555",
            periodStart: "2025-12-01",
            periodEnd: "2025-12-31",
            reconciliationDigest: "9".repeat(64),
          },
        ],
      }),
    ).toEqual({ kind: "non_overlapping", observationIds: [] });
  });

  it("blocks intersecting ranges until an owner or admin resolves them", () => {
    expect(
      classifyExactRangeOverlap({
        candidate: { ...context, reconciliationDigest: "f".repeat(64) },
        active: [
          {
            id: "55555555-5555-4555-8555-555555555555",
            periodStart: "2026-01-15",
            periodEnd: "2026-02-15",
            reconciliationDigest: "9".repeat(64),
          },
        ],
      }),
    ).toEqual({
      kind: "ambiguous_overlap",
      observationIds: ["55555555-5555-4555-8555-555555555555"],
    });
  });

  it("uses a package-independent digest and does not retain aggregate values", () => {
    const first = createReportReconciliationDigest(context);
    const second = createReportReconciliationDigest({ ...context, contentSha256: "a".repeat(64) });

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify({ first, second })).not.toContain("1300");
  });

  it("keeps an overlap in owner/admin review instead of suggesting a calculation", () => {
    expect(getReconciliationNextStep("ambiguous_overlap", false)).toBe(
      "Owner or admin review is required before this evidence can become current.",
    );
    expect(getReconciliationNextStep("exact_duplicate", true)).toBe(
      "This package replayed existing evidence; no new observation was created.",
    );
  });
});
