import { z } from "zod";

import { canonicalJson } from "@/domain/campaigns/canonical-json";

/**
 * What the platform proposes, and what approving it actually authorizes.
 *
 * A proposal is the argument for doing a piece of marketing: the problem, who
 * it is aimed at, what would be made, what it would cost, and how anyone would
 * later tell whether it worked. It is written before anything is made.
 *
 * The thing to hold on to is what approval MEANS here, because it is narrower
 * than it looks. Approving a proposal authorizes PREPARATION ONLY — drafting
 * creative inside a stated cost ceiling. It reserves no media spend, publishes
 * nothing, confirms no creative, and authorizes no later variation. Every
 * finished output still requires its own review of that exact output before it
 * can be published (D05), and the money-moving authority lives in the separate
 * launch approval. This is the two-gate model in
 * `adrs/0057-campaign-preparation-approval-vs-exact-output-publication.md`.
 *
 * Three shapes, deliberately separate:
 *   - the DOCUMENT, an immutable strict record of what was proposed;
 *   - the VERSION, which binds a document to a digest and a revision number;
 *   - the DECISION, an append-only record of what a person decided about one
 *     exact version, identified by its digest.
 *
 * Nothing here has a mutable "approved" flag. Whether a proposal is approved is
 * DERIVED from its decisions, so a document cannot be edited into looking
 * approved, and an approval cannot survive the content it was given for.
 */

const uuidSchema = z.string().uuid();
const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/, "A digest must be SHA-256 hex.");
const currencySchema = z.string().regex(/^[A-Z]{3}$/, "Currency must be an ISO 4217 code.");
const isoTimestampSchema = z
  .string()
  .datetime({ offset: false })
  .describe("UTC instant. Rendered in the organization timezone, never stored in one.");

/** Human text arriving from a person. Bounded, and never trusted as instruction. */
const shortTextSchema = z.string().trim().min(1).max(240);
const proseSchema = z.string().trim().min(1).max(4000);

export const CAMPAIGN_PROPOSAL_SCHEMA_VERSION = 1 as const;

/**
 * Money, always integer minor units with its currency beside it.
 *
 * There is no "unknown is 0" here. An organic-only campaign has NO media
 * budget, which is `null` — a different fact from a budget of zero, and the
 * read model must never render them the same way.
 */
export const proposalMoneySchema = z.strictObject({
  amountMinor: z.number().int().nonnegative(),
  currency: currencySchema,
});

export const proposalChannelSchema = z.strictObject({
  channelKey: shortTextSchema,
  /**
   * Whether this channel costs media money. The distinction drives which
   * approvals are required later, so it is declared, never inferred from
   * whether a budget happens to be present.
   */
  delivery: z.enum(["organic", "paid"]),
});

export const proposalDeliverableSchema = z.strictObject({
  format: shortTextSchema,
  language: shortTextSchema,
  count: z.number().int().positive().max(50),
});

/**
 * Where a claim in this proposal comes from.
 *
 * A discriminated union over records the platform already owns, each carrying
 * the tenant it belongs to and the exact revision that was read. Arbitrary URLs
 * are deliberately not acceptable as evidence for an internal fact: "we know
 * this because a page said so" is not a source this platform can re-check.
 *
 * Business Memory context is kept distinct from a market claim citation, since
 * the two support different kinds of statement and expire differently.
 */
export const proposalEvidenceReferenceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("business_memory_context"),
    organizationId: uuidSchema,
    contextManifestId: uuidSchema,
    sourceRevision: z.number().int().nonnegative(),
    observedFrom: isoTimestampSchema,
    observedTo: isoTimestampSchema,
    supports: z.enum(["internal_fact", "assumption"]),
  }),
  z.strictObject({
    kind: z.literal("market_claim_citation"),
    organizationId: uuidSchema,
    researchRequestId: uuidSchema,
    sourceRevision: z.number().int().nonnegative(),
    observedFrom: isoTimestampSchema,
    observedTo: isoTimestampSchema,
    supports: z.literal("market_claim"),
  }),
  z.strictObject({
    kind: z.literal("performance_evidence"),
    organizationId: uuidSchema,
    evidenceId: uuidSchema,
    sourceRevision: z.number().int().nonnegative(),
    observedFrom: isoTimestampSchema,
    observedTo: isoTimestampSchema,
    supports: z.literal("internal_fact"),
  }),
]);

