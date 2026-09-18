import { z } from "zod";

import {
  addLocalDays,
  addLocalMonths,
  daysBetweenLocal,
  isoDateSchema,
} from "@/domain/organizations/growth-periods";

/**
 * Fixed-projection curve, exact-coverage actuals and same-date comparison
 * (data contract D03, D05, D06).
 *
 * Like a printed race programme versus the photo finish: the projection is
 * the programme frozen before the race, the actuals are the measured finish
 * times, and the comparison only ever lines up the same race at the same
 * distance. Nothing here invents a measurement or moves the programme.
 *
 * Pure and deterministic: same inputs always give the same outputs. No
 * database, clock, model, network or Node built-in is touched, so this
 * module is safe to import from browser code.
 */

/** Initial intra-period curve method; stored on the row, never rebuilt in the browser. */
export const GROWTH_PROJECTION_METHOD_VERSION = "even_pace_v1";

/** Upper bound of facts one view may read; the extra row detects truncation. */
export const GROWTH_SERIES_MAX_FACTS = 10_000;

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER);

function safeMinorSchemaField() {
  return z
    .number()
    .int()
    .refine((value) => Number.isSafeInteger(value), {
      message: "Money stays in integer minor units within safe integers.",
    });
}

/** ISO currency code, uppercased at the boundary; money stays in integer minor units. */
export const currencySchema = z
  .string()
  .trim()
  .length(3)
  .regex(/^[A-Za-z]{3}$/, { message: "Currency reads as a 3-letter ISO code." })
  .transform((value) => value.toUpperCase());

const instantSchema = z
  .string()
  .refine((value) => value.includes("T") && !Number.isNaN(Date.parse(value)), {
    message: "Instants must parse as timestamps.",
  });

