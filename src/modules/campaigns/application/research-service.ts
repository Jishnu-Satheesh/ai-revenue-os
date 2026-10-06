import { z } from "zod";

import type { CampaignProposalSourceKind } from "@/domain/campaigns/proposal";
import type {
  CampaignProposalService,
  ProposalOutcome,
  ProposalVersionResult,
} from "@/modules/campaigns/application/proposal-service";
import type {
  PinnedResearchMemory,
  ResearchContext,
  ResearchContextReader,
  ResearchSourceData,
} from "@/modules/campaigns/infrastructure/research-context-reader";
import type { ResearchPlanner } from "@/modules/campaigns/infrastructure/research-planner";
import { RESEARCH_PLANNER_PROMPT_VERSION } from "@/modules/campaigns/infrastructure/research-planner";
import type { ResearchRunStore } from "@/modules/campaigns/infrastructure/research-run-repository";
import type { SubjectPackPort } from "@/modules/memory/application/subject-pack";

/**
 * Runs one admitted research run to a proposal or to honest advice (Task 6).
 *
 * The order is the safety case, and every step re-checks what the last one
 * assumed: claim the run, confirm the policy that admitted it still binds
 * and nobody cancelled, gather context, plan, persist through the governed
 * proposal writer only, consume the manifest, complete with measured cost.
 * Billable work never precedes the policy recheck; a proposal version never
 * travels any other path; cancellation stops the run but keeps its history.
 */

export const researchRunSchema = z.strictObject({
  organizationId: z.string().uuid(),
  runId: z.string().uuid(),
  profileVersionId: z.string().uuid().nullable().default(null),
  /**
   * Resolved from the binding policy by the scheduler or route — never
   * defaulted here, because an evidence age is an operating limit (D06).
   */
  evidenceMaxAgeDays: z.number().int().positive().max(365),
  /**
   * What preparing the approved creative may spend: the platform-configured
   * dispatch figure in the admitting policy's currency, carried from the
   * trigger payload. Required here for the same reason as the evidence age —
   * the planner must copy it exactly, and the worker never invents it (D06).
   */
  preparationAllowance: z.strictObject({
    amountMinor: z.number().int().nonnegative().max(10_000_000),
    currency: z.string().regex(/^[A-Z]{3}$/),
  }),
  /** Measured external spend so far, in minor units. Never estimated. */
  externalCostMinor: z.number().int().nonnegative().default(0),
});
export type ResearchRunInput = z.input<typeof researchRunSchema>;

export type ResearchRunResult =
  | { status: "completed"; runId: string; proposalId: string | null; outcome: string }
  | { status: "already_claimed"; runId: string }
  | { status: "cancelled"; runId: string }
  | { status: "failed"; runId: string; failureCode: string };

export class ResearchClaimLost extends Error {
  constructor(readonly runId: string) {
    super(`Research run lost its claim: ${runId}`);
    this.name = "ResearchClaimLost";
  }
}

/** A scheduled firing is research about business evidence, not a new kind. */
function proposalSourceKind(triggerKind: string): CampaignProposalSourceKind {
  return triggerKind === "scheduled" ? "business_signal" : (triggerKind as CampaignProposalSourceKind);
}

// Structural match for Agent 2's landed
// src/modules/campaigns/infrastructure/question-deriver.ts
// (createQuestionDeriver / QuestionDerivationResult). Kept structural rather
// than imported type-only so application code keeps depending on ports, not
// adapters. Arrays are readonly on the way in because the trigger layer's
// loose wrapper types them that way; the service copies what it persists.
export type ResearchQuestionDeriver = {
  derive(input: {
    organizationId: string;
    triggerKind: string;
    source: ResearchSourceData;
    memory: PinnedResearchMemory;
    evidenceStatus: string;
    correlationId: string;
    /** Ordered GI picks for scope (Agent B optional input). */
    picks?: readonly { id: string; title: string; body: string }[];
    /** Context tier for scope (Agent B optional input). */
    tier?: string;
  }): Promise<{
    question: string;
    provenance: { sourceIds: readonly string[]; modelId: string; derivedAt: string };
    gaps: readonly string[];
  }>;
};

