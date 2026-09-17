import { z } from "zod";

import {
  admitProposal,
  campaignProposalDocumentSchema,
  campaignProposalDecisionKindSchema,
  campaignProposalSourceKindSchema,
  hasPinnableProposalEvidence,
  preparationAuthority,
  type CampaignProposalDocument,
  type PreparationAuthority,
} from "@/domain/campaigns/proposal";
import { proposalDigest } from "@/domain/campaigns/proposal-digest";

/**
 * The service that owns the first approval gate.
 *
 * Everything that matters about correctness here is in the database function
 * `decide_campaign_proposal`: it is the thing that rechecks the capability, the
 * exact revision, the digest and the proposal's state, then writes the
 * decision, the campaign link and the generation intent in one transaction.
 * This layer exists to validate input at the boundary, to keep the caller from
 * being able to name its own actor or tenant, and to turn a database refusal
 * into an outcome a route can map to a status code without inventing one.
 *
 * It deliberately does NOT re-implement the checks. A second copy of a rule
 * that must hold under concurrency is a copy that will eventually disagree
 * with the one that counts.
 */

const uuidSchema = z.string().uuid();
const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/, "A digest must be SHA-256 hex.");

/**
 * The research claim a worker drafts under.
 *
 * Present only on the worker path. It is not a credential the caller chooses:
 * the database checks that this exact run is still claimed, with this exact
 * token and an unexpired lease, and refuses otherwise. A member never sends
 * one, and sending one would not help them — the member arm is chosen by
 * having a session actor at all, and asks the same permission it always did.
 */
export const researchClaimSchema = z.strictObject({
  runId: uuidSchema,
  claimToken: uuidSchema,
});
export type ResearchClaim = z.infer<typeof researchClaimSchema>;

export const requestProposalSchema = z.strictObject({
  sourceKind: campaignProposalSourceKindSchema,
  sourceId: uuidSchema.nullable().default(null),
  dedupeFingerprint: z.string().trim().min(1).max(200).nullable().default(null),
  claim: researchClaimSchema.nullable().default(null),
});
export type RequestProposalInput = z.input<typeof requestProposalSchema>;

export const completeProposalVersionSchema = z.strictObject({
  proposalId: uuidSchema,
  document: campaignProposalDocumentSchema,
  sourceRevisionManifest: z.record(z.string(), z.unknown()).default({}),
  /**
   * Claims the drafter marked as being about the wider market rather than this
   * client's own records. They decide admissibility under D07, so they are an
   * explicit input rather than something guessed from the prose.
   */
  marketClaimKeys: z.array(z.string().trim().min(1).max(160)).max(60).default([]),
  claim: researchClaimSchema.nullable().default(null),
});
export type CompleteProposalVersionInput = z.input<typeof completeProposalVersionSchema>;

export const decideProposalSchema = z.strictObject({
  proposalId: uuidSchema,
  proposalVersionId: uuidSchema,
  /** The content the decider actually saw. Checked again in the transaction. */
  proposalDigest: sha256HexSchema,
  decision: campaignProposalDecisionKindSchema,
  reason: z.string().trim().min(1).max(4000).nullable().default(null),
  instructions: z.string().trim().min(1).max(4000).nullable().default(null),
  snoozedUntil: z.string().datetime({ offset: false }).nullable().default(null),
  idempotencyKey: z.string().trim().min(8).max(200),
});
export type DecideProposalInput = z.input<typeof decideProposalSchema>;

/**
 * The outcomes a caller may see, and nothing else.
 *
 * C02 fixes the HTTP mapping: 401 unauthenticated, 403 forbidden, 404 not
 * found, 409 conflict, 422 invalid business prerequisite, 503 unavailable.
 * `needs_input` is 422 rather than an error, because a proposal that cannot
 * yet be reviewed is a normal state of the work, not a fault.
 */
export type ProposalOutcome<TValue> =
  | { status: "saved"; value: TValue }
  | { status: "replayed"; value: TValue }
  | { status: "needs_input"; reasonCode: string; declaredGaps: readonly string[] }
  | { status: "stale_version" }
  | { status: "expired_evidence" }
  | { status: "forbidden" }
  | { status: "conflict" }
  | { status: "unavailable" };

