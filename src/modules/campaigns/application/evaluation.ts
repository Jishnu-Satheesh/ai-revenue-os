import {
  campaignBundleModelManifestSchema,
  campaignBundleSchema,
} from "@/domain/campaigns/schemas";
import type { CampaignBundleManifest } from "@/domain/campaigns/schemas";
import type { GeneratedAssetTruthClass } from "@/domain/campaigns/truth-class";
import {
  evaluateContentPolicy,
  type ChannelContentLimits,
  type ContentPolicyViolation,
} from "@/domain/campaigns/content-policy";
import type { CampaignChannel } from "@/domain/campaigns/schemas";
import type { GenerationContext } from "@/modules/campaigns/application/generation-context";

/**
 * What has to be true before generated creative can become a bundle version.
 *
 * The order matters. Shape is checked first, because nothing else can be
 * evaluated on an object that is not a manifest. Then truth — every claim
 * traceable to pinned evidence — then policy. A model that produced beautiful,
 * on-brand copy asserting a discount nobody approved must fail, and fail for
 * that reason rather than a schema complaint.
 */

export type EvaluationFailure = {
  code:
    | "malformed_manifest"
    | "unsourced_claim"
    | "invented_offer"
    | "invented_metric"
    | "cross_tenant_asset"
    | "currency_mismatch"
    | "content_policy"
    | "too_many_assets"
    | "action_scheduled_in_past"
    | "policy_expired"
    | "unsourced_locked_assertion"
    | "locked_offer_without_offer";
  detail: string;
  path?: readonly (string | number)[];
};

export type EvaluationResult =
  | { outcome: "valid"; manifest: CampaignBundleManifest }
  | { outcome: "invalid"; failures: readonly EvaluationFailure[] };

export type EvaluationInput = {
  candidate: unknown;
  context: GenerationContext;
  /** Derived from the resolver outcome. A model never supplies this claim. */
  truthClass: GeneratedAssetTruthClass;
  /** Exact positive reference versions pinned for this run. */
  derivedFromBrandAssetVersionIds: readonly string[];
  limitsByChannel: Partial<Record<CampaignChannel, ChannelContentLimits>>;
  /** Asset ids the planner actually produced for this campaign. */
  producedAssetIds: readonly string[];
  maxAssets?: number;
};

const DEFAULT_MAX_ASSETS = 12;

export function evaluateGeneratedBundle(input: EvaluationInput): EvaluationResult {
  const modelParsed = campaignBundleModelManifestSchema.safeParse(input.candidate);
  if (!modelParsed.success) {
    return {
      outcome: "invalid",
      failures: modelParsed.error.issues.slice(0, 20).map((issue) => ({
        code: "malformed_manifest" as const,
        detail: issue.message,
        path: issue.path.map((segment) => segment as string | number),
      })),
    };
  }

  if (modelParsed.data.assets.some((asset) => asset.provenance.kind !== "generated")) {
    return {
      outcome: "invalid",
      failures: [
        {
          code: "malformed_manifest",
          detail: "A generation model may declare only generated assets.",
          path: ["assets"],
        },
      ],
    };
  }

  const parsed = campaignBundleSchema.safeParse({
    ...modelParsed.data,
    assets: modelParsed.data.assets.map((asset) => ({
      ...asset,
      truthClass: input.truthClass,
      provenance: {
        ...asset.provenance,
        derivedFromBrandAssetVersionIds: [...input.derivedFromBrandAssetVersionIds],
      },
    })),
  });
  if (!parsed.success) {
    return {
      outcome: "invalid",
      failures: parsed.error.issues.slice(0, 20).map((issue) => ({
        code: "malformed_manifest" as const,
        detail: issue.message,
        path: issue.path.map((segment) => segment as string | number),
      })),
    };
  }

  const manifest = parsed.data;
  const failures: EvaluationFailure[] = [];

  failures.push(...checkTenantAssets(manifest, input.producedAssetIds));
  failures.push(...checkAssetCount(manifest, input.maxAssets ?? DEFAULT_MAX_ASSETS));
  failures.push(...checkCurrency(manifest, input.context));
  failures.push(...checkSchedule(manifest, input.context));
  failures.push(...checkGenerationPolicy(manifest, input.context));
  failures.push(...checkClaims(manifest, input.context));

  const policy = evaluateContentPolicy({
    manifest,
    limitsByChannel: input.limitsByChannel,
    restrictedTerms: input.context.restrictedTerms,
  });
  failures.push(...policy.violations.map(toPolicyFailure));

  return failures.length === 0 ? { outcome: "valid", manifest } : { outcome: "invalid", failures };
}

/**
 * An asset the planner did not produce is not this campaign's asset.
 *
 * The realistic failure is not an attacker; it is a model reusing an id it saw
 * in an example. Either way the result is a bundle pointing at bytes from
 * somewhere else, which must never reach storage.
 */
