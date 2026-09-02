import { AlertTriangle } from "lucide-react";

import { allocationRuleCopy, TRUNCATION_CAUSE_COPY } from "@/components/campaigns/allocation-copy";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";

/**
 * The settled result and its proof, laid out for an operator to interrogate.
 *
 * A conclusion an operator cannot re-derive from the record is a conclusion
 * they cannot trust, so every section shows the fact behind the verdict rather
 * than a summary of it: the preregistered hypothesis, planned versus realized
 * exposure, the baseline and window, the estimate and its range, spend, the
 * guardrail, the evidence tier and method, why exposure fell short, the
 * limitations, and a plain statement of why the verdict carries its label.
 *
 * Metric keys, baseline sources, and verdicts are shown in plain words — the
 * raw identifiers stay in the database and in the audit record. The "why"
 * wording is deterministic and passes the no-overclaim validator in the
 * measurement domain; a result that was not validated never reads as causal.
 * Times render in the organization's timezone.
 */

export type OutcomeTruncation = {
  variantId: string;
  cause: "agent_pause" | "operator_pause" | "guardrail";
  ruleKey: string | null;
  at: string;
};

export type OutcomeProofData = {
  id: string;
  verdict: "validated_outcome" | "inconclusive" | "guardrail_breach" | "execution_only";
  attributionMethod: "observational_prepost" | "provider_randomized_experiment";
  primaryMetricKey: string;
  outcomeWindowDays: number;
  settlementDelayDays: number;
  baselineSource: string;
  baselineLookbackDays: number;
  plannedExposureCount: number | null;
  realizedExposureCount: number | null;
  guardrailState: "breached" | "clear" | "unmeasured";
  realizedSpendMinor: number | null;
  spendCeilingMinor: number | null;
  spendCurrency: string | null;
  estimateMinor: number | null;
  estimateLowMinor: number | null;
  estimateHighMinor: number | null;
  estimateCurrency: string | null;
  evidenceTier: "computed" | "observed" | null;
  truncationCauses: unknown;
  limitations: unknown;
  settledAt: string;
};

const VERDICT_COPY: Readonly<
  Record<
    OutcomeProofData["verdict"],
    { label: string; tone: "success" | "warning" | "danger" | "neutral" }
  >
> = {
  validated_outcome: { label: "Validated outcome", tone: "success" },
  inconclusive: { label: "Inconclusive", tone: "neutral" },
  guardrail_breach: { label: "Guardrail breach", tone: "danger" },
  execution_only: { label: "Execution only", tone: "neutral" },
};

const VERDICT_EXPLANATION: Readonly<Record<OutcomeProofData["verdict"], string>> = {
  validated_outcome:
    "The preregistered method's evidence bar was met, so this result is reported as validated.",
  inconclusive:
    "The campaign ran and its results were recorded, but the preregistered evidence bar was not met. The result is reported as inconclusive.",
  guardrail_breach:
    "A registered guardrail was breached, so the campaign is reported as a guardrail breach regardless of the primary metric.",
  execution_only:
    "The campaign ran, but no observation of the primary metric was recorded, so no conclusion is drawn.",
};

const METRIC_LABELS: Readonly<Record<string, string>> = {
  "margin.contribution": "Contribution margin",
  "revenue.gross": "Gross revenue",
  "revenue.purchase_value": "Purchase value",
  "transactions.count": "Transactions",
  "units.count": "Units sold",
};

const METHOD_LABEL: Readonly<Record<OutcomeProofData["attributionMethod"], string>> = {
  observational_prepost: "Before-and-after comparison (observational)",
  provider_randomized_experiment: "Provider randomized experiment",
};

const GUARDRAIL_LABEL: Readonly<Record<OutcomeProofData["guardrailState"], string>> = {
  breached: "Breached",
  clear: "Clear",
  unmeasured: "Not measured",
};

function metricLabel(key: string): string {
  return METRIC_LABELS[key] ?? key;
}

/** Turns a stored baseline source like `goal_baseline_measured:<key>` into words. */
function baselineLabel(source: string): string {
  const measured = source.match(/^goal_baseline_measured:(.+)$/);
  if (measured) return `Measured goal baseline for ${metricLabel(measured[1])}`;
  const estimated = source.match(/^goal_baseline_estimated:(.+)$/);
  if (estimated) return `Estimated goal baseline for ${metricLabel(estimated[1])}`;
  return source;
}

function asLimitations(value: unknown): readonly string[] {
  return Array.isArray(value) ? (value as string[]) : [];
}

function asTruncations(value: unknown): readonly OutcomeTruncation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const row = entry as Record<string, unknown>;
    if (typeof row.variant_id !== "string") return [];
    return [
      {
        variantId: row.variant_id,
        cause:
          row.cause === "guardrail" || row.cause === "operator_pause" ? row.cause : "agent_pause",
        ruleKey: typeof row.rule_key === "string" ? row.rule_key : null,
        at: typeof row.at === "string" ? row.at : "",
      },
    ];
  });
}

function money(minor: number | null, currency: string | null): string {
  if (minor === null) return "—";
  if (!currency) return minor.toLocaleString("en-GB");
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(minor / 100);
}

/** An instant, rendered in the organization's timezone rather than raw UTC. */
function formatMoment(iso: string, timeZone: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone,
    }).format(parsed);
  } catch {
    return iso;
  }
}

function SectionHeading({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <h3 className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
      {children}
    </h3>
  );
}

function InfoRow({
  label,
  value,
  mono = false,
}: Readonly<{ label: string; value: string; mono?: boolean }>) {
  return (
    <div className="flex items-start justify-between gap-4 px-3 py-2">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("text-right text-sm font-medium", mono && "font-mono text-xs break-all")}>
        {value}
      </dd>
    </div>
  );
}

