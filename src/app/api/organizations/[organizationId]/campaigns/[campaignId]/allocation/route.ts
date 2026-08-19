import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/api/organization-context";
import {
  campaignRouteContext,
  parseCampaignId,
} from "@/modules/campaigns/application/route-context";

/**
 * The allocation ledger for a campaign.
 *
 * Read-only by design. The fast loop writes these rows as it decides; this
 * route exists so an operator can interrogate every autonomous action — the
 * rule that fired, the value it saw, the threshold it compared, the margin
 * where one was used, and when. A pause an operator cannot explain is a pause
 * they cannot trust, so nothing here is filtered or summarised.
 */

type LedgerRow = {
  id: string;
  variant_id: string;
  rule_key: string;
  rule_version: string;
  observed_value: number | string | null;
  threshold: number | string | null;
  resolved_margin_minor: number | string | null;
  resolved_margin_grade: "measured" | "derived" | "estimated" | "assumed" | null;
  action: "pause" | "no_action";
  reason_code: string;
  actor: string;
  occurred_at: string;
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
      from(table: "campaign_allocation_events"): {
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
                data: LedgerRow[] | null;
                error: unknown;
              }>;
            };
          };
        };
      };
    };

    const { data, error } = await client
      .from("campaign_allocation_events")
      .select(
        "id, variant_id, rule_key, rule_version, observed_value, threshold, resolved_margin_minor, resolved_margin_grade, action, reason_code, actor, occurred_at",
      )
      .eq("organization_id", context.organizationId)
      .eq("campaign_id", campaignId)
      .order("occurred_at", { ascending: false });

    if (error) return apiErrorResponse(new Error("The allocation ledger could not be read."));

    return NextResponse.json({
      events: (data ?? []).map((row) => ({
        id: row.id,
        variantId: row.variant_id,
        ruleKey: row.rule_key,
        ruleVersion: row.rule_version,
        observedValue: toNumber(row.observed_value),
        threshold: toNumber(row.threshold),
        resolvedMarginMinor: toNumber(row.resolved_margin_minor),
        resolvedMarginGrade: row.resolved_margin_grade,
        action: row.action,
        reasonCode: row.reason_code,
        actor: row.actor,
        occurredAt: row.occurred_at,
      })),
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