export type ProposalDecisionResult = {
  decisionId: string;
  linkedCampaignId: string | null;
  /** Spelled out so no caller has to infer what an approval permits. */
  authority: PreparationAuthority | null;
};

export type ProposalVersionResult = {
  proposalVersionId: string;
  version: number;
  digest: string;
};

export type ProposalStore = {
  requestProposal(input: {
    organizationId: string;
    sourceKind: string;
    sourceId: string | null;
    dedupeFingerprint: string | null;
    /** Null on the member path. The worker path is refused without it. */
    claim: ResearchClaim | null;
  }): Promise<{ proposalId: string; outcome: "saved" | "replayed" }>;
  completeVersion(input: {
    organizationId: string;
    proposalId: string;
    document: CampaignProposalDocument;
    digest: string;
    sourceRevisionManifest: Record<string, unknown>;
    claim: ResearchClaim | null;
  }): Promise<ProposalVersionResult>;
  decide(input: {
    organizationId: string;
    proposalId: string;
    proposalVersionId: string;
    proposalDigest: string;
    decision: string;
    reason: string | null;
    instructions: string | null;
    snoozedUntil: string | null;
    idempotencyKey: string;
  }): Promise<{ decisionId: string; outcome: "saved" | "replayed"; linkedCampaignId: string | null }>;
  readVersionDocument(input: {
    organizationId: string;
    proposalId: string;
    proposalVersionId: string;
  }): Promise<CampaignProposalDocument | null>;
  /**
   * Pins the approval-time evidence snapshot for a proposal-born campaign.
   *
   * Approving a proposal mints a campaign with no `campaign_source_snapshots`
   * row, and generation reads only that pin — so without this, Generate on a
   * proposal-born campaign honestly refuses forever. The writer is the ADR 0058
   * `refresh_campaign_source_snapshot` repair: it inserts a new snapshot from
   * the organization's verified facts and never invents evidence, and it pins
   * nothing new when the facts are identical to the newest snapshot.
   *
   * Never throws: the decision is already committed when this runs, so a pin
   * that cannot be written is reported as unpinned and the recorded approval
   * stands. The campaign then keeps the existing honest refusal until repaired.
   */
  pinApprovalSnapshot(input: {
    organizationId: string;
    campaignId: string;
  }): Promise<{ sourceSnapshotId: string | null; refreshed: boolean }>;
};

export type ProposalPersistenceFailure = {
  kind: "forbidden" | "not_found" | "conflict" | "stale_version" | "unavailable";
};

export function isProposalPersistenceFailure(error: unknown): error is ProposalPersistenceFailure {
  return (
    typeof error === "object" &&
    error !== null &&
    "kind" in error &&
    typeof (error as { kind: unknown }).kind === "string"
  );
}

function failureToOutcome<TValue>(error: unknown): ProposalOutcome<TValue> {
  if (!isProposalPersistenceFailure(error)) return { status: "unavailable" };
  switch (error.kind) {
    case "forbidden":
      return { status: "forbidden" };
    case "stale_version":
      return { status: "stale_version" };
    case "conflict":
      return { status: "conflict" };
    case "not_found":
      // Not visible and not there are answered the same way on purpose: saying
      // which would confirm that another tenant's proposal exists.
      return { status: "forbidden" };
    default:
      return { status: "unavailable" };
  }
}

