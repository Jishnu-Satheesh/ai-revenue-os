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
  triggerKind: z.enum(["business_signal", "scheduled", "manual_request", "next_test"]),
  query: z.string().trim().min(1).max(2000),
  profileVersionId: z.string().uuid().nullable().default(null),
  evidenceMaxAgeDays: z.number().int().positive().max(365).default(30),
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
function proposalSourceKind(
  triggerKind: ResearchRunInput["triggerKind"],
): CampaignProposalSourceKind {
  return triggerKind === "scheduled" ? "business_signal" : triggerKind;
}

export type ResearchServiceDependencies = {
  runs: ResearchRunStore;
  /** The binding policy version, read worker-side (no member session). */
  policies: {
    readCurrentVersion(input: { organizationId: string }): Promise<number | null>;
  };
  contexts: ResearchContextReader;
  planner: ResearchPlanner;
  proposals: Pick<CampaignProposalService, "request" | "requestRevision">;
  subjectPack: Pick<SubjectPackPort, "consume">;
  now: () => Date;
  nowIso: () => string;
  isCancelled: () => boolean;
};

const CLAIM_LEASE_SECONDS = 3600;

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

      // The policy that admitted this run must still bind it before any
      // further billable work. A revised policy stops work it never
      // authorized; the failure names that rather than hiding behind a
      // generic error.
      const currentVersion = await dependencies.policies.readCurrentVersion({ organizationId });
      if (currentVersion !== claim.policyVersion) {
        return failClaimed({ ...base, failureCode: "policy_revised" });
      }

      const context = await dependencies.contexts.read({
        organizationId,
        runId,
        query: input.query,
        evidenceMaxAgeDays: input.evidenceMaxAgeDays,
        profileVersionId: input.profileVersionId,
        now: dependencies.now(),
      });

      if (dependencies.isCancelled()) {
        await dependencies.runs.cancel({ organizationId, runId });
        return { status: "cancelled", runId };
      }

      const planned = await dependencies.planner.plan({
        organizationId,
        runId,
        query: input.query,
        triggerKind: input.triggerKind,
        context,
      });
      // An unpriced model call follows the generation precedent: measured
      // external spend is kept, and the unmeasured part adds nothing rather
      // than a guess. Refused drafts carry their measured cost too, so a
      // failure never hides what it spent.
      const actualCost = input.externalCostMinor + (planned.modelCostMinor ?? 0);

      // The manifest was prepared and used for planning, so it is consumed
      // with the planner's identity. A dangling pin fails the run rather
      // than silently leaking an unconsumed manifest.
      try {
        await dependencies.subjectPack.consume({
          organizationId,
          manifestId: context.memory.manifestId,
          modelId: `campaign-research-planner-v${RESEARCH_PLANNER_PROMPT_VERSION}`,
          modelCalledAt: dependencies.nowIso(),
        });
      } catch {
        return failClaimed({ ...base, actualCostMinor: actualCost, failureCode: "context_consume_failed" });
      }

      if (planned.outcome === "advice") {
        try {
          await dependencies.runs.complete({
            organizationId,
            runId,
            claimToken: claim.claimToken,
            proposalId: null,
            contextManifestId: context.memory.manifestId,
            contextDigest: context.memory.digest,
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
      const opened = await dependencies.proposals.request({
        organizationId,
        request: {
          sourceKind: proposalSourceKind(input.triggerKind),
          sourceId: null,
          dedupeFingerprint: null,
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
          contextManifestId: planned.memoryContextManifestId,
          contextDigest: context.memory.digest,
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
