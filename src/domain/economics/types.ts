/**
 * Channel economics: what a transaction actually earns after variable cost.
 *
 * Pure arithmetic, deliberately free of `server-only`, so the same identity and
 * the same grading rules hold wherever a margin is shown.
 *
 * See `specs/012-channel-economics-ledger.md`.
 */

/** How a component's amount is arrived at. */
export type CostComputationKind =
  /** A flat amount for each transaction. */
  | "fixed_amount"
  /** A share of gross revenue, which is how most marketplace commissions behave. */
  | "rate_of_revenue"
  /** An amount for each unit sold, which is not the same as each transaction. */
  | "per_unit"
  /** Supplied directly by an integration or import rather than computed. */
  | "sourced";

/** Descending trust, mirroring the source hierarchy in `context/09-business-memory.md`. */
export type EconomicsQualityTier = "measured" | "derived" | "estimated" | "assumed" | "missing";

export type CompletenessGrade = "complete" | "partial" | "indicative";

/** Whether a margin was computed from its parts or handed over whole. */
export type MarginSource = "derived" | "reported";

/**
 * What a registered metric supplies to the ledger.
 *
 * The ledger needs a gross revenue series and, where one exists, a margin the
 * operator's own export stated. The second is pack vocabulary — the Restaurant
 * Pack calls it `margin.contribution` — so the binding is declared on the
 * registry rather than named in core code, and a tenant whose export calls it
 * something else can point the role at their own key.
 */
export type EconomicsRole =
  | "gross_revenue"
  | "transaction_count"
  /** Items sold, which is not the transaction count: packaging is charged per item. */
  | "unit_count"
  | "reported_margin";

/**
 * The metric key resolved for each role.
 *
 * Only revenue is required. A role with nothing behind it is not a failure: no
 * registered metric counts items sold yet, so `unitCount` is absent and
 * packaging stays unpriced, which is the honest answer rather than a startup
 * error.
 */
export type EconomicsMetricBinding = {
  grossRevenue: string;
  transactionCount?: string;
  unitCount?: string;
  reportedMargin?: string;
};

export type CostComponentDefinition = {
  key: string;
  label: string;
  computationKind: CostComputationKind;
  /** Channels the component applies to. `null` means every channel. */
  appliesToChannels: readonly string[] | null;
};

/**
 * What an organization actually pays for a component. Separate from the
 * definition because "commission" is shared vocabulary while 28% on Talabat
 * from March is this tenant's fact, and only the second one changes.
 */
export type CostComponentRate = {
  key: string;
  qualityTier: Exclude<EconomicsQualityTier, "missing">;
  /** Minor units, for `fixed_amount` and `per_unit`. */
  amountMinor?: number;
  /** A share in `0..1`, for `rate_of_revenue`. */
  rateOfRevenue?: number;
  /** Minor units already totalled for the period, for `sourced`. */
  sourcedAmountMinor?: number;
};

/**
 * The revenue and volume a period's costs are computed against.
 *
 * `transactionCount` and `unitCount` are distinct on purpose: a delivery fee is
 * charged per order, packaging per item, and conflating them silently
 * misprices whichever one the shorthand did not mean.
 */
export type EconomicsBasis = {
  grossRevenueMinor: number;
  transactionCount: number;
  unitCount?: number;
  currency: string;
};

export type ComputedComponent = {
  key: string;
  label: string;
  amountMinor: number;
  qualityTier: EconomicsQualityTier;
};

export type DerivedMargin = {
  marginSource: "derived";
  grade: Exclude<CompletenessGrade, "indicative">;
  contributionMarginMinor: number;
  grossRevenueMinor: number;
  currency: string;
  components: readonly ComputedComponent[];
};

/**
 * A margin that cannot be stated, only bounded.
 *
 * The bound is one-sided because a missing cost can only reduce margin, so
 * revenue less what is known is a ceiling and nothing establishes a floor. A
 * symmetric range would imply a precision nobody has.
 */
export type IndicativeMargin = {
  marginSource: "derived";
  grade: "indicative";
  atMostMinor: number;
  grossRevenueMinor: number;
  currency: string;
  components: readonly ComputedComponent[];
  missingComponentKeys: readonly string[];
};

/**
 * A figure an operator's own export stated outright. Measured, but not
 * decomposed, so it answers "how much" and never "what ate it".
 */
export type ReportedMargin = {
  marginSource: "reported";
  grade: Exclude<CompletenessGrade, "indicative">;
  contributionMarginMinor: number;
  grossRevenueMinor: number;
  currency: string;
  qualityTier: Exclude<EconomicsQualityTier, "missing">;
};

export type MarginOutcome = DerivedMargin | IndicativeMargin | ReportedMargin;

/** True when the figure may be read as a scalar contribution margin. */
export function isPresentableMargin(
  outcome: MarginOutcome,
): outcome is DerivedMargin | ReportedMargin {
  return outcome.grade !== "indicative";
}