/**
 * How anyone would later tell whether this worked.
 *
 * A plan may be written before every prerequisite for measuring it exists —
 * that is normal and useful — but it must SAY so. `missingData` is the list of
 * things that are not in place yet, and a non-empty list is what makes the
 * plan honest rather than aspirational. `target` is optional because a target
 * nobody can justify is worse than no target.
 *
 * Note what is absent: any realized-result claim. This plan describes how a
 * result would be measured. Asserting that a result HAPPENED goes through the
 * existing evidence engine with its own baseline, method and window.
 */
export const proposalSuccessPlanSchema = z.strictObject({
  primaryMetricKey: shortTextSchema,
  baselineSource: shortTextSchema,
  baselineRevision: z.number().int().nonnegative().nullable(),
  baselineFrom: isoTimestampSchema.nullable(),
  baselineTo: isoTimestampSchema.nullable(),
  observationWindowDays: z.number().int().positive().max(365),
  reportingDelayDays: z.number().int().nonnegative().max(180),
  settlementDelayDays: z.number().int().nonnegative().max(365),
  measurementMethod: shortTextSchema.nullable(),
  target: z
    .strictObject({ value: z.number().finite(), unit: shortTextSchema })
    .nullable(),
  /** Everything not yet in place. Empty means the plan is fully supported. */
  missingData: z.array(shortTextSchema).max(40),
});

/**
 * The offer, stated as a choice rather than left to absence.
 *
 * "There is no offer" and "someone forgot to fill the offer in" look identical
 * if the field is merely nullable, so the no-offer case is explicit.
 */
export const proposalOfferSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("no_offer") }),
  z.strictObject({ kind: z.literal("offer"), offerRef: shortTextSchema }),
]);

export const campaignProposalDocumentSchema = z.strictObject({
  schemaVersion: z.literal(CAMPAIGN_PROPOSAL_SCHEMA_VERSION),
  title: shortTextSchema,
  businessProblem: proseSchema,
  objective: shortTextSchema,
  audience: proseSchema,
  offer: proposalOfferSchema,
  channels: z.array(proposalChannelSchema).min(1).max(12),
  deliverables: z.array(proposalDeliverableSchema).min(1).max(40),
  timing: z.strictObject({
    startAt: isoTimestampSchema,
    endAt: isoTimestampSchema.nullable(),
    timezone: shortTextSchema,
  }),
  /** Absent for an organic-only proposal. Never zero to mean "unknown". */
  proposedMediaBudget: proposalMoneySchema.nullable(),
  /** What preparing the creative may cost. Separate from media spend entirely. */
  generationCostCeiling: proposalMoneySchema,
  successPlan: proposalSuccessPlanSchema,
  pausePolicyRef: shortTextSchema,
  evidence: z.array(proposalEvidenceReferenceSchema).max(60),
  memoryContextManifestId: uuidSchema.nullable(),
  assumptions: z.array(shortTextSchema).max(40),
  limitations: z.array(shortTextSchema).max(40),
  readiness: z.strictObject({
    canPrepare: z.boolean(),
    canLaunch: z.boolean(),
    blockers: z.array(shortTextSchema).max(40),
  }),
});

export type CampaignProposalDocument = z.infer<typeof campaignProposalDocumentSchema>;

export const CAMPAIGN_PROPOSAL_SOURCE_KINDS = [
  "manual_request",
  "business_signal",
  "next_test",
] as const;
export const campaignProposalSourceKindSchema = z.enum(CAMPAIGN_PROPOSAL_SOURCE_KINDS);
export type CampaignProposalSourceKind = z.infer<typeof campaignProposalSourceKindSchema>;

/**
 * Where a proposal is in its life.
 *
 * `approved_for_preparation` is named at length on purpose. A state called
 * "approved" would invite every reader to assume it means "cleared to publish",
 * which is exactly the mistake ADR 0057 exists to prevent.
 */
