import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { resolveCampaignStateChip } from "@/components/campaigns/campaign-state-chip";

const ROOT = process.cwd();

/**
 * Server/client boundary guard.
 *
 * `HomeCampaigns` is a Server Component but the shared card UI is a Client
 * Component. The label/tone mapping must live in the server-safe
 * `campaign-state-chip.ts` — importing the helper from the client module
 * throws "Attempted to call resolveCampaignStateChip() from the server" on
 * the /overview page. These tests pin that boundary.
 */
describe("campaign state chip server boundary", () => {
  it("the pure module carries no client directive", () => {
    const source = readFileSync(
      join(ROOT, "src/components/campaigns/campaign-state-chip.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/["']use client["']/);
  });

  it("the server home section resolves chips without the client module", () => {
    const source = readFileSync(
      join(ROOT, "src/components/organizations/home/home-campaigns.tsx"),
      "utf8",
    );
    expect(source).toContain("campaigns/campaign-state-chip");
    expect(source).not.toMatch(
      /import\s*\{[^}]*resolveCampaignStateChip[^}]*\}\s*from\s*["']@\/components\/campaigns\/shared-campaign-card["']/,
    );
  });

  it("resolves the prototype vocabulary", () => {
    expect(resolveCampaignStateChip({ state: "ready_for_review" })).toEqual({
      label: "Ready for review",
      tone: "warning",
    });
    expect(resolveCampaignStateChip({ state: "draft" })).toEqual({
      label: "Draft",
      tone: "success",
    });
    expect(resolveCampaignStateChip({ phase: "review" })).toEqual({
      label: "Ready for review",
      tone: "warning",
    });
  });
});
