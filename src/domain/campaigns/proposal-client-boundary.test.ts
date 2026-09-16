import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The Growth Intelligence page broke with a 500 because `proposal.ts` carried
 * a top-level `node:crypto` import into a client-component import chain.
 * Webpack cannot bundle `node:` specifiers for the browser, and it fails the
 * whole page — not just the component that hashes.
 *
 * The rule (also documented in `diff.ts`): modules reachable from a `"use
 * client"` component must never import a `node:` module, at any depth that
 * webpack follows. The digest function therefore lives in
 * `proposal-digest.ts`, beside the server code that writes versions — never
 * beside the schemas the UI reads.
 */
const CLIENT_REACHABLE = [
  "./proposal.ts",
  "../../modules/campaigns/application/proposal-read-model.ts",
];

describe("proposal client boundary", () => {
  for (const relative of CLIENT_REACHABLE) {
    it(`${relative} imports no node: modules`, () => {
      const source = readFileSync(new URL(relative, import.meta.url), "utf8");
      expect(source).not.toMatch(/from\s+["']node:/);
      expect(source).not.toMatch(/require\(\s*["']node:/);
    });
  }

  it("proposal.ts does not export the digest function", async () => {
    const proposal = await import("./proposal");
    expect("proposalDigest" in proposal).toBe(false);
  });
});