export function createCampaignProposalService(dependencies: { store: ProposalStore }) {
  return {
    async request(input: {
      organizationId: string;
      request: RequestProposalInput;
    }): Promise<ProposalOutcome<{ proposalId: string }>> {
      const parsed = requestProposalSchema.parse(input.request);
      try {
        const saved = await dependencies.store.requestProposal({
          organizationId: input.organizationId,
          sourceKind: parsed.sourceKind,
          sourceId: parsed.sourceId,
          dedupeFingerprint: parsed.dedupeFingerprint,
          claim: parsed.claim,
        });
        return { status: saved.outcome, value: { proposalId: saved.proposalId } };
      } catch (error) {
        return failureToOutcome(error);
      }
    },

    /**
     * Writes a revision, but only if it is fit to be read by a person.
     *
     * The D07 admission runs here rather than in the database because it is a
     * judgment about content — whether a market claim has a citation behind it
     * — and that belongs in the domain, close to the schema that defines what
     * evidence is. The database still owns everything about concurrency.
     */
    async requestRevision(input: {
      organizationId: string;
      request: CompleteProposalVersionInput;
    }): Promise<ProposalOutcome<ProposalVersionResult>> {
      const parsed = completeProposalVersionSchema.parse(input.request);

      const admission = admitProposal({
        document: parsed.document,
        organizationId: input.organizationId,
        marketClaimKeys: parsed.marketClaimKeys,
      });

      if (admission.outcome === "refused") {
        if (admission.reasonCode === "foreign_evidence") {
          // Evidence from another tenant is a tenancy failure, not a drafting
          // one, and is refused as such rather than sent back for editing.
          return { status: "forbidden" };
        }
        return { status: "needs_input", reasonCode: admission.reasonCode, declaredGaps: [] };
      }

      try {
        const saved = await dependencies.store.completeVersion({
          organizationId: input.organizationId,
          proposalId: parsed.proposalId,
          document: parsed.document,
          digest: proposalDigest(parsed.document),
          sourceRevisionManifest: parsed.sourceRevisionManifest,
          claim: parsed.claim,
        });
        return { status: "saved", value: saved };
      } catch (error) {
        return failureToOutcome(error);
      }
    },

    /**
     * Records a decision about one exact revision.
     *
     * The digest travels from the caller because it is evidence of what they
     * were looking at. It is never trusted on its own — the transaction
     * compares it against the stored version and refuses a mismatch — but
     * without it, an approval could be replayed against text that had since
     * changed.
     */
    async decide(input: {
      organizationId: string;
      request: DecideProposalInput;
    }): Promise<ProposalOutcome<ProposalDecisionResult>> {
      const parsed = decideProposalSchema.parse(input.request);

      if (parsed.decision === "snoozed" && parsed.snoozedUntil === null) {
        return {
          status: "needs_input",
          reasonCode: "snooze_requires_until",
          declaredGaps: [],
        };
      }

      try {
        const saved = await dependencies.store.decide({
          organizationId: input.organizationId,
          proposalId: parsed.proposalId,
          proposalVersionId: parsed.proposalVersionId,
          proposalDigest: parsed.proposalDigest,
          decision: parsed.decision,
          reason: parsed.reason,
          instructions: parsed.instructions,
          snoozedUntil: parsed.snoozedUntil,
          idempotencyKey: parsed.idempotencyKey,
        });

        // What was actually authorized is reported alongside the decision, so
        // no caller has to assume. For anything other than an approval there
        // is no authority at all.
        let authority: PreparationAuthority | null = null;
        if (parsed.decision === "approved_for_preparation") {
          const document = await dependencies.store.readVersionDocument({
            organizationId: input.organizationId,
            proposalId: parsed.proposalId,
            proposalVersionId: parsed.proposalVersionId,
          });
          authority = document ? preparationAuthority(document) : null;

          // The campaign this approval minted has no pinned evidence yet, and
          // generation reads only the pin. Pin only when the approved version
          // cited pinnable evidence — a version citing nothing leaves the
          // campaign honestly unstartable with the existing refusal copy.
          // Replays pin too: a campaign approved before this link existed
          // heals on its next replayed approval, and the writer itself pins
          // nothing when the facts are unchanged.
          if (
            saved.linkedCampaignId !== null &&
            document !== null &&
            hasPinnableProposalEvidence(document, input.organizationId)
          ) {
            await dependencies.store.pinApprovalSnapshot({
              organizationId: input.organizationId,
              campaignId: saved.linkedCampaignId,
            });
          }
        }

        return {
          status: saved.outcome,
          value: {
            decisionId: saved.decisionId,
            linkedCampaignId: saved.linkedCampaignId,
            authority,
          },
        };
      } catch (error) {
        return failureToOutcome(error);
      }
    },
  };
}

export type CampaignProposalService = ReturnType<typeof createCampaignProposalService>;

/** The exact status C02 fixes for each outcome. Kept in one place. */
export function proposalOutcomeStatus(outcome: ProposalOutcome<unknown>): number {
  switch (outcome.status) {
    case "saved":
      return 201;
    case "replayed":
      return 200;
    case "needs_input":
      return 422;
    case "stale_version":
    case "conflict":
      return 409;
    case "expired_evidence":
      return 422;
    case "forbidden":
      return 403;
    case "unavailable":
      return 503;
  }
}