function checkTenantAssets(
  manifest: CampaignBundleManifest,
  producedAssetIds: readonly string[],
): EvaluationFailure[] {
  const produced = new Set(producedAssetIds);
  return manifest.assets
    .filter((asset) => !produced.has(asset.id))
    .map((asset) => ({
      code: "cross_tenant_asset" as const,
      detail: `Asset ${asset.id} was not produced for this campaign.`,
      path: ["assets"],
    }));
}

function checkAssetCount(manifest: CampaignBundleManifest, maxAssets: number): EvaluationFailure[] {
  if (manifest.assets.length <= maxAssets) return [];
  return [
    {
      code: "too_many_assets",
      detail: `The bundle carries ${manifest.assets.length} assets and the ceiling is ${maxAssets}.`,
      path: ["assets"],
    },
  ];
}

function checkCurrency(
  manifest: CampaignBundleManifest,
  context: GenerationContext,
): EvaluationFailure[] {
  const ceiling = manifest.totalSpendCeiling;
  if (!ceiling || ceiling.currency === context.currency) return [];
  return [
    {
      code: "currency_mismatch",
      detail: `The bundle is capped in ${ceiling.currency} but the organization trades in ${context.currency}.`,
      path: ["totalSpendCeiling", "currency"],
    },
  ];
}

/**
 * Nothing may be scheduled before there is time to approve it.
 *
 * Checked here rather than in `campaignBundleSchema` on purpose. The schema is
 * also how stored bundles are read back, and a rule about "now" would make last
 * month's approved campaign fail to parse today — turning immutable evidence
 * into something that expires. This is a rule about what may be *accepted*, so
 * it belongs at acceptance.
 */
function checkSchedule(
  manifest: CampaignBundleManifest,
  context: GenerationContext,
): EvaluationFailure[] {
  const earliest = Date.parse(context.earliestScheduledFor);
  if (!Number.isFinite(earliest)) return [];

  return manifest.actions.flatMap((action, index) => {
    const scheduled = Date.parse(action.scheduledFor);
    if (!Number.isFinite(scheduled) || scheduled >= earliest) return [];
    return [
      {
        code: "action_scheduled_in_past" as const,
        detail: `An action is scheduled for ${action.scheduledFor}, before the earliest permitted time of ${context.earliestScheduledFor}.`,
        path: ["actions", index, "scheduledFor"],
      },
    ];
  });
}

/**
 * The licence to generate has to be worth something when it is granted.
 *
 * Like `checkSchedule`, this is deliberately not a schema rule. Whether a
 * policy window is still open is a question with a clock in it, and asking it
 * at parse time would make an approved campaign unreadable the moment its
 * window closed — losing the record of what was approved along with it.
 *
 * The locked assertions get the same treatment as any other claim: a variant
 * may repeat what the organization actually recorded, so a policy that locks a
 * claim nobody has evidence for is authorizing an invention in advance.
 */
function checkGenerationPolicy(
  manifest: CampaignBundleManifest,
  context: GenerationContext,
): EvaluationFailure[] {
  const failures: EvaluationFailure[] = [];
  const policy = manifest.generationPolicy;

  const expiresAt = Date.parse(policy.policyExpiresAt);
  const generatedAt = Date.parse(context.generatedAt);
  if (Number.isFinite(expiresAt) && Number.isFinite(generatedAt) && expiresAt <= generatedAt) {
    failures.push({
      code: "policy_expired",
      detail: `The policy expires at ${policy.policyExpiresAt}, at or before the ${context.generatedAt} it was generated at, so it authorizes nothing.`,
      path: ["generationPolicy", "policyExpiresAt"],
    });
  }

  const factKeys = new Set(context.facts.map((fact) => fact.key));
  for (const [index, key] of policy.lockedAssertionKeys.entries()) {
    if (!factKeys.has(key)) {
      failures.push({
        code: "unsourced_locked_assertion",
        detail: `The policy locks assertion "${key}", which is not in the pinned evidence this campaign may draw from.`,
        path: ["generationPolicy", "lockedAssertionKeys", index],
      });
    }
  }

  // A policy naming an offer for a campaign that records none would let every
  // variant sell something the organization never agreed to sell.
  if (policy.lockedOfferRef !== null && context.offer === null) {
    failures.push({
      code: "locked_offer_without_offer",
      detail: `The policy locks offer "${policy.lockedOfferRef}" but this campaign has no recorded offer.`,
      path: ["generationPolicy", "lockedOfferRef"],
    });
  }

  return failures;
}

/**
 * Every offer and metric the creative names must exist in pinned evidence.
 *
 * This is a containment check rather than a language model judging itself. It
 * cannot catch every subtle overstatement, and it is not meant to: it catches
 * the failure that actually happens, which is a confident, specific, entirely
 * invented number or promise.
 */