export type ResearchServiceDependencies = {
  runs: ResearchRunStore;
  contexts: ResearchContextReader;
  planner: ResearchPlanner;
  proposals: Pick<CampaignProposalService, "request" | "requestRevision">;
  subjectPack: Pick<SubjectPackPort, "consume">;
  now: () => Date;
  nowIso: () => string;
  isCancelled: () => boolean;
  /** Derives the scope question when the run was admitted without one. Optional so existing callers keep compiling. */
  questionDeriver?: ResearchQuestionDeriver;
  /** Metered (not blocking) model spend for the derivation call. Defaults to 0 when unknown. */
  derivationCostMinor?: number;
  /** Reads owned source data for derivation. Optional so old fakes keep compiling. */
  readSourceForDerivation?: (input: { organizationId: string }) => Promise<{
    organizationProfile: string;
    objectives: readonly string[];
    capacityNotes: readonly string[];
    operationalBlockers: readonly string[];
    hardConstraints: readonly string[];
  }>;
  /** Reads GI recommendation picks for derivation. Optional so old fakes keep compiling. */
  readRecommendationPicks?: (input: { organizationId: string }) => Promise<
    readonly {
      id: string;
      title: string;
      body: string;
      decision: string | null;
      helpful: boolean | null;
      updatedAt: string;
    }[]
  >;
};

const CLAIM_LEASE_SECONDS = 900;

/** DB check constraint on failure_code: free text, 1..120 chars. */
const PLANNER_FAILURE_MAX_LENGTH = 120;

/**
 * Failure-code format "<family>:<planner reason>" so the failure event names
 * the rule that tripped (D07 observability). The planner's reasonCode travels
 * verbatim (trimmed; anything outside [A-Za-z0-9_:-] becomes "_"), sliced so
 * the total stays within the 120-char column limit. A missing reason leaves
 * the bare family code.
 */
function plannerFailureCode(family: string, reasonCode: unknown): string {
  const raw = typeof reasonCode === "string" ? reasonCode.trim() : "";
  if (raw.length === 0) return family;
  const sanitized = raw.replace(/[^A-Za-z0-9_:-]/g, "_");
  return `${family}:${sanitized}`.slice(0, PLANNER_FAILURE_MAX_LENGTH);
}

