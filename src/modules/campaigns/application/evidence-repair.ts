import { z } from "zod";

import { brandContextFromBrandAssets } from "@/domain/onboarding/canonical-promotion";

/**
 * Supplying the evidence a campaign said it was missing, from the campaign.
 *
 * A campaign that fails for want of evidence names exactly what is absent, and
 * until now the only answer was to leave, find the right onboarding section,
 * fill it in and come back — at which point the campaign reported the identical
 * gap, because it generates from evidence pinned when it was created.
 *
 * This is the whole repair as one act: write what was supplied, then re-pin the
 * campaign onto the organization's current facts. The order is the point. A
 * refresh taken before the writes lands would pin a snapshot from before the
 * repair, which is the failure this exists to end.
 *
 * It reports what actually happened rather than what was asked for. A refresh
 * that changed nothing is reported as changing nothing: telling somebody their
 * evidence was updated when it was not sends them to press "Generate again" for
 * a run that must fail in exactly the same way.
 */

export const evidenceRepairGoalSchema = z.strictObject({
  name: z.string().trim().min(2).max(160),
  /** The registered metric. Validated against the column's own pattern. */
  metricKey: z
    .string()
    .trim()
    .max(200)
    .regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/),
  baselineStatus: z.enum(["known", "estimated", "unknown"]),
  baselineValue: z.number().finite().nullable().optional(),
  targetValue: z.number().finite(),
  unit: z.string().trim().min(1).max(40),
  currency: z
    .string()
    .length(3)
    .toUpperCase()
    .nullable()
    .optional(),
});
export type EvidenceRepairGoal = z.infer<typeof evidenceRepairGoalSchema>;

export const evidenceRepairRequestSchema = z.strictObject({
  /** Trait values from the brand voice vocabulary. */
  brandVoice: z.array(z.string().trim().max(80)).max(20).optional(),
  goal: evidenceRepairGoalSchema.optional(),
});
export type EvidenceRepairRequest = z.infer<typeof evidenceRepairRequestSchema>;

export type EvidenceRepairPorts = {
  /** Puts the voice in force on the canonical business profile. */
  saveBrandVoice(voice: string): Promise<void>;
  createGoal(goal: EvidenceRepairGoal): Promise<void>;
  /** Re-pins the campaign, and says whether that actually changed anything. */
  refreshSnapshot(): Promise<{ sourceSnapshotId: string; refreshed: boolean }>;
};

export type EvidenceRepairResult = {
  brandVoiceSaved: boolean;
  goalCreated: boolean;
  /** False when the organization's facts were already what was pinned. */
  evidenceRefreshed: boolean;
  sourceSnapshotId: string;
};

export async function repairCampaignEvidence(
  request: EvidenceRepairRequest,
  ports: EvidenceRepairPorts,
): Promise<EvidenceRepairResult> {
  // The same rule onboarding promotes by, so a voice supplied here and a voice
  // supplied there cannot end up stored differently.
  const brandContext = request.brandVoice
    ? brandContextFromBrandAssets({ brandVoice: [...request.brandVoice] })
    : null;
  const voice = typeof brandContext?.voice === "string" ? brandContext.voice : null;

  if (voice) await ports.saveBrandVoice(voice);
  if (request.goal) await ports.createGoal(request.goal);

  // Always, even when this request supplied nothing. The gap may have been
  // closed elsewhere — in onboarding, or by a colleague — and refusing to look
  // would strand the campaign on stale evidence for a repair already done.
  const { sourceSnapshotId, refreshed } = await ports.refreshSnapshot();

  return {
    brandVoiceSaved: voice !== null,
    goalCreated: request.goal !== undefined,
    evidenceRefreshed: refreshed,
    sourceSnapshotId,
  };
}
