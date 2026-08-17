import type {
  CampaignBundleManifest,
  CampaignChannel,
  CampaignCopy,
  CampaignCreativeDirection,
  CampaignHashtagSet,
  CampaignPlacement,
} from "@/domain/campaigns/schemas";
import { CREATIVE_DIRECTION_KINDS } from "@/domain/campaigns/schemas";

/**
 * One canonical arrangement of a manifest.
 *
 * Two operators can build the same proposal and list its parts in a different
 * order. Those are the same proposal, and they must digest to the same value,
 * or the approval record would treat a reordering as a new thing to approve.
 *
 * The rule is per field, not global: a field whose order is *incidental* is
 * sorted, and a field whose order is *visible to a customer* is left exactly as
 * authored. Sorting a caption's hashtags would silently rewrite what publishes.
 */

const KIND_ORDER = new Map(CREATIVE_DIRECTION_KINDS.map((kind, index) => [kind, index]));

export function normalizeManifest(manifest: CampaignBundleManifest): CampaignBundleManifest {
  return {
    ...manifest,
    directions: [...manifest.directions]
      .sort(compareDirections)
      .map((direction) => normalizeDirection(direction)),
    actions: [...manifest.actions].sort(compareActions),
    assets: [...manifest.assets].sort((left, right) => left.id.localeCompare(right.id)),
    generationPolicy: {
      ...manifest.generationPolicy,
      // A set of claims a variant may repeat, not a sequence anyone reads.
      lockedAssertionKeys: sortedUnique(manifest.generationPolicy.lockedAssertionKeys),
    },
    measurementPlan: {
      ...manifest.measurementPlan,
      // A set of guardrails, not a sequence: nothing reads them in order.
      guardrailMetricKeys: sortedUnique(manifest.measurementPlan.guardrailMetricKeys),
    },
  };
}

function normalizeDirection(direction: CampaignCreativeDirection): CampaignCreativeDirection {
  return {
    ...direction,
    assetIds: [...direction.assetIds].sort((left, right) => left.localeCompare(right)),
    copy: [...direction.copy].sort(compareCopy),
    hashtagSets: [...direction.hashtagSets]
      .sort((left, right) => compareChannel(left.channel, right.channel))
      .map(normalizeHashtagSet),
    internalContentTags: sortedUnique(direction.internalContentTags),
    softConventionDepartures: sortedUnique(direction.softConventionDepartures),
  };
}

/**
 * Tag order is preserved: it is the order a reader sees under the caption.
 * Only the set is normalized, and only by dropping an exact repeat of a tag
 * already present, which a provider would collapse anyway.
 */
function normalizeHashtagSet(set: CampaignHashtagSet): CampaignHashtagSet {
  const seen = new Set<string>();
  return {
    ...set,
    tags: set.tags.filter((tag) => {
      const key = tag.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  };
}

function compareDirections(
  left: CampaignCreativeDirection,
  right: CampaignCreativeDirection,
): number {
  // Review order, not alphabetical: control first, because every other
  // direction is read as a difference from it.
  const byKind = (KIND_ORDER.get(left.kind) ?? 0) - (KIND_ORDER.get(right.kind) ?? 0);
  return byKind !== 0 ? byKind : left.id.localeCompare(right.id);
}

function compareActions(
  left: CampaignBundleManifest["actions"][number],
  right: CampaignBundleManifest["actions"][number],
): number {
  if (left.scheduledFor !== right.scheduledFor) {
    return left.scheduledFor < right.scheduledFor ? -1 : 1;
  }
  const byChannel = compareChannel(left.channel, right.channel);
  if (byChannel !== 0) return byChannel;
  const byPlacement = comparePlacement(left.placement, right.placement);
  if (byPlacement !== 0) return byPlacement;
  return left.id.localeCompare(right.id);
}

function compareCopy(left: CampaignCopy, right: CampaignCopy): number {
  const byChannel = compareChannel(left.channel, right.channel);
  return byChannel !== 0 ? byChannel : comparePlacement(left.placement, right.placement);
}

function compareChannel(left: CampaignChannel, right: CampaignChannel): number {
  return left.localeCompare(right);
}

function comparePlacement(left: CampaignPlacement, right: CampaignPlacement): number {
  return left.localeCompare(right);
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
