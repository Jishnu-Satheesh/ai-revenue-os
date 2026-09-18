import {
  GROWTH_HORIZON_MONTHS,
  addLocalDays,
  nextProjectionIssueDate,
  organizationLocalDate,
  resolveGrowthPeriod,
  type GrowthHorizonMonths,
} from "@/domain/organizations/growth-periods";
import type { FrozenGrowthProjection } from "@/domain/organizations/growth-progress";
import type { RevenueScenarioInput } from "@/domain/organizations/revenue-scenario";
import type {
  BuildGrowthProjectionCandidateResult,
  GrowthCandidateRefusalReason,
} from "@/modules/organizations/application/growth-projection-builder";
import type { GrowthProjectionWritePort } from "@/modules/organizations/application/growth-progress-ports";

/**
 * Prospective per-horizon publication behind the existing nightly worker.
 *
 * Like a notary stamping pre-dated deeds exactly on the morning they become
 * valid: each horizon (1/3/6/12 months) has its own fixed calendar grid from
 * one shared origin, and tonight's run may only stamp the deeds whose
 * validity starts tomorrow. Stamping yesterday's deed, inventing an origin,
 * or rewriting a stamped deed are all refused — loudly, per horizon, and
 * without ever touching the mutable snapshot that rode along in the same run.
 *
 * Pure orchestration with injected boundaries: same inputs always give the
 * same results. No database, clock, model or Node built-in is touched here,
 * so every schedule semantic below is unit-testable with fakes. The worker
 * composition root supplies the reads, the candidate step and the
 * publication RPC; the database unique key behind that RPC stays the
 * authority on duplicates, never the transport around it.
 */

/**
 * Validated union input (with the run's already-proposed ranges applied)
 * handed over by the existing snapshot build. The snapshot build owns the
 * single model invocation; this phase never proposes again. Null means the
 * snapshot reads failed or never stored, so there is nothing to publish.
 */
export type GrowthCandidateMaterial = { input: RevenueScenarioInput } | null;

export type GrowthCandidateBuildContext = {
  organizationId: string;
  scheduleOriginDate: string;
  horizonMonths: GrowthHorizonMonths;
  cycleIndex: number;
  issuedAt: string;
  sourceCutoffDate: string;
  timeZone: string;
};

/**
 * What the worker already knows about an organization's frozen schedule:
 * either nothing yet (bootstrap), the stored origins, or an explicit
 * refusal to say. Origins must all agree — two origins for one organization
 * is corruption, and a corrupt schedule publishes nothing.
 */
export type GrowthScheduleSnapshot =
  | { status: "missing" }
  | { status: "ready"; origins: readonly string[] }
  | {
      status: "unavailable";
      reasonCode: "SCHEDULE_READ_FAILED" | "SCHEDULE_DENIED" | "SCHEDULE_CORRUPT";
    };

export type GrowthPublicationSkipCode =
  | "DISABLED"
  | "NOT_DUE"
  | "CANDIDATE_UNAVAILABLE"
  | "SCHEDULE_UNAVAILABLE"
  | "SCHEDULE_READ_FAILED"
  | "SCHEDULE_DENIED"
  | "SCHEDULE_CORRUPT"
  | `CANDIDATE_${GrowthCandidateRefusalReason}`;

export type GrowthPublicationFailCode =
  | "INVALID_INPUT"
  | "TENANT_MISMATCH"
  | "INVALID_DOCUMENT"
  | "SCHEDULE_MISMATCH"
  | "PERIOD_ALREADY_STARTED"
  | "INVALID_CURVE"
  | "IMMUTABLE_ROW"
  | "PERMISSION_DENIED"
  | "PUBLISH_FAILED";

export type GrowthHorizonPublication =
  | {
      horizonMonths: GrowthHorizonMonths;
      status: "published" | "replayed";
      projectionId: string;
      digest: string;
      reasonCode: null;
    }
  | {
      horizonMonths: GrowthHorizonMonths;
      status: "skipped" | "failed";
      projectionId: null;
      digest: null;
      reasonCode: GrowthPublicationSkipCode | GrowthPublicationFailCode;
    };

