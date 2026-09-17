import { z } from "zod";

import { canonicalJson } from "@/domain/campaigns/canonical-json";

/**
 * A finished thing that could actually be published, and what it took to get it.
 *
 * Three identities are kept apart here on purpose, because collapsing them is
 * how a platform ends up publishing something nobody agreed to:
 *
 *   - the DELIVERABLE: "the English feed post for this campaign". Stable. It is
 *     what a person means when they say "the post".
 *   - the VERSION: one exact set of finished bytes and words, immutable, with a
 *     content hash. It is what a person actually reviews.
 *   - the provider ACTION id: what the channel gave back when it was published.
 *     Not modelled here at all; it belongs to dispatch.
 *
 * A review binds to a VERSION, never to a deliverable. That is the whole point:
 * approving "the post" and then changing the picture would leave an approval
 * pointing at something its approver never saw. New versions therefore start
 * unreviewed and inherit nothing (D05, and ADR 0057's second gate).
 */

const uuidSchema = z.string().uuid();
const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/, "A content hash must be SHA-256 hex.");
const isoTimestampSchema = z
  .string()
  .datetime({ offset: false })
  .describe("UTC instant. Rendered in the organization timezone, never stored in one.");

/**
 * Where the finished bytes actually are.
 *
 * A discriminated union over records this platform already owns, because the
 * two are NOT interchangeable:
 *
 *   - `finished_poster` is a composed render: a plate with text laid onto it by
 *     the server, with a template and a script and a verified fit.
 *   - `final_image` is an image chosen to publish as it stands.
 *
 * A textless plate is not automatically a `final_image`. It is a raw ingredient,
 * and treating it as publishable because it happens to be an image is exactly
 * the confusion C04 calls out. Choosing one is an explicit reviewed decision.
 *
 * Note what is absent: any URL. A signed URL is a temporary credential. Putting
 * one in a manifest, a review or a digest would mean the record of what was
 * approved expires, and the digest of an approval would change when nothing
 * about the content did.
 */
export const deliverableSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("finished_poster"),
    /** The composed render row. Its bytes live in private Storage. */
    posterRenderId: uuidSchema,
    templateKey: z.string().trim().min(1).max(120),
    templateVersion: z.number().int().positive(),
    script: z.string().trim().min(1).max(40),
  }),
  z.strictObject({
    kind: z.literal("final_image"),
    /** An owned campaign asset, explicitly chosen as publishable as it stands. */
    assetId: uuidSchema,
    /**
     * True only where a person decided this image publishes without composition.
     * There is no path that sets this from the fact that a render failed.
     */
    chosenAsFinal: z.literal(true),
  }),
]);
export type DeliverableSource = z.infer<typeof deliverableSourceSchema>;

/** The public words. Every one of them is inside the digest. */
export const deliverableCopySchema = z.strictObject({
  caption: z.string().trim().max(2200),
  hashtags: z.array(z.string().trim().min(1).max(80)).max(30),
  callToAction: z.string().trim().max(120),
  destinationUrl: z.string().trim().url().max(2000).nullable(),
});
export type DeliverableCopy = z.infer<typeof deliverableCopySchema>;

/**
 * Everything that, if changed, means this is a different finished thing.
 *
 * The render inputs are in here in full — free line, template version, font
 * manifest version, brand mark version, script, engine version — because a
 * change to any of them changes the pixels a person would see. An identical
 * retry produces the same value and reuses the recorded result; anything else
 * is a new version that nobody has reviewed yet.
 */
export const deliverableRenderInputsSchema = z.strictObject({
  plateContentHash: sha256HexSchema,
  templateVersion: z.number().int().positive(),
  script: z.string().trim().min(1).max(40),
  slotValues: z.record(z.string().min(1).max(80), z.string().max(2000)),
  freeLine: z.string().trim().max(400).nullable(),
  brandMarkVersionId: uuidSchema.nullable(),
  fontManifestVersion: z.string().trim().min(1).max(80),
  renderEngineVersion: z.string().trim().min(1).max(80),
});
export type DeliverableRenderInputs = z.infer<typeof deliverableRenderInputsSchema>;

