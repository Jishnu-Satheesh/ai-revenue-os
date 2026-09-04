import { z } from "zod";

import type { MarketProfileDocumentV1 } from "@/domain/growth-intelligence/types";
import { DomainError } from "@/lib/errors";
import type {
  SynthesisProfileContext,
  SynthesisServiceResult,
  SynthesizeInput,
} from "@/modules/growth-intelligence/application/synthesis-service";

/**
 * The synthesis worker.
 *
 * Same shape as the market research worker, for the same reason: claim a
 * lease, reload every authority under it, compute through the injected
 * synthesis service, and hand the result to fenced database functions that
 * check every rule again. The worker is not the authority on what may be
 * persisted as intelligence.
 *
 * Deterministic refusals (unknown request, disabled profile, unsupported
 * kind, invalid candidates) return without throwing. Transient failures
 * (dropped connections, unexpected provider throws) propagate so Trigger
 * redelivers under the same claim token.
 */

export const synthesisPayloadSchema = z
  .object({
    organizationId: z.string().uuid(),
    requestId: z.string().uuid(),
    correlationId: z.string().uuid(),
  })
  .strict();

export type SynthesisPayload = z.infer<typeof synthesisPayloadSchema>;

export type SynthesisRequestView = {
  id: string;
  organizationId: string;
  branchId: string | null;
  channelId: string | null;
  kind: string;
  triggerReason: string;
  businessEvidenceDigest: string | null;
  marketProfileVersionId: string;
  sourcePolicyDigest: string;
  researchRuleVersion: string;
  localTimeBucket: string;
  correlationId: string;
};

export type ApprovedSynthesisProfileView = {
  versionId: string;
  digest: string;
  document: MarketProfileDocumentV1;
  sourcePolicyDigest: string;
  enabled: boolean;
};

export type SynthesisRequestOperations = {
  claim(input: {
    organizationId: string;
    requestId: string;
    claimToken: string;
    leaseSeconds: number;
  }): Promise<{ outcome: string; replayed: boolean }>;
  complete(input: {
    organizationId: string;
    requestId: string;
    claimToken: string;
  }): Promise<{ outcome: string }>;
  fail(input: {
    organizationId: string;
    requestId: string;
    claimToken: string;
    safeFailureCode: string;
  }): Promise<{ outcome: string }>;
  load(input: { organizationId: string; requestId: string }): Promise<SynthesisRequestView | null>;
};

export type SynthesisProfileReader = {
  readCurrent(input: { organizationId: string }): Promise<ApprovedSynthesisProfileView | null>;
};

export type SynthesisRunner = (input: SynthesizeInput) => Promise<SynthesisServiceResult>;

export type SynthesisDependencies = {
  requests: SynthesisRequestOperations;
  profiles: SynthesisProfileReader;
  synthesize: SynthesisRunner;
  newClaimToken?: () => string;
  signal?: AbortSignal;
};

export type SynthesisResult =
  | { outcome: "synthesized"; runId: string; itemCount: number }
  | { outcome: "replayed"; runId: string }
  | { outcome: "failed"; code: string; runId: string | null }
  | { outcome: "not_acquired"; claimOutcome: string }
  | { outcome: "claim_lost" }
  | { outcome: "cancelled" };

export const SYNTHESIS_LEASE_SECONDS = 600;

// business_evidence_changed carries new monthly business evidence;
// weekly_synthesis carries the weekly consolidation. Research and
// reassessment kinds belong to the market research worker, and profile
// discovery belongs to the Market Profile proposal flow.
const SYNTHESIS_KINDS = new Set(["business_evidence_changed", "weekly_synthesis"]);

function profileContext(document: MarketProfileDocumentV1): SynthesisProfileContext {
  const city = document.geographies.find((geography) => geography.layer === "city");
  const country = document.geographies.find((geography) => geography.layer === "country");
  const location = city ?? country;
  if (!location || !("countryCode" in location)) {
    throw new DomainError("DOMAIN_ERROR", "The approved profile has no usable city or country.");
  }
  return {
    approvedName: document.publicIdentity.approvedName,
    niches: document.nicheDescriptors,
    geographies: document.geographies.map((geography) => ({
      layer: geography.layer,
      ref: geography.locationRef,
      name: geography.name,
    })),
    topics: document.topics.map((topic) => topic.label),
  };
}

export async function runSynthesis(
  input: unknown,
  dependencies: SynthesisDependencies,
): Promise<SynthesisResult> {
  const payload = synthesisPayloadSchema.parse(input);
  const newClaimToken = dependencies.newClaimToken ?? (() => crypto.randomUUID());

  if (dependencies.signal?.aborted) return { outcome: "cancelled" };

  const claimToken = newClaimToken();
  const claim = await dependencies.requests.claim({
    organizationId: payload.organizationId,
    requestId: payload.requestId,
    claimToken,
    leaseSeconds: SYNTHESIS_LEASE_SECONDS,
  });
  if (claim.outcome !== "acquired") {
    return { outcome: "not_acquired", claimOutcome: claim.outcome };
  }

  const failRequest = async (code: string): Promise<SynthesisResult> => {
    await dependencies.requests.fail({
      organizationId: payload.organizationId,
      requestId: payload.requestId,
      claimToken,
      safeFailureCode: code,
    });
    return { outcome: "failed", code, runId: null };
  };

  const [request, profile] = await Promise.all([
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
  if (!SYNTHESIS_KINDS.has(request.kind)) return failRequest("REQUEST_KIND_UNSUPPORTED");

  let context: SynthesisProfileContext;
  try {
    context = profileContext(profile.document);
  } catch {
    return failRequest("PROFILE_CONTEXT_INVALID");
  }

  let serviceResult: SynthesisServiceResult;
  try {
    serviceResult = await dependencies.synthesize({
      organizationId: payload.organizationId,
      requestId: payload.requestId,
      claimToken,
      channelId: request.channelId,
      profileVersionId: profile.versionId,
      profile: context,
      preferences: { pinnedRefs: [] },
      correlationId: payload.correlationId,
    });
  } catch (error) {
    if (error instanceof DomainError && error.code === "INTEGRATION_ERROR") {
      return failRequest("SYNTHESIS_MODEL_UNAVAILABLE");
    }
    throw error;
  }

  if (serviceResult.outcome === "failed") {
    await dependencies.requests.fail({
      organizationId: payload.organizationId,
      requestId: payload.requestId,
      claimToken,
      safeFailureCode: serviceResult.code,
    });
    return { outcome: "failed", code: serviceResult.code, runId: serviceResult.runId };
  }

  const completion = await dependencies.requests.complete({
    organizationId: payload.organizationId,
    requestId: payload.requestId,
    claimToken,
  });
  if (completion.outcome !== "completed") return { outcome: "claim_lost" };

  if (serviceResult.outcome === "replayed") {
    return { outcome: "replayed", runId: serviceResult.runId };
  }
  return {
    outcome: "synthesized",
    runId: serviceResult.runId,
    itemCount: serviceResult.itemCount,
  };
}
