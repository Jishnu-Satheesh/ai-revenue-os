import type {
  ComputedComponent,
  CompletenessGrade,
  CostComponentDefinition,
  CostComponentRate,
  DerivedMargin,
  EconomicsBasis,
  EconomicsQualityTier,
  IndicativeMargin,
  MarginOutcome,
  ReportedMargin,
} from "@/domain/economics/types";

/**
 * The contribution margin identity and the grading that decides whether the
 * result may be shown at all.
 *
 * Two rules do the real work. A component that applies but has no rate is
 * `missing`, which makes the whole margin `indicative` and unshowable as a
 * figure — that is what keeps the ledger honest for the many small businesses
 * that do not know their true cost of goods. And a margin is only ever as
 * trustworthy as its weakest input, so one platform default drags an otherwise
 * measured period down to `partial`.
 *
 * See `specs/012-channel-economics-ledger.md` sections 4.1 to 4.4.
 */

/** Ascending trust, so the weakest contributor is the lowest index. */
const TIER_RANK: Readonly<Record<EconomicsQualityTier, number>> = {
  missing: 0,
  assumed: 1,
  estimated: 2,
  derived: 3,
  measured: 4,
};

export function appliesToChannel(
  definition: CostComponentDefinition,
  channel: string | null,
): boolean {
  if (definition.appliesToChannels === null) return true;
  if (channel === null) return false;
  return definition.appliesToChannels.includes(channel);
}

/**
 * A component's cost for the period, in minor units.
 *
 * Rounding happens once, here, on the period total. Rounding each transaction
 * and summing would drift by up to half a fils per order, which on a few
 * thousand orders is a real number in the wrong direction.
 */
export function computeComponentAmount(
  definition: CostComponentDefinition,
  rate: CostComponentRate,
  basis: EconomicsBasis,
): number | null {
  switch (definition.computationKind) {
    case "fixed_amount":
      return rate.amountMinor === undefined
        ? null
        : Math.round(rate.amountMinor * basis.transactionCount);

    case "per_unit":
      // Per unit, not per transaction. Without a unit count the amount is
      // unknowable rather than zero, and guessing one order equals one unit
      // would understate packaging on every multi-item basket.
      if (rate.amountMinor === undefined || basis.unitCount === undefined) return null;
      return Math.round(rate.amountMinor * basis.unitCount);

    case "rate_of_revenue":
      return rate.rateOfRevenue === undefined
        ? null
        : Math.round(basis.grossRevenueMinor * rate.rateOfRevenue);

    case "sourced":
      return rate.sourcedAmountMinor ?? null;
  }
}

export function deriveCompletenessGrade(
  components: readonly Pick<ComputedComponent, "qualityTier">[],
): CompletenessGrade {
  const weakest = components.reduce<EconomicsQualityTier>(
    (worst, component) =>
      TIER_RANK[component.qualityTier] < TIER_RANK[worst] ? component.qualityTier : worst,
    "measured",
  );

  if (weakest === "missing") return "indicative";
  if (weakest === "assumed" || weakest === "estimated") return "partial";
  return "complete";
}

export type ComputeMarginInput = {
  basis: EconomicsBasis;
  definitions: readonly CostComponentDefinition[];
  rates: readonly CostComponentRate[];
  /** The channel this period covers, used to decide which components apply. */
  channel: string | null;
};

/**
 * Derives a margin from its components.
 *
 * Every applicable definition produces a component, including the ones with no
 * usable rate. Omitting those would turn an unknown cost into a zero cost and
 * quietly inflate the margin, which is the single most expensive mistake this
 * ledger can make.
 */
export function computeDerivedMargin(input: ComputeMarginInput): DerivedMargin | IndicativeMargin {
  const ratesByKey = new Map(input.rates.map((rate) => [rate.key, rate]));
  const components: ComputedComponent[] = [];

  for (const definition of input.definitions) {
    if (!appliesToChannel(definition, input.channel)) continue;

    const rate = ratesByKey.get(definition.key);
    const amount = rate ? computeComponentAmount(definition, rate, input.basis) : null;

    components.push({
      key: definition.key,
      label: definition.label,
      amountMinor: amount ?? 0,
      qualityTier: amount === null ? "missing" : rate!.qualityTier,
    });
  }

  const known = components.filter((component) => component.qualityTier !== "missing");
  const knownCostMinor = known.reduce((total, component) => total + component.amountMinor, 0);
  const grade = deriveCompletenessGrade(components);

  if (grade === "indicative") {
    return {
      marginSource: "derived",
      grade,
      atMostMinor: input.basis.grossRevenueMinor - knownCostMinor,
      grossRevenueMinor: input.basis.grossRevenueMinor,
      currency: input.basis.currency,
      components,
      missingComponentKeys: components
        .filter((component) => component.qualityTier === "missing")
        .map((component) => component.key),
    };
  }

  return {
    marginSource: "derived",
    grade,
    contributionMarginMinor: input.basis.grossRevenueMinor - knownCostMinor,
    grossRevenueMinor: input.basis.grossRevenueMinor,
    currency: input.basis.currency,
    components,
  };
}

/**
 * Records a margin an operator's export stated outright.
 *
 * Measured but not decomposed. It is a usable decision input because the figure
 * itself is measured; it simply cannot answer what ate the margin.
 */
export function recordReportedMargin(input: {
  basis: EconomicsBasis;
  contributionMarginMinor: number;
  qualityTier: ReportedMargin["qualityTier"];
}): ReportedMargin {
  return {
    marginSource: "reported",
    grade:
      input.qualityTier === "measured" || input.qualityTier === "derived" ? "complete" : "partial",
    contributionMarginMinor: input.contributionMarginMinor,
    grossRevenueMinor: input.basis.grossRevenueMinor,
    currency: input.basis.currency,
    qualityTier: input.qualityTier,
  };
}

/**
 * Where an entry has both a derived margin and a reported one, the derived
 * value stands and the disagreement is surfaced.
 *
 * Reconciling them silently would hide either a wrong rate or a wrong export,
 * and an operator needs to know which. A tolerance in minor units rather than a
 * percentage keeps small absolute gaps on tiny periods from reading as alarming.
 */
export function reconcileReportedMargin(input: {
  derived: MarginOutcome;
  reportedMinor: number;
  toleranceMinor?: number;
}): { agrees: boolean; differenceMinor: number } | null {
  if (input.derived.grade === "indicative") return null;

  const derivedMinor = (input.derived as DerivedMargin | ReportedMargin).contributionMarginMinor;
  const differenceMinor = derivedMinor - input.reportedMinor;

  return {
    agrees: Math.abs(differenceMinor) <= (input.toleranceMinor ?? 0),
    differenceMinor,
  };
}
