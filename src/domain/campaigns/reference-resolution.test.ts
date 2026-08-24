import { describe, expect, it } from "vitest";

import { CREATIVE_REVIEW_REASON_CODES } from "@/domain/campaigns/asset-library";
import {
  POSITIVE_REFERENCE_LIMIT,
  REFERENCE_SLOT_CAPS,
  RESOLVER_VERSION,
  ReferenceResolutionError,
  resolveReferences,
  type ReferenceCandidate,
  type ReferenceResolutionRequest,
} from "@/domain/campaigns/reference-resolution";

const ids = {
  asset: (suffix: number) => `10000000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`,
  version: (suffix: number) => `20000000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`,
};

function candidate(
  suffix: number,
  overrides: Partial<ReferenceCandidate> = {},
): ReferenceCandidate {
  return {
    brandAssetId: ids.asset(suffix),
    brandAssetVersionId: ids.version(suffix),
    conditioningRoles: ["subject"],
    tags: ["fish curry"],
    scripts: [],
    ownership: "owned",
    version: 1,
    currentVerdict: null,
    currentReasonCodes: [],
    currentReviewedAt: null,
    archivedAt: null,
    requestedReferenceMode: "inspiration",
    ...overrides,
  };
}

const baseRequest: ReferenceResolutionRequest = {
  subjectTags: ["fish curry"],
  subjectDescription: null,
  settingTags: [],
  occasionTags: [],
  styleTags: [],
  scripts: [],
};

function resolve(
  candidates: ReferenceCandidate[],
  request: ReferenceResolutionRequest = baseRequest,
) {
  return resolveReferences({
    candidates,
    reasonRegistry: CREATIVE_REVIEW_REASON_CODES.map((code) => ({
      code,
      description: `Rule for ${code}`,
    })),
    request,
  });
}

describe("reference resolution outcomes", () => {
  it("stamps the resolver version and refuses only when no subject is declared", () => {
    expect(resolve([])).toMatchObject({
      resolverVersion: RESOLVER_VERSION,
      outcome: "insufficient",
      refusalCode: "no_declared_subject",
      referenceSlots: [],
    });
  });

  it("permits synthesis from a declared description when no photograph matches", () => {
    expect(
      resolve([], {
        ...baseRequest,
        subjectDescription: "Kingfish steaks in a brick-red tamarind and coconut gravy.",
      }),
    ).toMatchObject({ outcome: "synthesis_permitted", refusalCode: null });
  });

  it("resolves from a matching subject photograph ahead of a supplied description", () => {
    const result = resolve([candidate(1)], {
      ...baseRequest,
      subjectDescription: "A confirmed fallback description.",
    });

    expect(result.outcome).toBe("resolved");
    expect(result.referenceSlots[0]).toMatchObject({
      role: "subject",
      brandAssetVersionId: ids.version(1),
    });
  });

  it("does not treat a rejected subject photograph as a positive match", () => {
    const result = resolve(
      [
        candidate(1, {
          currentVerdict: "rejected",
          currentReasonCodes: ["wrong_subject"],
          currentReviewedAt: "2026-08-24T10:00:00.000Z",
        }),
      ],
      { ...baseRequest, subjectDescription: "The confirmed subject description." },
    );

    expect(result.outcome).toBe("synthesis_permitted");
    expect(result.referenceSlots).toHaveLength(0);
    expect(result.avoidReferences).toHaveLength(1);
  });
});

