import { z } from "zod";

import {
  addLocalDays,
  daysBetweenLocal,
  isoDateSchema,
  organizationLocalDate,
  resolveGrowthPeriod,
} from "@/domain/organizations/growth-periods";
import {
  buildEvenPaceProjection,
  currencySchema,
  frozenGrowthProjectionSchema,
  GROWTH_SERIES_MAX_FACTS,
  revenueFactSchema,
  scopePartitionSchema,
  GrowthProgressError,
  type FrozenGrowthProjection,
  type RevenueFact,
  type ScopePartition,
} from "@/domain/organizations/growth-progress";
import {
  buildRevenueScenario,
  type RevenueScenarioAction,
} from "@/domain/organizations/revenue-scenario";

/**
 * Fixed-projection candidate builder for the nightly worker (data contract D03).
 *
 * Like estimating a shop's monthly pace from its recent till receipts: the
 * estimate only exists when enough recent days actually reported, each day is
 * counted exactly once, and the freshest receipt is new enough to trust.
 * Missing days are left out and named — never zero-filled, never invented —
 * and anything less than the floor is a typed refusal, never a guessed
 * figure. A useful suggestion whose money cannot be proven stays visible as
 * advice while its amount stays out of the frozen numbers.
 *
 * Pure and deterministic: same inputs always give the same candidate. No
 * database, clock, model, network or Node built-in is touched, so later tasks
 * may import this module wherever the worker composes its candidate.
 */

/** Local days in the trailing baseline window ending at the source cutoff. */
export const GROWTH_BASELINE_WINDOW_DAYS = 30;

/** Minimum reported days in the window; fewer refuses instead of guessing. */
export const GROWTH_BASELINE_MIN_REPORTED_DAYS = 7;

/** Standard month the observed daily mean scales to; a named judgment call. */
export const GROWTH_BASELINE_STANDARD_MONTH_DAYS = 30;

/** A baseline month ending more than this many local days before issue is stale. */
export const GROWTH_BASELINE_MAX_AGE_DAYS = 45;

/** User-facing label for an estimate that carries no action impact. */
export const BASELINE_ONLY_LIMITATION = "Action impact is not included in this estimate.";

const EVEN_PACE_LIMITATION =
  "Even-pace estimate: each month carries the same frozen monthly amounts, spread evenly across its days.";

const MAX_FINDING_BASES = 24;
const MAX_ACTION_CANDIDATES = 50;

export type GrowthCandidateRefusalReason =
  | "INVALID_INPUT"
  | "SCOPE_NOT_COMPARABLE"
  | "BASELINE_INCOMPLETE"
  | "BASELINE_STALE"
  | "PERIOD_ALREADY_STARTED"
  | "SCHEDULE_MISMATCH"
  | "MONEY_OVERFLOW"
  | "SOURCE_LIMIT_EXCEEDED";

/** Thrown when a frozen scope would double-count or misattribute revenue. */
export class GrowthScopeError extends Error {
  readonly code = "SCOPE_NOT_COMPARABLE" as const;

  constructor(message = "The reporting scope cannot be compared without double counting.") {
    super(message);
    this.name = "GrowthScopeError";
  }
}

/**
 * Checks a frozen scope for double-counting shapes (data contract D02).
 *
 * Never adds an organization-level total to its own branch subtotals, and
 * never admits two partitions over the same coordinates: either shape would
 * count the same revenue twice. Dimension digests stay opaque lineage here —
 * dimensioned rows are excluded at the fact read, and the coordinate rule
 * below keeps any one row attributable to exactly one partition.
 */
export function growthScopeProblem(
  partitions: readonly ScopePartition[],
): "SCOPE_NOT_COMPARABLE" | null {
  const keys = partitions.map((partition) => partition.partitionKey);
  if (new Set(keys).size !== keys.length) return "SCOPE_NOT_COMPARABLE";

  const coords = partitions.map((partition) =>
    [partition.channelId ?? "-", partition.branchId ?? "-", partition.metricDefinitionId].join("|"),
  );
  if (new Set(coords).size !== coords.length) return "SCOPE_NOT_COMPARABLE";

  const byChannel = new Map<string, { total: boolean; parts: boolean }>();
  for (const partition of partitions) {
    const group = byChannel.get(partition.channelId ?? "-") ?? { total: false, parts: false };
    if (partition.branchId === null) group.total = true;
    else group.parts = true;
    byChannel.set(partition.channelId ?? "-", group);
  }
  for (const group of byChannel.values()) {
    if (group.total && group.parts) return "SCOPE_NOT_COMPARABLE";
  }
  return null;
}