export type PublishDueGrowthProjectionsResult = {
  results: GrowthHorizonPublication[];
};

export type GrowthProjectionPublisherDependencies = {
  isEnabled: (organizationId: string) => boolean;
  readSchedule: (organizationId: string, asOfDate: string) => Promise<GrowthScheduleSnapshot>;
  buildCandidate: (
    material: RevenueScenarioInput,
    context: GrowthCandidateBuildContext,
  ) => BuildGrowthProjectionCandidateResult | Promise<BuildGrowthProjectionCandidateResult>;
  publish: GrowthProjectionWritePort["publish"];
};

export type PublishDueGrowthProjectionsInput = {
  organizationId: string;
  nowIso: string;
  timeZone: string;
  correlationId: string;
  candidateMaterial: GrowthCandidateMaterial;
};

const PUBLISH_FAILURE_CODES: ReadonlySet<string> = new Set([
  "INVALID_INPUT",
  "TENANT_MISMATCH",
  "INVALID_DOCUMENT",
  "SCHEDULE_MISMATCH",
  "PERIOD_ALREADY_STARTED",
  "INVALID_CURVE",
  "IMMUTABLE_ROW",
  "PERMISSION_DENIED",
  "PUBLISH_FAILED",
]);

function toFailureCode(error: unknown): GrowthPublicationFailCode {
  const code =
    typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  if (typeof code === "string" && PUBLISH_FAILURE_CODES.has(code)) {
    return code as GrowthPublicationFailCode;
  }
  return "PUBLISH_FAILED";
}

/**
 * The cycle whose nightly issue date is exactly today, or null when no
 * period starts tomorrow. Cycles are always recomputed from the original
 * origin (never chained), so a February clamp never drifts later months and
 * one horizon rolling never moves another.
 */
function dueCycleForHorizon(
  scheduleOriginDate: string,
  horizonMonths: GrowthHorizonMonths,
  todayLocalDate: string,
): number | null {
  for (let cycleIndex = 0; cycleIndex <= 1200; cycleIndex += 1) {
    const period = resolveGrowthPeriod(scheduleOriginDate, horizonMonths, cycleIndex);
    const issueDate = nextProjectionIssueDate(period.startDate);
    if (issueDate === todayLocalDate) return cycleIndex;
    if (issueDate > todayLocalDate) return null;
  }
  return null;
}

function skippedAll(
  reasonCode: GrowthHorizonPublication["reasonCode"] & string,
): PublishDueGrowthProjectionsResult {
  return {
    results: GROWTH_HORIZON_MONTHS.map((horizonMonths) => ({
      horizonMonths,
      status: "skipped" as const,
      projectionId: null,
      digest: null,
      reasonCode: reasonCode as GrowthPublicationSkipCode,
    })),
  };
}

/**
 * Default candidate step over the snapshot material. The snapshot union
 * input carries month totals and applied ranges but no ledger-bound scope
 * partitions or baseline facts — and a frozen baseline without that proof
 * is never stated. Until the populate-vs-amend lineage decision (owed
 * before Task 5) brings bound inputs to this boundary, every due horizon
 * skips with its reason intact rather than publishing a guessed curve.
 */
export function buildSnapshotGrowthCandidate(
  _material: RevenueScenarioInput,
  _context: GrowthCandidateBuildContext,
): BuildGrowthProjectionCandidateResult {
  void _material;
  void _context;
  return {
    status: "refused",
    reason: "BASELINE_INCOMPLETE",
    detail:
      "The nightly snapshot material carries no ledger-bound baseline facts, so no frozen baseline is stated.",
  };
}