export const CAMPAIGN_DELIVERABLE_VERSION_SCHEMA_VERSION = 1 as const;

export const campaignDeliverableVersionSchema = z.strictObject({
  schemaVersion: z.literal(CAMPAIGN_DELIVERABLE_VERSION_SCHEMA_VERSION),
  id: uuidSchema,
  organizationId: uuidSchema,
  campaignId: uuidSchema,
  deliverableId: uuidSchema,
  version: z.number().int().positive(),
  /** The exact bundle version whose approval this output was prepared under. */
  bundleVersionId: uuidSchema,
  directionKey: uuidSchema,
  /** Present when this output came from a variant rather than the base direction. */
  creativeVariantId: uuidSchema.nullable(),
  source: deliverableSourceSchema,
  channel: z.string().trim().min(1).max(60),
  placement: z.string().trim().min(1).max(60),
  language: z.string().trim().min(1).max(40),
  copy: deliverableCopySchema,
  renderInputs: deliverableRenderInputsSchema,
  /** The hash of the finished bytes. What a review is bound to. */
  contentHash: sha256HexSchema,
  createdAt: isoTimestampSchema,
});
export type CampaignDeliverableVersion = z.infer<typeof campaignDeliverableVersionSchema>;

export const CAMPAIGN_DELIVERABLE_REVIEW_DECISIONS = ["approved", "rejected"] as const;
export const deliverableReviewDecisionSchema = z.enum(CAMPAIGN_DELIVERABLE_REVIEW_DECISIONS);
export type DeliverableReviewDecision = z.infer<typeof deliverableReviewDecisionSchema>;

export const campaignDeliverableReviewSchema = z.strictObject({
  id: uuidSchema,
  organizationId: uuidSchema,
  deliverableId: uuidSchema,
  deliverableVersionId: uuidSchema,
  /**
   * Carried beside the version id deliberately. The id says which row; the hash
   * says which bytes. A review authorizes publication only when both still
   * match, which is what stops an approval sliding onto a re-render.
   */
  contentHash: sha256HexSchema,
  actorId: uuidSchema,
  decision: deliverableReviewDecisionSchema,
  reasonCodes: z.array(z.string().trim().min(1).max(80)).max(15),
  note: z.string().trim().max(2000).nullable(),
  reviewedAt: isoTimestampSchema,
});
export type CampaignDeliverableReview = z.infer<typeof campaignDeliverableReviewSchema>;

/**
 * The value a render is keyed by.
 *
 * Identical inputs produce an identical digest, so a retry after a lost
 * response reuses the render already recorded instead of paying to make the
 * same picture twice. Any change to any input produces a different digest and
 * therefore a new version, which is unreviewed.
 */
export function deliverableRenderDigest(inputs: DeliverableRenderInputs): string {
  return canonicalJson(deliverableRenderInputsSchema.parse(inputs), "$");
}

/**
 * Whether this exact finished output may be published.
 *
 * The only thing that can authorize publication is a review of THIS version's
 * exact content hash. Not a review of the deliverable, not a review of an
 * earlier version, and not the approval of the proposal or the bundle — those
 * authorized preparation, which is a different act.
 */
export type PublicationEligibility =
  | { publishable: true; reviewId: string }
  | { publishable: false; reasonCode: PublicationBlockedReason };

export type PublicationBlockedReason =
  | "never_reviewed"
  | "rejected"
  | "reviewed_different_content"
  | "superseded_by_newer_version";

