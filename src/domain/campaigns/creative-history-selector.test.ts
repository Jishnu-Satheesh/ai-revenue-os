import { describe, expect, it } from "vitest";

import {
  CREATIVE_HISTORY_APPROVED_FINAL_LIMIT,
  CREATIVE_HISTORY_REJECTED_BLUEPRINT_LIMIT,
} from "@/domain/campaigns/creative-history";
import {
  selectCreativeHistory,
  type CreativeHistorySelectionCandidate,
} from "@/domain/campaigns/creative-history-selector";

const organizationId = "10000000-0000-4000-8000-000000000001";

function candidate(
  suffix: number,
  overrides: Partial<CreativeHistorySelectionCandidate> = {},
): CreativeHistorySelectionCandidate {
  const id = `20000000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`;
  const versionId = `30000000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`;
  return {
    organizationId,
    itemId: id,
    versionId,
    verdict: "approved",
    reasonCodes: [],
    metadata: {
      subjectTags: ["chicken mandi"],
      occasionTags: ["ramadan"],
      channels: ["instagram"],
      formats: ["feed"],
      markets: ["dubai"],
      languages: ["en"],
      objectives: ["acquisition"],
      styleTags: ["warm"],
    },
    verifiedPerformanceScore: null,
    version: 1,
    ...overrides,
  };
}

const request = {
  organizationId,
  subjectTags: ["chicken mandi"],
  occasionTags: ["ramadan"],
  channel: "instagram",
  format: "feed",
  market: "dubai",
  language: "en",
  objective: "acquisition",
  styleTags: ["warm"],
};

describe("Creative History selector", () => {
  it("pins independent, capped approved-final and rejected-Blueprint evidence", () => {
    const receipt = selectCreativeHistory({
      request,
      candidates: [
        ...Array.from({ length: 4 }, (_, index) => candidate(index + 1)),
        ...Array.from({ length: 6 }, (_, index) =>
          candidate(index + 20, {
            verdict: "rejected",
            reasonCodes: index % 2 === 0 ? ["wrong_style"] : ["not_our_plating"],
          }),
        ),
      ],
    });

    expect(receipt.selectorVersion).toBe(1);
    expect(receipt.approved).toHaveLength(3);
    expect(receipt.rejected).toHaveLength(5);
    expect(receipt.finalImageReferences.map((entry) => entry.versionId)).toEqual(
      receipt.approved.map((entry) => entry.versionId),
    );
    expect(receipt.blueprintReferences.some((entry) => entry.role === "rejected_creative")).toBe(
      true,
    );
  });

  it("records a weak scenario match as an exclusion instead of filling a quota", () => {
    const receipt = selectCreativeHistory({
      request,
      candidates: [
        candidate(1),
        candidate(2, { metadata: { ...candidate(2).metadata, subjectTags: ["pizza"] } }),
      ],
    });

    expect(receipt.approved.map((entry) => entry.versionId)).toEqual([candidate(1).versionId]);
    expect(receipt.exclusions).toContainEqual(
      expect.objectContaining({ versionId: candidate(2).versionId, code: "weak_match" }),
    );
  });

  it("uses rejected evidence to cover a new human reason before repeating one", () => {
    const receipt = selectCreativeHistory({
      request,
      candidates: [
        ...Array.from({ length: 5 }, (_, index) =>
          candidate(index + 1, { verdict: "rejected", reasonCodes: ["wrong_style"] }),
        ),
        candidate(6, { verdict: "rejected", reasonCodes: ["not_our_plating"] }),
      ],
    });

    expect(receipt.rejected.map((entry) => entry.versionId)).toContain(candidate(6).versionId);
    expect(new Set(receipt.rejected.flatMap((entry) => entry.reasonCodes))).toEqual(
      new Set(["wrong_style", "not_our_plating"]),
    );
  });
});

describe("the selector's own fence and its exact caps", () => {
  it("caps the approved set the final image model may see at three", () => {
    const receipt = selectCreativeHistory({
      request,
      candidates: Array.from({ length: 9 }, (_, index) => candidate(index + 1)),
    });

    expect(receipt.finalImageReferences).toHaveLength(CREATIVE_HISTORY_APPROVED_FINAL_LIMIT);
    expect(CREATIVE_HISTORY_APPROVED_FINAL_LIMIT).toBe(3);
  });

  it("caps the rejected evidence the Blueprint stage may see at five", () => {
    const receipt = selectCreativeHistory({
      request,
      candidates: Array.from({ length: 11 }, (_, index) =>
        candidate(index + 1, { verdict: "rejected", reasonCodes: ["wrong_subject"] }),
      ),
    });

    expect(receipt.rejected).toHaveLength(CREATIVE_HISTORY_REJECTED_BLUEPRINT_LIMIT);
    expect(CREATIVE_HISTORY_REJECTED_BLUEPRINT_LIMIT).toBe(5);
  });

  it("never puts a rejected design in the final-image set, however many there are", () => {
    const receipt = selectCreativeHistory({
      request,
      candidates: [
        ...Array.from({ length: 4 }, (_, index) => candidate(index + 1)),
        ...Array.from({ length: 6 }, (_, index) =>
          candidate(index + 20, { verdict: "rejected", reasonCodes: ["wrong_subject"] }),
        ),
      ],
    });

    expect(receipt.finalImageReferences.every((entry) => entry.verdict === "approved")).toBe(true);
    // `role` is `"approved_creative"` by type here, so comparing it to
    // `"rejected_creative"` is a compile error rather than a test — the fence
    // holds statically. What is worth asserting at runtime is that no rejected
    // design's identity reaches this set at all.
    expect(receipt.finalImageReferences.every((entry) => entry.role === "approved_creative")).toBe(
      true,
    );
    const rejectedVersionIds = new Set(receipt.rejected.map((entry) => entry.versionId));
    expect(
      receipt.finalImageReferences.some((entry) => rejectedVersionIds.has(entry.versionId)),
    ).toBe(false);
    // The Blueprint set is the wider one, and does carry both.
    expect(receipt.blueprintReferences.some((entry) => entry.role === "rejected_creative")).toBe(
      true,
    );
  });

  it("excludes another tenant's design outright rather than scoring it", () => {
    const receipt = selectCreativeHistory({
      request,
      candidates: [
        candidate(1),
        candidate(2, { organizationId: "99999999-9999-4999-8999-999999999999" }),
      ],
    });

    expect(receipt.exclusions).toContainEqual(
      expect.objectContaining({ code: "foreign_organization" }),
    );
    const serialized = JSON.stringify(receipt.finalImageReferences);
    expect(serialized).not.toContain("30000000-0000-4000-8000-000000000002");
  });

  it("breaks ties the same way every time, down to the version id", () => {
    const candidates = Array.from({ length: 6 }, (_, index) => candidate(index + 1));

    const first = selectCreativeHistory({ request, candidates });
    const second = selectCreativeHistory({ request, candidates: [...candidates].reverse() });

    expect(first.finalImageReferences.map((entry) => entry.versionId)).toEqual(
      second.finalImageReferences.map((entry) => entry.versionId),
    );
  });
});