export async function publishDueGrowthProjections(
  input: PublishDueGrowthProjectionsInput,
  dependencies: GrowthProjectionPublisherDependencies,
): Promise<PublishDueGrowthProjectionsResult> {
  const { organizationId, nowIso, timeZone, correlationId, candidateMaterial } = input;

  let todayLocalDate: string;
  try {
    todayLocalDate = organizationLocalDate(nowIso, timeZone);
  } catch {
    return skippedAll("SCHEDULE_UNAVAILABLE");
  }

  // The gate is checked before any read, build or publish: a disabled
  // organization leaves no trace in the frozen store, not even a skipped row.
  if (!dependencies.isEnabled(organizationId)) {
    return skippedAll("DISABLED");
  }

  let schedule: GrowthScheduleSnapshot;
  try {
    schedule = await dependencies.readSchedule(organizationId, todayLocalDate);
  } catch {
    return skippedAll("SCHEDULE_UNAVAILABLE");
  }
  if (schedule.status === "unavailable") {
    return skippedAll(schedule.reasonCode);
  }

  // Bootstrap establishes the origin as tomorrow: the first build starts on
  // the next local day, and all four horizons share that one origin. A
  // stored schedule keeps its original day forever — never re-anchored.
  let scheduleOriginDate: string;
  if (schedule.status === "missing") {
    scheduleOriginDate = addLocalDays(todayLocalDate, 1);
  } else {
    const origins = [...new Set(schedule.origins)];
    const agreed = origins.length === 1 ? origins[0] : undefined;
    if (agreed === undefined) {
      return skippedAll("SCHEDULE_CORRUPT");
    }
    scheduleOriginDate = agreed;
  }

  const results: GrowthHorizonPublication[] = [];
  for (const horizonMonths of GROWTH_HORIZON_MONTHS) {
    const cycleIndex = dueCycleForHorizon(scheduleOriginDate, horizonMonths, todayLocalDate);
    if (cycleIndex === null) {
      results.push({
        horizonMonths,
        status: "skipped",
        projectionId: null,
        digest: null,
        reasonCode: "NOT_DUE",
      });
      continue;
    }
    if (candidateMaterial === null) {
      results.push({
        horizonMonths,
        status: "skipped",
        projectionId: null,
        digest: null,
        reasonCode: "CANDIDATE_UNAVAILABLE",
      });
      continue;
    }

    let candidate: BuildGrowthProjectionCandidateResult;
    try {
      candidate = await dependencies.buildCandidate(candidateMaterial.input, {
        organizationId,
        scheduleOriginDate,
        horizonMonths,
        cycleIndex,
        issuedAt: nowIso,
        sourceCutoffDate: todayLocalDate,
        timeZone,
      });
    } catch {
      results.push({
        horizonMonths,
        status: "failed",
        projectionId: null,
        digest: null,
        reasonCode: "PUBLISH_FAILED",
      });
      continue;
    }
    if (candidate.status === "refused") {
      results.push({
        horizonMonths,
        status: "skipped",
        projectionId: null,
        digest: null,
        reasonCode: `CANDIDATE_${candidate.reason}`,
      });
      continue;
    }

    // Candidate documents travel to the write boundary unchanged — lineage
    // included. The publisher never edits, re-dates or re-numbers them.
    const document: FrozenGrowthProjection = candidate.document;
    if (document.organizationId !== organizationId) {
      results.push({
        horizonMonths,
        status: "failed",
        projectionId: null,
        digest: null,
        reasonCode: "TENANT_MISMATCH",
      });
      continue;
    }

    try {
      const published = await dependencies.publish({
        organizationId,
        document,
        correlationId,
      });
      results.push(
        published.published
          ? {
              horizonMonths,
              status: "published",
              projectionId: published.projectionId,
              digest: published.digest,
              reasonCode: null,
            }
          : {
              horizonMonths,
              status: "replayed",
              projectionId: published.projectionId,
              digest: published.digest,
              reasonCode: null,
            },
      );
    } catch (error) {
      // A missed prospective window surfaces here: when a retry crosses the
      // period start, the database refuses with PERIOD_ALREADY_STARTED and
      // the frozen line stays exactly where it was — never backfilled.
      results.push({
        horizonMonths,
        status: "failed",
        projectionId: null,
        digest: null,
        reasonCode: toFailureCode(error),
      });
    }
  }
  return { results };
}