export const CAMPAIGN_PROPOSAL_STATES = [
  "researching",
  "needs_input",
  "ready_for_review",
  "changes_requested",
  "approved_for_preparation",
  "snoozed",
  "dismissed",
  "superseded",
  "cancelled",
] as const;
export const campaignProposalStateSchema = z.enum(CAMPAIGN_PROPOSAL_STATES);
export type CampaignProposalState = z.infer<typeof campaignProposalStateSchema>;

export const CAMPAIGN_PROPOSAL_DECISIONS = [
  "approved_for_preparation",
  "changes_requested",
  "snoozed",
  "dismissed",
] as const;
export const campaignProposalDecisionKindSchema = z.enum(CAMPAIGN_PROPOSAL_DECISIONS);
export type CampaignProposalDecisionKind = z.infer<typeof campaignProposalDecisionKindSchema>;

export const campaignProposalVersionSchema = z.strictObject({
  id: uuidSchema,
  organizationId: uuidSchema,
  proposalId: uuidSchema,
  version: z.number().int().positive(),
  document: campaignProposalDocumentSchema,
  digest: sha256HexSchema,
  createdAt: isoTimestampSchema,
  createdBy: uuidSchema,
});
export type CampaignProposalVersion = z.infer<typeof campaignProposalVersionSchema>;

export const campaignProposalDecisionSchema = z.strictObject({
  id: uuidSchema,
  organizationId: uuidSchema,
  proposalId: uuidSchema,
  proposalVersionId: uuidSchema,
  /** The exact content decided on. A decision cannot outlive its content. */
  proposalDigest: sha256HexSchema,
  /** Taken from the authenticated session, never from request JSON. */
  actorId: uuidSchema,
  decision: campaignProposalDecisionKindSchema,
  reason: proseSchema.nullable(),
  instructions: proseSchema.nullable(),
  snoozedUntil: isoTimestampSchema.nullable(),
  decidedAt: isoTimestampSchema,
});
export type CampaignProposalDecision = z.infer<typeof campaignProposalDecisionSchema>;

export function canonicalProposalJson(document: CampaignProposalDocument): string {
  return canonicalJson(campaignProposalDocumentSchema.parse(document), "$");
}

/**
 * The fields whose change requires a NEW revision rather than an edit.
 *
 * These are the terms a person actually agreed to. Letting any of them move
 * under a standing approval would mean the approval authorized something its
 * approver never read.
 */
export const MATERIAL_PROPOSAL_TERMS = [
  "audience",
  "offer",
  "proposedMediaBudget",
  "generationCostCeiling",
  "successPlan",
  "channels",
  "deliverables",
] as const;

export function materialTermsChanged(
  before: CampaignProposalDocument,
  after: CampaignProposalDocument,
): readonly (typeof MATERIAL_PROPOSAL_TERMS)[number][] {
  return MATERIAL_PROPOSAL_TERMS.filter(
    (term) => canonicalJson(before[term], `$.${term}`) !== canonicalJson(after[term], `$.${term}`),
  );
}

/**
 * What an approval of this document actually permits.
 *
 * Returned as data rather than left implicit, so a caller cannot read an
 * approval as broader than it is. Every field except preparation is false here
 * and always will be: this function describes gate one.
 */
export type PreparationAuthority = {
  mayPrepareCreative: boolean;
  /** Always false. Media spend is authorized by launch approval, never here. */
  mayReserveMediaSpend: false;
  /** Always false. Publication requires review of each exact finished output. */
  mayPublish: false;
  /** Always false. A creative is confirmed by its own review, not by this. */
  mayConfirmCreative: false;
  /** Always false. Every later variation needs its own review under D05. */
  mayAuthorizeLaterVariation: false;
  generationCostCeiling: CampaignProposalDocument["generationCostCeiling"];
};

