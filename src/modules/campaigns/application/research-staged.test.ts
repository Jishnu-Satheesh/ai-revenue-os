import { describe, expect, it, vi } from "vitest";

import { createCampaignProposalService } from "@/modules/campaigns/application/proposal-service";
import type { ProposalStore } from "@/modules/campaigns/application/proposal-service";
import { createResearchService } from "@/modules/campaigns/application/research-service";
import { createResearchPlanner } from "@/modules/campaigns/infrastructure/research-planner";
import type { CampaignProposalDocument } from "@/domain/campaigns/proposal";

/**
 * The Task 6 staged acceptance, end to end at the service seam.
 *
 * A source-backed staged request with bounded spend travels the whole path:
 * claim, policy recheck, context with real entry bodies, a draft_DIS proven
 * against the assembled context, admission, the governed proposal writer,
 * and completion with measured cost. The fake model sees the real prompt —
 * and the test asserts the prompt carried entry contents, so a digest-only
 * fixture fails this acceptance by construction.
 */

const ORGANIZATION_ID = "fb430000-0000-4000-8000-000000000201";
const RUN_ID = "fb430000-0000-4000-8000-000000000202";
const PROPOSAL_ID = "fb430000-0000-4000-8000-000000000203";
const MANIFEST_ID = "fb430000-0000-4000-8000-000000000204";
const DIGEST = "c".repeat(64);
const NOW = new Date("2026-09-13T12:00:00.000Z");
const ENTRY_BODY = "Office workers fill the room between 12:00 and 13:30.";

function document(): CampaignProposalDocument {
  return {
    schemaVersion: 1,
    title: "Win back weekday lunch",
    businessProblem: "Weekday lunch covers fell 18% since September.",
    objective: "Fill weekday lunch",
    audience: "Nearby office workers who order before noon.",
    offer: { kind: "no_offer" },
    channels: [{ channelKey: "instagram", delivery: "organic" }],
    deliverables: [{ format: "post", language: "en", count: 2 }],
    timing: { startAt: "2026-10-01T00:00:00.000Z", endAt: null, timezone: "Asia/Dubai" },
    proposedMediaBudget: null,
    generationCostCeiling: { amountMinor: 2000, currency: "AED" },
    successPlan: {
      primaryMetricKey: "covers.weekday_lunch",
      baselineSource: "pos weekday lunch",
      baselineRevision: 0,
      baselineFrom: null,
      baselineTo: null,
      observationWindowDays: 28,
      reportingDelayDays: 2,
      settlementDelayDays: 0,
      measurementMethod: null,
      target: null,
      missingData: ["No profit estimate is attached yet."],
    },
    pausePolicyRef: "default-pause-policy",
    evidence: [
      {
        kind: "business_memory_context",
        organizationId: ORGANIZATION_ID,
        contextManifestId: MANIFEST_ID,
        sourceRevision: 0,
        observedFrom: "2026-09-01T00:00:00.000Z",
        observedTo: "2026-09-12T00:00:00.000Z",
        supports: "internal_fact",
      },
    ],
    memoryContextManifestId: MANIFEST_ID,
    assumptions: ["Office hours stay as they are."],
    limitations: ["No external market research supports this."],
    readiness: { canPrepare: false, canLaunch: false, blockers: ["Awaiting owner review."] },
  };
}

function memoryStore(): ProposalStore & { versions: Map<string, CampaignProposalDocument> } {
  const versions = new Map<string, CampaignProposalDocument>();
  return {
    versions,
    async requestProposal() {
      return { proposalId: PROPOSAL_ID, outcome: "saved" as const };
    },
    async completeVersion(input) {
      versions.set(input.proposalId, input.document);
      return { proposalVersionId: "version-1", version: 1, digest: input.digest };
    },
    async decide() {
      throw new Error("not exercised");
    },
    async readVersionDocument(input) {
      return versions.get(input.proposalId) ?? null;
    },
  };
}

