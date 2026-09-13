import { z } from "zod";

import {
  campaignDeliverableReviewSchema,
  deliverableCompletion,
  deliverableCopySchema,
  deliverableRenderInputsSchema,
  deliverableRenderDigest,
  deliverableReviewDecisionSchema,
  deliverableSourceSchema,
  publicationEligibility,
  type CampaignDeliverableReview,
  type DeliverableCompletion,
  type DeliverablePlanItem,
  type PublicationEligibility,
} from "@/domain/campaigns/deliverable";

/**
 * Recording finished outputs, and gating publication on reviewing them.
 *
 * Two callers, two very different rights. A worker records what it produced and
 * can never review it. A person reviews one exact output and can never record
 * one. The database enforces that split through separate EXECUTE grants; this
 * layer keeps the two paths from sharing a code path that could blur them.
 *
 * Publication eligibility is computed here, from reviews, rather than stored as
 * a flag. A stored "publishable" column would be a value some later write could
 * set without anyone having looked at the bytes.
 */

const uuidSchema = z.string().uuid();
const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/, "A content hash must be SHA-256 hex.");

export const recordDeliverableVersionSchema = z.strictObject({
  campaignId: uuidSchema,
  bundleVersionId: uuidSchema,
  directionKey: uuidSchema,
  creativeVariantId: uuidSchema.nullable().default(null),
  channel: z.string().trim().min(1).max(60),
  placement: z.string().trim().min(1).max(60),
  language: z.string().trim().min(1).max(40),
  format: z.string().trim().min(1).max(60),
  ordinal: z.number().int().positive().default(1),
  source: deliverableSourceSchema,
  copy: deliverableCopySchema,
  renderInputs: deliverableRenderInputsSchema,
  contentHash: sha256HexSchema,
  verification: z.record(z.string(), z.unknown()).default({}),
});
export type RecordDeliverableVersionInput = z.input<typeof recordDeliverableVersionSchema>;

export const reviewDeliverableVersionSchema = z.strictObject({
  deliverableVersionId: uuidSchema,
  /** The hash the reviewer actually saw. Checked again in the transaction. */
  contentHash: sha256HexSchema,
  decision: deliverableReviewDecisionSchema,
  reasonCodes: z.array(z.string().trim().min(1).max(80)).max(15).default([]),
  note: z.string().trim().min(1).max(2000).nullable().default(null),
  idempotencyKey: z.string().trim().min(8).max(200),
});
export type ReviewDeliverableVersionInput = z.input<typeof reviewDeliverableVersionSchema>;

export type DeliverableOutcome<TValue> =
  | { status: "saved"; value: TValue }
  | { status: "replayed"; value: TValue }
  | { status: "needs_input"; reasonCode: string }
  | { status: "superseded" }
  | { status: "content_changed" }
  | { status: "forbidden" }
  | { status: "conflict" }
  | { status: "unavailable" };

export type RecordedDeliverableVersion = {
  deliverableId: string;
  deliverableVersionId: string;
  version: number;
};

export type DeliverableStore = {
  recordVersion(input: {
    organizationId: string;
    payload: Record<string, unknown>;
  }): Promise<RecordedDeliverableVersion & { outcome: "saved" | "replayed" }>;
  reviewVersion(input: {
    organizationId: string;
    payload: Record<string, unknown>;
  }): Promise<{ reviewId: string; outcome: "saved" | "replayed" }>;
  readVersionForPublication(input: {
    organizationId: string;
    deliverableVersionId: string;
  }): Promise<{
    version: { id: string; contentHash: string; version: number };
    currentVersion: number;
    reviews: readonly CampaignDeliverableReview[];
  } | null>;
};

export type DeliverableFailure = {
  kind: "forbidden" | "not_found" | "conflict" | "superseded" | "content_changed" | "unavailable";
};

function failureToOutcome<TValue>(error: unknown): DeliverableOutcome<TValue> {
  const kind =
    typeof error === "object" && error !== null && "kind" in error
      ? (error as DeliverableFailure).kind
      : "unavailable";

  switch (kind) {
    case "forbidden":
      return { status: "forbidden" };
    case "superseded":
      return { status: "superseded" };
    case "content_changed":
      return { status: "content_changed" };
    case "conflict":
      return { status: "conflict" };
    case "not_found":
      // Not visible and not there answer identically, so neither confirms the
      // existence of another tenant's output.
      return { status: "forbidden" };
    default:
      return { status: "unavailable" };
  }
}

