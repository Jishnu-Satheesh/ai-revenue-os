import { z } from "zod";

import {
  addLocalDays,
  addLocalMonths,
  daysBetweenLocal,
  isoDateSchema,
  organizationLocalDate,
  resolveGrowthPeriod,
} from "@/domain/organizations/growth-periods";
import {
  buildActualGrowthSeries,
  buildEvenPaceProjection,
  currencySchema,
  frozenGrowthProjectionSchema,
  revenueFactSchema,
  scopePartitionSchema,
  GrowthProgressError,
  type FrozenGrowthProjection,
  type ScopePartition,
} from "@/domain/organizations/growth-progress";
import {
  buildRevenueScenario,
  type RevenueScenarioAction,
} from "@/domain/organizations/revenue-scenario";

/**
 * Fixed-projection candidate builder for the nightly worker (data contract D03).
 *
 * Like checking a shop's full prior-month ledger before writing next month's
 * rota: the rota only exists when that month is counted completely, counted
 * once, and fresh enough to trust. Anything less is a typed refusal, never a
 * guessed rota — and a useful suggestion whose money cannot be proven stays
 * visible as advice while its amount stays out of the frozen numbers.
 *
 * Pure and deterministic: same inputs always give the same candidate. No
 * database, clock, model, network or Node built-in is touched, so later tasks
 * may import this module wherever the worker composes its candidate.
 */

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
 * Names the complete calendar month before the issue date (data contract D03).
 *
 * The label downstream always comes from this window — never parsed out of an
 * arbitrary historical bucket — so a stray old report cannot rename the month.
 */
export function resolvePriorCalendarMonthWindow(issueLocalDate: string): {
  startDate: string;
  endDateExclusive: string;
} {
  const parsed = isoDateSchema.safeParse(issueLocalDate);
  if (!parsed.success)
    throw new GrowthProgressError("INVALID_INPUT", "Issue dates read YYYY-MM-DD.");
  const year = Number(issueLocalDate.slice(0, 4));
  const month = Number(issueLocalDate.slice(5, 7));
  const pad = (value: number) => String(value).padStart(2, "0");
  const endDateExclusive = `${year}-${pad(month)}-01`;
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  return { startDate: `${prevYear}-${pad(prevMonth)}-01`, endDateExclusive };
}

function toSafeTotal(value: bigint): number | null {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    return null;
  }
  return Number(value);
}

/**
 * Builds one frozen candidate document, or a typed refusal (data contract D03).
 *
 * The baseline must be the complete prior calendar month over the frozen
 * scope, proven by the D05 exact-cover algorithm rather than a row count, and
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

  // The baseline is one exact calendar month entirely before the period: a
  // count of rows or an arbitrary bucket never proves a month's coverage.
  const baseline = input.baselineWindow;
  if (
    !baseline.startDate.endsWith("-01") ||
    addLocalMonths(baseline.startDate, 1) !== baseline.endDateExclusive
  ) {
    return refused("BASELINE_INCOMPLETE", "The baseline is one complete calendar month.");
  }
  if (baseline.endDateExclusive > input.period.startDate) {
    return refused("BASELINE_INCOMPLETE", "The baseline ends before the projected period.");
  }
  const monthEnd = addLocalDays(baseline.endDateExclusive, -1);
  if (issueLocalDate < monthEnd) {
    return refused("BASELINE_INCOMPLETE", "The baseline month has not finished yet.");
  }
  if (daysBetweenLocal(monthEnd, issueLocalDate) > GROWTH_BASELINE_MAX_AGE_DAYS) {
    return refused("BASELINE_STALE", "The baseline month ended too long before issue.");
  }

  let monthTotal: number;
  try {
    // The coverage proof is timeless: no todayLocalDate is passed, because the
    // closing endpoint (the exclusive bound, one day past the issue day by
    // construction) would otherwise read as future and refuse every
    // legitimate baseline. Facts are still bounded by the source cutoff above.
    const series = buildActualGrowthSeries({
      periodStart: baseline.startDate,
      periodEndExclusive: baseline.endDateExclusive,
      currency: input.currency,
      scopePartitions: input.scopePartitions,
      facts: input.baselineFacts,
    });
    const closing = series.points.find((point) => point.date === baseline.endDateExclusive);
    if (!closing || closing.coverage !== "complete" || closing.cumulativeMinor === null) {
      return refused(
        "BASELINE_INCOMPLETE",
        "The baseline month lacks complete comparable coverage.",
      );
    }
    monthTotal = closing.cumulativeMinor;
  } catch (error) {
    if (error instanceof GrowthProgressError && error.code === "SOURCE_LIMIT_EXCEEDED") {
      return refused(
        "SOURCE_LIMIT_EXCEEDED",
        "One view reads at most 10000 facts; the total is withheld, not guessed.",
      );
    }
    if (error instanceof GrowthProgressError && error.code === "MONEY_OVERFLOW") {
      return refused("MONEY_OVERFLOW", "A baseline amount left safe integers.");
    }
    return refused("INVALID_INPUT", "The baseline facts were not usable.");
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
        label: baseline.startDate.slice(0, 7),
        minorUnits: monthTotal,
        currency: input.currency,
      },
    ],
    losses: [...lossById.values()],
    actions,
    lastObservationDate: monthEnd,
    today: issueLocalDate,
    cutoffNote: `Reports through ${monthEnd}.`,
    coverageNote: `${input.scopePartitions.length} frozen scope partitions · monthly baseline.`,
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
      // No per-row source manifest: the Task 1 fact DTO carries no ledger
      // revision to bind, and the publication boundary rejects unbound
      // claims. An empty manifest is contract-valid; the baseline window and
      // frozen scope preserve what the estimate rests on.
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