const timeZoneSchema = z
  .string()
  .min(1)
  .max(120)
  .refine(
    (value) => {
      try {
        new Intl.DateTimeFormat("en-CA", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    },
    { message: "Timezones read as IANA names and are never reinterpreted." },
  );

/** One frozen reporting-scope partition (data contract D02). */
export const scopePartitionSchema = z.strictObject({
  partitionKey: z.string().trim().min(1).max(200),
  /** Null marks an explicitly organization-level total, never a sum of branches. */
  channelId: z.string().uuid().nullable(),
  branchId: z.string().uuid().nullable(),
  metricDefinitionId: z.string().uuid(),
  dimensionsDigest: z.string().trim().min(1).max(256),
  periodTimezone: timeZoneSchema,
});
export type ScopePartition = z.output<typeof scopePartitionSchema>;

/** One normalized revenue observation kept until arithmetic is complete. */
export const revenueFactSchema = z
  .strictObject({
    sourceTable: z.enum(["normalized_metrics", "exact_range_metric_observations"]),
    rowId: z.string().trim().min(1).max(200),
    organizationId: z.string().uuid(),
    partitionKey: z.string().trim().min(1).max(200),
    startDate: isoDateSchema,
    endDateExclusive: isoDateSchema,
    amountMinor: safeMinorSchemaField(),
    currency: currencySchema,
    createdAt: instantSchema,
    reconciliationDigest: z.string().trim().min(1).max(256),
  })
  .refine((value) => value.startDate < value.endDateExclusive, {
    message: "A revenue fact must end after it starts.",
  });
export type RevenueFact = z.output<typeof revenueFactSchema>;

/** One frozen projection point: a day-end bound triple, or the zero start anchor. */
export const growthProgressPointSchema = z
  .strictObject({
    date: isoDateSchema,
    lowMinor: safeMinorSchemaField(),
    centralMinor: safeMinorSchemaField(),
    highMinor: safeMinorSchemaField(),
    anchor: z.boolean(),
  })
  .refine(
    (value) => value.lowMinor <= value.centralMinor && value.centralMinor <= value.highMinor,
    {
      message: "Projection points keep low <= central <= high.",
    },
  );
export type GrowthProgressPoint = z.output<typeof growthProgressPointSchema>;

/**
 * Sorted, date-unique point arrays for sparse (non-dense) series.
 *
 * Not for frozen documents: the frozen curve's zero anchor shares the first
 * day-end's date by D04 design (told apart by flag, not by date), so it
 * cannot pass a unique-dates array. The frozen document schema below owns
 * that denser rule instead.
 */
export const sparseGrowthPointsSchema = z
  .array(growthProgressPointSchema)
  .min(1)
  .max(368)
  .refine(
    (points) => {
      for (let index = 1; index < points.length; index += 1) {
        if (points[index - 1]!.date >= points[index]!.date) return false;
      }
      return true;
    },
    { message: "Projection points stay sorted with unique dates." },
  );

/** Opaque source identity carried for lineage; never raw workbook payload. */
export const projectionSourceSchema = z
  .strictObject({
    table: z.string().trim().min(1).max(120),
    rowId: z.string().trim().min(1).max(200),
    revision: z.string().trim().min(1).max(200).nullable(),
    digest: z.string().trim().min(1).max(256),
    partitionKey: z.string().trim().min(1).max(200),
    startDate: isoDateSchema,
    endDateExclusive: isoDateSchema,
    amountMinor: safeMinorSchemaField(),
  })
  .refine((value) => value.startDate < value.endDateExclusive, {
    message: "A projection source must end after it starts.",
  });
export type ProjectionSourceRef = z.output<typeof projectionSourceSchema>;

/** Validated action assumption bound to its source; fractions, never money. */
export const projectionActionAssumptionSchema = z
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
export type ProjectionActionAssumption = z.output<typeof projectionActionAssumptionSchema>;

export const baselineWindowSchema = z
  .strictObject({ startDate: isoDateSchema, endDateExclusive: isoDateSchema })
  .refine((value) => value.startDate < value.endDateExclusive, {
    message: "A baseline window must end after it starts.",
  });
export type BaselineWindow = z.output<typeof baselineWindowSchema>;

/** The immutable frozen document (data contract D04 document keys). */
export const frozenGrowthProjectionSchema = z
  .strictObject({
    organizationId: z.string().uuid(),
    scheduleOriginDate: isoDateSchema,
    cycleIndex: z.number().int().min(0),
    horizonMonths: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]),
    startDate: isoDateSchema,
    endDateExclusive: isoDateSchema,
    issuedAt: instantSchema,
    sourceCutoffDate: isoDateSchema,
    timeZone: timeZoneSchema,
    currency: currencySchema,
    metricKey: z.literal("revenue.gross"),
    scopePartitions: z.array(scopePartitionSchema).min(1).max(100),
    baselineWindow: baselineWindowSchema,
    monthlyLowMinor: safeMinorSchemaField(),
    monthlyHighMinor: safeMinorSchemaField(),
    // The anchor shares the first day-end's date by design (D04), so the
    // generic sorted-unique array cannot apply here; the refine below owns
    // date discipline: one anchor, then exactly one point per calendar day.
    points: z.array(growthProgressPointSchema).min(1).max(368),
    sources: z.array(projectionSourceSchema).max(2000),
    actionAssumptions: z.array(projectionActionAssumptionSchema).max(50),
    limitations: z.array(z.string().trim().min(1).max(300)).max(20),
  })
  .refine((value) => value.startDate < value.endDateExclusive, {
    message: "A projection period must end after it starts.",
  })
  .refine((value) => value.monthlyLowMinor <= value.monthlyHighMinor, {
    message: "Monthly low must not exceed monthly high.",
  })
  .refine(
    (value) => {
      const keys = value.scopePartitions.map((partition) => partition.partitionKey);
      return new Set(keys).size === keys.length;
    },
    { message: "Scope partitions carry unique keys." },
  )
  .refine(
    (value) => {
      // The curve is dense by construction: the zero anchor at the period
      // start, then exactly one day-end point per calendar day. The anchor
      // and the first day-end share the start date and are told apart by the
      // anchor flag — the anchor is "zero before the first day's activity",
      // not a zeroth day outside the period.
      if (value.points.length === 0) return false;
      const [anchor, ...days] = value.points as [GrowthProgressPoint, ...GrowthProgressPoint[]];
      if (!anchor.anchor || anchor.date !== value.startDate) return false;
      if (anchor.lowMinor !== 0 || anchor.centralMinor !== 0 || anchor.highMinor !== 0)
        return false;
      const expectedDays = daysBetweenLocal(value.startDate, value.endDateExclusive);
      if (days.length !== expectedDays) return false;
      return days.every((point, index) => {
        if (point.anchor) return false;
        return point.date === addLocalDays(value.startDate, index);
      });
    },
    { message: "Projection points start with the zero anchor, then one point per day." },
  );
