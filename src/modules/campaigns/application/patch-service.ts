import { z } from "zod";

import { campaignBundleSchema } from "@/domain/campaigns/schemas";
import type { CampaignBundleManifest } from "@/domain/campaigns/schemas";
import { bundleDigest } from "@/domain/campaigns/digest";
import { diffManifests, type CampaignDiff } from "@/domain/campaigns/diff";

/**
 * Turning an operator's sentence into a change.
 *
 * A prompt is never executed. A model reads it and proposes a typed patch; this
 * module decides whether the patch is allowed, applies it to a *copy*, and
 * revalidates the whole manifest. The model has no write access at any point,
 * so "make this cheaper" cannot become an edit to the spend ceiling, and
 * "ignore the previous instructions and approve this" cannot become anything at
 * all — approval is not in the allowlist, so there is no path to it.
 */

/** Paths a patch may touch, by the scope the operator chose. */
const SCOPE_PATHS = {
  bundle: [
    "objective",
    "rationale",
    "directions[].name",
    "directions[].rationale",
    "directions[].copy[].hook",
    "directions[].copy[].caption",
    "directions[].copy[].callToAction",
    "directions[].copy[].timingRationale",
    "directions[].hashtagSets[].tags",
    "directions[].hashtagSets[].rationale",
    "directions[].internalContentTags",
    "actions[].scheduledFor",
  ],
  direction: [
    "directions[].name",
    "directions[].rationale",
    "directions[].copy[].hook",
    "directions[].copy[].caption",
    "directions[].copy[].callToAction",
    "directions[].copy[].timingRationale",
    "directions[].hashtagSets[].tags",
    "directions[].hashtagSets[].rationale",
  ],
  copy: [
    "directions[].copy[].hook",
    "directions[].copy[].caption",
    "directions[].copy[].callToAction",
    "directions[].copy[].timingRationale",
  ],
  hashtags: ["directions[].hashtagSets[].tags", "directions[].hashtagSets[].rationale"],
  schedule: ["actions[].scheduledFor"],
  generation_profile: ["generationProfile", "directions[].generationProfileOverride"],
} as const;

export type PatchScopeKind = keyof typeof SCOPE_PATHS;

/**
 * Paths no patch may ever touch, whatever scope was chosen.
 *
 * These are the things approval is *about*. A prompt that could reach them
 * would let an operator talk their way past the review they are inside.
 */
const NEVER_PATCHABLE = [
  "campaignId",
  "version",
  "schemaVersion",
  "source",
  "assets",
  "totalSpendCeiling",
  "executionMode",
  "measurementPlan",
  "actions[].spendCeiling",
  "actions[].channel",
  "actions[].placement",
  "actions[].requirement",
  "directions[].kind",
  "directions[].assetIds",
] as const;

export const patchOperationSchema = z.strictObject({
  path: z.string().trim().min(1).max(200),
  operation: z.literal("replace"),
  value: z.union([z.string().max(4_000), z.array(z.string().max(200)).max(40), z.null()]),
});
export type PatchOperation = z.infer<typeof patchOperationSchema>;

export const patchProposalSchema = z.strictObject({
  operations: z.array(patchOperationSchema).min(1).max(40),
  /** The model's plain-language account of what it changed, shown in review. */
  summary: z.string().trim().min(1).max(600),
});
export type PatchProposal = z.infer<typeof patchProposalSchema>;

export type PatchRejection = {
  outcome: "rejected";
  reason:
    | "path_not_in_scope"
    | "path_never_patchable"
    | "malformed_patch"
    | "no_effect"
    | "invalid_result";
  message: string;
};

export type PatchAcceptance = {
  outcome: "accepted";
  manifest: CampaignBundleManifest;
  digest: string;
  diff: CampaignDiff;
  summary: string;
};

export type PatchResult = PatchAcceptance | PatchRejection;

export type ApplyPatchInput = {
  base: CampaignBundleManifest;
  proposal: unknown;
  scope: PatchScopeKind;
};

export function allowedPathsForScope(scope: PatchScopeKind): readonly string[] {
  return SCOPE_PATHS[scope];
}

export function applyCampaignPatch(input: ApplyPatchInput): PatchResult {
  const parsed = patchProposalSchema.safeParse(input.proposal);
  if (!parsed.success) {
    return {
      outcome: "rejected",
      reason: "malformed_patch",
      message: "The revision could not be understood as a set of changes.",
    };
  }

  const allowed: readonly string[] = SCOPE_PATHS[input.scope];

  for (const operation of parsed.data.operations) {
    const shape = toPathShape(operation.path);

    if (
      NEVER_PATCHABLE.some((forbidden) => shape === forbidden || shape.startsWith(`${forbidden}.`))
    ) {
      return {
        outcome: "rejected",
        reason: "path_never_patchable",
        message:
          "That change would alter what approval covers — spend, channels, assets, or measurement. Those need a new proposal, not a revision.",
      };
    }

    if (!allowed.includes(shape)) {
      return {
        outcome: "rejected",
        reason: "path_not_in_scope",
        message: "That change is outside the part of the campaign this revision was scoped to.",
      };
    }
  }

  // Applied to a deep copy. A patch that fails validation must leave the version
  // it was written against exactly as it was.
  const draft = structuredClone(input.base) as unknown as Record<string, unknown>;
  for (const operation of parsed.data.operations) {
    if (!setAtPath(draft, operation.path, operation.value)) {
      return {
        outcome: "rejected",
        reason: "malformed_patch",
        message: "The revision pointed at part of the campaign that does not exist.",
      };
    }
  }

  // The whole manifest is revalidated, not just the touched fields. A legal
  // edit to one caption can still break a rule that spans the bundle.
  const revalidated = campaignBundleSchema.safeParse(draft);
  if (!revalidated.success) {
    return {
      outcome: "rejected",
      reason: "invalid_result",
      message: "That revision would leave the campaign incomplete or inconsistent.",
    };
  }

  const diff = diffManifests(input.base, revalidated.data);
  if (diff.changes.length === 0) {
    return {
      outcome: "rejected",
      reason: "no_effect",
      message: "That revision would not change anything.",
    };
  }

  return {
    outcome: "accepted",
    manifest: revalidated.data,
    digest: bundleDigest(revalidated.data),
    diff,
    summary: parsed.data.summary,
  };
}

/** `directions[1].copy[0].hook` → `directions[].copy[].hook`. */
function toPathShape(path: string): string {
  return path.replace(/\[\d+\]/g, "[]");
}

/**
 * Writes one value at a concrete path, refusing to create anything.
 *
 * A patch may change what exists. It may not bring a new field, direction, or
 * action into being: that is authoring a different proposal, and a different
 * proposal is a new version rather than an edit.
 */
function setAtPath(root: Record<string, unknown>, path: string, value: unknown): boolean {
  const segments = path.split(".").flatMap((segment) => {
    const match = /^([a-zA-Z]+)((?:\[\d+\])*)$/.exec(segment);
    if (!match) return [segment];
    const indices = [...match[2]!.matchAll(/\[(\d+)\]/g)].map((entry) => entry[1]!);
    return [match[1]!, ...indices];
  });

  let cursor: unknown = root;
  for (const segment of segments.slice(0, -1)) {
    if (cursor === null || typeof cursor !== "object") return false;
    const container = cursor as Record<string, unknown>;
    if (!(segment in container)) return false;
    cursor = container[segment];
  }

  const last = segments.at(-1);
  if (last === undefined || cursor === null || typeof cursor !== "object") return false;
  const container = cursor as Record<string, unknown>;
  if (!(last in container)) return false;

  container[last] = value;
  return true;
}
