import { GradeBadge } from "@/components/economics/grade-badge";
import { StatusBadge } from "@/components/ui/status-badge";
import type { CompletenessGrade } from "@/domain/economics/types";
import type { RolledComponent } from "@/domain/economics/rollup";
import { fromMinorUnits } from "@/domain/reference/currencies";

/**
 * What is eating the margin — the second question in `specs/012` section 7.
 *
 * Built from proportional bars rather than a charting library: five to eight
 * rows on one shared baseline make the arithmetic visible, and a dependency
 * would buy nothing here.
 *
 * A zero renders as a visible tick rather than nothing. Dine-in commission
 * genuinely is zero, and a priced zero must not look the same as a cost nobody
 * has told us about — that distinction is the whole point of the ledger.
 */
export function MarginWaterfall({
  channel,
  components,
  grossRevenueMinor,
  contributionMarginMinor,
  grade,
  currency,
}: {
  channel: string | null;
  components: readonly RolledComponent[];
  grossRevenueMinor: number;
  contributionMarginMinor: number;
  grade: CompletenessGrade;
  currency: string;
}) {
  const widthOf = (amount: number) =>
    grossRevenueMinor === 0 ? 0 : Math.min(100, (amount / grossRevenueMinor) * 100);

  return (
    <div className="flex flex-col gap-1">
      <Row
        label="Gross revenue"
        amountMinor={grossRevenueMinor}
        currency={currency}
        width={100}
        barClassName="bg-chart-5"
      />

      {components.map((component, index) => (
        <Row
          key={component.key}
          label={component.label}
          amountMinor={component.amountMinor}
          currency={currency}
          width={widthOf(component.amountMinor)}
          // Descending emerald steps, so each cost reads as a slice taken out
          // of the revenue bar above it.
          barClassName={COST_BARS[index % COST_BARS.length]}
          negative={component.qualityTier !== "missing"}
          tier={component.qualityTier}
        />
      ))}

      <div className="mt-2 border-t border-border pt-2">
        <Row
          label="Contribution margin"
          amountMinor={contributionMarginMinor}
          currency={currency}
          width={widthOf(contributionMarginMinor)}
          barClassName="bg-primary"
          emphasis
          trailing={<GradeBadge grade={grade} />}
        />
      </div>

      <p className="sr-only">{`Component breakdown for ${channel ?? "all channels"}.`}</p>
    </div>
  );
}

const COST_BARS = ["bg-chart-2", "bg-chart-3", "bg-chart-1", "bg-chart-4"] as const;

function Row({
  label,
  amountMinor,
  currency,
  width,
  barClassName,
  negative = false,
  emphasis = false,
  tier,
  trailing,
}: {
  label: string;
  amountMinor: number;
  currency: string;
  width: number;
  barClassName: string;
  negative?: boolean;
  emphasis?: boolean;
  tier?: RolledComponent["qualityTier"];
  trailing?: React.ReactNode;
}) {
  const missing = tier === "missing";

  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="flex w-52 shrink-0 items-center gap-2">
        <span className={emphasis ? "text-sm font-medium" : "text-sm"}>{label}</span>
        {tier ? <TierChip tier={tier} /> : null}
      </div>

      <div className="h-5 min-w-0 flex-1 rounded bg-muted/70">
        {/* A priced zero still gets a 2px tick. An empty track would read as
            "we do not know", which is a different and much worse claim. */}
        <div
          className={`h-full rounded ${missing ? "bg-transparent" : barClassName}`}
          style={{ width: `${Math.max(width, amountMinor === 0 && !missing ? 0.4 : 0)}%` }}
        />
      </div>

      <div className="flex w-44 shrink-0 items-center justify-end gap-2">
        {missing ? (
          <span className="text-sm text-muted-foreground">Unknown</span>
        ) : (
          <span
            className={`text-sm tabular-nums ${emphasis ? "font-medium" : "text-muted-foreground"}`}
          >
            {negative ? "−" : ""}
            {currency}{" "}
            {Number(fromMinorUnits(amountMinor, currency)).toLocaleString("en-US", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
        )}
        {trailing}
      </div>
    </div>
  );
}

const TIER_LABEL: Readonly<Record<RolledComponent["qualityTier"], string>> = {
  measured: "Measured",
  derived: "Derived",
  estimated: "Estimated",
  assumed: "Assumed",
  missing: "Missing",
};

function TierChip({ tier }: { tier: RolledComponent["qualityTier"] }) {
  if (tier === "measured" || tier === "derived")
    return <StatusBadge label={TIER_LABEL[tier]} tone="success" />;
  if (tier === "missing") return <StatusBadge label={TIER_LABEL[tier]} />;
  return <StatusBadge label={TIER_LABEL[tier]} tone="warning" />;
}