export type FrozenGrowthProjection = z.output<typeof frozenGrowthProjectionSchema>;

/** Same-date actual-versus-projection verdict (data contract D06). */
export const growthComparisonSchema = z.strictObject({
  state: z.enum(["behind", "ahead", "within_range", "equal", "unavailable"]),
  differenceMinor: safeMinorSchemaField().nullable(),
  differencePercent: z.number().int().nullable(),
  reasonCode: z.string().trim().min(1).max(120).nullable(),
});
export type GrowthComparison = z.output<typeof growthComparisonSchema>;

/** Why an actual point is not a comparable total; shared with the client view. */
export const actualCoverageReasonSchema = z.enum([
  "COVERAGE_GAP",
  "OVERLAP_CONFLICT",
  "CURRENCY_MISMATCH",
  "FUTURE_DATE",
]);
export type ActualCoverageReason = z.output<typeof actualCoverageReasonSchema>;

/** One comparable actual observation with its coverage proof. */
export const actualGrowthPointSchema = z.strictObject({
  date: isoDateSchema,
  cumulativeMinor: safeMinorSchemaField().nullable(),
  coverage: z.enum(["complete", "missing", "conflict", "incomparable"]),
  reasonCode: actualCoverageReasonSchema.nullable(),
  /** Row identities of the chosen exact cover, in scope order then chronological. */
  sourceIds: z.array(z.string().trim().min(1).max(200)),
});
export type ActualGrowthPoint = z.output<typeof actualGrowthPointSchema>;

export type ActualGrowthSeries = {
  readonly points: readonly ActualGrowthPoint[];
};

export type GrowthProgressErrorCode =
  | "INVALID_INPUT"
  | "INVALID_RANGE"
  | "MONEY_OVERFLOW"
  | "POINT_OUT_OF_RANGE"
  | "SOURCE_LIMIT_EXCEEDED";

/** Domain-specific error for growth-progress arithmetic; carries a stable code. */
export class GrowthProgressError extends Error {
  readonly code: GrowthProgressErrorCode;

  constructor(code: GrowthProgressErrorCode, message: string) {
    super(message);
    this.name = "GrowthProgressError";
    this.code = code;
  }
}

function toSafeMinor(value: bigint): number {
  if (value > MAX_SAFE || value < MIN_SAFE) {
    throw new GrowthProgressError(
      "MONEY_OVERFLOW",
      "A growth amount left safe integers, so no total is stated.",
    );
  }
  return Number(value);
}

/** Mathematical floor for amount/days with days > 0; exact for negatives (BigInt truncates). */
function floorDiv(amount: bigint, days: bigint): bigint {
  const quotient = amount / days;
  const remainder = amount % days;
  if (remainder !== BigInt(0) && remainder < BigInt(0)) return quotient - BigInt(1);
  return quotient;
}

/** Rounded rational midpoint, ties half away from zero, so low <= central <= high always holds. */
function midpointHalfAway(low: bigint, high: bigint): bigint {
  const sum = low + high;
  const quotient = sum / BigInt(2);
  const remainder = sum % BigInt(2);
  if (remainder === BigInt(1)) return quotient + BigInt(1);
  if (remainder === BigInt(-1)) return quotient - BigInt(1);
  return quotient;
}

/** Rounded 100*numerator/denominator with denominator > 0, ties half away from zero. */
function percentHalfAway(numerator: bigint, denominator: bigint): number {
  const scaled = BigInt(100) * numerator;
  const quotient = scaled / denominator;
  const remainder = scaled % denominator;
  const doubled = remainder * BigInt(2);
  if (doubled >= denominator) return toSafeMinor(quotient + BigInt(1));
  if (doubled <= -denominator) return toSafeMinor(quotient - BigInt(1));
  return toSafeMinor(quotient);
}

