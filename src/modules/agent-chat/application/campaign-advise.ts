import { z } from "zod";

import { DomainError } from "@/lib/errors";
import { buildThreadIdempotencyKey } from "@/modules/agent-chat/application/thread-keys";

/**
 * Campaign advice handoff (spec section 11: `Draft advice for your review`).
 *
 * Pure orchestration over injected seams — no provider code, no live calls,
 * no `node:` imports (this module stays client-importable, like the
 * executors). The drawer tab renders advice with citations, the exact
 * evidence window, limitations, and cost/impact inputs labeled as estimates
 * with their assumptions on the same surface.
 *
 * Eligibility is deterministic: `campaign.create` permission plus qualifying
 * readiness (evidence snapshot freezable, Market Profile bound,
 * policy/capability/schedule/audience checks pass). Eligible admits one
 * atomic `request_campaign_draft_from_opportunity`-family draft request
 * (claim/lease, frozen evidence snapshot, idempotency key) and links
 * thread → request → campaign through the Task 1 `set_thread_links` seam.
 * Ineligible resolves to a pre-filled `/campaigns/new` brief through the
 * same pipeline Decision Engine opportunities enter. No silent upgrade:
 * the brief path never touches the draft seams and always names its
 * reason codes.
 *
 * FENCES (binding): draft creation is never approval, never publishes,
 * never spends or reserves, never moves money. This module exposes only
 * two seams — `drafts.requestDraft` (admit or replay one governed draft
 * request) and `links.setThreadLinks` (thread → draft-request link). There
 * is no approve seam, no publish seam, no spend seam, and no money-moving
 * seam to call. Approval binds one exact Bundle version plus digest in
 * Studio/Telegram review; material edits invalidate approval and require a
 * new version (see `fingerprintAdviceDraft` / `isMaterialAdviceChange`).
 */

export const CAMPAIGN_DRAFT_ACTION_KEY = "campaign.governed_draft_v1";

// ---------------------------------------------------------------------------
// Advice input (Zod at the boundary)
// ---------------------------------------------------------------------------

const assertionSchema = z
  .object({
    key: z.string().trim().min(1).max(200),
    expectedOutcome: z.string().trim().min(1).max(200),
  })
  .strict();

const evidenceSnapshotSchema = z
  .object({
    /** Exact evidence window the advice cites (branch timezone rendering is the drawer's job). */
    windowDays: z.union([z.literal(30), z.literal(60)]),
    observedAt: z.string().datetime({ offset: true }),
    digest: z.string().trim().min(1).max(256),
    citations: z.array(z.string().trim().min(1).max(500)).min(1).max(50),
  })
  .strict();

export type CampaignEvidenceSnapshot = z.infer<typeof evidenceSnapshotSchema>;

const marketProfilePointerSchema = z
  .object({
    versionId: z.string().trim().min(1).max(200),
    digest: z.string().trim().min(1).max(256),
  })
  .strict();

export const campaignEstimateSchema = z
  .object({
    /** Forward-looking number, e.g. "+AED 4,000 gross profit / week". Never a realized result. */
    valueText: z.string().trim().min(1).max(240),
    /** Cited inputs, shown next to the number on the same surface. */
    inputs: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
    /** Stated assumptions, shown next to the number on the same surface. */
    assumptions: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
  })
  .strict();

export type CampaignEstimate = z.infer<typeof campaignEstimateSchema>;

