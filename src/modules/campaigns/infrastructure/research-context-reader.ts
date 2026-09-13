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
    }): Promise<ResearchContext> {
      const [source, pack, evidence] = await Promise.all([
        dependencies.readSource({ organizationId: input.organizationId }),
        // The actor is the run itself, tenant-scoped by organizationId: the
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

      return {
        source,
        memory: {
          manifestId: pack.manifestId,
          digest: pack.contextDigest,
          entries: pack.entries.map((entry) => ({
            id: entry.contextRef,
            title: entry.title,
            body: entry.summary,
          })),
          excludedCount: pack.excludedCount,
        },
        evidence,
        marketingFit: source.operationalBlockers.length > 0 ? "advice_only" : "viable",
      };
    },
  };
}

export type ResearchContextReader = ReturnType<typeof createResearchContextReader>;