/** Throws GrowthScopeError when the scope cannot be compared. Shared with the reader. */
export function assertComparableGrowthScope(partitions: readonly ScopePartition[]): void {
  if (growthScopeProblem(partitions) !== null) {
    throw new GrowthScopeError(
      "The scope mixes an organization total with its branch subtotals, so no total is stated.",
    );
  }
}

const instantSchema = z
  .string()
  .refine((value) => value.includes("T") && !Number.isNaN(Date.parse(value)), {
    message: "Instants must parse as timestamps.",
  });

const growthPeriodInputSchema = z
  .strictObject({
    horizonMonths: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]),
    cycleIndex: z.number().int().min(0),
    startDate: isoDateSchema,
    endDateExclusive: isoDateSchema,
  })
  .refine((value) => value.startDate < value.endDateExclusive, {
    message: "A growth period must end after it starts.",
  });

const growthFindingBasisSchema = z
  .strictObject({
    findingId: z.string().uuid(),
    organizationId: z.string().uuid(),
    basisMinorUnits: z.number().int().min(0),
    currency: currencySchema,
    windowStartDate: isoDateSchema,
    windowEndExclusive: isoDateSchema,
    channelId: z.string().uuid().nullable(),
    branchId: z.string().uuid().nullable(),
  })
  .refine((value) => value.windowStartDate < value.windowEndExclusive, {
    message: "A finding window must end after it starts.",
  });

const growthActionCandidateSchema = z
  .strictObject({
    sourceKind: z.string().trim().min(1).max(80),
    sourceId: z.string().trim().min(1).max(200),
    sourceRevision: z.string().trim().min(1).max(200),
    citedFindingId: z.string().uuid(),
    lowFraction: z.number().min(0).max(1),
    highFraction: z.number().min(0).max(1),
  })
  .refine((value) => value.lowFraction <= value.highFraction, {
    message: "Assumption low must not exceed high.",
  });

const buildCandidateInputSchema = z.strictObject({
  organizationId: z.string().uuid(),
  scheduleOriginDate: isoDateSchema,
  period: growthPeriodInputSchema,
  issuedAt: instantSchema,
  sourceCutoffDate: isoDateSchema,
  timeZone: z.string().min(1).max(120),
  currency: currencySchema,
  scopePartitions: z.array(scopePartitionSchema).min(1).max(100),
  baselineWindow: z
    .strictObject({ startDate: isoDateSchema, endDateExclusive: isoDateSchema })
    .refine((value) => value.startDate < value.endDateExclusive, {
      message: "A baseline window must end after it starts.",
    }),
  baselineFacts: z.array(revenueFactSchema),
  findingBases: z.array(growthFindingBasisSchema).max(MAX_FINDING_BASES),
  actionCandidates: z.array(growthActionCandidateSchema).max(MAX_ACTION_CANDIDATES),
});

export type BuildGrowthProjectionCandidateInput = z.input<typeof buildCandidateInputSchema>;

export type BuildGrowthProjectionCandidateResult =
  | { status: "ready"; document: FrozenGrowthProjection }
  | { status: "refused"; reason: GrowthCandidateRefusalReason; detail: string };

function refused(reason: GrowthCandidateRefusalReason, detail: string) {
  return { status: "refused" as const, reason, detail };
}

/**
 * Names the trailing baseline window: the 30 local days ending at the source
 * cutoff (data contract D03).
 *
 * The window anchors at the cutoff — the freshest day the source vouches
 * for — rather than at an arbitrary calendar month, so a new organization
 * publishes within days of reporting and one missing day no longer voids a
 * month. Downstream always takes this window as given; a stray old report
 * cannot rename it.
 */
