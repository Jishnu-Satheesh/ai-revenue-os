import {
  resolveGrowthPeriod,
} from "@/domain/organizations/growth-periods";
import type { ScopePartition } from "@/domain/organizations/growth-progress";
import type { RevenueScenarioInput } from "@/domain/organizations/revenue-scenario";
import {
  assessPartitionBaselines,
  buildGrowthProjectionCandidate,
  GROWTH_BASELINE_FALLBACK_RUNGS,
  resolveTrailingBaselineWindow,
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
 * trailing reported window ending at the source cutoff (each scope partition
 * assessed on its own reported days, widening rung by rung until some
 * partition meets the rung floor), and the curve carries no action money
 * until cited findings bind it — a window no partition can vouch for refuses
 * instead of guessing. Partitions that cannot qualify are excluded and named
 * by the builder, never silently dropped. The snapshot material rides along
 * for future finding/action bindings but contributes nothing today.
 * The snapshot material rides along for future finding/action bindings but
 * contributes nothing today.
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

  // Populate path: the frozen scope mirrors the baseline window's own
  // reporting coordinates (per channel/branch, plus org-level rows when
  // present) instead of an asserted shape that matches nothing. An asserted
  // org-total would refuse every real organization forever: ledger rows live
  // under channels. The frozen document records exactly what froze, so the
  // scope stays checkable even as it varies run to run.
  //
  // Fallback ladder: the trailing window widens rung by rung until some
  // scope partition's reported days meet that rung's floor (ADR 0069: floor
  // 1 at every rung, assessed per partition). The first rung with at least
  // one qualifying partition builds on its own; the builder narrows the
  // frozen scope to the qualifying partitions and names the excluded ones.
  // A rung no partition can trust (every partition conflicts, mixed
  // currency, unreadable reads) refuses outright instead of widening past
  // a defect; a rung no partition reports in simply widens.
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

  for (const rung of GROWTH_BASELINE_FALLBACK_RUNGS) {
    let baselineWindow: { startDate: string; endDateExclusive: string };
    try {
      baselineWindow = resolveTrailingBaselineWindow(
        context.sourceCutoffDate,
        rung.windowDays,
      );
    } catch {
      return refused("INVALID_INPUT", "The source cutoff cannot place the baseline window.");
    }

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
    if (coordinates.length === 0) continue;
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
    if (facts.length === 0) continue;
    const currencies = new Set(facts.map((fact) => fact.currency));
    if (currencies.size !== 1) {
      return refused("INVALID_INPUT", "Baseline currency is not uniform.");
    }
    const [currency] = currencies;

    const assessed = assessPartitionBaselines({
      windowStart: baselineWindow.startDate,
      windowEndExclusive: baselineWindow.endDateExclusive,
      cutoffDate: context.sourceCutoffDate,
      currency: currency ?? "AED",
      scopePartitions,
      facts,
    });
    // Every partition conflicting means the rung's evidence disagrees with
    // itself: refuse outright rather than widening past the defect. A mix of
    // conflicted and merely empty partitions widens — the empty ones may
    // still report further back, and the builder names whichever partitions
    // cannot qualify.
    if (assessed.every((partition) => partition.status === "conflict")) {
      return refused(
        "BASELINE_INCOMPLETE",
        "Conflicting reports cover the same day, so no total is stated.",
      );
    }
    const rungQualifies = assessed.some(
      (partition) =>
        partition.status === "ok" && partition.reportedDays.length >= rung.minReportedDays,
    );
    if (!rungQualifies) continue;

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
      minReportedDays: rung.minReportedDays,
      baselineFacts: [...facts],
      findingBases: [],
      actionCandidates: [],
    });
  }

  return refused(
    "BASELINE_INCOMPLETE",
    "No fallback rung of the trailing window carries enough reported days.",
  );
}
