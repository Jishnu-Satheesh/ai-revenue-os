import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { economicsError } from "@/domain/economics/errors";
import type {
  EvidencePackageState,
  ReadinessCostCoverage,
  ReadinessObservation,
} from "@/domain/economics/readiness";
import type { EconomicsRole } from "@/domain/economics/types";
import type { Database } from "@/lib/supabase/database.types";
import type {
  EvidenceReadinessRepository,
  ReadinessEvidence,
} from "@/modules/economics/application/readiness-ports";

type ReadinessClient = SupabaseClient<Database>;

/**
 * A generous ceiling on a read that is one row per metric per exact period per
 * channel. A tenant past it has a reporting problem worth seeing rather than a
 * page worth hanging.
 */
const MAX_OBSERVATION_ROWS = 2_000;

/**
 * The value columns, named here so their absence below is deliberate rather
 * than accidental. Readiness describes the shape of the evidence and has no use
 * for what it says; selecting one of these would put a workbook figure into a
 * response, a cache, and a log for no reason anyone asked for.
 */
const OBSERVATION_COLUMNS =
  "id, channel_id, branch_id, metric_definition_id, period_start, period_end, period_timezone, currency, quality_state, completeness_state, reconciliation_state, report_package_id";

/** How a package's lifecycle state bears on whether its evidence may be used. */
function toPackageState(status: string | undefined): EvidencePackageState {
  if (status === "reconciliation_required") return "reconciliation_required";
  if (status === "failed" || status === "validation_failed" || status === "projection_failed") {
    return "failed";
  }
  return "usable";
}

export function createAuthenticatedEvidenceReadinessRepository(
  supabase: ReadinessClient,
): EvidenceReadinessRepository {
  return {
    async loadEvidence({ organizationId }): Promise<ReadinessEvidence> {
      const [observations, metrics, packages, channels, branches] = await Promise.all([
        supabase
          .from("exact_range_metric_observations")
          .select(OBSERVATION_COLUMNS)
          .eq("organization_id", organizationId)
          .order("period_start", { ascending: false })
          .limit(MAX_OBSERVATION_ROWS),
        // Shared vocabulary plus this organization's own keys. Only definitions
        // bound to an economics input matter; everything else is ignored rather
        // than guessed at.
        supabase
          .from("metric_definitions")
          .select("id, economics_role, organization_id")
          .not("economics_role", "is", null)
          .eq("is_active", true)
          .or(`organization_id.is.null,organization_id.eq.${organizationId}`),
        supabase
          .from("integration_report_packages")
          .select("id, status")
          .eq("organization_id", organizationId),
        supabase
          .from("organization_channels")
          .select("id, display_name")
          .eq("organization_id", organizationId),
        supabase.from("branches").select("id, name").eq("organization_id", organizationId),
      ]);

      const failure = [observations, metrics, packages, channels, branches].find(
        (result) => result.error,
      );
      if (failure) throw economicsError("ECONOMICS_READ_FAILED");

      const roleByMetric = new Map<string, EconomicsRole>();
      for (const metric of metrics.data ?? []) {
        if (metric.economics_role) roleByMetric.set(metric.id, metric.economics_role);
      }

      const statusByPackage = new Map(
        (packages.data ?? []).map((row) => [row.id, row.status] as const),
      );

      return {
        observations: (observations.data ?? []).map(
          (row): ReadinessObservation => ({
            observationId: row.id,
            channelId: row.channel_id,
            branchId: row.branch_id,
            metricDefinitionId: row.metric_definition_id,
            economicsRole: roleByMetric.get(row.metric_definition_id) ?? null,
            periodStart: row.period_start,
            periodEnd: row.period_end,
            periodTimezone: row.period_timezone,
            currency: row.currency,
            qualityState: row.quality_state,
            completenessState: row.completeness_state,
            reconciliationState: row.reconciliation_state,
            reportPackageId: row.report_package_id,
            packageState: toPackageState(statusByPackage.get(row.report_package_id)),
          }),
        ),
        channels: (channels.data ?? []).map((row) => ({
          id: row.id,
          displayName: row.display_name,
        })),
        branches: (branches.data ?? []).map((row) => ({ id: row.id, name: row.name })),
      };
    },

    async loadCostCoverage({ organizationId }): Promise<ReadinessCostCoverage> {
      const { data, error } = await supabase.rpc("get_cost_component_coverage", {
        target_organization_id: organizationId,
      });

      // Unchecked, not all clear. The function is member-gated and returns
      // availability only, so a failure here means nothing was examined — and
      // reporting that as "no gaps" would be the single most misleading thing
      // this panel could say.
      if (error) return { outcome: "unchecked" };

      return {
        outcome: "checked",
        components: (data ?? []).map((row) => ({
          key: row.key,
          label: row.label,
          covered: row.has_rate,
          // The tier, never the figure. "Commission has a measured source" is
          // the readiness signal; the percentage is commercially sensitive and
          // has no business on this surface for any role.
          tier: (row.weakest_tier as ReadinessCostCoverageTier) ?? null,
          operatorCanResolve: canOperatorResolve(row.computation_kind, row.has_rate),
        })),
      };
    },
  };
}

type ReadinessCostCoverageTier = "measured" | "derived" | "estimated" | "assumed" | null;

/**
 * Whether typing a rate would actually close the gap.
 *
 * A `sourced` component is supplied by a provider report, and a `per_unit` one
 * with nothing priced needs an item count nobody is importing yet. Neither is a
 * task the operator can complete, and offering a button for them is worse than
 * offering none.
 */
function canOperatorResolve(computationKind: string, hasRate: boolean): boolean {
  if (computationKind === "sourced") return false;
  if (computationKind === "per_unit" && !hasRate) return false;
  return true;
}