export function resolveTrailingBaselineWindow(cutoffLocalDate: string): {
  startDate: string;
  endDateExclusive: string;
} {
  const parsed = isoDateSchema.safeParse(cutoffLocalDate);
  if (!parsed.success)
    throw new GrowthProgressError("INVALID_INPUT", "Cutoff dates read YYYY-MM-DD.");
  return {
    startDate: addLocalDays(cutoffLocalDate, -(GROWTH_BASELINE_WINDOW_DAYS - 1)),
    endDateExclusive: addLocalDays(cutoffLocalDate, 1),
  };
}

function toSafeTotal(value: bigint): number | null {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    return null;
  }
  return Number(value);
}

function bigintGcd(left: bigint, right: bigint): bigint {
  let remaining = left < BigInt(0) ? -left : left;
  let divisor = right < BigInt(0) ? -right : right;
  while (divisor !== BigInt(0)) {
    const next = remaining % divisor;
    remaining = divisor;
    divisor = next;
  }
  return remaining;
}

/** Rounded quotient with a positive denominator, ties half away from zero. */
function divHalfAway(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const doubled = remainder * BigInt(2);
  if (doubled >= denominator) return quotient + BigInt(1);
  if (doubled <= -denominator) return quotient - BigInt(1);
  return quotient;
}

type TrailingBaselineAssessment =
  | {
      status: "ok";
      reportedDays: string[];
      totalNumerator: bigint;
      totalDenominator: bigint;
    }
  | { status: "conflict" };

/**
 * Assesses the trailing reported window day by day (data contract D03).
 *
 * Facts outside the window are ignored, never clipped into it — the reader
 * drops crossing rows in production, and this matches that boundary wherever
 * facts arrive pre-bounded. A day is reported only when every frozen
 * partition covers it exactly once at the finest granularity available: an
 * exact day cover wins over a coarser containing span (which is then ignored
 * for that day); a single containing span contributes its amount spread
 * evenly over its own reported days; two disagreeing covers of one day mark
 * the whole assessment conflicting. A foreign-currency edge taints the days
 * it spans for its partition, mirroring the D05 taint rule.
 *
 * The running total stays an exact reduced rational, so a weekly span of
 * 700 over 7 days contributes exactly 100 a day — mean arithmetic only. No
 * daily observation is created, stored or drawn from this; D05 still governs
 * what the blue line may show.
 */
function assessTrailingBaselineWindow(args: {
  windowStart: string;
  windowEndExclusive: string;
  cutoffDate: string;
  currency: string;
  scopePartitions: readonly ScopePartition[];
  facts: readonly RevenueFact[];
}): TrailingBaselineAssessment {
  const { windowStart, windowEndExclusive, cutoffDate, currency, scopePartitions, facts } = args;
  const keys = scopePartitions.map((partition) => partition.partitionKey);
  const byPartition = new Map<string, RevenueFact[]>();
  for (const key of keys) byPartition.set(key, []);
  for (const fact of facts) {
    const bucket = byPartition.get(fact.partitionKey);
    if (!bucket) continue;
    if (fact.startDate < windowStart || fact.endDateExclusive > windowEndExclusive) continue;
    bucket.push(fact);
  }
  // Only dates the source vouches for: inside the window and at/before cutoff.
  let lastDate = addLocalDays(windowEndExclusive, -1);
  if (lastDate > cutoffDate) lastDate = cutoffDate;
  const reportedDays: string[] = [];
  let totalNumerator = BigInt(0);
  let totalDenominator = BigInt(1);
  for (let date = windowStart; date <= lastDate; date = addLocalDays(date, 1)) {
    const nextDay = addLocalDays(date, 1);
    let dayNumerator = BigInt(0);
    let dayDenominator = BigInt(1);
    let covered = true;
    for (const key of keys) {
      const containing = (byPartition.get(key) ?? []).filter(
        (fact) => fact.startDate <= date && date < fact.endDateExclusive,
      );
      if (containing.some((fact) => fact.currency !== currency)) {
        covered = false;
        break;
      }
      const seen = new Set<string>();
      const edges: RevenueFact[] = [];
      for (const fact of containing) {
        const identity = `${fact.sourceTable}\n${fact.rowId}`;
        if (seen.has(identity)) continue;
        seen.add(identity);
        edges.push(fact);
      }
      const exact = edges.filter(
        (fact) => fact.startDate === date && fact.endDateExclusive === nextDay,
      );
      let amount: bigint;
      let spanDays: bigint;
      if (exact.length > 0) {
        const amounts = new Set(exact.map((fact) => fact.amountMinor));
        if (amounts.size !== 1) return { status: "conflict" };
        amount = BigInt(exact[0]!.amountMinor);
        spanDays = BigInt(1);
      } else if (edges.length === 0) {
        covered = false;
        break;
      } else {
        const shapes = new Set(
          edges.map((fact) => `${fact.startDate}|${fact.endDateExclusive}|${fact.amountMinor}`),
        );
        if (shapes.size !== 1) return { status: "conflict" };
        const only = edges[0]!;
        amount = BigInt(only.amountMinor);
        spanDays = BigInt(daysBetweenLocal(only.startDate, only.endDateExclusive));
      }
      dayNumerator = dayNumerator * spanDays + amount * dayDenominator;
      dayDenominator = dayDenominator * spanDays;
      const divisor = bigintGcd(dayNumerator, dayDenominator);
      if (divisor > BigInt(1)) {
        dayNumerator /= divisor;
        dayDenominator /= divisor;
      }
    }
    if (!covered) continue;
    reportedDays.push(date);
    totalNumerator = totalNumerator * dayDenominator + dayNumerator * totalDenominator;
    totalDenominator = totalDenominator * dayDenominator;
    const totalDivisor = bigintGcd(totalNumerator, totalDenominator);
    if (totalDivisor > BigInt(1)) {
      totalNumerator /= totalDivisor;
      totalDenominator /= totalDivisor;
    }
  }
  return { status: "ok", reportedDays, totalNumerator, totalDenominator };
}