describe("positive slot selection", () => {
  it("excludes archived candidates", () => {
    const result = resolve([candidate(1, { archivedAt: "2026-08-24T10:00:00.000Z" })]);

    expect(result.outcome).toBe("insufficient");
    expect(result.referenceSlots).toHaveLength(0);
  });

  it("ignores an unclassified upload instead of failing unrelated generation", () => {
    const result = resolve([candidate(1, { conditioningRoles: [] })], {
      ...baseRequest,
      subjectDescription: "A confirmed description remains usable.",
    });

    expect(result.outcome).toBe("synthesis_permitted");
    expect(result.referenceSlots).toHaveLength(0);
  });

  it("enforces every slot cap, the total cap, and one version per asset", () => {
    const candidates = [
      ...Array.from({ length: 4 }, (_, index) => candidate(index + 1)),
      ...Array.from({ length: 2 }, (_, index) =>
        candidate(index + 10, { conditioningRoles: ["brand_mark"], tags: [] }),
      ),
      ...Array.from({ length: 2 }, (_, index) =>
        candidate(index + 20, { conditioningRoles: ["setting"], tags: ["terrace"] }),
      ),
      ...Array.from({ length: 3 }, (_, index) =>
        candidate(index + 30, { conditioningRoles: ["style_exemplar"], tags: ["warm"] }),
      ),
      ...Array.from({ length: 2 }, (_, index) =>
        candidate(index + 40, { conditioningRoles: ["palette"], tags: [] }),
      ),
      candidate(99, {
        brandAssetId: ids.asset(1),
        brandAssetVersionId: ids.version(99),
        version: 99,
      }),
    ];

    const result = resolve(candidates, {
      ...baseRequest,
      settingTags: ["terrace"],
      styleTags: ["warm"],
    });
    const counts = Object.fromEntries(
      Object.keys(REFERENCE_SLOT_CAPS).map((role) => [
        role,
        result.referenceSlots.filter((slot) => slot.role === role).length,
      ]),
    );

    expect(result.referenceSlots.length).toBeLessThanOrEqual(POSITIVE_REFERENCE_LIMIT);
    for (const [role, cap] of Object.entries(REFERENCE_SLOT_CAPS)) {
      expect(counts[role]).toBeLessThanOrEqual(cap);
    }
    expect(new Set(result.referenceSlots.map((slot) => slot.brandAssetId)).size).toBe(
      result.referenceSlots.length,
    );
  });

  it("applies approved, overlap, version, and asset-id ordering in that order", () => {
    const approved = candidate(9, {
      tags: ["fish curry"],
      currentVerdict: "approved",
      currentReviewedAt: "2026-08-24T10:00:00.000Z",
    });
    const greaterOverlap = candidate(8, { tags: ["fish curry", "weekend"] });
    const newerVersion = candidate(7, { version: 3 });
    const lowerAssetId = candidate(1);

    const result = resolve([lowerAssetId, newerVersion, greaterOverlap, approved], {
      ...baseRequest,
      occasionTags: ["weekend"],
    });

    expect(result.referenceSlots.map((slot) => slot.brandAssetId)).toEqual([
      approved.brandAssetId,
      greaterOverlap.brandAssetId,
      newerVersion.brandAssetId,
    ]);
  });

  it("uses ascending asset id when the first three ordering keys tie", () => {
    const result = resolve([candidate(4), candidate(2), candidate(3), candidate(1)]);

    expect(result.referenceSlots.map((slot) => slot.brandAssetId)).toEqual([
      ids.asset(1),
      ids.asset(2),
      ids.asset(3),
    ]);
  });

  it("matches tags through the shared Unicode normalization rule", () => {
    const result = resolve([candidate(1, { tags: ["CAFE\u0301", "മീൻ കറി"] })], {
      ...baseRequest,
      subjectTags: ["café", "മീൻ കറി"],
    });

    expect(result.outcome).toBe("resolved");
  });

  it("fills at most one typography slot per requested script and at most three", () => {
    const result = resolve(
      [
        candidate(1, { conditioningRoles: ["typography"], tags: [], scripts: ["Latn"] }),
        candidate(2, { conditioningRoles: ["typography"], tags: [], scripts: ["Mlym"] }),
        candidate(3, { conditioningRoles: ["typography"], tags: [], scripts: ["Arab"] }),
        candidate(4, { conditioningRoles: ["typography"], tags: [], scripts: ["Cyrl"] }),
      ],
      {
        ...baseRequest,
        subjectDescription: "A confirmed description keeps generation available.",
        scripts: ["Mlym", "Latn", "Arab", "Cyrl"],
      },
    );

    const typography = result.referenceSlots.filter((slot) => slot.role === "typography");
    expect(typography).toHaveLength(3);
    expect(typography.map((slot) => slot.script)).toEqual(["Arab", "Cyrl", "Latn"]);
  });
});

