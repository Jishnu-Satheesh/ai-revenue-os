import { z } from "zod";

import { evaluateContentPolicy } from "@/domain/campaigns/content-policy";
import type { CampaignBundleManifest } from "@/domain/campaigns/schemas";
import type { CampaignDiff } from "@/domain/campaigns/diff";
import {
  applyCampaignPatch,
  type PatchOperation,
  type PatchRejection,
} from "@/modules/campaigns/application/patch-service";
import { verifiedChannelLimits } from "@/modules/campaigns/application/verified-limits";

/**
 * An operator editing the words directly, with no model in the loop.
 *
 * The prompt path asks a model to interpret a sentence and propose a change.
 * This path has nothing to interpret: a person typed the caption they want, and
 * the caption they typed is the caption that gets stored. That is the whole
 * difference, and it is worth having as a separate path — "make the hook
 * punchier" and "the hook should read exactly this" are different requests, and
 * answering the second with a model means the operator does not get what they
 * asked for.
 *
 * It reuses the patch allowlist rather than writing to the manifest directly.
 * The rules about what an approval covers — spend, channels, assets,
 * measurement — do not become negotiable because a human is typing.
 */

const editFieldSchema = z.string().trim().max(4_000);

export const operatorEditSchema = z.strictObject({
  directionId: z.string().uuid(),
  /** Index into that direction's copy array, as rendered. */
  copyIndex: z.number().int().min(0).max(40),
  hook: editFieldSchema.min(1).max(200),
  caption: editFieldSchema.min(1).max(2_200),
  callToAction: editFieldSchema.min(1).max(120),
  timingRationale: editFieldSchema.min(1).max(600),
  hashtagSetIndex: z.number().int().min(0).max(40).nullable(),
  tags: z.array(z.string().trim().min(1).max(80)).max(40).nullable(),
});
export type OperatorEdit = z.infer<typeof operatorEditSchema>;

export type OperatorEditResult =
  | { outcome: "accepted"; manifest: CampaignBundleManifest; digest: string; diff: CampaignDiff }
  | PatchRejection
  | { outcome: "rejected"; reason: "content_policy"; message: string };

/**
 * Applies one direction's edited copy, then re-runs every content rule.
 *
 * The schema check inside the patch service proves the result is still a
 * manifest. It does not prove the result is publishable: a caption a person
 * typed can exceed a platform limit or use a restricted term exactly as a
 * generated one can. Skipping the policy pass because the author was human
 * would make hand-editing the way around the rules.
 */
/**
 * The first restricted term any of these fields contains, if any.
 *
 * Whole-word and case-insensitive. A substring match would reject "classic"
 * for containing "class", and an operator who cannot work out why their caption
 * is refused will paste it somewhere the platform cannot see.
 */
function findRestrictedTerm(
  fields: readonly string[],
  restrictedTerms: readonly string[],
): string | null {
  for (const term of restrictedTerms) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`\\b${escaped}\\b`, "i");
    if (fields.some((field) => pattern.test(field))) return term;
  }
  return null;
}

/** Identity of a violation, so the same one before and after is recognised. */
function violationKey(violation: { code: string; path?: readonly (string | number)[] }): string {
  return `${violation.code}@${(violation.path ?? []).join(".")}`;
}

export function applyOperatorEdit(input: {
  base: CampaignBundleManifest;
  edit: OperatorEdit;
  restrictedTerms: readonly string[];
}): OperatorEditResult {
  const directionIndex = input.base.directions.findIndex(
    (direction) => direction.id === input.edit.directionId,
  );
  if (directionIndex < 0) {
    return {
      outcome: "rejected",
      reason: "malformed_patch",
      message: "That direction is not part of this version.",
    };
  }

  const prefix = `directions[${directionIndex}].copy[${input.edit.copyIndex}]`;
  const operations: PatchOperation[] = [
    { path: `${prefix}.hook`, operation: "replace", value: input.edit.hook },
    { path: `${prefix}.caption`, operation: "replace", value: input.edit.caption },
    { path: `${prefix}.callToAction`, operation: "replace", value: input.edit.callToAction },
    { path: `${prefix}.timingRationale`, operation: "replace", value: input.edit.timingRationale },
  ];

  if (input.edit.hashtagSetIndex !== null && input.edit.tags !== null) {
    operations.push({
      path: `directions[${directionIndex}].hashtagSets[${input.edit.hashtagSetIndex}].tags`,
      operation: "replace",
      value: [...input.edit.tags],
    });
  }

  const patched = applyCampaignPatch({
    base: input.base,
    scope: "direction",
    proposal: { operations, summary: "Edited by an operator." },
  });

  if (patched.outcome === "rejected") return patched;

  // Only violations this edit *introduces* refuse it.
  //
  // A version can become non-compliant without anyone touching it: the verified
  // provider contract changes, a limit is withdrawn, and copy that was fine
  // yesterday is flagged today. Refusing every edit to such a version would
  // leave the operator unable to fix the very thing being complained about, so
  // pre-existing violations are carried rather than blamed on whoever edits
  // next. Anything the edit adds is still refused.
  const limitsByChannel = verifiedChannelLimits();
  const before = new Set(
    evaluateContentPolicy({
      manifest: input.base,
      limitsByChannel,
      restrictedTerms: input.restrictedTerms,
    }).violations.map(violationKey),
  );

  const introduced = evaluateContentPolicy({
    manifest: patched.manifest,
    limitsByChannel,
    restrictedTerms: input.restrictedTerms,
  }).violations.filter((violation) => !before.has(violationKey(violation)));

  // Content policy scans hashtags for restricted terms but not copy, so the
  // fields an operator just typed are scanned here. This is the one place a
  // person writes publishable text directly, and shipping it unchecked would
  // make hand-editing the way to say something the brand forbids.
  const restricted = findRestrictedTerm(
    [input.edit.hook, input.edit.caption, input.edit.callToAction],
    input.restrictedTerms,
  );
  if (restricted) {
    return {
      outcome: "rejected",
      reason: "content_policy",
      message: `This copy uses “${restricted}”, which this organization does not allow.`,
    };
  }

  if (introduced.length > 0) {
    return {
      outcome: "rejected",
      reason: "content_policy",
      // The first one, in the operator's own terms. The rest follow once this
      // is fixed; a wall of rule names is not how anyone edits copy.
      message: introduced[0]!.message,
    };
  }

  return {
    outcome: "accepted",
    manifest: patched.manifest,
    digest: patched.digest,
    diff: patched.diff,
  };
}
