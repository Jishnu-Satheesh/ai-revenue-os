import { describe, expect, it } from "vitest";

import {
  INTERNAL_ONLY_CONTEXT,
  isShareActiveStatus,
  resolveShareContext,
  shareLogFields,
} from "@/workflows/analysis/grounded-share-mode";

describe("isShareActiveStatus", () => {
  it("activates only on an explicit true flag", () => {
    expect(isShareActiveStatus({ shareActive: true })).toBe(true);
  });

  it("denies every other shape", () => {
    for (const data of [
      null,
      undefined,
      true,
      "true",
      [],
      {},
      { shareActive: false },
      { shareActive: "true" },
      { shareActive: 1 },
    ]) {
      expect(isShareActiveStatus(data)).toBe(false);
    }
  });
});

describe("resolveShareContext", () => {
  it("stays internal-only without an active share", () => {
    expect(
      resolveShareContext({
        shareActive: false,
        entries: [{ title: "Plan", summary: "Something." }],
        excludedCount: 0,
      }),
    ).toEqual(INTERNAL_ONLY_CONTEXT);
  });

  it("reports an allowed-but-empty corpus honestly", () => {
    expect(
      resolveShareContext({ shareActive: true, entries: [], excludedCount: 4 }),
    ).toEqual({
      mode: "grounded_share",
      entries: [],
      excludedCount: 4,
      reason: "corpus_unqualified",
    });
  });

  it("shares allowlisted entries when active", () => {
    const entries = [{ title: "Plan", summary: "Check capacity before Friday." }];
    expect(resolveShareContext({ shareActive: true, entries, excludedCount: 1 })).toEqual({
      mode: "grounded_share",
      entries,
      excludedCount: 1,
      reason: "ready",
    });
  });
});

describe("shareLogFields", () => {
  it("carries counts and reason, never bodies", () => {
    const fields = shareLogFields(
      resolveShareContext({
        shareActive: true,
        entries: [{ title: "Plan", summary: "Secret words." }],
        excludedCount: 2,
      }),
    );
    expect(fields).toEqual({
      shareMode: "grounded_share",
      shareEntryCount: 1,
      shareExcludedCount: 2,
      shareReason: "ready",
    });
    expect(JSON.stringify(fields)).not.toContain("Secret words");
  });
});
