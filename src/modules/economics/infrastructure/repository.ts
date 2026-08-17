import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { economicsError } from "@/domain/economics/errors";
import type { StoredCostRate } from "@/domain/economics/rates";
import type { LedgerEntry } from "@/domain/economics/rollup";
import type {
  CostComponentDefinition,
  EconomicsMetricBinding,
  EconomicsQualityTier,
  EconomicsRole,
} from "@/domain/economics/types";
import type { Database } from "@/lib/supabase/database.types";
import type {
  EconomicsCatalog,
  EconomicsCatalogPort,
  EconomicsEntryWrite,
  EconomicsLedgerStore,
  RegisteredCostComponent,
} from "@/modules/economics/application/ports";
import type { EconomicsCatalogEntry } from "@/modules/economics/application/read-model";

type EconomicsClient = SupabaseClient<Database>;

/** A ninety-day window at day grain across a handful of channels; bounds a bad query. */
const MAX_LEDGER_ROWS = 2_000;

export function createEconomicsCatalogRepository(supabase: EconomicsClient): EconomicsCatalogPort {
  return {
    async loadCatalog(organizationId) {
      // Shared vocabulary plus this organization's own keys, exactly as
      // metric_definitions resolves. A custom key that shadows shared
      // vocabulary is rejected at write time, so a key is never both.
      const { data: definitions, error: definitionError } = await supabase
        .from("cost_component_definitions")
        .select(
          "id, key, label, computation_kind, applies_to_channels, source_metric_key, organization_id",
        )
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

    async loadMetricBinding(organizationId) {
      const { data, error } = await supabase
        .from("metric_definitions")
        .select("key, economics_role, organization_id")
        .not("economics_role", "is", null)
        .eq("is_active", true)
        .or(`organization_id.is.null,organization_id.eq.${organizationId}`);

      if (error) throw economicsError("ECONOMICS_CATALOG_UNAVAILABLE");

      const keyByRole = new Map<string, string>();
      for (const row of data ?? []) {
        if (!row.economics_role) continue;
        // An organization's own definition outranks shared vocabulary for the
        // same role, exactly as it does for the same key. A tenant whose export
        // names margin differently points the role at their key and the ledger
        // needs no code change.
        if (keyByRole.has(row.economics_role) && row.organization_id === null) continue;
        keyByRole.set(row.economics_role, row.key);
      }

      const grossRevenue = keyByRole.get("gross_revenue");
      // Revenue is the spine of every period, so an unbound revenue role leaves
      // nothing to price. Every other role may be absent: `unit_count` has no
      // metric behind it yet, which correctly leaves packaging unpriced rather
      // than failing the run.
      if (!grossRevenue) throw economicsError("ECONOMICS_REVENUE_ROLE_UNBOUND", { organizationId });

      const optional = (role: EconomicsRole, into: keyof EconomicsMetricBinding) => {
        const key = keyByRole.get(role);
        return key ? { [into]: key } : {};
      };

      return {
        grossRevenue,
        ...optional("transaction_count", "transactionCount"),
        ...optional("unit_count", "unitCount"),
        ...optional("reported_margin", "reportedMargin"),
      };
    },
  };
}

/**
 * The read side of the ledger, for the operator view.
 *
 * Runs on the authenticated session client under the existing member policy —
 * entries and components are readable by members, while rates stay admin-only
 * and this view never needs them. Components ride along in one embed so a
 * ninety-day window is a single round trip rather than one per entry.
 */
export async function loadLedgerEntries(
  supabase: EconomicsClient,
  query: {
    organizationId: string;
    branchId?: string | null;
    rangeStart: Date;
    rangeEndExclusive: Date;
  },
): Promise<LedgerEntry[]> {
  let request = supabase
    .from("channel_economics_entries")
    .select(
      `channel, period_start, gross_revenue_minor, transaction_count, currency,
       margin_source, completeness_grade, contribution_margin_minor, at_most_minor,
       reported_margin_minor,
       channel_economics_components (amount_minor, quality_tier, cost_component_definitions (key, label))`,
    )
    .eq("organization_id", query.organizationId)
    .eq("grain", "period")
    .gte("period_start", query.rangeStart.toISOString())
    .lt("period_start", query.rangeEndExclusive.toISOString())
    .order("period_start", { ascending: true })
    .limit(MAX_LEDGER_ROWS);

  // A null filter and an absent filter mean different things: the first asks
  // for organization-wide rows, the second for every branch.
  if (query.branchId !== undefined)
    request =
      query.branchId === null
        ? request.is("branch_id", null)
        : request.eq("branch_id", query.branchId);

  const { data, error } = await request;
  if (error) throw economicsError("ECONOMICS_READ_FAILED", { code: error.code ?? "unknown" });

  return (data ?? []).map(toLedgerEntry);
}

/**
 * Which components exist for this tenant, and whether each is priced.
 *
 * Through an RPC rather than a table read, for two reasons that both produce a
 * wrong answer otherwise. `cost_component_rates` is owner/admin only, so an
 * operator reading it directly sees nothing and every priced component reports
 * as unpriced. And deriving coverage from the entries' own components fails for
 * a `reported` margin, which carries no components at all — precisely the state
 * a new client is in, and precisely when the task list matters most.
 *
 * The RPC returns coverage and tier, never an amount. What a component costs
 * stays confidential; whether it is known does not.
 */
export async function loadCatalogCoverage(
  supabase: EconomicsClient,
  organizationId: string,
): Promise<EconomicsCatalogEntry[]> {
  const { data, error } = await supabase.rpc("get_cost_component_coverage", {
    target_organization_id: organizationId,
  });

  if (error) throw economicsError("ECONOMICS_READ_FAILED", { code: error.code ?? "unknown" });

  return (data ?? []).map((row) => ({
    key: row.key,
    label: row.label,
    computationKind: row.computation_kind as EconomicsCatalogEntry["computationKind"],
    hasRate: row.has_rate,
    weakestTier: row.weakest_tier as EconomicsCatalogEntry["weakestTier"],
  }));
}

type LedgerEntryRow = {
  channel: string | null;
  period_start: string;
  gross_revenue_minor: number | string;
  transaction_count: number;
  currency: string;
  margin_source: string;
  completeness_grade: string;
  contribution_margin_minor: number | string | null;
  at_most_minor: number | string | null;
  reported_margin_minor: number | string | null;
  channel_economics_components:
    | {
        amount_minor: number | string;
        quality_tier: string;
        cost_component_definitions: { key: string; label: string } | null;
      }[]
    | null;
};

function toLedgerEntry(row: LedgerEntryRow): LedgerEntry {
  return {
    channel: row.channel,
    periodStart: new Date(row.period_start),
    grossRevenueMinor: toNumber(row.gross_revenue_minor),
    transactionCount: row.transaction_count,
    currency: row.currency,
    marginSource: row.margin_source as LedgerEntry["marginSource"],
    completenessGrade: row.completeness_grade as LedgerEntry["completenessGrade"],
    contributionMarginMinor:
      row.contribution_margin_minor === null ? null : toNumber(row.contribution_margin_minor),
    atMostMinor: row.at_most_minor === null ? null : toNumber(row.at_most_minor),
    reportedMarginMinor:
      row.reported_margin_minor === null || row.reported_margin_minor === undefined
        ? null
        : toNumber(row.reported_margin_minor),
    components: (row.channel_economics_components ?? []).flatMap((component) =>
      component.cost_component_definitions
        ? [
            {
              key: component.cost_component_definitions.key,
              label: component.cost_component_definitions.label,
              amountMinor: toNumber(component.amount_minor),
              qualityTier: component.quality_tier as EconomicsQualityTier,
            },
          ]
        : [],
    ),
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
    reported_margin_minor: entry.reportedMarginMinor,
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
  source_metric_key: string | null;
};

function toDefinition(row: DefinitionRow): CostComponentDefinition {
  return {
    key: row.key,
    label: row.label,
    computationKind: row.computation_kind as CostComponentDefinition["computationKind"],
    appliesToChannels: row.applies_to_channels,
    sourceMetricKey: row.source_metric_key,
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
