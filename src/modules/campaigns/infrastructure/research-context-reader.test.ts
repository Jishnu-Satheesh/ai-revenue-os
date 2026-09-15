import { describe, expect, it, vi } from "vitest";

import { createResearchContextReader } from "@/modules/campaigns/infrastructure/research-context-reader";
import type { SubjectPackPort } from "@/modules/memory/application/subject-pack";
import type { CampaignEvidenceReader } from "@/modules/growth-intelligence/application/campaign-evidence-reader";

const ORGANIZATION_ID = "fb430000-0000-4000-8000-000000000201";
const RUN_ID = "fb430000-0000-4000-8000-000000000202";
const NOW = new Date("2026-09-13T12:00:00.000Z");

function reader(
  overrides: Partial<Parameters<typeof createResearchContextReader>[0]> = {},
) {
  return createResearchContextReader({
    readSource: async () => ({
      organizationProfile: "Neighbourhood kitchen.",
      objectives: ["Fill weekday lunch."],
      capacityNotes: ["Forty covers at lunch."],
      operationalBlockers: [],
      hardConstraints: ["Never imply a health claim."],
    }),
    subjectPack: {
      prepare: async (input: { actorId: string }) => ({
        manifestId: "fb430000-0000-4000-8000-000000000203",
        contextDigest: "c".repeat(64),
        status: "ready",
        entries: [
          {
            contextRef: "entry-weekday-regulars",
            sourceKind: "memory",
            sourceId: "mem-1",
            title: "Weekday regulars",
            summary: "Office workers fill the room between 12:00 and 13:30.",
            statementKind: "observation",
            trustRank: 2,
            freshness: "fresh",
            sensitivity: "internal",
          },
        ],
        excludedCount: 1,
        degradedReasons: [],
        actorFingerprint: String(input.actorId),
      }),
      consume: async () => {},
    } as unknown as SubjectPackPort,
    evidence: {
      read: async () => ({
        status: "unavailable",
        requestId: null,
        reason: "no_requests",
        failureCode: null,
      }),
    } as CampaignEvidenceReader,
    nowIso: () => NOW.toISOString(),
    ...overrides,
  });
}

function readInput(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORGANIZATION_ID,
    runId: RUN_ID,
    query: "weekday lunch decline",
    evidenceMaxAgeDays: 30,
    profileVersionId: null,
    now: NOW,
    ...overrides,
  };
}

describe("research context reader", () => {
  it("binds the pack to the run itself, tenant-scoped by organization", async () => {
    let actorId = "";
    const contextReader = reader({
      subjectPack: {
        prepare: async (input: { actorId: string }) => {
          actorId = input.actorId;
          return {
            manifestId: "fb430000-0000-4000-8000-000000000203",
            contextDigest: "c".repeat(64),
            status: "ready",
            entries: [],
            excludedCount: 0,
            degradedReasons: [],
          };
        },
        consume: async () => {},
      } as unknown as SubjectPackPort,
    });
    await contextReader.read(readInput());
    expect(actorId).toBe(`campaign-research:${RUN_ID}`);
  });

  it("carries actual entry contents, never a bare digest", async () => {
    const context = await reader().read(readInput());
    expect(context.memory.digest).toBe("c".repeat(64));
    expect(context.memory.entries).toEqual([
      {
        id: "entry-weekday-regulars",
        title: "Weekday regulars",
        body: "Office workers fill the room between 12:00 and 13:30.",
      },
    ]);
    expect(context.memory.excludedCount).toBe(1);
  });

  it("proposes campaigns when operations are sound", async () => {
    const context = await reader().read(readInput());
    expect(context.marketingFit).toBe("viable");
  });

  it("advises instead of advertising when operations block", async () => {
    const contextReader = reader({
      readSource: async () => ({
        organizationProfile: "Neighbourhood kitchen.",
        objectives: ["Fill weekday lunch."],
        capacityNotes: [],
        operationalBlockers: ["The kitchen closes for repairs until October."],
        hardConstraints: [],
      }),
    });
    const context = await contextReader.read(readInput());
    expect(context.marketingFit).toBe("advice_only");
    expect(context.source.operationalBlockers).toEqual([
      "The kitchen closes for repairs until October.",
    ]);
  });

  it("still builds context when external evidence is missing", async () => {
    const context = await reader().read(readInput());
    expect(context.evidence.status).toBe("unavailable");
    expect(context.source.organizationProfile).toBe("Neighbourhood kitchen.");
  });

  it("uses the admitted pin without preparing, dropping content-less entries", async () => {
    const prepare = vi.fn();
    const contextReader = reader({
      subjectPack: { prepare, consume: async () => {} } as unknown as SubjectPackPort,
    });
    const context = await contextReader.read(
      readInput({
        pinned: {
          manifestId: "fb430000-0000-4000-8000-000000000203",
          digest: "c".repeat(64),
          entries: [
            { id: "ctx-0001", title: "Weekday regulars", body: "Office workers fill the room." },
            { id: "ctx-0002", title: null, body: null },
          ],
          excludedCount: 0,
        },
      }),
    );
    expect(prepare).not.toHaveBeenCalled();
    expect(context.memory.entries).toEqual([
      { id: "ctx-0001", title: "Weekday regulars", body: "Office workers fill the room." },
    ]);
    expect(context.memory.excludedCount).toBe(1);
  });
});