/** User-facing coverage line naming exactly what the baseline rests on. */
function reportedDaysLimitation(reportedDays: number, latestDate: string): string {
  return (
    `Baseline from ${reportedDays} reported days (ending ${latestDate}); ` +
    `missing days excluded, monthly pace scaled from the observed daily mean.`
  );
}

/**
 * Builds one frozen candidate document, or a typed refusal (data contract D03).
 *
 * The baseline is the trailing reported window over the frozen scope: the
 * observed daily mean scaled to a 30-day standard month, requiring at least
 * GROWTH_BASELINE_MIN_REPORTED_DAYS reported days and a latest reported day
 * no older than GROWTH_BASELINE_MAX_AGE_DAYS. Qualified action ranges adapt
 * to the existing deterministic scenario engine; an unqualified range keeps
 * its advice downstream but contributes no money here.
 */
export function buildGrowthProjectionCandidate(
  rawInput: unknown,
): BuildGrowthProjectionCandidateResult {
  const parsed = buildCandidateInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return refused("INVALID_INPUT", "The candidate inputs were not usable.");
  }
  const input = parsed.data;

  if (growthScopeProblem(input.scopePartitions) !== null) {
    return refused(
      "SCOPE_NOT_COMPARABLE",
      "The scope mixes a total with its own subtotals, so no total is stated.",
    );
  }

  let issueLocalDate: string;
  try {
    issueLocalDate = organizationLocalDate(input.issuedAt, input.timeZone);
  } catch {
    return refused("INVALID_INPUT", "The organization timezone is not usable.");
  }
  if (input.sourceCutoffDate > issueLocalDate) {
    return refused("INVALID_INPUT", "The source cutoff must not postdate the issue day.");
  }

  let expectedStart = "";
  let expectedEnd = "";
  try {
    const expected = resolveGrowthPeriod(
      input.scheduleOriginDate,
      input.period.horizonMonths,
      input.period.cycleIndex,
    );
    expectedStart = expected.startDate;
    expectedEnd = expected.endDateExclusive;
  } catch {
    return refused("INVALID_INPUT", "The schedule origin cannot place this period.");
  }
  if (input.period.startDate !== expectedStart || input.period.endDateExclusive !== expectedEnd) {
    return refused("SCHEDULE_MISMATCH", "The period sits off its fixed schedule grid.");
  }
  if (input.period.startDate <= issueLocalDate) {
    return refused("PERIOD_ALREADY_STARTED", "A projection starts before its period, never after.");
  }

  // The baseline is the trailing reported window ending at the source
  // cutoff: the observed daily mean over reported days, scaled to a standard
  // month. Missing days are excluded and named, never filled.
  const baseline = input.baselineWindow;
  if (baseline.endDateExclusive > input.period.startDate) {
    return refused("BASELINE_INCOMPLETE", "The baseline ends before the projected period.");
  }
  if (input.baselineFacts.length > GROWTH_SERIES_MAX_FACTS) {
    return refused(
      "SOURCE_LIMIT_EXCEEDED",
      "One view reads at most 10000 facts; the total is withheld, not guessed.",
    );
  }
  const assessed = assessTrailingBaselineWindow({
    windowStart: baseline.startDate,
    windowEndExclusive: baseline.endDateExclusive,
    cutoffDate: input.sourceCutoffDate,
    currency: input.currency,
    scopePartitions: input.scopePartitions,
    facts: input.baselineFacts,
  });
  if (assessed.status === "conflict") {
    return refused(
      "BASELINE_INCOMPLETE",
      "Conflicting reports cover the same day, so no total is stated.",
    );
  }
  if (assessed.reportedDays.length < GROWTH_BASELINE_MIN_REPORTED_DAYS) {
    return refused(
      "BASELINE_INCOMPLETE",
      "Fewer than 7 reported days precede the cutoff, so no total is stated.",
    );
  }
  const latestReported = assessed.reportedDays[assessed.reportedDays.length - 1]!;
  if (daysBetweenLocal(latestReported, issueLocalDate) > GROWTH_BASELINE_MAX_AGE_DAYS) {
    return refused("BASELINE_STALE", "The latest reported day ended too long before issue.");
  }
  const monthTotal = toSafeTotal(
    divHalfAway(
      BigInt(GROWTH_BASELINE_STANDARD_MONTH_DAYS) * assessed.totalNumerator,
      assessed.totalDenominator * BigInt(assessed.reportedDays.length),
    ),
  );
  if (monthTotal === null) {
    return refused("MONEY_OVERFLOW", "A baseline amount left safe integers.");
  }

  // Qualify each range against tenant, currency, baseline window and frozen
  // scope. A range that fails keeps its advice downstream (Task 5) but its
  // money never enters the frozen curve.
  const basisById = new Map(input.findingBases.map((basis) => [basis.findingId, basis]));
  const qualified: Array<{
    sourceKind: string;
    sourceId: string;
    sourceRevision: string;
    citedFindingId: string;
    lowFraction: number;
    highFraction: number;
    basisMinorUnits: number;
    basisCurrency: string;
  }> = [];
  for (const candidate of input.actionCandidates) {
    const basis = basisById.get(candidate.citedFindingId);
    if (!basis) continue;
    if (basis.organizationId !== input.organizationId) continue;
    if (basis.currency !== input.currency) continue;
    if (
      basis.windowStartDate < baseline.startDate ||
      basis.windowEndExclusive > baseline.endDateExclusive
    ) {
      continue;
    }
    const scopeMatch = input.scopePartitions.some(
      (partition) =>
        partition.channelId === basis.channelId && partition.branchId === basis.branchId,
    );
    if (!scopeMatch) continue;
    qualified.push({
      sourceKind: candidate.sourceKind,
      sourceId: candidate.sourceId,
      sourceRevision: candidate.sourceRevision,
      citedFindingId: candidate.citedFindingId,
      lowFraction: candidate.lowFraction,
      highFraction: candidate.highFraction,
      basisMinorUnits: basis.basisMinorUnits,
      basisCurrency: basis.currency,
    });
  }

  // Adapt the qualified inputs to the existing deterministic scenario engine.
  // Titles and statuses below never reach storage: only the combined monthly
  // bounds are frozen, so placeholder wording cannot leak into the document.
  const lossById = new Map<string, { findingId: string; minorUnits: number; currency: string }>();
  for (const entry of qualified) {
    if (!lossById.has(entry.citedFindingId)) {
      lossById.set(entry.citedFindingId, {
        findingId: entry.citedFindingId,
        minorUnits: entry.basisMinorUnits,
        currency: entry.basisCurrency,
      });
    }
  }
  const actions: RevenueScenarioAction[] = qualified.map((entry, index) => ({
    id: `candidate-${index}`,
    title: "Qualified action",
    kind: "recommendation",
    status: "Qualified",
    href: null,
    citedFindingId: entry.citedFindingId,
    citedBasisMinorUnits: entry.basisMinorUnits,
    citedCurrency: entry.basisCurrency,
    assumptionLow: entry.lowFraction,
    assumptionHigh: entry.highFraction,
  }));
  const scenario = buildRevenueScenario({
    organizationId: input.organizationId,
    grain: "month",
    history: [
      {
        label: latestReported.slice(0, 7),
        minorUnits: monthTotal,
        currency: input.currency,
      },
    ],
    losses: [...lossById.values()],
    actions,
    lastObservationDate: latestReported,
    today: issueLocalDate,
    cutoffNote: `Reports through ${latestReported}.`,
    coverageNote: `${input.scopePartitions.length} frozen scope partitions · trailing reported-day baseline.`,
  });
  if (scenario.state !== "ready") {
    return refused("INVALID_INPUT", "The qualified inputs cannot form a scenario.");
  }
  const monthlyLow = toSafeTotal(BigInt(monthTotal) + BigInt(scenario.combinedLowMinorUnits));
  const monthlyHigh = toSafeTotal(BigInt(monthTotal) + BigInt(scenario.combinedHighMinorUnits));
  if (monthlyLow === null || monthlyHigh === null || monthlyLow > monthlyHigh) {
    return refused("MONEY_OVERFLOW", "A monthly amount left safe integers.");
  }

  let document: FrozenGrowthProjection;
  try {
    const points = buildEvenPaceProjection({
      scheduleOriginDate: input.scheduleOriginDate,
      periodStart: input.period.startDate,
      periodEndExclusive: input.period.endDateExclusive,
      monthlyLowMinor: monthlyLow,
      monthlyHighMinor: monthlyHigh,
    });
    const candidate = {
      organizationId: input.organizationId,
      scheduleOriginDate: input.scheduleOriginDate,
      cycleIndex: input.period.cycleIndex,
      horizonMonths: input.period.horizonMonths,
      startDate: input.period.startDate,
      endDateExclusive: input.period.endDateExclusive,
      issuedAt: input.issuedAt,
      sourceCutoffDate: input.sourceCutoffDate,
      timeZone: input.timeZone,
      currency: input.currency,
      metricKey: "revenue.gross" as const,
      scopePartitions: input.scopePartitions,
      baselineWindow: {
        startDate: baseline.startDate,
        endDateExclusive: baseline.endDateExclusive,
      },
      monthlyLowMinor: monthlyLow,
      monthlyHighMinor: monthlyHigh,
      points: [...points],
      // Baseline-only manifests stay empty by Task-5 decision (a): the
      // publication boundary binds every manifest row to a ledger revision
      // (`v_row_revision::text <> v_claim_revision` rejects, and a null
      // revision is rejected outright), while the Task-1 fact DTO carries
      // no revision to bind. A populated-but-unbound manifest could never
      // publish, so an empty — contract-valid — manifest plus the frozen
      // baseline window and scope below preserve what the estimate rests
      // on. Per-row lineage needs the DTO revision amendment first; that
      // follow-up is recorded, not silent.
      sources: [],
      actionAssumptions: qualified.map((entry) => ({
        sourceKind: entry.sourceKind,
        sourceId: entry.sourceId,
        sourceRevision: entry.sourceRevision,
        citedFindingId: entry.citedFindingId,
        lowFraction: entry.lowFraction,
        highFraction: entry.highFraction,
      })),
      limitations: [
        EVEN_PACE_LIMITATION,
        reportedDaysLimitation(assessed.reportedDays.length, latestReported),
        ...(qualified.length === 0 ? [BASELINE_ONLY_LIMITATION] : []),
      ],
    };
    const checked = frozenGrowthProjectionSchema.safeParse(candidate);
    if (!checked.success) {
      return refused("INVALID_INPUT", "The candidate document cannot validate.");
    }
    document = checked.data;
  } catch (error) {
    if (error instanceof GrowthProgressError && error.code === "MONEY_OVERFLOW") {
      return refused("MONEY_OVERFLOW", "A monthly amount left safe integers.");
    }
    return refused("INVALID_INPUT", "The projection curve cannot be built.");
  }

  return { status: "ready", document };
}