const threadLinkPointerSchema = z
  .object({
    projectId: z.string().trim().min(1).max(200).optional(),
    requestId: z.string().trim().min(1).max(200).optional(),
    campaignId: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export type ThreadLinkPointers = z.infer<typeof threadLinkPointerSchema>;

export const adviseCampaignInputSchema = z
  .object({
    organizationId: z.string().trim().min(1).max(200),
    actorId: z.string().trim().min(1).max(200),
    threadId: z.string().trim().min(1).max(200),
    /** Precomputed digest; derived from thread + objective + audience when absent. */
    messageDigest: z.string().trim().min(1).max(200).optional(),
    /** Caller-derived grants, never client claims — the route recomputes these from the role. */
    permissions: z.array(z.string().trim().min(1).max(120)).default([]),
    /** Opportunity binding the draft request admits. Null advice has no draft path. */
    opportunity: z
      .object({
        id: z.string().trim().min(1).max(200),
        version: z.number().int().positive(),
      })
      .strict()
      .nullable()
      .default(null),
    objective: z.string().trim().min(1).max(500),
    audience: z.string().trim().min(1).max(500),
    assertions: z.array(assertionSchema).min(1).max(50),
    evidenceSnapshot: evidenceSnapshotSchema,
    /** The snapshot the worker must freeze can be captured verbatim. */
    evidenceSnapshotFreezable: z.boolean(),
    /** Bound Market Profile version + digest; null means unbound. */
    marketProfile: marketProfilePointerSchema.nullable().default(null),
    policyPass: z.boolean(),
    capabilityPass: z.boolean(),
    schedulePass: z.boolean(),
    audienceReady: z.boolean(),
    estimate: campaignEstimateSchema,
    correlationId: z.string().trim().min(1).max(200).optional(),
    /**
     * Sibling link ids already on the thread (research project, request,
     * campaign). The `set_thread_links` RPC overwrites all four columns,
     * so the handoff forwards these alongside the new draft-request id —
     * posting the draft id alone would silently wipe the thread →
     * research chain.
     */
    existingLinks: threadLinkPointerSchema.optional(),
  })
  .strict();

export type AdviseCampaignInput = z.infer<typeof adviseCampaignInputSchema>;

// ---------------------------------------------------------------------------
// Reason codes (closed vocabulary — deterministic eligibility)
// ---------------------------------------------------------------------------

export const CAMPAIGN_ADVICE_REASON_CODES = [
  "CAMPAIGN_REQUIRES_CREATE",
  "ADVICE_NO_OPPORTUNITY",
  "EVIDENCE_NOT_FREEZABLE",
  "PROFILE_UNBOUND",
  "POLICY_BLOCKED",
  "CAPABILITY_BLOCKED",
  "SCHEDULE_BLOCKED",
  "AUDIENCE_NOT_READY",
] as const;

export type CampaignAdviceReasonCode = (typeof CAMPAIGN_ADVICE_REASON_CODES)[number];

/**
 * Deterministic eligibility inputs and nothing else: the `campaign.create`
 * grant plus qualifying readiness (evidence snapshot freezable, Market
 * Profile bound, policy/capability/schedule/audience checks pass) plus an
 * opportunity to admit the request against. No model text, no prompt
 * wording, no hidden state.
 */
export function checkCampaignAdviceEligibility(
  input: Pick<
    AdviseCampaignInput,
    | "permissions"
    | "opportunity"
    | "evidenceSnapshotFreezable"
    | "marketProfile"
    | "policyPass"
    | "capabilityPass"
    | "schedulePass"
    | "audienceReady"
  >,
): { eligible: boolean; reasonCodes: CampaignAdviceReasonCode[] } {
  // Permission first: without `campaign.create` nothing else is evaluated,
  // and the refusal names the grant so the drawer can say so honestly.
  if (!input.permissions.includes("campaign.create")) {
    return { eligible: false, reasonCodes: ["CAMPAIGN_REQUIRES_CREATE"] };
  }
  const reasonCodes: CampaignAdviceReasonCode[] = [];
  if (!input.opportunity) reasonCodes.push("ADVICE_NO_OPPORTUNITY");
  if (!input.evidenceSnapshotFreezable) reasonCodes.push("EVIDENCE_NOT_FREEZABLE");
  if (!input.marketProfile) reasonCodes.push("PROFILE_UNBOUND");
  if (!input.policyPass) reasonCodes.push("POLICY_BLOCKED");
  if (!input.capabilityPass) reasonCodes.push("CAPABILITY_BLOCKED");
  if (!input.schedulePass) reasonCodes.push("SCHEDULE_BLOCKED");
  if (!input.audienceReady) reasonCodes.push("AUDIENCE_NOT_READY");
  return { eligible: reasonCodes.length === 0, reasonCodes };
}

// ---------------------------------------------------------------------------
// Estimate labeling (forward-looking estimate, never a realized result)
// ---------------------------------------------------------------------------

export type LabeledCampaignEstimate = CampaignEstimate & {
  kind: "estimate";
  /** Fixed surface label. A realized-result claim needs baseline + attribution + window instead. */
  label: "Estimate";
};

/**
 * Labels a cost/impact number as the estimate it is, keeping its inputs
 * and assumptions on the same object so the drawer can render them on the
 * same surface. Realized-result claims (baseline + attribution method +
 * measurement window) are forbidden here — this function cannot produce one.
 */
export function labelCampaignEstimate(estimate: CampaignEstimate): LabeledCampaignEstimate {
  const parsed = campaignEstimateSchema.parse(estimate);
  return { ...parsed, kind: "estimate", label: "Estimate" };
}

// ---------------------------------------------------------------------------
// Frozen evidence snapshot (verbatim copy + digest, never a live reference)
// ---------------------------------------------------------------------------

export type FrozenEvidenceSnapshot = {
  snapshot: CampaignEvidenceSnapshot;
  digest: string;
  frozenAt: string;
};

/**
 * Freezes the cited evidence bundle verbatim: a deep copy stamped with the
 * freeze time, carrying its digest for audit. The draft worker freezes the
 * same bundle server-side; this copy is what the thread → request →
 * campaign audit chain cites.
 */
export function freezeEvidenceSnapshot(
  snapshot: CampaignEvidenceSnapshot,
  now: Date = new Date(),
): FrozenEvidenceSnapshot {
  const parsed = evidenceSnapshotSchema.parse(snapshot);
  const copy: CampaignEvidenceSnapshot = {
    windowDays: parsed.windowDays,
    observedAt: parsed.observedAt,
    digest: parsed.digest,
    citations: [...parsed.citations],
  };
  return {
    snapshot: copy,
    digest: parsed.digest,
    frozenAt: now.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Marker receipts: requested → claimed → draft-ready + Campaign Bundle link
// ---------------------------------------------------------------------------

export const CAMPAIGN_MARKER_STAGES = ["requested", "claimed", "draft-ready"] as const;

export type CampaignMarkerStage = (typeof CAMPAIGN_MARKER_STAGES)[number];

export type CampaignMarkerReceipt = {
  stage: CampaignMarkerStage;
  state: "done" | "active" | "pending";
  label: string;
};

const CAMPAIGN_MARKER_LABELS: Record<CampaignMarkerStage, string> = {
  requested: "Requested",
  claimed: "Claimed",
  "draft-ready": "Draft ready",
};

export function buildCampaignMarkerReceipts(current: CampaignMarkerStage): CampaignMarkerReceipt[] {
  if (!(CAMPAIGN_MARKER_STAGES as readonly string[]).includes(current)) {
    throw new DomainError("VALIDATION_ERROR", "Please check the submitted fields.");
  }
  const currentIndex = CAMPAIGN_MARKER_STAGES.indexOf(current);
  return CAMPAIGN_MARKER_STAGES.map((stage, index) => ({
    stage,
    state: index < currentIndex ? "done" : index === currentIndex ? "active" : "pending",
    label: CAMPAIGN_MARKER_LABELS[stage],
  }));
}

/**
 * Campaign Bundle review link. The campaign id is unknown until the worker
 * completes the draft, so the link targets the campaign list with the draft
 * request id carried in the receipt payload beside the href — no invented
 * deep-link params. Once the campaign exists the href points at it.
 */
export function campaignBundleLink(
  organizationId: string,
  ref?: { draftRequestId?: string; campaignId?: string | null },
): {
  href: string;
  ref: { draftRequestId: string | null; campaignId: string | null };
} {
  const org = z.string().trim().min(1).max(200).parse(organizationId);
  const campaignId = ref?.campaignId ?? null;
  return {
    href: campaignId
      ? `/organizations/${org}/campaigns/${campaignId}`
      : `/organizations/${org}/campaigns`,
    ref: {
      draftRequestId: ref?.draftRequestId ?? null,
      campaignId,
    },
  };
}

// ---------------------------------------------------------------------------
// Material edits invalidate (approval binds one exact Bundle version)
// ---------------------------------------------------------------------------

const adviceFingerprintSourceSchema = z
  .object({
    objective: z.string().trim().min(1).max(500),
    audience: z.string().trim().min(1).max(500),
    assertions: z.array(assertionSchema).min(1).max(50),
    evidenceDigest: z.string().trim().min(1).max(256),
  })
  .strict();

/**
 * Stable 16-hex fingerprint over the advice a draft request was admitted
 * with. Pure arithmetic (the same mixing as the thread digests) so this
 * module stays client-importable.
 */
export function fingerprintAdviceDraft(input: unknown): string {
  const parsed = adviceFingerprintSourceSchema.parse(input);
  const text = JSON.stringify(parsed);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const char = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ char, 2654435761);
    h2 = Math.imul(h2 ^ char, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(16).padStart(8, "0")}${(h1 >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Material edits invalidate: any change to objective, audience,
 * assertions, or the evidence digest means the admitted draft no longer
 * describes the advice on screen. The drawer must ask for a fresh request
 * instead of pointing at the stale one.
 */
export function isMaterialAdviceChange(previous: unknown, next: unknown): boolean {
  return fingerprintAdviceDraft(previous) !== fingerprintAdviceDraft(next);
}

// ---------------------------------------------------------------------------
// adviseCampaign: the handoff
// ---------------------------------------------------------------------------

/**
 * Injected seams. Only two exist — the draft admission and the thread
 * link. Both optional so the ineligible path (the common drawer case)
 * runs with no seams at all: the brief-prefill proof.
 */
export type AdviseCampaignSeams = {
  drafts?: {
    /** Admits (or replays) one governed draft request — the atomic path. */
    requestDraft(input: {
      organizationId: string;
      actorId: string;
      opportunityId: string;
      opportunityVersion: number;
      actionKey: typeof CAMPAIGN_DRAFT_ACTION_KEY;
      objective: string;
      audience: string;
      assertions: Array<{ key: string; expectedOutcome: string }>;
      idempotencyKey: string;
      correlationId: string;
    }): Promise<{ outcome: "created" | "replayed"; requestId: string; draftRequestStatus: string }>;
  };
  links?: {
    /** Task 1 `set_thread_links` seam: thread → draft-request link. */
    setThreadLinks(input: {
      organizationId: string;
      actorId: string;
      threadId: string;
      draftRequestId: string;
      /** Sibling ids forwarded so the overwrite RPC keeps them. */
      projectId?: string;
      requestId?: string;
      campaignId?: string;
    }): Promise<unknown>;
  };
  now?: () => Date;
};

export type AdviseCampaignOutcome =
  | {
      outcome: "draft_requested";
      draftRequestId: string;
      replayed: boolean;
      idempotencyKey: string;
      frozenEvidence: FrozenEvidenceSnapshot;
      markers: CampaignMarkerReceipt[];
      bundleLink: ReturnType<typeof campaignBundleLink>;
      estimate: LabeledCampaignEstimate;
      adviceFingerprint: string;
      reasonCodes: [];
    }
  | {
      outcome: "brief_prefilled";
      /** Prefilled `/campaigns/new` URL carrying objective + audience + reason codes. */
      briefUrl: string;
      prefill: { objective: string; audience: string };
      reasonCodes: CampaignAdviceReasonCode[];
      estimate: LabeledCampaignEstimate;
      draftRequestId?: undefined;
    };

/**
 * Builds the pre-filled brief URL for the ineligible path: the same
 * `/campaigns/new` pipeline Decision Engine opportunities enter, carrying
 * the operator's objective and audience plus the machine-readable reason
 * codes. Never a silent upgrade — callers must show the reasons beside
 * the link.
 */
export function buildPrefilledBriefUrl(input: {
  organizationId: string;
  objective: string;
  audience: string;
  reasonCodes: CampaignAdviceReasonCode[];
}): string {
  const org = z.string().trim().min(1).max(200).parse(input.organizationId);
  const params = new URLSearchParams({
    objective: input.objective,
    audience: input.audience,
    reason: input.reasonCodes.join(","),
  });
  return `/organizations/${org}/campaigns/new?${params.toString()}`;
}

/**
 * Campaign advice handoff. Order: validate → label the estimate →
 * deterministic eligibility (permission first, then readiness) →
 * ineligible resolves to the prefilled brief without touching any seam →
 * eligible freezes the evidence snapshot, admits the draft request under
 * the thread-linked idempotency key, and links thread → request.
 */
export async function adviseCampaign(
  input: AdviseCampaignInput,
  seams: AdviseCampaignSeams = {},
): Promise<AdviseCampaignOutcome> {
  const parsed = adviseCampaignInputSchema.parse(input);
  const estimate = labelCampaignEstimate(parsed.estimate);
  const eligibility = checkCampaignAdviceEligibility(parsed);

  if (!eligibility.eligible) {
    // Ineligible: pre-filled brief, seams provably untouched, reasons named.
    return {
      outcome: "brief_prefilled",
      briefUrl: buildPrefilledBriefUrl({
        organizationId: parsed.organizationId,
        objective: parsed.objective,
        audience: parsed.audience,
        reasonCodes: eligibility.reasonCodes,
      }),
      prefill: { objective: parsed.objective, audience: parsed.audience },
      reasonCodes: eligibility.reasonCodes,
      estimate,
    };
  }

  const opportunity = parsed.opportunity;
  if (!opportunity) {
    // Unreachable through checkCampaignAdviceEligibility (it reports
    // ADVICE_NO_OPPORTUNITY first), kept so the eligible branch below
    // never runs without an opportunity even if the checker changes.
    throw new DomainError("VALIDATION_ERROR", "Please check the submitted fields.");
  }

  const now = seams.now?.() ?? new Date();
  const frozenEvidence = freezeEvidenceSnapshot(parsed.evidenceSnapshot, now);
  const digest =
    parsed.messageDigest ??
    fingerprintAdviceDraft({
      objective: parsed.objective,
      audience: parsed.audience,
      assertions: parsed.assertions,
      evidenceDigest: parsed.evidenceSnapshot.digest,
    });
  const idempotencyKey = buildThreadIdempotencyKey(parsed.threadId, digest);
  const correlationId =
    parsed.correlationId ?? `${parsed.organizationId}:${parsed.threadId}:${digest}`;
  const adviceFingerprint = fingerprintAdviceDraft({
    objective: parsed.objective,
    audience: parsed.audience,
    assertions: parsed.assertions,
    evidenceDigest: parsed.evidenceSnapshot.digest,
  });

  if (!seams.drafts || !seams.links) {
    // No durable seams wired (unit scope): report the admitted plan
    // without spending or storing — like the research executor's
    // seam-less plan, the draft path creates nothing here.
    return {
      outcome: "draft_requested",
      draftRequestId: "pending",
      replayed: false,
      idempotencyKey,
      frozenEvidence,
      markers: buildCampaignMarkerReceipts("requested"),
      bundleLink: campaignBundleLink(parsed.organizationId),
      estimate,
      adviceFingerprint,
      reasonCodes: [],
    };
  }

  const admitted = await seams.drafts.requestDraft({
    organizationId: parsed.organizationId,
    actorId: parsed.actorId,
    opportunityId: opportunity.id,
    opportunityVersion: opportunity.version,
    actionKey: CAMPAIGN_DRAFT_ACTION_KEY,
    objective: parsed.objective,
    audience: parsed.audience,
    assertions: parsed.assertions,
    idempotencyKey,
    correlationId,
  });

  // Thread → request link: the audit chain across thread, draft request,
  // and (once the worker completes it) campaign. Sibling ids already on
  // the thread ride along because the RPC overwrites every link column.
  const existingLinks = threadLinkPointerSchema.parse(parsed.existingLinks ?? {});
  await seams.links.setThreadLinks({
    organizationId: parsed.organizationId,
    actorId: parsed.actorId,
    threadId: parsed.threadId,
    draftRequestId: admitted.requestId,
    ...existingLinks,
  });

  const replayed = admitted.outcome === "replayed";
  return {
    outcome: "draft_requested",
    draftRequestId: admitted.requestId,
    replayed,
    idempotencyKey,
    frozenEvidence,
    markers: buildCampaignMarkerReceipts(replayed ? "claimed" : "requested"),
    bundleLink: campaignBundleLink(parsed.organizationId, {
      draftRequestId: admitted.requestId,
    }),
    estimate,
    adviceFingerprint,
    reasonCodes: [],
  };
}