function StatCell({
  label,
  value,
  valueClassName,
}: Readonly<{ label: string; value: string; valueClassName?: string }>) {
  return (
    <div className="flex flex-col gap-0.5 bg-card p-3">
      <dt className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className={cn("text-sm font-medium", valueClassName)}>{value}</dd>
    </div>
  );
}

export function OutcomeProof({
  outcome,
  timeZone = "UTC",
}: Readonly<{
  outcome: OutcomeProofData | null;
  /** The organization's timezone; the settle time renders in it, never in UTC. */
  timeZone?: string;
}>) {
  if (!outcome) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No settled result yet</EmptyTitle>
          <EmptyDescription>
            The evidence loop settles a verdict only after the registered outcome window and
            settlement delay have passed.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const verdict = VERDICT_COPY[outcome.verdict];
  const limitations = asLimitations(outcome.limitations);
  const truncations = asTruncations(outcome.truncationCauses);

  return (
    <Card aria-label="Outcome">
      <CardHeader>
        <CardAction>
          <StatusBadge label={verdict.label} tone={verdict.tone} />
        </CardAction>
        <CardTitle>Settled result</CardTitle>
        <CardDescription>
          Settled{" "}
          <time dateTime={outcome.settledAt}>{formatMoment(outcome.settledAt, timeZone)}</time>
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <section className="flex flex-col gap-2">
          <SectionHeading>Hypothesis</SectionHeading>
          <dl className="divide-y rounded-md ring-1 ring-foreground/10">
            <InfoRow label="Primary metric" value={metricLabel(outcome.primaryMetricKey)} />
            <InfoRow
              label="Baseline"
              value={`${baselineLabel(outcome.baselineSource)} · prior ${outcome.baselineLookbackDays} days`}
            />
            <InfoRow label="Method" value={METHOD_LABEL[outcome.attributionMethod]} />
            <InfoRow
              label="Outcome window"
              value={`${outcome.outcomeWindowDays} days, plus a ${outcome.settlementDelayDays}-day settlement delay`}
            />
          </dl>
        </section>

        <Separator />

        <section className="flex flex-col gap-2">
          <SectionHeading>Delivery and spend</SectionHeading>
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md bg-border ring-1 ring-border">
            <StatCell
              label="Planned exposure"
              value={
                outcome.plannedExposureCount === null ? "—" : String(outcome.plannedExposureCount)
              }
            />
            <StatCell
              label="Realized exposure"
              value={
                outcome.realizedExposureCount === null ? "—" : String(outcome.realizedExposureCount)
              }
            />
            <StatCell
              label="Spend"
              value={money(outcome.realizedSpendMinor, outcome.spendCurrency)}
            />
            <StatCell
              label="Spend ceiling"
              value={money(outcome.spendCeilingMinor, outcome.spendCurrency)}
            />
            <StatCell
              label="Guardrail"
              value={GUARDRAIL_LABEL[outcome.guardrailState]}
              valueClassName={outcome.guardrailState === "breached" ? "text-danger" : undefined}
            />
            <StatCell label="Evidence tier" value={outcome.evidenceTier ?? "—"} />
          </dl>
        </section>

        {outcome.estimateMinor !== null ? (
          <>
            <Separator />
            <section className="flex flex-col gap-2">
              <SectionHeading>Estimate</SectionHeading>
              <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-md bg-muted/40 p-3">
                <span className="font-mono text-xl font-semibold">
                  {money(outcome.estimateMinor, outcome.estimateCurrency)}
                </span>
                <span className="text-xs text-muted-foreground">
                  Range {money(outcome.estimateLowMinor, outcome.estimateCurrency)} –{" "}
                  {money(outcome.estimateHighMinor, outcome.estimateCurrency)}
                </span>
              </div>
            </section>
          </>
        ) : null}

        {truncations.length > 0 ? (
          <>
            <Separator />
            <section className="flex flex-col gap-2">
              <SectionHeading>Why exposure fell short</SectionHeading>
              <ul className="flex flex-col gap-2">
                {truncations.map((truncation, index) => (
                  <li
                    key={`${truncation.variantId}-${index}`}
                    className="flex items-start gap-1.5 rounded-md border border-dashed p-2"
                  >
                    <AlertTriangle
                      className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <span className="text-xs text-muted-foreground">
                      One variant was {TRUNCATION_CAUSE_COPY[truncation.cause]}
                      {truncation.ruleKey
                        ? truncation.cause === "guardrail"
                          ? ` (${allocationRuleCopy(truncation.ruleKey).title.toLowerCase()})`
                          : ` by the ${allocationRuleCopy(truncation.ruleKey).title.toLowerCase()}`
                        : null}{" "}
                      before its scheduled delivery finished.
                      <span className="block font-mono text-[10px] break-all">
                        {truncation.variantId}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </>
        ) : null}

        {limitations.length > 0 ? (
          <>
            <Separator />
            <section className="flex flex-col gap-2">
              <SectionHeading>Limitations</SectionHeading>
              <ul className="flex flex-col gap-1.5">
                {limitations.map((limitation) => (
                  <li
                    key={limitation}
                    className="flex items-start gap-2 text-xs text-muted-foreground"
                  >
                    <span
                      className="mt-1.5 size-1 shrink-0 rounded-full bg-muted-foreground/60"
                      aria-hidden="true"
                    />
                    {limitation}
                  </li>
                ))}
              </ul>
            </section>
          </>
        ) : null}

        <Separator />

        <Alert variant={outcome.verdict === "guardrail_breach" ? "destructive" : "default"}>
          <AlertTitle>Why this verdict</AlertTitle>
          <AlertDescription>{VERDICT_EXPLANATION[outcome.verdict]}</AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}
