import { z } from "zod";

import { createGrowthIntelligenceRequestFingerprint } from "@/domain/growth-intelligence/request-fingerprint";
import type {
  ApprovedMarketProfileView,
  GrowthIntelligenceRequestView,
  MarketResearchClaim,
  MarketResearchProfiles,
} from "@/workflows/growth-intelligence/run-market-research";

/**
 * The weekly consolidation worker.
 *
 * Consolidation derives the current-state rollup for one weekly synthesis
 * request and enqueues evidence reassessment when sources expired, were
 * excluded or withdrawn, or materially changed. It never rewrites history:
 * expiry, withdrawal, exclusion, and supersession are appended as claim
 * events by the reassessment research run that owns its own claim token, not
 * by this worker borrowing another request's lease.
 */

export const consolidationPayloadSchema = z
  .object({
    organizationId: z.string().uuid(),
    requestId: z.string().uuid(),
    correlationId: z.string().uuid(),
  })
  .strict();

export type ConsolidationPayload = z.infer<typeof consolidationPayloadSchema>;

export type ConsolidationState = {
  currentClaimCount: number;
  expiredCount: number;
  excludedCount: number;
  withdrawnCount: number;
  changedCount: number;
};

export type ConsolidationStateLoader = {
  load(input: {
    organizationId: string;
    profileVersionId: string;
    localTimeBucket: string;
  }): Promise<ConsolidationState>;
};

export type ConsolidationDependencies = {
  requests: MarketResearchClaim;
  profiles: MarketResearchProfiles;
  state: ConsolidationStateLoader;
  now?: () => Date;
  newClaimToken?: () => string;
  signal?: AbortSignal;
};

export type ConsolidationResult =
  | {
      outcome: "consolidated";
      requestId: string;
      currentClaimCount: number;
      reassessmentEnqueued: boolean;
    }
  | { outcome: "failed"; code: string }
  | { outcome: "not_acquired"; claimOutcome: string }
  | { outcome: "claim_lost" }
  | { outcome: "cancelled" };

const CONSOLIDATION_LEASE_SECONDS = 600;
const RESEARCH_RULE_VERSION = "market-research@1";

export async function consolidateMarketEvidence(
  input: unknown,
  dependencies: ConsolidationDependencies,
): Promise<ConsolidationResult> {
  const payload = consolidationPayloadSchema.parse(input);
  const now = dependencies.now ?? (() => new Date());
  const newClaimToken = dependencies.newClaimToken ?? (() => crypto.randomUUID());

  if (dependencies.signal?.aborted) return { outcome: "cancelled" };

  const claimToken = newClaimToken();
  const claim = await dependencies.requests.claim({
    organizationId: payload.organizationId,
    requestId: payload.requestId,
    claimToken,
    leaseSeconds: CONSOLIDATION_LEASE_SECONDS,
  });
  if (claim.outcome !== "acquired") {
    return { outcome: "not_acquired", claimOutcome: claim.outcome };
  }

  const failRequest = async (code: string): Promise<ConsolidationResult> => {
    await dependencies.requests.fail({
      organizationId: payload.organizationId,
      requestId: payload.requestId,
      claimToken,
      safeFailureCode: code,
    });
    return { outcome: "failed", code };
  };

  const [request, profile]: [
    GrowthIntelligenceRequestView | null,
    ApprovedMarketProfileView | null,
  ] = await Promise.all([
    dependencies.requests.load({
      organizationId: payload.organizationId,
      requestId: payload.requestId,
    }),
    dependencies.profiles.readCurrent({ organizationId: payload.organizationId }),
  ]);

  if (!request) return failRequest("REQUEST_CONTEXT_UNAVAILABLE");
  if (!profile || !profile.enabled) {
    return failRequest(!profile ? "PROFILE_UNAVAILABLE" : "PROFILE_DISABLED");
  }
  if (
    profile.versionId !== request.marketProfileVersionId ||
    profile.sourcePolicyDigest !== request.sourcePolicyDigest
  ) {
    return failRequest("PROFILE_VERSION_CHANGED");
  }
  if (request.kind !== "weekly_synthesis") return failRequest("REQUEST_KIND_UNSUPPORTED");
  if (dependencies.signal?.aborted) return failRequest("WORKER_CANCELLED");

  const state = await dependencies.state.load({
    organizationId: payload.organizationId,
    profileVersionId: profile.versionId,
    localTimeBucket: request.localTimeBucket,
  });

  const needsReassessment =
    state.expiredCount > 0 ||
    state.excludedCount > 0 ||
    state.withdrawnCount > 0 ||
    state.changedCount > 0;

  let reassessmentEnqueued = false;
  if (needsReassessment) {
    try {
      const triggerReason = state.expiredCount > 0 ? "evidence_expired" : "source_changed";
      const fingerprint = createGrowthIntelligenceRequestFingerprint({
        organizationId: payload.organizationId,
        branchId: request.branchId,
        channelId: request.channelId,
        kind: "evidence_reassessment",
        triggerReason,
        businessEvidenceDigest: request.businessEvidenceDigest,
        marketProfileVersionId: profile.versionId,
        sourcePolicyDigest: profile.sourcePolicyDigest,
        researchRuleVersion: RESEARCH_RULE_VERSION,
        localTimeBucket: "immediate",
        synthesisVersionTuple: null,
        playbookVersionTuple: null,
      });
      await dependencies.requests.enqueue({
        organizationId: payload.organizationId,
        request: {
          organizationId: payload.organizationId,
          branchId: request.branchId,
          channelId: request.channelId,
          kind: "evidence_reassessment",
          triggerReason,
          businessEvidenceDigest: request.businessEvidenceDigest,
          marketProfileVersionId: profile.versionId,
          sourcePolicyDigest: profile.sourcePolicyDigest,
          researchRuleVersion: RESEARCH_RULE_VERSION,
          localTimeBucket: "immediate",
          synthesisVersionTuple: null,
          playbookVersionTuple: null,
          requestFingerprint: fingerprint,
          dueAt: now().toISOString(),
          correlationId: payload.correlationId,
          requestedBy: null,
        },
      });
      reassessmentEnqueued = true;
    } catch {
      reassessmentEnqueued = false;
    }
  }

  const completion = await dependencies.requests.complete({
    organizationId: payload.organizationId,
    requestId: payload.requestId,
    claimToken,
  });
  if (completion.outcome !== "completed") return { outcome: "claim_lost" };

  return {
    outcome: "consolidated",
    requestId: payload.requestId,
    currentClaimCount: state.currentClaimCount,
    reassessmentEnqueued,
  };
}