const evenPaceInputSchema = z.strictObject({
  scheduleOriginDate: isoDateSchema,
  periodStart: isoDateSchema,
  periodEndExclusive: isoDateSchema,
  monthlyLowMinor: safeMinorSchemaField(),
  monthlyHighMinor: safeMinorSchemaField(),
});

export type EvenPaceProjectionInput = z.input<typeof evenPaceInputSchema>;

/**
 * Builds the frozen even-pace curve (data contract D03, method even_pace_v1).
 *
 * Each complete local monthly segment carries the same frozen monthly
 * amounts — never compounded. Within a segment the cumulative bound is
 * completedSegments x monthlyBound + floor(monthlyBound x elapsedDays /
 * segmentDays), and the central point is the half-away-from-zero midpoint.
 * Actual facts are never interpolated, smoothed or spread.
 */
export function buildEvenPaceProjection(
  rawInput: EvenPaceProjectionInput,
): readonly GrowthProgressPoint[] {
  const parsed = evenPaceInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new GrowthProgressError("INVALID_INPUT", "The projection inputs were not usable.");
  }
  const { scheduleOriginDate, periodStart, periodEndExclusive, monthlyLowMinor, monthlyHighMinor } =
    parsed.data;
  if (monthlyLowMinor > monthlyHighMinor) {
    throw new GrowthProgressError("INVALID_RANGE", "Monthly low must not exceed monthly high.");
  }
  if (periodStart >= periodEndExclusive) {
    throw new GrowthProgressError("INVALID_RANGE", "A projection period must end after it starts.");
  }
  if (periodStart < scheduleOriginDate) {
    throw new GrowthProgressError(
      "INVALID_INPUT",
      "A projection period starts at or after its schedule origin.",
    );
  }
  const periodDays = daysBetweenLocal(periodStart, periodEndExclusive);
  if (periodDays > 367) {
    throw new GrowthProgressError(
      "POINT_OUT_OF_RANGE",
      "A growth projection holds at most 367 daily points.",
    );
  }

  const lowBound = BigInt(monthlyLowMinor);
  const highBound = BigInt(monthlyHighMinor);

  // Monthly grid anchored at the schedule origin; every boundary is
  // recomputed from the origin so February clamps never drift later months.
  type Segment = { start: string; end: string };
  const segments: Segment[] = [];
  for (let index = 0; index < 1500; index += 1) {
    const start = addLocalMonths(scheduleOriginDate, index);
    if (start >= periodEndExclusive) break;
    const end = addLocalMonths(scheduleOriginDate, index + 1);
    if (end > periodStart) segments.push({ start, end });
  }

  const points: GrowthProgressPoint[] = [
    { date: periodStart, lowMinor: 0, centralMinor: 0, highMinor: 0, anchor: true },
  ];
  for (let elapsed = 1; elapsed <= periodDays; elapsed += 1) {
    // Day-end dates run startDate..endExclusive-1: the first day-end shares
    // the anchor's date and is distinguished by the anchor flag, never by
    // inventing a zeroth day outside the period.
    const day = addLocalDays(periodStart, elapsed - 1);
    const containing = segments.find((segment) => segment.start <= day && day < segment.end);
    if (!containing) {
      throw new GrowthProgressError("INVALID_INPUT", "The projection grid missed a period day.");
    }
    let completedLow = BigInt(0);
    let completedHigh = BigInt(0);
    for (const segment of segments) {
      if (segment.start >= periodStart && segment.end <= day) {
        completedLow += lowBound;
        completedHigh += highBound;
      }
    }
    const effectiveStart = containing.start < periodStart ? periodStart : containing.start;
    const effectiveEnd = containing.end > periodEndExclusive ? periodEndExclusive : containing.end;
    const elapsedInSegment = BigInt(daysBetweenLocal(effectiveStart, day) + 1);
    const segmentDays = BigInt(daysBetweenLocal(effectiveStart, effectiveEnd));
    const low = completedLow + floorDiv(lowBound * elapsedInSegment, segmentDays);
    const high = completedHigh + floorDiv(highBound * elapsedInSegment, segmentDays);
    const central = midpointHalfAway(low, high);
    points.push({
      date: day,
      lowMinor: toSafeMinor(low),
      centralMinor: toSafeMinor(central),
      highMinor: toSafeMinor(high),
      anchor: false,
    });
  }
  return points;
}

