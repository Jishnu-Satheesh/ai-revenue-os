import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

/**
 * The settled result and its proof, laid out for an operator to interrogate.
 *
 * A conclusion an operator cannot re-derive from the record is a conclusion
 * they cannot trust, so every section shows the fact behind the verdict rather
 * than a summary of it: the preregistered hypothesis, planned versus realized
 * exposure, the baseline and window, the estimate and its range, spend, the
 * guardrail, the evidence tier and method, the truncations, the limitations,
 * and a plain statement of why the verdict carries its label.
 *
 * The "why" wording is deterministic and passes the no-overclaim validator in
 * the measurement domain; a result that was not validated never reads as
 * causal. Times render as stored (UTC); the caller converts to the
 * organization's timezone.
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

const VERDICT_LABEL: Readonly<Record<OutcomeProofData["verdict"], string>> = {
  validated_outcome: "Validated outcome",
  inconclusive: "Inconclusive",
  guardrail_breach: "Guardrail breach",
  execution_only: "Execution only",
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

const METHOD_LABEL: Readonly<Record<OutcomeProofData["attributionMethod"], string>> = {
  observational_prepost: "Observational, before and after",
  provider_randomized_experiment: "Provider randomized experiment",
};

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
  if (minor === null || currency === null) return "—";
  return `${minor} ${currency}`;
}

export function OutcomeProof({ outcome }: Readonly<{ outcome: OutcomeProofData | null }>) {
  if (!outcome) {
    return (
      <section className="rounded-lg border border-dashed p-6 text-center" aria-label="Outcome">
        <p className="text-sm font-medium">No settled result yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          The evidence loop settles a verdict only after the registered outcome window and
          settlement delay have passed.
        </p>
      </section>
    );
  }

  const limitations = asLimitations(outcome.limitations);
  const truncations = asTruncations(outcome.truncationCauses);

  return (
    <section className="flex flex-col gap-3" aria-label="Outcome">
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={outcome.verdict === "guardrail_breach" ? "destructive" : "outline"}>
              {VERDICT_LABEL[outcome.verdict]}
            </Badge>
            <time className="ml-auto text-xs text-muted-foreground" dateTime={outcome.settledAt}>
              Settled {outcome.settledAt}
            </time>
          </div>

          <div>
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Hypothesis
            </h3>
            <p className="mt-1">
              This campaign preregistered{" "}
              <span className="font-mono">{outcome.primaryMetricKey}</span> as its primary metric,
              measured against a baseline from{" "}
              <span className="font-mono">{outcome.baselineSource}</span> over the prior{" "}
              {outcome.baselineLookbackDays} days, under the{" "}
              {METHOD_LABEL[outcome.attributionMethod].toLowerCase()} method.
            </p>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Planned exposure</dt>
              <dd className="font-mono">{outcome.plannedExposureCount ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Realized exposure</dt>
              <dd className="font-mono">{outcome.realizedExposureCount ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Outcome window</dt>
              <dd className="font-mono">{outcome.outcomeWindowDays} days</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Settlement delay</dt>
              <dd className="font-mono">{outcome.settlementDelayDays} days</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Evidence tier</dt>
              <dd className="font-mono">{outcome.evidenceTier ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Spend</dt>
              <dd className="font-mono">
                {money(outcome.realizedSpendMinor, outcome.spendCurrency)}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Spend ceiling</dt>
              <dd className="font-mono">
                {money(outcome.spendCeilingMinor, outcome.spendCurrency)}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Guardrail</dt>
              <dd className="font-mono">{outcome.guardrailState}</dd>
            </div>
          </dl>

          {outcome.estimateMinor !== null ? (
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Estimate
              </h3>
              <p className="mt-1 font-mono">
                {money(outcome.estimateMinor, outcome.estimateCurrency)} · range{" "}
                {money(outcome.estimateLowMinor, outcome.estimateCurrency)} to{" "}
                {money(outcome.estimateHighMinor, outcome.estimateCurrency)}
              </p>
            </div>
          ) : null}

          {truncations.length > 0 ? (
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Missing data
              </h3>
              <ul className="mt-1 flex flex-col gap-1 text-xs text-muted-foreground">
                {truncations.map((truncation, index) => (
                  <li key={`${truncation.variantId}-${index}`}>
                    Variant <span className="font-mono">{truncation.variantId}</span> was truncated
                    by {truncation.cause}
                    {truncation.ruleKey ? (
                      <>
                        {" "}
                        (<span className="font-mono">{truncation.ruleKey}</span>)
                      </>
                    ) : null}
                    .
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {limitations.length > 0 ? (
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Limitations
              </h3>
              <ul className="mt-1 flex flex-col gap-1 text-xs text-muted-foreground">
                {limitations.map((limitation) => (
                  <li key={limitation}>{limitation}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div>
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Why this verdict
            </h3>
            <p className="mt-1">{VERDICT_EXPLANATION[outcome.verdict]}</p>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