export function createResearchService(dependencies: ResearchServiceDependencies) {
  async function failClaimed(input: {
    organizationId: string;
    runId: string;
    claimToken: string;
    actualCostMinor?: number;
    failureCode: string;
  }): Promise<ResearchRunResult> {
    await dependencies.runs.fail({
      organizationId: input.organizationId,
      runId: input.runId,
      claimToken: input.claimToken,
      actualCostMinor: input.actualCostMinor ?? 0,
      failureCode: input.failureCode,
    });
    return { status: "failed", runId: input.runId, failureCode: input.failureCode };
  }

  return {
    async run(raw: ResearchRunInput): Promise<ResearchRunResult> {
      const input = researchRunSchema.parse(raw);
      const { organizationId, runId } = input;

      const claim = await dependencies.runs.claim({
        organizationId,
        runId,
        leaseSeconds: CLAIM_LEASE_SECONDS,
      });
      if ("outcome" in claim) return { status: "already_claimed", runId };
      const base = {
        organizationId,
        runId,
        claimToken: claim.claimToken,
        externalCostMinor: input.externalCostMinor,
      };

      if (dependencies.isCancelled()) {
        await dependencies.runs.cancel({ organizationId, runId });
        return { status: "cancelled", runId };
      }

      // One claim-bound load: the run, the still-binding policy version, and
      // the admitted pin. A gone claim throws rather than retries — the run
      // is either cancelled or owned elsewhere, and neither wants a second
      // worker doing the same billable work.
      let loaded;
      try {
        loaded = await dependencies.runs.load({
          organizationId,
          runId,
          claimToken: claim.claimToken,
        });
      } catch {
        throw new ResearchClaimLost(runId);
      }

      // The policy that admitted this run must still bind it before any
      // further billable work. A revised policy stops work it never
      // authorized; the failure names that rather than hiding behind a
      // generic error.
      if (loaded.currentPolicyVersion !== claim.policyVersion) {
        return failClaimed({ ...base, failureCode: "policy_revised" });
      }

      // Runs admitted without a staged question derive their scope from
      // owned data instead of failing. The button press already authorized
      // spend within the binding policy; the scope comes from the pinned
      // manifest the admission approved, not from invention; and the human
      // gates stay downstream (proposal review, launch approval), untouched.
      let effectiveQuestion = loaded.researchQuestion;
      let derivationCostMinor = 0;
      if (effectiveQuestion === null) {
        // swarm-contract: mirror of question-context-tiers (Agent A not yet
        // landed — prefer the import when present). Inline copy MUST match:
        // rank planned>acknowledged>helpful-true>untouched, exclude
        // dismissed/snoozed, cap 6, ties newest-first.
        type MirrorPick = {
          id: string;
          title: string;
          body: string;
          decision: string | null;
          helpful: boolean | null;
          updatedAt: string;
        };
        const mirrorRank = (pick: MirrorPick): number => {
          if (pick.decision === "planned") return 0;
          if (pick.decision === "acknowledged") return 1;
          if ((pick.decision === null || pick.decision === undefined) && pick.helpful === true)
            return 2;
          if (pick.decision === "dismissed" || pick.decision === "snoozed") return -1;
          return 3;
        };
        const orderPicks = (picks: readonly MirrorPick[]): MirrorPick[] =>
          [...picks]
            .filter((pick) => mirrorRank(pick) >= 0)
            .sort((a, b) => {
              const rankDelta = mirrorRank(a) - mirrorRank(b);
              if (rankDelta !== 0) return rankDelta;
              if (a.updatedAt === b.updatedAt) return 0;
              return a.updatedAt < b.updatedAt ? 1 : -1;
            })
            .slice(0, 6);
        const selectTierMirror = (input: {
          memory: readonly { id: string; title: string | null; body: string | null }[];
          orderedPicks: readonly MirrorPick[];
          orgDetailCount: number;
          goalCount: number;
        }): { tier: string } => {
          const hasMemory = input.memory.some(
            (entry) => typeof entry.body === "string" && entry.body.trim().length > 0,
          );
          if (hasMemory) return { tier: "business_memory" };
          const hasInteracted = input.orderedPicks.some(
            (pick) =>
              pick.decision === "planned" ||
              pick.decision === "acknowledged" ||
              ((pick.decision === null || pick.decision === undefined) && pick.helpful === true),
          );
          if (hasInteracted) return { tier: "gi_interacted" };
          const hasUntouched = input.orderedPicks.some(
            (pick) =>
              (pick.decision === null || pick.decision === undefined) && pick.helpful !== true,
          );
          if (hasUntouched) return { tier: "gi_untouched" };
          if (input.orgDetailCount > 0) return { tier: "org_details" };
          if (input.goalCount > 0) return { tier: "goals" };
          return { tier: "none" };
        };
        const isClaimLostError = (error: unknown): boolean =>
          typeof error === "object" &&
          error !== null &&
          (error as { kind?: unknown }).kind === "not_found";
        // The full source read happens in contexts.read, which needs the
        // query first — so derivation works from the pinned manifest entries
        // and the trigger kind only, with an unprofiled fallback where the
        // deriver needs a full source shape. When the optional readers are
        // wired, the NULL path reads real org data + GI picks behind the
        // claim fence before deriving, instead of the hardcoded fallback.
        const fallbackSource: ResearchSourceData = {
          organizationProfile: "Unprofiled organization.",
          objectives: [],
          capacityNotes: [],
          operationalBlockers: [],
          hardConstraints: [],
        };
        let derivationSource: ResearchSourceData = fallbackSource;
        let picksRaw: readonly MirrorPick[] = [];
        try {
          const assertLive = (
            dependencies.runs as {
              assertClaimLive?: (input: {
                organizationId: string;
                runId: string;
                claimToken: string;
              }) => Promise<void>;
            }
          ).assertClaimLive;
          if (typeof assertLive === "function") {
            await assertLive({ organizationId, runId, claimToken: claim.claimToken });
          }
          if (dependencies.readSourceForDerivation) {
            derivationSource = await dependencies.readSourceForDerivation({ organizationId });
          }
          if (dependencies.readRecommendationPicks) {
            picksRaw = await dependencies.readRecommendationPicks({ organizationId });
          }
        } catch (error) {
          if (isClaimLostError(error)) throw new ResearchClaimLost(runId);
          derivationSource = fallbackSource;
          picksRaw = [];
        }
        const ordered = orderPicks(picksRaw);
        const orgDetailCount =
          (derivationSource.organizationProfile.trim().length > 0 ? 1 : 0) +
          derivationSource.capacityNotes.length +
          derivationSource.hardConstraints.length;
        const goalCount = derivationSource.objectives.length;
        const tierScope = selectTierMirror({
          memory: loaded.entries,
          orderedPicks: ordered,
          orgDetailCount,
          goalCount,
        });
        const derived = dependencies.questionDeriver
          ? await dependencies.questionDeriver.derive({
              organizationId,
              triggerKind: loaded.triggerKind,
              source: derivationSource,
              memory: {
                manifestId: loaded.manifestId ?? "",
                digest: loaded.digest ?? "",
                entries: loaded.entries,
                excludedCount: 0,
              },
              evidenceStatus: "unknown",
              correlationId: runId,
              picks: ordered.slice(0, 6).map((pick) => ({
                id: pick.id,
                title: pick.title,
                body: pick.body,
              })),
              tier: tierScope.tier,
            })
          : {
              question: "What campaign should we run next?",
              provenance: {
                sourceIds: [],
                modelId: "manual-question-fallback",
                derivedAt: dependencies.nowIso(),
              },
            };
        // The real store always provides this; the optionality is only for
        // older fakes. Deriving without a claim-bound save would plan from a
        // scope nobody owns, so a missing writer is a loud wiring bug, never
        // a silent skip.
        const saveDerived = dependencies.runs.saveDerivedQuestion;
        if (!saveDerived) {
          throw new Error("Research run store cannot persist a derived question");
        }
        try {
          await saveDerived({
            organizationId,
            runId,
            claimToken: claim.claimToken,
            derivedQuestion: derived.question,
            derivation: {
              sourceIds: [...derived.provenance.sourceIds],
              modelId: derived.provenance.modelId,
              derivedAt: derived.provenance.derivedAt,
            },
          });
        } catch (error) {
          if (
            typeof error === "object" &&
            error !== null &&
            (error as { kind?: unknown }).kind === "not_found"
          ) {
            throw new ResearchClaimLost(runId);
          }
          throw error;
        }
        effectiveQuestion = derived.question;
        // Metered, not blocking: the spend is carried into actualCost below.
        // The fallback asks nothing of a model, so it costs nothing even
        // when a derivation price is configured.
        derivationCostMinor = dependencies.questionDeriver
          ? (dependencies.derivationCostMinor ?? 0)
          : 0;
      }

      const context = await dependencies.contexts.read({
        organizationId,
        runId,
        // Carried so the reader can prove the claim before it reads anything
        // on the service client, which bypasses RLS.
        claim: { runId, claimToken: claim.claimToken },
        query: effectiveQuestion,
        evidenceMaxAgeDays: input.evidenceMaxAgeDays,
        profileVersionId: input.profileVersionId,
        now: dependencies.now(),
        // The admitted pin, never re-derived: assembling fresh context at
        // run time could only produce something the admission never approved.
        pinned: {
          manifestId: loaded.manifestId ?? "",
          digest: loaded.digest ?? "",
          entries: loaded.entries,
          excludedCount: 0,
        },
      });

      if (dependencies.isCancelled()) {
        await dependencies.runs.cancel({ organizationId, runId });
        return { status: "cancelled", runId };
      }

      const planned = await dependencies.planner.plan({
        organizationId,
        runId,
        query: effectiveQuestion,
        triggerKind: loaded.triggerKind,
        context,
        preparationAllowance: input.preparationAllowance,
      });
      // An unpriced model call follows the generation precedent: measured
      // external spend is kept, and the unmeasured part adds nothing rather
      // than a guess. Refused drafts carry their measured cost too, so a
      // failure never hides what it spent.
      const actualCost =
        input.externalCostMinor + derivationCostMinor + (planned.modelCostMinor ?? 0);

      // The admitted pin was used for planning, so it is consumed with the
      // planner's identity. A dangling pin fails the run rather than silently
      // leaking an unconsumed manifest. Runs admitted without a pin consume
      // nothing: there is no manifest to leak.
      if (loaded.manifestId !== null) {
        try {
          await dependencies.subjectPack.consume({
            organizationId,
            manifestId: loaded.manifestId,
            modelId: `campaign-research-planner-v${RESEARCH_PLANNER_PROMPT_VERSION}`,
            modelCalledAt: dependencies.nowIso(),
          });
        } catch {
          return failClaimed({
            ...base,
            actualCostMinor: actualCost,
            failureCode: "context_consume_failed",
          });
        }
      }

      if (planned.outcome === "advice") {
        try {
          await dependencies.runs.complete({
            organizationId,
            runId,
            claimToken: claim.claimToken,
            proposalId: null,
            contextManifestId: loaded.manifestId,
            contextDigest: loaded.digest,
            qualifiedResearchRequestIds: [],
            actualCostMinor: actualCost,
            outcome: "advice_only",
          });
        } catch {
          throw new ResearchClaimLost(runId);
        }
        return { status: "completed", runId, proposalId: null, outcome: "advice_only" };
      }

      if (planned.outcome !== "ready") {
        // Forbidden carries no planner reasonCode, so it stays bare; every
        // other non-ready planner outcome names its reason after the colon.
        const failureCode =
          planned.outcome === "forbidden"
            ? "proposal_forbidden"
            : plannerFailureCode("proposal_inadmissible", planned.reasonCode);
        return failClaimed({ ...base, actualCostMinor: actualCost, failureCode });
      }

      // The proposal itself is opened and revised through the governed
      // writer only. Research never writes a version any other way, and a
      // decided proposal refuses the write inside the transaction.
      // The claim travels with the write. The worker has no standing authority
      // to open a proposal -- it has the authority of this run, for as long as
      // it still holds the lease, and the database checks that rather than
      // trusting that a service identity is calling.
      const draftClaim = { runId, claimToken: claim.claimToken };
      const opened = await dependencies.proposals.request({
        organizationId,
        request: {
          sourceKind: proposalSourceKind(loaded.triggerKind),
          sourceId: null,
          dedupeFingerprint: null,
          claim: draftClaim,
        },
      });
      if (opened.status !== "saved" && opened.status !== "replayed") {
        return failClaimed({ ...base, actualCostMinor: actualCost, failureCode: "proposal_unavailable" });
      }

      const revised = await dependencies.proposals.requestRevision({
        organizationId,
        request: {
          proposalId: opened.value.proposalId,
          document: planned.document,
          sourceRevisionManifest: planned.sourceRevisionManifest,
          marketClaimKeys: [...planned.marketClaimKeys],
          claim: draftClaim,
        },
      });
      if (revised.status !== "saved") {
        const failureCode =
          revised.status === "forbidden" ? "proposal_forbidden" : "proposal_inadmissible";
        return failClaimed({ ...base, actualCostMinor: actualCost, failureCode });
      }

      try {
        await dependencies.runs.complete({
          organizationId,
          runId,
          claimToken: claim.claimToken,
          proposalId: opened.value.proposalId,
          contextManifestId: loaded.manifestId,
          contextDigest: loaded.digest,
          qualifiedResearchRequestIds: evidenceRequestIds(context),
          actualCostMinor: actualCost,
          outcome: "proposal_prepared",
        });
      } catch {
        // The proposal version is saved and reviewable; only the run
        // bookkeeping is lost. Throwing (rather than failing) tells the
        // worker not to retry work that already landed.
        throw new ResearchClaimLost(runId);
      }
      return {
        status: "completed",
        runId,
        proposalId: opened.value.proposalId,
        outcome: "proposal_prepared",
      };
    },
  };
}

export type ResearchService = ReturnType<typeof createResearchService>;

function evidenceRequestIds(context: ResearchContext): string[] {
  if (context.evidence.status !== "qualified") return [];
  return [context.evidence.requestId];
}

export type { ProposalOutcome, ProposalVersionResult };