export function preparationAuthority(
  document: CampaignProposalDocument,
): PreparationAuthority {
  return {
    // Even an approved proposal cannot prepare while readiness says it cannot.
    mayPrepareCreative: document.readiness.canPrepare,
    mayReserveMediaSpend: false,
    mayPublish: false,
    mayConfirmCreative: false,
    mayAuthorizeLaterVariation: false,
    generationCostCeiling: document.generationCostCeiling,
  };
}

/**
 * Whether the version cites source records belonging to this tenant.
 *
 * Each evidence ref carries its own tenant, so this is checkable from the
 * document alone. The context manifest below carries none, which is why it is
 * a separate question.
 */
export function hasSameTenantEvidenceRefs(
  document: CampaignProposalDocument,
  organizationId: string,
): boolean {
  return document.evidence.some((reference) => reference.organizationId === organizationId);
}

/**
 * Whether the approved version cites any evidence this tenant may generate from.
 *
 * A cheap pre-gate over the stored document, not a tenancy proof. Same-tenant
 * refs establish tenancy on their own; the manifest arm only notes that a
 * manifest pointer is cited. A member-supplied document is never re-validated
 * against the tenant at write time, so a manifest standing alone must be
 * verified tenant-side (an RLS-scoped manifest read, which answers absent for
 * foreign rows) before it authorizes a pin — otherwise a foreign pointer
 * would read as pinnable here. An approval that cites nothing pinnable must
 * leave the campaign honestly unstartable rather than pin an invented
 * snapshot.
 */
export function hasPinnableProposalEvidence(
  document: CampaignProposalDocument,
  organizationId: string,
): boolean {
  if (document.memoryContextManifestId !== null) return true;
  return hasSameTenantEvidenceRefs(document, organizationId);
}

/**
 * Whether this document may be put in front of a person at all (D07).
 *
 * D07 is confirmed product policy: a proposal built only from the client's own
 * internal evidence, with NO profit estimate and NO external research, is still
 * worth reviewing — provided it says plainly what it is missing. Withholding a
 * useful recommendation because the impact is not yet quantifiable is a
 * failure, not rigour.
 *
 * What D07 does NOT permit is a factual claim with nothing behind it. A market
 * claim needs a market citation, from this tenant. Everything else is admitted
 * with its gaps stated.
 */
export type ProposalAdmission =
  | { outcome: "admissible"; declaredGaps: readonly string[] }
  | { outcome: "refused"; reasonCode: ProposalAdmissionRefusal };

export type ProposalAdmissionRefusal =
  | "market_claim_without_citation"
  | "foreign_evidence"
  | "no_reviewable_content";

export function admitProposal(input: {
  document: CampaignProposalDocument;
  organizationId: string;
  /** Claims in the prose the drafter marked as being about the wider market. */
  marketClaimKeys: readonly string[];
}): ProposalAdmission {
  const { document, organizationId, marketClaimKeys } = input;

  // Evidence belonging to another tenant is never admissible here, whatever it
  // would support. This is checked before anything else, because a proposal
  // that leaked another client's records must not be reviewable at all.
  const foreign = document.evidence.some(
    (reference) => reference.organizationId !== organizationId,
  );
  if (foreign) return { outcome: "refused", reasonCode: "foreign_evidence" };

  const hasMarketCitation = document.evidence.some(
    (reference) => reference.kind === "market_claim_citation",
  );
  if (marketClaimKeys.length > 0 && !hasMarketCitation) {
    return { outcome: "refused", reasonCode: "market_claim_without_citation" };
  }

  // Something has to be reviewable. A proposal with no evidence AND no stated
  // assumption is not a modest proposal, it is an empty one.
  if (document.evidence.length === 0 && document.assumptions.length === 0) {
    return { outcome: "refused", reasonCode: "no_reviewable_content" };
  }

  // D07 in one place: the gaps are declared, and their presence never blocks
  // review. They are what the reader needs in order to judge the argument.
  const declaredGaps = [
    ...document.successPlan.missingData,
    ...document.limitations,
    ...(hasMarketCitation ? [] : ["No external market research supports this."]),
    ...(document.successPlan.target === null
      ? ["No profit or outcome estimate is attached."]
      : []),
  ];

  return { outcome: "admissible", declaredGaps };
}
