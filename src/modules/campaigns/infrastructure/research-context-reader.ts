import type { SubjectPackPort } from "@/modules/memory/application/subject-pack";
import type {
  CampaignEvidence,
  CampaignEvidenceReader,
} from "@/modules/growth-intelligence/application/campaign-evidence-reader";

/**
 * The context one research run is allowed to think with (Task 6, C03).
 *
 * Three origins, each kept visibly separate all the way into the planning
 * prompt: source-owned business data (what the client told us), scoped
 * reviewed Memory (what the platform remembers, pinned and consumed through
 * the Spec 023 port — entry contents travel, never a bare digest), and
 * qualified external evidence (what Growth proved, if anything).
 *
 * The reader also answers the one question that decides whether this run may
 * propose ads at all: when the source data names operational blockers — the
 * kitchen cannot cover lunch, delivery is suspended — marketing cannot fix
 * the problem, and the run produces advice instead of a campaign. That is a
 * useful outcome, not a failure, and it is recorded as one.
 */

export type ResearchSourceData = {
  organizationProfile: string;
  objectives: readonly string[];
  capacityNotes: readonly string[];
  /** Non-empty means the problem is operational: advise, do not advertise. */
  operationalBlockers: readonly string[];
  hardConstraints: readonly string[];
};

export type ResearchMemoryContext = {
  manifestId: string;
  digest: string;
  entries: readonly { id: string; title: string; body: string }[];
  excludedCount: number;
};

export type ResearchContext = {
  source: ResearchSourceData;
  memory: ResearchMemoryContext;
  evidence: CampaignEvidence;
  marketingFit: "viable" | "advice_only";
};

export type ResearchContextDependencies = {
  readSource: (input: { organizationId: string }) => Promise<ResearchSourceData>;
  subjectPack: SubjectPackPort;
  evidence: CampaignEvidenceReader;
  nowIso: () => string;
  /**
   * Proves the run still holds its claim, before anything below is read.
   *
   * Every read here runs on the worker's service client, which bypasses RLS —
   * tenancy holds because each query repeats the organization id. This is the
   * second fence, and it is checked first: a worker that has lost its claim
   * must see no business data, no pinned memory and no Growth evidence, rather
   * than being stopped after it has already read them.
   *
   * Only the worker path holds a claim. Preparation runs before one exists,
   * so it passes none and this is never called.
   */
  assertClaimLive?: (input: {
    organizationId: string;
    runId: string;
    claimToken: string;
  }) => Promise<void>;
};

export type PinnedResearchMemory = {
  manifestId: string;
  digest: string;
  /**
   * Exact bounded snapshots served claim-bound by the worker loader.
   * Content-less entries (erased upstream) are treated as absent here, so
   * the planner can never cite what it cannot see.
   */
  entries: readonly { id: string; title: string | null; body: string | null }[];
  excludedCount: number;
};

export function createResearchContextReader(
  dependencies: ResearchContextDependencies,
) {
  return {
    async read(input: {
      organizationId: string;
      runId: string;
      /** What the run is researching, in the requester's words. */
      query: string;
      evidenceMaxAgeDays: number;
      profileVersionId: string | null;
      now: Date;
      /**
       * When the caller already holds the admitted pin (the worker path),
       * preparation is skipped: re-deriving context at run time could only
       * assemble something the admission never approved.
       */
      pinned?: PinnedResearchMemory;
      /**
       * The worker's live claim on this run. Present only on the worker path;
       * preparation has no claim to offer.
       */
      claim?: { runId: string; claimToken: string };
    }): Promise<ResearchContext> {
      // Deliberately awaited alone, before the reads below. Putting it inside
      // the Promise.all would start every service-client read in the same tick
      // as the check meant to gate them.
      if (input.claim && dependencies.assertClaimLive) {
        await dependencies.assertClaimLive({
          organizationId: input.organizationId,
          runId: input.claim.runId,
          claimToken: input.claim.claimToken,
        });
      }

      const [source, pack, evidence] = await Promise.all([
        dependencies.readSource({ organizationId: input.organizationId }),
        input.pinned
          ? Promise.resolve(null)
          : // The actor is the run itself, tenant-scoped by organizationId: the
            // prepared manifest is pinned to this run's purpose and cannot be
            // mistaken for a person's broader context.
            dependencies.subjectPack.prepare({
              organizationId: input.organizationId,
              actorId: `campaign-research:${input.runId}`,
              query: input.query,
              correlationId: input.runId,
            }),
        dependencies.evidence.read({
          organizationId: input.organizationId,
          evidenceMaxAgeDays: input.evidenceMaxAgeDays,
          profileVersionId: input.profileVersionId,
          now: input.now,
        }),
      ]);

      const present = (input.pinned?.entries ?? []).filter(
        (entry) => typeof entry.body === "string" && entry.body.length > 0,
      );
      const memory: ResearchMemoryContext = input.pinned
        ? {
            manifestId: input.pinned.manifestId,
            digest: input.pinned.digest,
            entries: present.map((entry) => ({
              id: entry.id,
              title: entry.title ?? "(untitled)",
              body: entry.body as string,
            })),
            excludedCount:
              input.pinned.excludedCount + (input.pinned.entries.length - present.length),
          }
        : {
            manifestId: pack!.manifestId,
            digest: pack!.contextDigest,
            entries: pack!.entries.map((entry) => ({
              id: entry.contextRef,
              title: entry.title,
              body: entry.summary,
            })),
            excludedCount: pack!.excludedCount,
          };

      return {
        source,
        memory,
        evidence,
        marketingFit: source.operationalBlockers.length > 0 ? "advice_only" : "viable",
      };
    },
  };
}

export type ResearchContextReader = ReturnType<typeof createResearchContextReader>;