export type CompareGrowthPointInput = {
  actualMinor: number | null;
  projectedLowMinor: number | null;
  projectedCentralMinor: number | null;
  projectedHighMinor: number | null;
};

/**
 * Compares one cumulative actual against its frozen bounds at the same date
 * (data contract D06). Classification uses the low/high bounds; the shown
 * money and percentage differences use the midpoint and say so downstream.
 */
export function compareGrowthPoint(rawInput: CompareGrowthPointInput): GrowthComparison {
  const unavailable = (reasonCode: string): GrowthComparison => ({
    state: "unavailable",
    differenceMinor: null,
    differencePercent: null,
    reasonCode,
  });
  // Fields are checked one by one so a malformed bound is never mislabeled
  // as a missing actual; every bad shape still lands on unavailable.
  const record =
    typeof rawInput === "object" && rawInput !== null ? (rawInput as Record<string, unknown>) : {};
  const amountField = safeMinorSchemaField().nullable();
  const actualField = amountField.safeParse(record.actualMinor);
  if (!actualField.success || actualField.data === null) {
    return unavailable("MISSING_ACTUAL");
  }
  const lowField = amountField.safeParse(record.projectedLowMinor);
  const centralField = amountField.safeParse(record.projectedCentralMinor);
  const highField = amountField.safeParse(record.projectedHighMinor);
  if (
    !lowField.success ||
    !centralField.success ||
    !highField.success ||
    lowField.data === null ||
    centralField.data === null ||
    highField.data === null
  ) {
    return unavailable("MISSING_PROJECTION");
  }
  const actualMinor = actualField.data;
  const projectedLowMinor = lowField.data;
  const projectedCentralMinor = centralField.data;
  const projectedHighMinor = highField.data;
  if (
    projectedLowMinor > projectedHighMinor ||
    projectedCentralMinor < projectedLowMinor ||
    projectedCentralMinor > projectedHighMinor
  ) {
    return {
      state: "unavailable",
      differenceMinor: null,
      differencePercent: null,
      reasonCode: "INVALID_RANGE",
    };
  }
  if (actualMinor === projectedCentralMinor) {
    return {
      state: "equal",
      differenceMinor: 0,
      differencePercent: projectedCentralMinor > 0 ? 0 : null,
      reasonCode: null,
    };
  }
  const difference = toSafeMinor(BigInt(actualMinor) - BigInt(projectedCentralMinor));
  const differencePercent =
    projectedCentralMinor > 0
      ? percentHalfAway(
          BigInt(actualMinor) - BigInt(projectedCentralMinor),
          BigInt(projectedCentralMinor),
        )
      : null;
  if (actualMinor < projectedLowMinor) {
    return { state: "behind", differenceMinor: difference, differencePercent, reasonCode: null };
  }
  if (actualMinor > projectedHighMinor) {
    return { state: "ahead", differenceMinor: difference, differencePercent, reasonCode: null };
  }
  return {
    state: "within_range",
    differenceMinor: difference,
    differencePercent,
    reasonCode: null,
  };
}

const actualSeriesInputSchema = z.strictObject({
  periodStart: isoDateSchema,
  periodEndExclusive: isoDateSchema,
  currency: currencySchema,
  scopePartitions: z.array(scopePartitionSchema).min(1).max(100),
  facts: z.array(revenueFactSchema),
  candidateDates: z.array(isoDateSchema).max(400).default([]),
  todayLocalDate: isoDateSchema.optional(),
});

export type ActualGrowthSeriesInput = {
  periodStart: string;
  periodEndExclusive: string;
  currency: string;
  scopePartitions: readonly ScopePartition[];
  facts: readonly RevenueFact[];
  candidateDates?: readonly string[];
  todayLocalDate?: string;
};

type CoverEdge = {
  start: string;
  end: string;
  amount: bigint;
  sourceRank: number;
  rowId: string;
};

type CoverState = { total: bigint; edges: readonly CoverEdge[] };