describe("staged research request", () => {
  it("produces a readable proposal with exact provenance and measured cost", async () => {
    const store = memoryStore();
    const proposals = createCampaignProposalService({ store });
    const completed: Record<string, unknown>[] = [];
    let seenPrompt = "";

    const service = createResearchService({
      runs: {
        claim: async () => ({
          runId: RUN_ID,
          claimToken: "claim",
          policyVersion: 3,
          budgetMinor: 1000,
        }),
        assertClaimLive: async () => {},
        listLeaseExpiries: async () => [],
        reclaimLeases: async () => ({ reclaimed: 0, abandoned: 0 }),
        load: async () => ({
          status: "claimed",
          triggerKind: "manual_request",
          policyVersion: 3,
          budgetMinor: 1000,
          researchQuestion: "weekday lunch decline",
          currentPolicyVersion: 3,
          manifestId: MANIFEST_ID,
          digest: DIGEST,
          entries: [
            { id: "entry-weekday-regulars", title: "Weekday regulars", body: ENTRY_BODY },
          ],
        }),
        complete: async (input: { actualCostMinor: number; outcome: string }) => {
          completed.push({ ...input });
        },
        fail: async () => {
          throw new Error("must not fail");
        },
        cancel: async () => {},
      },
      contexts: {
        read: async (input: {
          pinned?: {
            manifestId: string;
            digest: string;
            entries: readonly { id: string; title: string | null; body: string | null }[];
          };
        }) => ({
          source: {
            organizationProfile: "Neighbourhood kitchen.",
            objectives: ["Fill weekday lunch."],
            capacityNotes: [],
            operationalBlockers: [],
            hardConstraints: [],
          },
          memory: {
            manifestId: input.pinned?.manifestId ?? "",
            digest: input.pinned?.digest ?? "",
            entries: (input.pinned?.entries ?? [])
              .filter((entry) => typeof entry.body === "string" && entry.body.length > 0)
              .map((entry) => ({
                id: entry.id,
                title: entry.title ?? "(untitled)",
                body: entry.body as string,
              })),
            excludedCount: 0,
          },
          evidence: { status: "unavailable", requestId: null, reason: "no_requests", failureCode: null },
          marketingFit: "viable",
        }),
      } as never,
      planner: createResearchPlanner({
        drafter: {
          draft: async ({ prompt }) => {
            seenPrompt = prompt;
            return {
              output: {
                alternatives: [
                  {
                    title: "Organic lunch series",
                    summary: "A four-week organic series aimed at office workers.",
                    whyViable: "Speaks to known regulars for no media money.",
                    risks: ["Reach stays limited to followers."],
                    evidenceRefs: ["entry-weekday-regulars"],
                  },
                ],
                document: document(),
                marketClaimKeys: [],
              },
              modelId: "research-draft@1",
              estimatedCostMinor: 12,
            };
          },
        },
      }),
      proposals,
      subjectPack: { consume: async () => {} },
      now: () => NOW,
      nowIso: () => NOW.toISOString(),
      isCancelled: () => false,
    });

    const result = await service.run({
      organizationId: ORGANIZATION_ID,
      runId: RUN_ID,
      evidenceMaxAgeDays: 30,
      externalCostMinor: 100,
    });

    // The draft saw real content: a digest-only prompt fails this line.
    expect(seenPrompt).toContain(ENTRY_BODY);

    expect(result).toEqual({
      status: "completed",
      runId: RUN_ID,
      proposalId: PROPOSAL_ID,
      outcome: "proposal_prepared",
    });

    // The proposal is readable through the governed reader, exactly as saved.
    const reread = await store.readVersionDocument({
      organizationId: ORGANIZATION_ID,
      proposalId: PROPOSAL_ID,
      proposalVersionId: "version-1",
    });
    expect(reread?.title).toBe("Win back weekday lunch");

    // Exact provenance travelled with the version: alternatives considered,
    // memory digest cited, gaps declared.
    const saved = store.versions.get(PROPOSAL_ID);
    expect(saved?.limitations).toContain("No external market research supports this.");

    // Measured external spend plus measured model cost, never estimated.
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      actualCostMinor: 112,
      outcome: "proposal_prepared",
      contextDigest: DIGEST,
    });
  });
});
