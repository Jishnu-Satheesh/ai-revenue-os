import { describe, expect, it } from "vitest";

import { deriveConnectionHealth } from "@/domain/integrations/health";

const now = new Date("2026-08-08T12:00:00.000Z");

describe("deriveConnectionHealth", () => {
  it("prioritizes stale health before degraded status", () => {
    const health = deriveConnectionHealth({
      status: "degraded",
      staleAfterMinutes: 65,
      lastTestedAt: "2026-08-08T10:00:00.000Z",
      lastSuccessfulSyncAt: "2026-08-08T10:54:00.000Z",
      latestOutcome: "warning",
      now,
    });

    expect(health).toMatchObject({ state: "stale", reasonCode: "sync_stale" });
  });

  it("keeps Google fixture data healthy through its 65-minute freshness threshold", () => {
    const health = deriveConnectionHealth({
      status: "active",
      staleAfterMinutes: 65,
      lastTestedAt: "2026-08-08T11:00:00.000Z",
      lastSuccessfulSyncAt: "2026-08-08T10:55:00.000Z",
      latestOutcome: "passed",
      now,
    });

    expect(health).toMatchObject({ state: "healthy", reasonCode: "fresh" });
  });

  it("marks an untested connection stale after its first scheduled sync window", () => {
    const health = deriveConnectionHealth({
      status: "active",
      staleAfterMinutes: 65,
      nextScheduledSyncAt: "2026-08-08T11:30:00.000Z",
      now,
    });

    expect(health).toMatchObject({ state: "stale", reasonCode: "sync_stale" });
  });

  it("prioritizes revocation over every other health signal", () => {
    const health = deriveConnectionHealth({
      status: "revoked",
      staleAfterMinutes: 65,
      lastTestedAt: "2026-08-08T10:00:00.000Z",
      lastSuccessfulSyncAt: "2026-08-08T10:00:00.000Z",
      latestOutcome: "failed",
      now,
    });

    expect(health).toMatchObject({ state: "revoked", reasonCode: "connection_revoked" });
  });
});
