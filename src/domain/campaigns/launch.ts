import { createHash } from "node:crypto";
import { z } from "zod";

import { canonicalJson } from "@/domain/campaigns/canonical-json";
import {
  publicationEligibility,
  type CampaignDeliverableReview,
} from "@/domain/campaigns/deliverable";

/**
 * The moment something becomes publishable, and exactly what was authorized.
 *
 * This is the last gate. A proposal approval said "you may prepare creative".
 * Each deliverable review said "these exact bytes are fine". A launch approval
 * says "publish THESE outputs, to THESE accounts, with THESE words, at THIS
 * time, for THIS money" — and it is bound to every one of those terms at once.
 *
 * Why bind all of it together: a person reviewing a post is reading the picture
 * and the caption. They are also, implicitly, agreeing to where it goes and what
 * it costs. Approving the creative and then letting the destination, the account
 * or the budget move would mean the approval authorized something its approver
 * never saw. So the digest covers the whole set, and changing any part of it
 * produces different authority rather than editing the old one.
 *
 * Note what publication authority is NOT: it is not a verdict on the design as a
 * reusable reference. Approving a post to go out today says nothing about
 * whether that artwork should be drawn from again, and C04 keeps the two apart
 * deliberately.
 */

const uuidSchema = z.string().uuid();
const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/, "A hash must be SHA-256 hex.");
const isoTimestampSchema = z
  .string()
  // Offset required, not forbidden: stored instants round-trip through the API
  // with an explicit +00:00 suffix, and rejecting the transport format hid
  // approved reviews the same way once. A naive datetime is still refused.
  .datetime({ offset: true })
  .describe("UTC instant. Rendered in the organization timezone, never stored in one.");

/**
 * One output, named by both its row and its bytes.
 *
 * The hash travels with the id for the same reason it does on a review: the id
 * says which output, the hash says which version of it. A selection carrying
 * only ids would still look valid after a re-render.
 */
export const launchSelectionSchema = z.strictObject({
  deliverableId: uuidSchema,
  deliverableVersionId: uuidSchema,
  contentHash: sha256HexSchema,
});
export type LaunchSelection = z.infer<typeof launchSelectionSchema>;

/** Every term of what actually goes out on a channel. All of it is bound. */
export const launchActionTermsSchema = z.strictObject({
  deliverableVersionId: uuidSchema,
  channel: z.string().trim().min(1).max(60),
  placement: z.string().trim().min(1).max(60),
  script: z.string().trim().min(1).max(40),
  /** The organization's own connected account. Never a free-text handle. */
  channelAccountId: uuidSchema,
  caption: z.string().trim().max(2200),
  hashtags: z.array(z.string().trim().min(1).max(80)).max(30),
  callToAction: z.string().trim().max(120),
  destinationUrl: z.string().trim().url().max(2000).nullable(),
  /** Already resolved from the organization timezone into an exact instant. */
  scheduledAt: isoTimestampSchema,
  timezone: z.string().trim().min(1).max(80),
  /** Absent for an organic post. Never zero to mean "unknown". */
  budget: z
    .strictObject({ amountMinor: z.number().int().nonnegative(), currency: z.string().regex(/^[A-Z]{3}$/) })
    .nullable(),
  expiresAt: isoTimestampSchema.nullable(),
  pausePolicyRef: z.string().trim().min(1).max(240),
});
export type LaunchActionTerms = z.infer<typeof launchActionTermsSchema>;

export const CAMPAIGN_LAUNCH_MANIFEST_SCHEMA_VERSION = 1 as const;

export const campaignLaunchManifestSchema = z.strictObject({
  schemaVersion: z.literal(CAMPAIGN_LAUNCH_MANIFEST_SCHEMA_VERSION),
  campaignId: uuidSchema,
  /** The exact bundle version this launch publishes from. */
  bundleVersionId: uuidSchema,
  bundleDigest: sha256HexSchema,
  /** Present when the campaign began as a proposal, so intent stays traceable. */
  proposalVersionId: uuidSchema.nullable(),
  proposalDigest: sha256HexSchema.nullable(),
  selections: z.array(launchSelectionSchema).min(1).max(60),
  actions: z.array(launchActionTermsSchema).min(1).max(60),
  /** Claims these posts make, and the source each one rests on. */
  assertions: z
    .array(
      z.strictObject({
        key: z.string().trim().min(1).max(160),
        sourceRef: z.string().trim().min(1).max(240),
      }),
    )
    .max(120),
  offerRef: z.string().trim().min(1).max(240).nullable(),
  /** What must be true for the result to be measurable at all. */
  measurementPrerequisites: z.array(z.string().trim().min(1).max(240)).max(40),
});
export type CampaignLaunchManifest = z.infer<typeof campaignLaunchManifestSchema>;

