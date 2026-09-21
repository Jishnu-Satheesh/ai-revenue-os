import {
  organizationLocalDate,
  resolveGrowthPeriod,
} from "@/domain/organizations/growth-periods";
import type { ScopePartition } from "@/domain/organizations/growth-progress";
import type { RevenueScenarioInput } from "@/domain/organizations/revenue-scenario";
import {
  buildGrowthProjectionCandidate,
  resolvePriorCalendarMonthWindow,
  type BuildGrowthProjectionCandidateResult,
} from "@/modules/organizations/application/growth-projection-builder";
import type { GrowthCandidateBuildContext } from "@/modules/organizations/application/growth-projection-publisher";
import type { RevenueFactsEnvelope } from "@/modules/organizations/application/growth-progress-ports";

/**
 * Ledger-bound candidate assembly for the nightly worker (Task-5 lineage,
 * populate path).
 *
 * Like developing a photo from its negative: the frozen scope is derived
 * from the organization's own revenue vocabulary, the baseline is the
 * complete prior calendar month proven by exact cover over ledger facts,
 * and the curve carries no action money until cited findings bind it — an
 * unproven month refuses instead of guessing. The snapshot material rides
 * along for future finding/action bindings but contributes nothing today.
 *
 * Pure orchestration with injected boundaries: same inputs always give the
 * same result. No database, clock, model or network is touched, so every
 * rule below is unit-testable with fakes.
 */

export type GrowthCandidateAssemblyDependencies = {
  resolveRevenueDefinitionId: (organizationId: string) => Promise<string | null>;
  listBaselineCoordinates: (input: {
    organizationId: string;
    metricDefinitionId: string;
    from: string;
    toExclusive: string;
    periodTimezone: string;
  }) => Promise<Array<{ channelId: string | null; branchId: string | null }>>;
  readBaselineFacts: (input: {
    organizationId: string;
    from: string;
    toExclusive: string;
    scopePartitions: ScopePartition[];
  }) => Promise<RevenueFactsEnvelope>;
};

function refused(
  reason: "BASELINE_INCOMPLETE" | "INVALID_INPUT",
  detail: string,
): BuildGrowthProjectionCandidateResult {
  return { status: "refused", reason, detail };
}

export async function assembleLedgerBaselineCandidate(
  material: RevenueScenarioInput,
  context: GrowthCandidateBuildContext,
  dependencies: GrowthCandidateAssemblyDependencies,
): Promise<BuildGrowthProjectionCandidateResult> {
  void material;

  let definitionId: string | null;
  try {
    definitionId = await dependencies.resolveRevenueDefinitionId(context.organizationId);
  } catch {
    definitionId = null;
  }
  if (definitionId === null) {
    return refused(
      "BASELINE_INCOMPLETE",
      "No active revenue definition binds this organization's baseline.",
    );
  }

  let issueLocalDate: string;
  try {
    issueLocalDate = organizationLocalDate(context.issuedAt, context.timeZone);
  } catch {
    return refused("INVALID_INPUT", "The organization timezone is not usable.");
  }
  // Populate path: the frozen scope mirrors the baseline window's own
  // reporting coordinates (per channel/branch, plus org-level rows when
  // present) instead of an asserted shape that matches nothing. An asserted
  // org-total would refuse every real organization forever: ledger rows live
  // under channels. The frozen document records exactly what froze, so the
  // scope stays checkable even as it varies month to month.
  const baselineWindow = resolvePriorCalendarMonthWindow(issueLocalDate);

  let coordinates: Array<{ channelId: string | null; branchId: string | null }>;
  try {
    coordinates = await dependencies.listBaselineCoordinates({
      organizationId: context.organizationId,
      metricDefinitionId: definitionId,
      from: baselineWindow.startDate,
      toExclusive: baselineWindow.endDateExclusive,
      periodTimezone: context.timeZone,
    });
  } catch {
    return refused("BASELINE_INCOMPLETE", "Baseline coordinates could not be read.");
  }
  if (coordinates.length === 0) {
    return refused("BASELINE_INCOMPLETE", "Nothing reported in the baseline month.");
  }
  const scopePartitions: ScopePartition[] = coordinates.map((coordinate) => ({
    partitionKey:
      coordinate.channelId === null && coordinate.branchId === null
        ? "organization-total"
        : `channel-${coordinate.channelId ?? "org"}-branch-${coordinate.branchId ?? "org"}`,
    channelId: coordinate.channelId,
    branchId: coordinate.branchId,
    metricDefinitionId: definitionId,
    dimensionsDigest: "empty",
    periodTimezone: context.timeZone,
  }));

  let period: { startDate: string; endDateExclusive: string };
  try {
    const resolved = resolveGrowthPeriod(
      context.scheduleOriginDate,
      context.horizonMonths,
      context.cycleIndex,
    );
    period = { startDate: resolved.startDate, endDateExclusive: resolved.endDateExclusive };
  } catch {
    return refused("INVALID_INPUT", "The schedule origin cannot place this period.");
  }

  let envelope: RevenueFactsEnvelope;
  try {
    envelope = await dependencies.readBaselineFacts({
      organizationId: context.organizationId,
      from: baselineWindow.startDate,
      toExclusive: baselineWindow.endDateExclusive,
      scopePartitions,
    });
  } catch {
    return refused("BASELINE_INCOMPLETE", "Baseline facts could not be read.");
  }
  if (envelope.status !== "ready") {
    return refused(
      "BASELINE_INCOMPLETE",
      "Baseline facts are not provably complete for this scope.",
    );
  }
  const facts = envelope.facts;
  if (facts.length === 0) {
    return refused("BASELINE_INCOMPLETE", "The baseline month carries no ledger facts.");
  }
  const currencies = new Set(facts.map((fact) => fact.currency));
  if (currencies.size !== 1) {
    return refused("INVALID_INPUT", "Baseline currency is not uniform.");
  }
  const [currency] = currencies;

  return buildGrowthProjectionCandidate({
    organizationId: context.organizationId,
    scheduleOriginDate: context.scheduleOriginDate,
    period: {
      horizonMonths: context.horizonMonths,
      cycleIndex: context.cycleIndex,
      startDate: period.startDate,
      endDateExclusive: period.endDateExclusive,
    },
    issuedAt: context.issuedAt,
    sourceCutoffDate: context.sourceCutoffDate,
    timeZone: context.timeZone,
    currency: currency ?? "AED",
    scopePartitions: [...scopePartitions],
    baselineWindow,
    baselineFacts: [...facts],
    findingBases: [],
    actionCandidates: [],
  });
}
