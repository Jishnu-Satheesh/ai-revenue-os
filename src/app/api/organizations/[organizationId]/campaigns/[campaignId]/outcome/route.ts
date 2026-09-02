import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/api/organization-context";
import {
  campaignRouteContext,
  parseCampaignId,
} from "@/modules/campaigns/application/route-context";

/**
 * The settled result and its proof, for an operator to interrogate.
 *
 * Read-only by design. The evidence loop writes the verdict; this route exists
 * so an operator can read the method, window, evidence tier, planned versus
 * realized exposure, spend, guardrail state, and limitations that a verdict
 * carries. Nothing here is summarised or filtered, because a conclusion an
 * operator cannot re-derive from the record is a conclusion they cannot trust.
 */

type OutcomeRow = {
  id: string;
  verdict: "validated_outcome" | "inconclusive" | "guardrail_breach" | "execution_only";
  attribution_method: "observational_prepost" | "provider_randomized_experiment";
  primary_metric_key: string;
  outcome_window_days: number;
  settlement_delay_days: number;
  baseline_source: string;
  baseline_lookback_days: number;
  planned_exposure_count: number | string;
  realized_exposure_count: number | string;
  guardrail_state: "breached" | "clear" | "unmeasured";
  realized_spend_minor: number | string | null;
  spend_ceiling_minor: number | string | null;
  spend_currency: string | null;
  estimate_minor: number | string | null;
  estimate_low_minor: number | string | null;
  estimate_high_minor: number | string | null;
  estimate_currency: string | null;
  evidence_tier: "computed" | "observed" | null;
  truncation_causes: unknown;
  limitations: unknown;
  settled_at: string;
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; campaignId: string }> },
) {
  try {
    const { campaignId: raw } = await params;
    const context = await campaignRouteContext(params, "campaign.read");
    const campaignId = parseCampaignId(raw);

    const client = context.supabase as unknown as {
      from(table: "campaign_outcomes"): {
        select(columns: string): {
          eq(
            column: string,
            value: string,
          ): {
            eq(
              column: string,
              value: string,
            ): {
              order(
                column: string,
                opts: { ascending: boolean },
              ): PromiseLike<{
                data: OutcomeRow[] | null;
                error: unknown;
              }>;
            };
          };
        };
      };
    };

    const { data, error } = await client
      .from("campaign_outcomes")
      .select(
        "id, verdict, attribution_method, primary_metric_key, outcome_window_days, settlement_delay_days, baseline_source, baseline_lookback_days, planned_exposure_count, realized_exposure_count, guardrail_state, realized_spend_minor, spend_ceiling_minor, spend_currency, estimate_minor, estimate_low_minor, estimate_high_minor, estimate_currency, evidence_tier, truncation_causes, limitations, settled_at",
      )
      .eq("organization_id", context.organizationId)
      .eq("campaign_id", campaignId)
      .order("settled_at", { ascending: false });

    if (error) return apiErrorResponse(new Error("The campaign outcome could not be read."));

    const row = data?.[0];
    if (!row) {
      return NextResponse.json({ outcome: null });
    }

    return NextResponse.json({
      outcome: {
        id: row.id,
        verdict: row.verdict,
        attributionMethod: row.attribution_method,
        primaryMetricKey: row.primary_metric_key,
        outcomeWindowDays: row.outcome_window_days,
        settlementDelayDays: row.settlement_delay_days,
        baselineSource: row.baseline_source,
        baselineLookbackDays: row.baseline_lookback_days,
        plannedExposureCount: toNumber(row.planned_exposure_count),
        realizedExposureCount: toNumber(row.realized_exposure_count),
        guardrailState: row.guardrail_state,
        realizedSpendMinor: toNumber(row.realized_spend_minor),
        spendCeilingMinor: toNumber(row.spend_ceiling_minor),
        spendCurrency: row.spend_currency,
        estimateMinor: toNumber(row.estimate_minor),
        estimateLowMinor: toNumber(row.estimate_low_minor),
        estimateHighMinor: toNumber(row.estimate_high_minor),
        estimateCurrency: row.estimate_currency,
        evidenceTier: row.evidence_tier,
        truncationCauses: row.truncation_causes,
        limitations: row.limitations,
        settledAt: row.settled_at,
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

function toNumber(value: number | string | null): number | null {
  if (value === null || value === "") return null;
  if (typeof value === "number") return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