/**
 * The value a launch approval is bound to.
 *
 * Covers the selected outputs, their hashes and every channel term. Change the
 * caption, the account, the schedule or the budget and this value moves, so the
 * old approval can no longer authorize the dispatch.
 */
export function launchDigest(manifest: CampaignLaunchManifest): string {
  return createHash("sha256")
    .update(canonicalJson(campaignLaunchManifestSchema.parse(manifest), "$"), "utf8")
    .digest("hex");
}

export type LaunchAdmissionRefusal =
  | "selection_not_reviewed"
  | "selection_content_changed"
  | "selection_superseded"
  | "selection_rejected"
  | "action_without_selection"
  | "selection_without_action"
  | "duplicate_selection";

export type LaunchAdmission =
  | { outcome: "admissible" }
  | { outcome: "refused"; reasonCode: LaunchAdmissionRefusal; deliverableVersionId: string | null };

/**
 * Whether this exact set may be launched.
 *
 * Every selected output must carry its own approval of its own current bytes.
 * A previously approved generation family authorizes nothing here: a variant
 * produced under an approved cap is still an unreviewed output until somebody
 * reviews it (D05).
 *
 * The two set checks matter as much as the per-output ones. "Review these and
 * schedule those" must not be expressible: an action naming an output nobody
 * selected, or a selection with no action, means the thing approved and the
 * thing scheduled are different sets.
 */
export function admitLaunch(input: {
  manifest: CampaignLaunchManifest;
  /** For each selected version: its reviews and where it sits in its history. */
  reviewState: ReadonlyMap<
    string,
    {
      version: { id: string; contentHash: string; version: number };
      currentVersion: number;
      reviews: readonly CampaignDeliverableReview[];
    }
  >;
}): LaunchAdmission {
  const { manifest, reviewState } = input;

  const selectedIds = manifest.selections.map((selection) => selection.deliverableVersionId);
  if (new Set(selectedIds).size !== selectedIds.length) {
    return { outcome: "refused", reasonCode: "duplicate_selection", deliverableVersionId: null };
  }

  const selected = new Set(selectedIds);
  const acted = new Set(manifest.actions.map((action) => action.deliverableVersionId));

  for (const action of manifest.actions) {
    if (!selected.has(action.deliverableVersionId)) {
      return {
        outcome: "refused",
        reasonCode: "action_without_selection",
        deliverableVersionId: action.deliverableVersionId,
      };
    }
  }

  for (const selection of manifest.selections) {
    if (!acted.has(selection.deliverableVersionId)) {
      return {
        outcome: "refused",
        reasonCode: "selection_without_action",
        deliverableVersionId: selection.deliverableVersionId,
      };
    }
  }

  for (const selection of manifest.selections) {
    const state = reviewState.get(selection.deliverableVersionId);
    if (!state) {
      return {
        outcome: "refused",
        reasonCode: "selection_not_reviewed",
        deliverableVersionId: selection.deliverableVersionId,
      };
    }

    // The hash the launch names must be the hash the output actually has. This
    // catches a selection assembled before a re-render and submitted after it.
    if (state.version.contentHash !== selection.contentHash) {
      return {
        outcome: "refused",
        reasonCode: "selection_content_changed",
        deliverableVersionId: selection.deliverableVersionId,
      };
    }

    const eligibility = publicationEligibility({
      version: state.version,
      reviews: state.reviews,
      currentVersion: state.currentVersion,
    });

    if (!eligibility.publishable) {
      const reasonCode: LaunchAdmissionRefusal =
        eligibility.reasonCode === "rejected"
          ? "selection_rejected"
          : eligibility.reasonCode === "superseded_by_newer_version"
            ? "selection_superseded"
            : eligibility.reasonCode === "reviewed_different_content"
              ? "selection_content_changed"
              : "selection_not_reviewed";

      return {
        outcome: "refused",
        reasonCode,
        deliverableVersionId: selection.deliverableVersionId,
      };
    }
  }

  return { outcome: "admissible" };
}

/**
 * Which launch terms, if changed, mean new authority rather than an edit.
 *
 * All of them. This list exists to be explicit rather than to be filtered: the
 * point of binding the whole manifest is that there is no term a person could
 * change quietly while keeping the approval.
 */
export function launchTermsChanged(
  before: CampaignLaunchManifest,
  after: CampaignLaunchManifest,
): boolean {
  return launchDigest(before) !== launchDigest(after);
}
