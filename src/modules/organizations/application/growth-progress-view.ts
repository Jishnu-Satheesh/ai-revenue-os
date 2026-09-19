import { z } from "zod";

import { isoDateSchema, type GrowthHorizonMonths } from "@/domain/organizations/growth-periods";
import {
  actualCoverageReasonSchema,
  currencySchema,
  growthComparisonSchema,
  type GrowthComparison,
} from "@/domain/organizations/growth-progress";

/**
 * Browser-safe view types for the Overview growth section (data contract D07).
 *
 * Like a museum label next to the exhibit: it carries the dates, the two
 * values at each date and where they came from — never the vault's raw
 * documents, and never titles the viewer is not allowed to see.
 *
 * No database, crypto, model or Node built-in is touched, so Client
 * Components may import this module directly.
 */

export const growthProgressPointViewSchema = z.strictObject({
  date: isoDateSchema,
  currentMinor: z.number().int().nullable(),
  projectedLowMinor: z.number().int().nullable(),
  projectedCentralMinor: z.number().int().nullable(),
  projectedHighMinor: z.number().int().nullable(),
  currentCoverage: z.enum(["complete", "missing", "conflict", "incomparable"]),
  /** Why the blue line has no comparable value here; null when coverage is complete. */
  reasonCode: actualCoverageReasonSchema.nullable(),
  /** True when the blue line must break before this point instead of bridging a gap. */
  breakBefore: z.boolean(),
});
export type GrowthProgressPointView = z.output<typeof growthProgressPointViewSchema>;

export const growthAdviceRelationSchema = z.enum(["recovery", "expansion", "general"]);
export type GrowthAdviceRelation = z.output<typeof growthAdviceRelationSchema>;

export const growthAdviceRowSchema = z.strictObject({
  id: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(200),
  supportingText: z.string().trim().min(1).max(1000),
  href: z.string().trim().min(1).max(500).nullable(),
  relation: growthAdviceRelationSchema,
});
export type GrowthAdviceRow = z.output<typeof growthAdviceRowSchema>;

export const growthProgressViewStateSchema = z.enum([
  "ready",
  "upcoming",
  "awaiting_reports",
  "missing",
  "unavailable",
]);
export type GrowthProgressViewState = z.output<typeof growthProgressViewStateSchema>;

export const growthProgressPeriodViewSchema = z.strictObject({
  horizonMonths: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]),
  cycleIndex: z.number().int().min(0),
  startDate: isoDateSchema,
  endDateExclusive: isoDateSchema,
});
export type GrowthProgressPeriodView = z.output<typeof growthProgressPeriodViewSchema>;

export const growthProgressFreshnessSchema = z.strictObject({
  status: z.enum(["fresh", "stale", "awaiting_reports"]),
  note: z.string().trim().min(1).max(300).nullable(),
});
export type GrowthProgressFreshness = z.output<typeof growthProgressFreshnessSchema>;

/** Permission-safe source label with an already validated reference; no denied titles. */
export const growthProgressSourceViewSchema = z.strictObject({
  label: z.string().trim().min(1).max(200),
  href: z.string().trim().min(1).max(500).nullable(),
});
export type GrowthProgressSourceView = z.output<typeof growthProgressSourceViewSchema>;

export const growthProgressViewSchema = z.strictObject({
  horizonMonths: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]),
  state: growthProgressViewStateSchema,
  reasonCode: z.string().trim().min(1).max(120).nullable(),
  projectionId: z.string().uuid().nullable(),
  projectionDigest: z.string().trim().min(1).max(256).nullable(),
  period: growthProgressPeriodViewSchema,
  currency: currencySchema.nullable(),
  scopeLabel: z.string().trim().min(1).max(300),
  issuedAt: z.string().nullable(),
  sourceCutoffDate: isoDateSchema.nullable(),
  latestComparableDate: isoDateSchema.nullable(),
  points: z.array(growthProgressPointViewSchema).max(368),
  latestComparison: growthComparisonSchema.nullable(),
  adviceRows: z.array(growthAdviceRowSchema).max(2),
  limitations: z.array(z.string().trim().min(1).max(300)).max(20),
  freshness: growthProgressFreshnessSchema,
  sources: z.array(growthProgressSourceViewSchema).max(100),
});
export type GrowthProgressView = Omit<
  z.output<typeof growthProgressViewSchema>,
  "latestComparison"
> & {
  latestComparison: GrowthComparison | null;
};

export const growthProgressViewsSchema = z.strictObject({
  1: growthProgressViewSchema,
  3: growthProgressViewSchema,
  6: growthProgressViewSchema,
  12: growthProgressViewSchema,
});
export type GrowthProgressViews = Record<GrowthHorizonMonths, GrowthProgressView>;

export const growthProgressSectionSchema = z.union([
  z.strictObject({ state: z.literal("disabled") }),
  z.strictObject({
    state: z.literal("failed"),
    reasonCode: z.string().trim().min(1).max(120).nullable(),
    /**
     * Last readable horizon view, kept so a refresh failure can stay
     * labelled with its own report date. Null on the initial load, where
     * the shaped failure state is the honest surface.
     */
    retainedView: growthProgressViewSchema.nullable(),
  }),
  z.strictObject({
    state: z.literal("ready"),
    initialHorizon: z.literal(3),
    /**
     * Server-derived owner/admin flag for the on-demand worker trigger.
     * The button renders only on a blank (missing-projection) view when
     * this is true; the route re-checks the role, so a forged view cannot
     * widen access.
     */
    canTriggerImmediatePublication: z.boolean(),
    views: growthProgressViewsSchema,
  }),
]);
export type GrowthProgressSection =
  | { state: "disabled" }
  | { state: "failed"; reasonCode: string | null; retainedView: GrowthProgressView | null }
  | {
      state: "ready";
      initialHorizon: 3;
      canTriggerImmediatePublication: boolean;
      views: GrowthProgressViews;
    };

/**
 * Single construction sites for the two non-ready section states, so the
 * home loader and the growth service never drift on what "off" looks like.
 * Disabled is the flag-off and rollback shape; failed carries the safe code.
 */
export function disabledGrowthProgressSection(): GrowthProgressSection {
  return { state: "disabled" };
}

export function failedGrowthProgressSection(
  reasonCode: string | null,
  retainedView: GrowthProgressView | null = null,
): GrowthProgressSection {
  return { state: "failed", reasonCode, retainedView };
}
