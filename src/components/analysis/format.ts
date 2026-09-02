import type {
  WorkspaceFindingView,
  WorkspaceValueView,
} from "@/modules/analysis/application/read-model";

/**
 * Rendering figures that were computed elsewhere.
 *
 * Nothing here derives a value. A percentage is shown from a numerator and a
 * denominator the detector stored separately, because the mean of daily rates
 * is not the period rate and a stored quotient could not be re-aggregated. The
 * division happens at the last possible moment, for display only.
 */

/**
 * Money arrives as integer minor units, and how many minor units make a unit
 * depends on the currency: 100 fils to a dirham, 1000 to a dinar, and none at
 * all to a yen. `Intl` already knows this, so the exponent is read from the
 * formatter rather than from a hand-kept table that would be wrong for the
 * first Kuwaiti client.
 */
export function formatMoney(minorUnits: number, currency: string): string {
  const formatter = new Intl.NumberFormat("en-AE", { style: "currency", currency });
  const exponent = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(minorUnits / 10 ** exponent);
}

/**
 * Money at whole-unit precision, for the big headline figures the draft shows
 * as "AED 553" rather than "AED 553.00". Still divides by the currency's own
 * minor-unit exponent, so a dinar keeps three places and a yen keeps none.
 */
export function formatWholeMoney(minorUnits: number, currency: string): string {
  const base = new Intl.NumberFormat("en-AE", { style: "currency", currency });
  const exponent = base.resolvedOptions().maximumFractionDigits ?? 2;
  const whole = new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  });
  return whole.format(minorUnits / 10 ** exponent);
}

export function formatSignedMoney(minorUnits: number, currency: string): string {
  const formatted = formatMoney(Math.abs(minorUnits), currency);
  if (minorUnits > 0) return `+${formatted}`;
  if (minorUnits < 0) return `−${formatted}`;
  return formatted;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("en-GB").format(value);
}

export function formatPercent(numerator: number, denominator: number): string {
  if (denominator === 0) return "—";
  return `${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 }).format((numerator / denominator) * 100)}%`;
}

/** Percent to two places, for the small headline figures the draft shows as "0.13%". */
export function formatPercentPrecise(numerator: number, denominator: number): string {
  if (denominator === 0) return "—";
  return `${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format((numerator / denominator) * 100)}%`;
}

/** Exact dates as recorded, never a month name. See the readiness panel. */
export function formatWindow(start: string, end: string, timeZone?: string): string {
  return `${start} to ${end}${timeZone ? ` · ${timeZone}` : ""}`;
}

export function formatValue(value: WorkspaceValueView): string {
  if (value.kind === "money") return formatMoney(value.minorUnits, value.currency);
  if (value.kind === "count") return formatCount(value.value);
  return formatPercent(value.numerator, value.denominator);
}

/**
 * The one colour a headline figure may wear, and when.
 *
 * Emerald marks an earned or primary fact and destructive marks a loss;
 * everything else stays foreground so colour keeps meaning instead of becoming
 * decoration. A figure this page could not state is muted rather than coloured,
 * because an unmeasured thing is not a result in either direction.
 */
export function figureToneClass(finding: WorkspaceFindingView): string {
  const { value } = finding;
  if (finding.kind === "needs_data" || !value) return "text-muted-foreground";
  if (value.kind === "money") {
    if (value.minorUnits < 0) return "text-destructive";
    if (value.minorUnits > 0) return "text-primary";
    return "";
  }
  if (finding.monetaryImpact && finding.monetaryImpact.minorUnits < 0) return "text-destructive";
  return "";
}

/**
 * The headline figure for one finding, in the units that finding is about.
 *
 * Switched on the detector's own code rather than on the value's shape, because
 * two ratios can mean different things: a share of revenue reads as a
 * percentage, and a share of periods reads as "14 of 31", and rendering either
 * one as the other would be a quiet lie about what was counted.
 */
export function findingValueLabel(finding: WorkspaceFindingView): string | null {
  const { value } = finding;
  if (!value) return null;

  if (
    finding.code === "PERIOD_COVERAGE_COMPLETE" ||
    finding.code === "PERIOD_COVERAGE_INCOMPLETE"
  ) {
    return value.kind === "ratio"
      ? `${formatCount(value.numerator)} of ${formatCount(value.denominator)} periods`
      : null;
  }

  if (finding.code === "CHANNEL_REVENUE_SHARE" && value.kind === "ratio") {
    return value.currency
      ? `${formatPercent(value.numerator, value.denominator)} · ${formatMoney(value.numerator, value.currency)} of ${formatMoney(value.denominator, value.currency)}`
      : formatPercent(value.numerator, value.denominator);
  }

  if (finding.code === "EVIDENCE_HELD_FOR_DECISION" || finding.code === "NO_EVIDENCE_HELD") {
    return value.kind === "count"
      ? `${formatCount(value.value)} ${value.value === 1 ? "decision" : "decisions"} outstanding`
      : null;
  }

  if (finding.code.startsWith("REVENUE_PERIOD_MOVEMENT_") && value.kind === "money") {
    const movement = formatSignedMoney(value.minorUnits, value.currency);
    // The base only appears when the detector recorded one. A prior period of
    // zero has no proportional change, and inventing "+100%" would be arithmetic
    // about nothing.
    return value.base
      ? `${movement} · ${formatPercent(value.minorUnits, value.base)} against ${formatMoney(value.base, value.currency)}`
      : movement;
  }

  return formatValue(value);
}
