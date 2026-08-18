import { describe, expect, it, vi } from "vitest";

import { generateCampaignVariants } from "@/workflows/campaigns/generate-variants";
import { campaignVariantPayloadSchema } from "@/workflows/campaigns/contracts";
import { manifestIds, validManifest } from "@/domain/campaigns/test-manifest";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN_ID = "c1000000-0000-4000-8000-000000000001";
const VERSION_ID = "d1000000-0000-4000-8000-000000000001";
const RUN_ID = "e1000000-0000-4000-8000-000000000001";
const DIGEST = "a".repeat(64);
const NOW = new Date("2026-09-01T00:00:00.000Z");

const PAYLOAD = {
  organizationId: ORGANIZATION_ID,
  campaignId: CAMPAIGN_ID,
  bundleVersionId: VERSION_ID,
  runId: RUN_ID,
  correlationId: "f1000000-0000-4000-8000-000000000001",
  perDirection: 1,
  costCeilingMinor: 100_000,
};

function contextRead(overrides: Record<string, unknown> = {}) {
  const manifest = validManifest();
  return {
    manifest,
    digest: DIGEST,
    approval: {
      bundleVersionId: VERSION_ID,
      bundleDigest: DIGEST,
      expiresAt: "2026-09-30T00:00:00.000Z",
      revokedAt: null,
    },
    evidence: {
      offer: manifest.generationPolicy.lockedOfferRef,
      factKeys: manifest.generationPolicy.lockedAssertionKeys,
      factText: "lunch set price weekday capacity",
      restrictedTerms: [] as readonly string[],
    },
    limits: { maxHashtags: 30, maxCopyCharacters: 2_200 },
    ...overrides,
  };
}

/** A drawn variant, valid unless a test breaks it on purpose. */
function drawn(directionId: string, seed: number, overrides: Record<string, unknown> = {}) {
  const assetId = `e0000000-0000-4000-8000-00000000000${seed}`;
  return {
    candidate: {
      id: `f0000000-0000-4000-8000-00000000000${seed}`,
      directionId,
      assetId,
      channel: "instagram",
      placement: "feed_image",
      hook: `Hook number ${seed}`,
      caption: `Caption number ${seed}.`,
      hashtags: ["#lunchdeal"],
      callToAction: "Book a table",
      ...overrides,
    },
    assetId,
    costMinor: 100,
    modelId: "image-model-v1",
  };
}

function deps(overrides: Record<string, unknown> = {}) {
  let seed = 0;
  return {
    context: { read: vi.fn(async () => contextRead()) },
    planner: {
      draw: vi.fn(async ({ directionId }: { directionId: string }) => {
        seed += 1;
        return drawn(directionId, seed);
      }),
    },
    variants: {
      readCapacity: vi.fn(async () => ({
        contentHashes: [] as readonly string[],
        usedByDirection: {} as Record<string, number>,
        usedInTotal: 0,
      })),
      append: vi.fn(async () => ({
        outcome: "appended" as const,
        variantId: "aa000000-0000-4000-8000-000000000001",
      })),
    },
    isCancelled: () => false,
    promptVersionId: "campaign-variant-prompt-v1",
    now: () => NOW,
    ...overrides,
  } as never;
}

describe("variants are produced inside an approval that already exists", () => {
  it("stores one variant per direction when everything passes", async () => {
    const result = await generateCampaignVariants(PAYLOAD, deps(), new AbortController().signal);

    expect(result.status).toBe("completed");
    if (result.status !== "completed") throw new Error("expected completion");
    expect(result.requested).toBe(3);
    expect(result.stored).toBe(3);
  });

  it("never sends a prompt, a secret or business context in the task payload", () => {
    // The wire contract is the guarantee, not the in-process argument object.
    // Identifiers, a run key and a ceiling; everything else the worker reads
    // for itself under its own credentials.
    expect(
      campaignVariantPayloadSchema.safeParse({
        ...PAYLOAD,
        prompt: "write me something",
      }).success,
    ).toBe(false);

    const { perDirection: _perDirection, ...wire } = PAYLOAD;
    expect(campaignVariantPayloadSchema.safeParse(wire).success).toBe(true);
  });
});

