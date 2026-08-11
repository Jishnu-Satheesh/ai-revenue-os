import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { economicsError } from "@/domain/economics/errors";
import type { StoredCostRate } from "@/domain/economics/rates";
import type { CostComponentDefinition, EconomicsQualityTier } from "@/domain/economics/types";
import type { Database } from "@/lib/supabase/database.types";
import type {
  EconomicsCatalog,
  EconomicsCatalogPort,
  EconomicsEntryWrite,
  EconomicsLedgerStore,
  RegisteredCostComponent,
} from "@/modules/economics/application/ports";

type EconomicsClient = SupabaseClient<Database>;

export function createEconomicsCatalogRepository(supabase: EconomicsClient): EconomicsCatalogPort {
  return {
    async loadCatalog(organizationId) {
      // Shared vocabulary plus this organization's own keys, exactly as
      // metric_definitions resolves. A custom key that shadows shared
      // vocabulary is rejected at write time, so a key is never both.
      const { data: definitions, error: definitionError } = await supabase
        .from("cost_component_definitions")
        .select("id, key, label, computation_kind, applies_to_channels, organization_id")
        .eq("is_active", true)
        .or(`organization_id.is.null,organization_id.eq.${organizationId}`)
        .order("key", { ascending: true });

      if (definitionError) throw economicsError("ECONOMICS_CATALOG_UNAVAILABLE");

      const components: RegisteredCostComponent[] = (definitions ?? []).map((row) => ({
        id: row.id,
        definition: toDefinition(row),
      }));

      const keyById = new Map(
        components.map((component) => [component.id, component.definition.key]),
      );

      const { data: rates, error: rateError } = await supabase
        .from("cost_component_rates")
        .select(
          "id, definition_id, branch_id, channel, amount_minor, rate_of_revenue, quality_tier, effective_from, effective_to",
        )
        .eq("organization_id", organizationId)
        .order("effective_from", { ascending: true });

      if (rateError) throw economicsError("ECONOMICS_CATALOG_UNAVAILABLE");

      return {
        components,
        // A rate whose definition is inactive or invisible has nothing to price
        // and is dropped here rather than resolved against a key that is not in
        // the catalog.
        rates: (rates ?? []).flatMap((row) => {
          const key = keyById.get(row.definition_id);
          return key ? [toRate(row, key)] : [];
        }),
      } satisfies EconomicsCatalog;
    },
  };
}

/**
 * The write side of the ledger.
 *
 * Requires a service-role client. `channel_economics_entries` carries no
 * authenticated write grant and the RPC is granted to `service_role` alone, so
 * the only route to an entry is a computation that can be audited.
 */
export function createEconomicsLedgerStore(supabase: EconomicsClient): EconomicsLedgerStore {
  return {
    async recordEntries(organizationId, entries) {
      if (entries.length === 0) return { written: 0 };

      const { data, error } = await supabase.rpc("record_channel_economics_entries", {
        target_organization_id: organizationId,
        input_entries: entries.map(toEntryPayload),
      });

      if (error)
        throw economicsError("ECONOMICS_WRITE_FAILED", {
          code: error.code ?? "unknown",
          entries: entries.length,
        });

      return { written: data ?? 0 };
    },
  };
}

function toEntryPayload(entry: EconomicsEntryWrite) {
  return {
    branch_id: entry.branchId,
    grain: entry.grain,
    channel: entry.channel,
    period_start: entry.periodStart.toISOString(),
    period_end: entry.periodEnd.toISOString(),
    period_timezone: entry.periodTimezone,
    gross_revenue_minor: entry.grossRevenueMinor,
    transaction_count: entry.transactionCount,
    unit_count: entry.unitCount,
    currency: entry.currency,
    margin_source: entry.marginSource,
    completeness_grade: entry.completenessGrade,
    contribution_margin_minor: entry.contributionMarginMinor,
    at_most_minor: entry.atMostMinor,
    reported_quality_tier: entry.reportedQualityTier,
    source_reference: entry.sourceReference,
    components: entry.components.map((component) => ({
      definition_id: component.definitionId,
      rate_id: component.rateId,
      amount_minor: component.amountMinor,
      quality_tier: component.qualityTier,
    })),
  };
}

type DefinitionRow = {
  id: string;
  key: string;
  label: string;
  computation_kind: string;
  applies_to_channels: string[] | null;
};

function toDefinition(row: DefinitionRow): CostComponentDefinition {
  return {
    key: row.key,
    label: row.label,
    computationKind: row.computation_kind as CostComponentDefinition["computationKind"],
    appliesToChannels: row.applies_to_channels,
  };
}

type RateRow = {
  id: string;
  branch_id: string | null;
  channel: string | null;
  amount_minor: number | string | null;
  rate_of_revenue: number | string | null;
  quality_tier: string;
  effective_from: string;
  effective_to: string | null;
};

function toRate(row: RateRow, definitionKey: string): StoredCostRate {
  return {
    id: row.id,
    key: definitionKey,
    definitionKey,
    qualityTier: row.quality_tier as Exclude<EconomicsQualityTier, "missing">,
    ...(row.amount_minor === null ? {} : { amountMinor: toNumber(row.amount_minor) }),
    ...(row.rate_of_revenue === null ? {} : { rateOfRevenue: toNumber(row.rate_of_revenue) }),
    channel: row.channel,
    branchId: row.branch_id,
    // A `date` column arrives as `YYYY-MM-DD`, which is exactly what rate
    // resolution compares against. Parsing it into an instant would pin it to
    // midnight UTC and apply every rate change a day late in Dubai.
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
  };
}

/** Postgres `numeric` and `bigint` can arrive as strings, so never trust the wire type. */
function toNumber(value: number | string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw economicsError("ECONOMICS_CATALOG_UNAVAILABLE");
  return parsed;
}