function edgeKey(edge: CoverEdge): string {
  return `${edge.start}|${edge.end}|${edge.sourceRank}|${edge.rowId}`;
}

/**
 * Prefers the finer-grained cover; ties break toward normalized facts, then
 * lexicographic row identity, so equivalent covers always elect the same
 * representative regardless of input row order.
 */
function isBetterCover(candidate: readonly CoverEdge[], current: readonly CoverEdge[]): boolean {
  if (candidate.length !== current.length) return candidate.length > current.length;
  const left = candidate.map(edgeKey).join("\n");
  const right = current.map(edgeKey).join("\n");
  return left < right;
}

/**
 * Builds the comparable actual series with the per-partition exact-cover DAG
 * (data contract D05).
 *
 * For each frozen partition, reported intervals are directed edges from
 * startDate to endDateExclusive. An endpoint carries a cumulative total only
 * when an exact, nonoverlapping cover runs from the period start through
 * that endpoint for EVERY frozen partition. Two complete covers that agree
 * elect one deterministic representative; two that disagree mark the
 * endpoint OVERLAP_CONFLICT. Partial overlaps are never clipped, gaps stay
 * gaps, and an explicit zero satisfies coverage while absence never does.
 */
export function buildActualGrowthSeries(rawInput: ActualGrowthSeriesInput): ActualGrowthSeries {
  const rawFacts =
    typeof rawInput === "object" && rawInput !== null && "facts" in rawInput
      ? (rawInput as { facts?: unknown }).facts
      : undefined;
  if (Array.isArray(rawFacts) && rawFacts.length > GROWTH_SERIES_MAX_FACTS) {
    throw new GrowthProgressError(
      "SOURCE_LIMIT_EXCEEDED",
      "One view reads at most 10000 facts; the total is withheld, not guessed.",
    );
  }
  const parsed = actualSeriesInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new GrowthProgressError("INVALID_INPUT", "The actual-series inputs were not usable.");
  }
  const { periodStart, periodEndExclusive, currency, scopePartitions, facts } = parsed.data;
  const candidateDates = parsed.data.candidateDates ?? [];
  if (periodStart >= periodEndExclusive) {
    throw new GrowthProgressError("INVALID_RANGE", "A growth period must end after it starts.");
  }
  const scopeOrder = scopePartitions.map((partition) => partition.partitionKey);
  if (new Set(scopeOrder).size !== scopeOrder.length) {
    throw new GrowthProgressError("INVALID_INPUT", "Scope partitions carry unique keys.");
  }
  const todayLocalDate = parsed.data.todayLocalDate;

  const inScope = new Set(scopeOrder);
  const seenIdentities = new Set<string>();
  const edgesByPartition = new Map<string, CoverEdge[]>();
  const taintByPartition = new Map<string, { start: string; end: string }[]>();
  for (const key of scopeOrder) {
    edgesByPartition.set(key, []);
    taintByPartition.set(key, []);
  }

  for (const fact of facts) {
    if (!inScope.has(fact.partitionKey)) continue;
    // Rows outside the period, or crossing its edges, are never clipped in.
    if (fact.startDate < periodStart || fact.endDateExclusive > periodEndExclusive) continue;
    if (fact.currency !== currency) {
      // A mismatched row can never join a cover, but it taints the dates it
      // spans: an endpoint inside (start, end] of that row is unknowable in
      // the expected currency. Dates outside the span keep clean covers.
      taintByPartition.get(fact.partitionKey)!.push({
        start: fact.startDate,
        end: fact.endDateExclusive,
      });
      continue;
    }
    const identity = `${fact.sourceTable}\n${fact.rowId}`;
    if (seenIdentities.has(identity)) continue;
    seenIdentities.add(identity);
    edgesByPartition.get(fact.partitionKey)!.push({
      start: fact.startDate,
      end: fact.endDateExclusive,
      amount: BigInt(fact.amountMinor),
      sourceRank: fact.sourceTable === "normalized_metrics" ? 0 : 1,
      rowId: fact.rowId,
    });
  }

  // Candidate plot dates: actual observation endpoints plus selected
  // projection dates, restricted to the open-closed period window. Tainted
  // span ends seed candidates too, so a mismatched row stays visible as an
  // incomparable point instead of vanishing silently.
  const candidates = new Set<string>();
  for (const edges of edgesByPartition.values()) {
    for (const edge of edges) candidates.add(edge.end);
  }
  for (const spans of taintByPartition.values()) {
    for (const span of spans) candidates.add(span.end);
  }
  for (const date of candidateDates) {
    if (date > periodStart && date <= periodEndExclusive) candidates.add(date);
  }
  const orderedDates = [...candidates].sort();

  // Per-partition chronological DAG: at each reachable end date keep a
  // canonical cover per distinct total, bounded to two totals so conflicts
  // are detected without enumerating paths.
  const statesByPartition = new Map<string, Map<string, CoverState[]>>();
  for (const key of scopeOrder) {
    const states = new Map<string, CoverState[]>();
    states.set(periodStart, [{ total: BigInt(0), edges: [] }]);
    const edges = [...edgesByPartition.get(key)!].sort((left, right) => {
      if (left.end !== right.end) return left.end < right.end ? -1 : 1;
      if (left.start !== right.start) return left.start < right.start ? -1 : 1;
      if (left.sourceRank !== right.sourceRank) return left.sourceRank - right.sourceRank;
      return left.rowId < right.rowId ? -1 : left.rowId > right.rowId ? 1 : 0;
    });
    for (const edge of edges) {
      const prefixes = states.get(edge.start);
      if (!prefixes) continue;
      for (const prefix of prefixes) {
        const total = prefix.total + edge.amount;
        const cover = [...prefix.edges, edge];
        const reached = states.get(edge.end);
        if (!reached) {
          states.set(edge.end, [{ total, edges: cover }]);
          continue;
        }
        const same = reached.find((state) => state.total === total);
        if (same) {
          if (isBetterCover(cover, same.edges)) same.edges = cover;
        } else if (reached.length < 2) {
          reached.push({ total, edges: cover });
        }
      }
    }
    statesByPartition.set(key, states);
  }

  const points: ActualGrowthPoint[] = orderedDates.map((date) => {
    if (todayLocalDate !== undefined && date > todayLocalDate) {
      return {
        date,
        cumulativeMinor: null,
        coverage: "missing" as const,
        reasonCode: "FUTURE_DATE" as const,
        sourceIds: [],
      };
    }
    let incomparable = false;
    let conflicted = false;
    let missing = false;
    let total = BigInt(0);
    const sourceIds: string[] = [];
    for (const key of scopeOrder) {
      const tainted = taintByPartition
        .get(key)!
        .some((span) => span.start < date && date <= span.end);
      if (tainted) {
        incomparable = true;
        continue;
      }
      const reached = statesByPartition.get(key)!.get(date);
      if (!reached) {
        missing = true;
        continue;
      }
      if (reached.length > 1) {
        conflicted = true;
        continue;
      }
      total += reached[0]!.total;
      for (const edge of reached[0]!.edges) sourceIds.push(edge.rowId);
    }
    // D05 keeps missing and conflicting coverage as distinct states. Where
    // they meet at one endpoint the conflict wins: a conflicting partition
    // can never yield a trustworthy total while the conflict stands (only a
    // source correction removes it), whereas a gap may still close with new
    // reports. Either way no total is stated.
    if (incomparable) {
      return {
        date,
        cumulativeMinor: null,
        coverage: "incomparable" as const,
        reasonCode: "CURRENCY_MISMATCH" as const,
        sourceIds: [],
      };
    }
    if (conflicted) {
      return {
        date,
        cumulativeMinor: null,
        coverage: "conflict" as const,
        reasonCode: "OVERLAP_CONFLICT" as const,
        sourceIds: [],
      };
    }
    if (missing) {
      return {
        date,
        cumulativeMinor: null,
        coverage: "missing" as const,
        reasonCode: "COVERAGE_GAP" as const,
        sourceIds: [],
      };
    }
    return {
      date,
      cumulativeMinor: toSafeMinor(total),
      coverage: "complete" as const,
      reasonCode: null,
      sourceIds,
    };
  });

  return { points };
}
