import { z } from "zod";

import type { CampaignProposalSourceKind } from "@/domain/campaigns/proposal";
import type {
  CampaignProposalService,
  ProposalOutcome,
  ProposalVersionResult,
} from "@/modules/campaigns/application/proposal-service";
import type {
  ResearchContext,
  ResearchContextReader,
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
    source: unknown;
    memory: unknown;
    evidenceStatus: string;
    correlationId: string;
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
};

const CLAIM_LEASE_SECONDS = 900;

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
        // The full source read happens in contexts.read, which needs the
        // query first — so derivation works from the pinned manifest entries
        // and the trigger kind only, with an unprofiled fallback where the
        // deriver needs a full source shape.
        const derived = dependencies.questionDeriver
          ? await dependencies.questionDeriver.derive({
              organizationId,
              triggerKind: loaded.triggerKind,
              source: {
                organizationProfile: "Unprofiled organization.",
                objectives: [],
                capacityNotes: [],
                operationalBlockers: [],
                hardConstraints: [],
              },
              memory: {
                manifestId: loaded.manifestId ?? "",
                digest: loaded.digest ?? "",
                entries: loaded.entries,
                excludedCount: 0,
              },
              evidenceStatus: "unknown",
              correlationId: runId,
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
        const failureCode =
          planned.outcome === "forbidden" ? "proposal_forbidden" : "proposal_inadmissible";
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