function checkClaims(
  manifest: CampaignBundleManifest,
  context: GenerationContext,
): EvaluationFailure[] {
  const failures: EvaluationFailure[] = [];
  const evidence = [
    context.objective,
    context.audience,
    context.offer ?? "",
    ...context.facts.map((fact) => `${fact.key} ${fact.value}`),
  ]
    .join(" ")
    .toLowerCase();

  if (manifest.measurementPlan.primaryMetricKey !== context.primaryMetricKey) {
    failures.push({
      code: "invented_metric",
      detail: `The plan measures ${manifest.measurementPlan.primaryMetricKey}, which is not the registered metric ${context.primaryMetricKey}.`,
      path: ["measurementPlan", "primaryMetricKey"],
    });
  }

  if (manifest.measurementPlan.baselineSource !== context.baselineSource) {
    failures.push({
      code: "unsourced_claim",
      detail: "The plan names a baseline the organization did not register.",
      path: ["measurementPlan", "baselineSource"],
    });
  }

  // A campaign with no recorded offer must not produce copy that promises one.
  if (context.offer === null) {
    for (const [directionIndex, direction] of manifest.directions.entries()) {
      for (const [copyIndex, copy] of direction.copy.entries()) {
        const offerish = findOfferClaim(`${copy.hook} ${copy.caption} ${copy.callToAction}`);
        if (offerish && !evidence.includes(offerish)) {
          failures.push({
            code: "invented_offer",
            detail: `Copy promises "${offerish}" but no offer is recorded for this campaign.`,
            path: ["directions", directionIndex, "copy", copyIndex],
          });
        }
      }
    }
  }

  return failures;
}

/**
 * Looks for the shapes an invented promise actually takes: a percentage off, a
 * money amount, or a free-item claim.
 */
function findOfferClaim(text: string): string | null {
  const patterns = [
    /\b\d{1,3}\s?%\s?(?:off|discount)\b/i,
    /\b(?:free|complimentary)\s+[a-z]{3,20}\b/i,
    /\b(?:aed|usd|eur|gbp)\s?\d+(?:\.\d{1,2})?\b/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) return match[0].toLowerCase();
  }
  return null;
}

function toPolicyFailure(violation: ContentPolicyViolation): EvaluationFailure {
  return { code: "content_policy", detail: violation.message, path: violation.path };
}

/**
 * One repair attempt, then stop.
 *
 * An unbounded repair loop is how a generation run quietly spends a fortune and
 * still fails. One pass catches the ordinary case — a model that dropped a
 * required field and fixes it when told — and anything still broken after that
 * is a real failure the operator should see, not a budget to keep burning.
 */
export const MAX_REPAIR_ATTEMPTS = 1;

export type RepairDecision =
  | { action: "accept"; manifest: CampaignBundleManifest }
  | { action: "repair"; attempt: number; failures: readonly EvaluationFailure[] }
  | { action: "fail"; failures: readonly EvaluationFailure[] };

export function decideRepair(result: EvaluationResult, attemptsSoFar: number): RepairDecision {
  if (result.outcome === "valid") return { action: "accept", manifest: result.manifest };
  if (attemptsSoFar < MAX_REPAIR_ATTEMPTS) {
    return { action: "repair", attempt: attemptsSoFar + 1, failures: result.failures };
  }
  return { action: "fail", failures: result.failures };
}

/**
 * The operator-facing reason a generation failed.
 *
 * Deliberately built from stable codes rather than model output: a provider
 * message can echo prompt content, and prompt content can contain anything a
 * customer once wrote into a review.
 */
export function safeFailureSummary(failures: readonly EvaluationFailure[]): string {
  const codes = [...new Set(failures.map((failure) => failure.code))];
  const explanations: Record<EvaluationFailure["code"], string> = {
    malformed_manifest: "the proposal was not a complete campaign",
    unsourced_claim: "it made a claim the evidence does not support",
    invented_offer: "it promised an offer nobody approved",
    invented_metric: "it measured something other than the registered metric",
    cross_tenant_asset: "it referenced an image that does not belong to this campaign",
    currency_mismatch: "its spend ceiling was in the wrong currency",
    content_policy: "it broke a brand or platform rule",
    too_many_assets: "it produced more images than a bundle may carry",
    action_scheduled_in_past: "it scheduled a post before there was time to approve it",
    policy_expired: "its licence to generate had already run out",
    unsourced_locked_assertion: "it locked a claim the evidence does not support",
    locked_offer_without_offer: "it locked an offer this campaign does not have",
  };
  return `Generation was rejected because ${codes.map((code) => explanations[code]).join(", and ")}.`;
}
