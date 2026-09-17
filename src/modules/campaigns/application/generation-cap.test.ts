import { describe, expect, it } from "vitest";

import {
  approvedCeilingMinor,
  createApprovedGenerationCapReader,
  generationDispatchAllowed,
} from "@/modules/campaigns/application/generation-cap";

describe("the approved preparation purse", () => {
  it("reads the ceiling from the approved document", () => {
    expect(
      approvedCeilingMinor({ generationCostCeiling: { amountMinor: 8000, currency: "AED" } }),
    ).toBe(8000);
  });

  it("reports unreadable rather than inventing a purse", () => {
    expect(approvedCeilingMinor({})).toBeNull();
    expect(approvedCeilingMinor(null)).toBeNull();
  });

  it("allows spending inside the purse, including exactly it", () => {
    expect(
      generationDispatchAllowed({ approvedCeilingMinor: 8000, dispatchCeilingMinor: 500 }),
    ).toEqual({ allowed: true });
    expect(
      generationDispatchAllowed({ approvedCeilingMinor: 8000, dispatchCeilingMinor: 8000 }),
    ).toEqual({ allowed: true });
  });

  it("refuses a dispatch ceiling above the approval", () => {
    expect(
      generationDispatchAllowed({ approvedCeilingMinor: 400, dispatchCeilingMinor: 500 }),
    ).toEqual({ allowed: false, reasonCode: "generation_budget_exceeded" });
  });

  it("refuses when the approval cannot be read, rather than spending freely", () => {
    expect(
      generationDispatchAllowed({ approvedCeilingMinor: null, dispatchCeilingMinor: 500 }),
    ).toEqual({ allowed: false, reasonCode: "generation_budget_unreadable" });
  });
});

describe("reading the approved ceiling", () => {
  function persistence(proposals: unknown, versions: unknown) {
    return {
      from(table: string) {
        const rows = table === "campaign_proposals" ? proposals : versions;
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return { limit: async () => ({ data: rows, error: null }) };
                  },
                  limit: async () => ({ data: rows, error: null }),
                };
              },
            };
          },
        };
      },
    };
  }

  it("returns the ceiling from the linked proposal's current version", async () => {
    const reader = createApprovedGenerationCapReader(
      persistence(
        [{ state: "approved_for_preparation", current_version_id: "version-1" }],
        [{ document: { generationCostCeiling: { amountMinor: 8000, currency: "AED" } } }],
      ) as never,
    );

    await expect(
      reader.readApprovedCeiling({ organizationId: "org-1", campaignId: "campaign-1" }),
    ).resolves.toEqual({ ceilingMinor: 8000, state: "approved_for_preparation" });
  });

  it("reports no purse when no proposal links to the campaign", async () => {
    const reader = createApprovedGenerationCapReader(persistence([], []) as never);

    await expect(
      reader.readApprovedCeiling({ organizationId: "org-1", campaignId: "campaign-1" }),
    ).resolves.toEqual({ ceilingMinor: null, state: null });
  });
});