describe("reference modes", () => {
  it("defaults positive references to inspiration", () => {
    expect(resolve([candidate(1)]).referenceSlots[0]?.referenceMode).toBe("inspiration");
  });

  it("preserves exact-match only for an owned reference", () => {
    expect(
      resolve([candidate(1, { requestedReferenceMode: "exact_match" })]).referenceSlots[0]
        ?.referenceMode,
    ).toBe("exact_match");
  });

  it("refuses exact-match on a third-party reference instead of downgrading it", () => {
    let thrown: unknown;
    try {
      resolve([candidate(1, { ownership: "third_party", requestedReferenceMode: "exact_match" })]);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ReferenceResolutionError);
    expect(thrown).toMatchObject({ code: "exact_match_requires_owned_reference" });
  });
});

describe("rejected references and negative rules", () => {
  it("does not carry an archived rejection into avoid slots or negative rules", () => {
    const result = resolve([
      candidate(1, {
        currentVerdict: "rejected",
        currentReasonCodes: ["wrong_subject"],
        currentReviewedAt: "2026-08-24T10:00:00.000Z",
        archivedAt: "2026-08-24T11:00:00.000Z",
      }),
    ]);

    expect(result.avoidReferences).toHaveLength(0);
    expect(result.negativeRules).toHaveLength(0);
  });

  it("selects only the two most recently rejected assets and keeps their own reasons attached", () => {
    const result = resolve([
      candidate(1, {
        currentVerdict: "rejected",
        currentReasonCodes: ["wrong_subject"],
        currentReviewedAt: "2026-08-24T10:00:00.000Z",
      }),
      candidate(2, {
        currentVerdict: "rejected",
        currentReasonCodes: ["wrong_style", "people_shown"],
        currentReviewedAt: "2026-08-24T12:00:00.000Z",
      }),
      candidate(3, {
        currentVerdict: "rejected",
        currentReasonCodes: ["off_palette"],
        currentReviewedAt: "2026-08-24T11:00:00.000Z",
      }),
    ]);

    expect(result.avoidReferences).toEqual([
      {
        role: "avoid",
        brandAssetId: ids.asset(2),
        brandAssetVersionId: ids.version(2),
        reasonCodes: ["wrong_style", "people_shown"],
      },
      {
        role: "avoid",
        brandAssetId: ids.asset(3),
        brandAssetVersionId: ids.version(3),
        reasonCodes: ["off_palette"],
      },
    ]);
    expect(result.referenceSlots).toHaveLength(0);
  });

  it("deduplicates negative rules, sorts them by code, and caps them at twelve", () => {
    const codes = [...CREATIVE_REVIEW_REASON_CODES].reverse();
    const result = resolve([
      candidate(1, {
        currentVerdict: "rejected",
        currentReasonCodes: codes.slice(0, 8),
        currentReviewedAt: "2026-08-24T10:00:00.000Z",
      }),
      candidate(2, {
        currentVerdict: "rejected",
        currentReasonCodes: codes.slice(7),
        currentReviewedAt: "2026-08-24T11:00:00.000Z",
      }),
    ]);

    const expectedCodes = [...CREATIVE_REVIEW_REASON_CODES].sort().slice(0, 12);
    expect(result.negativeRules.map((rule) => rule.code)).toEqual(expectedCodes);
    expect(result.negativeRules).toHaveLength(12);
  });

  it("fails closed when a rejected reason has no governed registry description", () => {
    expect(() =>
      resolveReferences({
        candidates: [
          candidate(1, {
            currentVerdict: "rejected",
            currentReasonCodes: ["wrong_subject"],
            currentReviewedAt: "2026-08-24T10:00:00.000Z",
          }),
        ],
        reasonRegistry: [],
        request: baseRequest,
      }),
    ).toThrowError(ReferenceResolutionError);
  });

  it("validates registry coverage before applying the twelve-rule output cap", () => {
    const sortedCodes = [...CREATIVE_REVIEW_REASON_CODES].sort();
    const missingCode = sortedCodes.at(-1)!;

    expect(() =>
      resolveReferences({
        candidates: [
          candidate(1, {
            currentVerdict: "rejected",
            currentReasonCodes: sortedCodes,
            currentReviewedAt: "2026-08-24T10:00:00.000Z",
          }),
        ],
        reasonRegistry: sortedCodes
          .filter((code) => code !== missingCode)
          .map((code) => ({ code, description: `Rule for ${code}` })),
        request: baseRequest,
      }),
    ).toThrowError(ReferenceResolutionError);
  });
});