export function createDeliverableService(dependencies: { store: DeliverableStore }) {
  return {
    /**
     * Records one finished output. Worker-only, by the database's grants.
     *
     * The render digest is computed here from the inputs rather than accepted
     * from the caller, so "identical retry" means the inputs really were
     * identical — not that a caller said they were.
     */
    async recordVersion(input: {
      organizationId: string;
      request: RecordDeliverableVersionInput;
    }): Promise<DeliverableOutcome<RecordedDeliverableVersion>> {
      const parsed = recordDeliverableVersionSchema.parse(input.request);

      try {
        const saved = await dependencies.store.recordVersion({
          organizationId: input.organizationId,
          payload: {
            campaign_id: parsed.campaignId,
            bundle_version_id: parsed.bundleVersionId,
            direction_key: parsed.directionKey,
            creative_variant_id: parsed.creativeVariantId,
            channel: parsed.channel,
            placement: parsed.placement,
            language: parsed.language,
            format: parsed.format,
            ordinal: parsed.ordinal,
            source_kind: parsed.source.kind,
            poster_render_id:
              parsed.source.kind === "finished_poster" ? parsed.source.posterRenderId : null,
            final_asset_id: parsed.source.kind === "final_image" ? parsed.source.assetId : null,
            copy: parsed.copy,
            render_inputs: parsed.renderInputs,
            render_digest: deliverableRenderDigest(parsed.renderInputs),
            content_hash: parsed.contentHash,
            verification: parsed.verification,
          },
        });

        return {
          status: saved.outcome,
          value: {
            deliverableId: saved.deliverableId,
            deliverableVersionId: saved.deliverableVersionId,
            version: saved.version,
          },
        };
      } catch (error) {
        return failureToOutcome(error);
      }
    },

    /**
     * Records a person's review of one exact output.
     *
     * A rejection must carry at least one reason. A rejection with no reason is
     * not a review — whoever has to act on it cannot.
     */
    async reviewVersion(input: {
      organizationId: string;
      request: ReviewDeliverableVersionInput;
    }): Promise<DeliverableOutcome<{ reviewId: string }>> {
      const parsed = reviewDeliverableVersionSchema.parse(input.request);

      if (parsed.decision === "rejected" && parsed.reasonCodes.length === 0) {
        return { status: "needs_input", reasonCode: "rejection_requires_reason" };
      }

      try {
        const saved = await dependencies.store.reviewVersion({
          organizationId: input.organizationId,
          payload: {
            deliverable_version_id: parsed.deliverableVersionId,
            content_hash: parsed.contentHash,
            decision: parsed.decision,
            reason_codes: parsed.reasonCodes,
            note: parsed.note,
            idempotency_key: parsed.idempotencyKey,
          },
        });

        return { status: saved.outcome, value: { reviewId: saved.reviewId } };
      } catch (error) {
        return failureToOutcome(error);
      }
    },

    /**
     * Whether this exact output may be published.
     *
     * Derived every time from the reviews on record. The proposal approval and
     * the bundle approval authorized preparation; only a review of these exact
     * bytes authorizes publication.
     */
    async publicationEligibility(input: {
      organizationId: string;
      deliverableVersionId: string;
    }): Promise<PublicationEligibility> {
      const found = await dependencies.store.readVersionForPublication(input);
      if (!found) return { publishable: false, reasonCode: "never_reviewed" };

      return publicationEligibility({
        version: found.version,
        reviews: found.reviews.map((review) => campaignDeliverableReviewSchema.parse(review)),
        currentVersion: found.currentVersion,
      });
    },

    /** What the plan asked for against what exists. Never a tidied-up count. */
    completion(input: {
      plan: readonly DeliverablePlanItem[];
      produced: readonly { format: string; language: string }[];
    }): DeliverableCompletion {
      return deliverableCompletion(input);
    },
  };
}

export type CampaignDeliverableService = ReturnType<typeof createDeliverableService>;