export function publicationEligibility(input: {
  version: Pick<CampaignDeliverableVersion, "id" | "contentHash" | "version">;
  reviews: readonly CampaignDeliverableReview[];
  /** The highest version number this deliverable currently has. */
  currentVersion: number;
}): PublicationEligibility {
  const { version, reviews, currentVersion } = input;

  if (version.version < currentVersion) {
    return { publishable: false, reasonCode: "superseded_by_newer_version" };
  }

  const forThisVersion = reviews.filter((review) => review.deliverableVersionId === version.id);
  if (forThisVersion.length === 0) {
    return { publishable: false, reasonCode: "never_reviewed" };
  }

  // Latest decision wins; a rejection after an approval is a rejection.
  const latest = [...forThisVersion].sort((left, right) =>
    left.reviewedAt < right.reviewedAt ? 1 : left.reviewedAt > right.reviewedAt ? -1 : 0,
  )[0]!;

  if (latest.decision === "rejected") {
    return { publishable: false, reasonCode: "rejected" };
  }

  // The bytes moved under the approval. This is the case that matters most and
  // the one a version id alone would miss.
  if (latest.contentHash !== version.contentHash) {
    return { publishable: false, reasonCode: "reviewed_different_content" };
  }

  return { publishable: true, reviewId: latest.id };
}

/**
 * What the plan asked for against what actually exists.
 *
 * Partial completion must never quietly shrink the plan. If eight posts were
 * approved and five were made, the honest report is five of eight with the
 * three failures named — not a tidy set of five that looks complete.
 */
export type DeliverablePlanItem = {
  format: string;
  language: string;
  count: number;
};

export type DeliverableCompletion = {
  planned: number;
  produced: number;
  complete: boolean;
  missing: readonly { format: string; language: string; shortfall: number }[];
  /**
   * Finished output the plan never asked for.
   *
   * A manual-brief campaign has no proposal plan, so everything it produces
   * lands here: an empty plan plus one produced output reads as
   * produced-but-unplanned, never as complete. Over-production against a real
   * plan is reported the same way rather than absorbed -- five posters against
   * four planned is four of four with one unplanned, not a tidy complete.
   */
  unplanned: readonly { format: string; language: string; surplus: number }[];
};

export function deliverableCompletion(input: {
  plan: readonly DeliverablePlanItem[];
  produced: readonly { format: string; language: string }[];
}): DeliverableCompletion {
  const counts = new Map<string, number>();
  for (const item of input.produced) {
    const key = `${item.format} ${item.language}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const missing: { format: string; language: string; shortfall: number }[] = [];
  let planned = 0;
  let produced = 0;

  for (const item of input.plan) {
    planned += item.count;
    const made = counts.get(`${item.format} ${item.language}`) ?? 0;
    produced += Math.min(made, item.count);
    if (made < item.count) {
      missing.push({ format: item.format, language: item.language, shortfall: item.count - made });
    }
  }

  const surplus = unplanned(input);

  return {
    planned,
    produced,
    complete: missing.length === 0 && surplus.length === 0,
    missing,
    unplanned: surplus,
  };
}

/**
 * Finished output beyond what the plan asked for, per format and language.
 *
 * Computed independently of the capped `produced` count above, keyed by the
 * pair itself rather than by string concatenation: the plan half of this file
 * joins its keys with a literal NUL byte, and this stays out of that scheme
 * rather than depending on an invisible separator.
 */
function unplanned(input: {
  plan: readonly DeliverablePlanItem[];
  produced: readonly { format: string; language: string }[];
}): { format: string; language: string; surplus: number }[] {
  const keyOf = (format: string, language: string): string => JSON.stringify([format, language]);

  const plannedByPair = new Map<string, { format: string; language: string; count: number }>();
  for (const item of input.plan) {
    const key = keyOf(item.format, item.language);
    const prior = plannedByPair.get(key);
    if (prior) prior.count += item.count;
    else
      plannedByPair.set(key, { format: item.format, language: item.language, count: item.count });
  }

  const madeByPair = new Map<string, { format: string; language: string; made: number }>();
  for (const item of input.produced) {
    const key = keyOf(item.format, item.language);
    const prior = madeByPair.get(key);
    if (prior) prior.made += 1;
    else madeByPair.set(key, { format: item.format, language: item.language, made: 1 });
  }

  const surplus: { format: string; language: string; surplus: number }[] = [];
  for (const [key, made] of madeByPair) {
    const planned = plannedByPair.get(key)?.count ?? 0;
    if (made.made > planned) {
      surplus.push({ format: made.format, language: made.language, surplus: made.made - planned });
    }
  }
  return surplus;
}
