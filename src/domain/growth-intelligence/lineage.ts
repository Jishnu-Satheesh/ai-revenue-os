import type { GrowthIntelligenceItemIdentity } from "@/domain/growth-intelligence/items";

/**
 * Item lineage.
 *
 * A later run opens a new untriaged item only when the evidence fingerprint
 * materially changes: new claim or finding digests, a new geography, new
 * limitations, or a new synthesis version. Byte-for-byte repeats and
 * narration-only rewrites over identical evidence are duplicates and must
 * not create another card.
 */

export type ItemLineage = "duplicate" | "material_change";

export function classifyItemLineage(
  previous: GrowthIntelligenceItemIdentity,
  current: GrowthIntelligenceItemIdentity,
): ItemLineage {
  if (current.itemFingerprint === previous.itemFingerprint) return "duplicate";
  if (current.evidenceFingerprint === previous.evidenceFingerprint) return "duplicate";
  return "material_change";
}