describe("a partial run is an outcome, not a failure", () => {
  it("keeps the variants that passed and reports the one that did not", async () => {
    let seed = 0;
    const dependencies = deps({
      planner: {
        draw: vi.fn(async ({ directionId }: { directionId: string }) => {
          seed += 1;
          // The second draw references an asset the run did not produce.
          return seed === 2
            ? {
                ...drawn(directionId, seed),
                assetId: "e0000000-0000-4000-8000-0000000000fe",
              }
            : drawn(directionId, seed);
        }),
      },
    });

    const result = await generateCampaignVariants(
      PAYLOAD,
      dependencies,
      new AbortController().signal,
    );

    if (result.status !== "completed") throw new Error("expected completion");
    expect(result.stored).toBe(2);
    expect(result.outcomes.filter((outcome) => outcome.status === "refused")).toHaveLength(1);
  });

  it("judges the asset the planner drew, not the one the variant claims", async () => {
    // Regression. An earlier version derived the allowed asset list from the
    // variant itself, which compared a value against itself and could never
    // fail — the cross-tenant asset check was a no-op that looked like a check.
    const dependencies = deps({
      planner: {
        draw: vi.fn(async ({ directionId }: { directionId: string }) => ({
          ...drawn(directionId, 1),
          assetId: "e0000000-0000-4000-8000-0000000000fe",
        })),
      },
    });

    const result = await generateCampaignVariants(
      PAYLOAD,
      dependencies,
      new AbortController().signal,
    );

    if (result.status !== "completed") throw new Error("expected completion");
    expect(result.stored).toBe(0);
    expect(
      result.outcomes.every(
        (outcome) => outcome.status === "refused" && outcome.detail.includes("asset_not_produced"),
      ),
    ).toBe(true);
  });

  it("records a refusal rather than dropping it silently", async () => {
    const dependencies = deps({
      planner: {
        draw: vi.fn(async ({ directionId }: { directionId: string }) => ({
          ...drawn(directionId, 1),
          candidate: { nonsense: true },
        })),
      },
    });

    const result = await generateCampaignVariants(
      PAYLOAD,
      dependencies,
      new AbortController().signal,
    );

    if (result.status !== "completed") throw new Error("expected completion");
    expect(result.stored).toBe(0);
    expect(result.outcomes).toHaveLength(3);
    expect(result.outcomes.every((outcome) => outcome.status === "refused")).toBe(true);
  });

  it("reports the database's reason when storage refuses what the service allowed", async () => {
    // The service said yes from a stale read and the database said no. The
    // database is right, and its reason is what an operator needs to see.
    const dependencies = deps({
      variants: {
        readCapacity: vi.fn(async () => ({
          contentHashes: [],
          usedByDirection: {},
          usedInTotal: 0,
        })),
        append: vi.fn(async () => ({
          outcome: "refused" as const,
          reason: "total_cap_reached" as const,
        })),
      },
    });

    const result = await generateCampaignVariants(
      PAYLOAD,
      dependencies,
      new AbortController().signal,
    );

    if (result.status !== "completed") throw new Error("expected completion");
    expect(result.stored).toBe(0);
    expect(result.outcomes[0]).toMatchObject({ reason: "total_cap_reached" });
  });

  it("refuses a duplicate of a variant stored earlier in the same run", async () => {
    const dependencies = deps({
      // Every draw returns the same creative, so the second is a duplicate of
      // the first even though nothing was stored before the run began.
      planner: {
        draw: vi.fn(async () => drawn(manifestIds.control, 1)),
      },
    });

    const result = await generateCampaignVariants(
      { ...PAYLOAD, perDirection: 2 },
      dependencies,
      new AbortController().signal,
    );

    if (result.status !== "completed") throw new Error("expected completion");
    expect(result.stored).toBe(1);
    expect(
      result.outcomes.filter(
        (outcome) => outcome.status === "refused" && outcome.detail.includes("duplicate_variant"),
      ).length,
    ).toBeGreaterThan(0);
  });
});

describe("the run stops when it is told to, or when the money runs out", () => {
  it("stops on cancellation without storing anything further", async () => {
    let calls = 0;
    const result = await generateCampaignVariants(
      PAYLOAD,
      deps({
        isCancelled: () => {
          calls += 1;
          return calls > 1;
        },
      }),
      new AbortController().signal,
    );

    expect(result.status).toBe("cancelled");
  });

  it("stops on an aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await generateCampaignVariants(PAYLOAD, deps(), controller.signal);

    expect(result.status).toBe("cancelled");
  });

  it("stops once the cost ceiling is passed, counting the draw that passed it", async () => {
    const result = await generateCampaignVariants(
      { ...PAYLOAD, costCeilingMinor: 150 },
      deps(),
      new AbortController().signal,
    );

    expect(result.status).toBe("cost_ceiling_reached");
    if (result.status !== "cost_ceiling_reached") throw new Error("expected the ceiling");
    // One draw at 100 fits; the second takes it to 200 and stops the run.
    expect(result.stored).toBe(1);
  });
});