describe("research context reader, proving the claim before reading", () => {
  const CLAIM = { runId: RUN_ID, claimToken: "fb430000-0000-4000-8000-0000000002ff" };

  it("proves the claim before it reads anything on the service client", async () => {
    const order: string[] = [];
    const assertClaimLive = vi.fn(async () => {
      order.push("assert");
    });

    const contextReader = reader({
      assertClaimLive,
      readSource: async () => {
        order.push("source");
        return {
          organizationProfile: "Neighbourhood kitchen.",
          objectives: [],
          capacityNotes: [],
          operationalBlockers: [],
          hardConstraints: [],
        };
      },
      evidence: {
        read: async () => {
          order.push("evidence");
          return { status: "unavailable", requestId: null, reason: "no_requests", failureCode: null };
        },
      } as CampaignEvidenceReader,
    });

    await contextReader.read(readInput({ claim: CLAIM }));

    expect(assertClaimLive).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      runId: CLAIM.runId,
      claimToken: CLAIM.claimToken,
    });
    // The proof comes first, not alongside. These reads bypass RLS, so a
    // worker that has lost its claim must be stopped before it sees anything,
    // not after.
    expect(order[0]).toBe("assert");
    expect(order).toContain("evidence");
  });

  it("reads nothing at all once the claim is gone", async () => {
    const readSource = vi.fn();
    const evidenceRead = vi.fn();

    const contextReader = reader({
      assertClaimLive: async () => {
        throw new Error("campaign_research_claim_lost");
      },
      readSource: readSource as never,
      evidence: { read: evidenceRead } as unknown as CampaignEvidenceReader,
    });

    await expect(contextReader.read(readInput({ claim: CLAIM }))).rejects.toThrow(
      "campaign_research_claim_lost",
    );
    // Fails closed: an unprovable claim reads no business data, no pinned
    // memory and no Growth evidence.
    expect(readSource).not.toHaveBeenCalled();
    expect(evidenceRead).not.toHaveBeenCalled();
  });

  it("still reads when no claim is offered, which is the preparation path", async () => {
    const assertClaimLive = vi.fn(async () => {});
    const contextReader = reader({ assertClaimLive });

    const context = await contextReader.read(readInput());

    // Preparation runs before any claim exists, so there is nothing to prove.
    // The guard applies to the worker path that actually holds one.
    expect(assertClaimLive).not.toHaveBeenCalled();
    expect(context.source.organizationProfile).toBe("Neighbourhood kitchen.");
  });
});
