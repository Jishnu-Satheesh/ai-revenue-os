import { z } from "zod";

import {
  addLocalDays,
  daysBetweenLocal,
  GROWTH_HORIZON_MONTHS,
  organizationLocalDate,
  type GrowthHorizonMonths,
} from "@/domain/organizations/growth-periods";
import {
  buildActualGrowthSeries,
  compareGrowthPoint,
  GrowthProgressError,
  type FrozenGrowthProjection,
  type RevenueFact,
  type ScopePartition,
} from "@/domain/organizations/growth-progress";
import {
  comparisonStateOf,
  selectGrowthAdvice,
  type GrowthAdviceCandidate,
  type GrowthAdviceReadInput,
  type GrowthAdviceReadResult,
} from "@/modules/organizations/application/growth-advice";
import type {
  GrowthProgressReadPort,
  RevenueFactsEnvelope,
  StoredGrowthProjection,
} from "@/modules/organizations/application/growth-progress-ports";
import type {
  GrowthProgressSection,
  GrowthProgressView,
} from "@/modules/organizations/application/growth-progress-view";

/**
 * Home composition behind the Overview growth section (data contract D07).
 *
 * Like a projectionist threading four reels from one booking sheet: one
 * projection read, one batched fact read per distinct frozen scope, one
 * advice read — then each horizon (1/3/6/12 months) is composed from the
 * same frozen numbers every viewer of the same projection id sees. Denied
 * projections hide rather than recompute, independent lane failures degrade
 * their own views, and no model, currency math or link is invented here.
 *
 * Orchestration with injected boundaries only: same inputs always give the
 * same section. No database, clock, model, network or Node built-in is
 * touched, so every composition rule below is unit-testable with fakes.
 */

/** A comparable total stays fresh for this many local days past its date. */
export const GROWTH_PROGRESS_FRESH_DAYS = 7;

export const loadGrowthProgressInputSchema = z.strictObject({
  organizationId: z.string().uuid(),
  actorId: z.string().uuid(),
  nowIso: z.string().refine((value) => value.includes("T") && !Number.isNaN(Date.parse(value)), {
    message: "Instants must parse as timestamps.",
  }),
  timeZone: z.string().min(1).max(120),
  permissions: z.strictObject({
    canReadProjections: z.boolean(),
    canReadGrowth: z.boolean(),
    canReadCampaigns: z.boolean(),
    canTriggerPublication: z.boolean(),
  }),
});
export type LoadGrowthProgressInput = z.output<typeof loadGrowthProgressInputSchema>;

export type GrowthProgressServiceDependencies = {
  progressReads: GrowthProgressReadPort;
  readAdvice: (input: GrowthAdviceReadInput) => Promise<GrowthAdviceReadResult>;
};

type ScopeGroup = {
  key: string;
  partitions: readonly ScopePartition[];
  members: StoredGrowthProjection[];
};

function scopeGroupKey(partitions: readonly ScopePartition[]): string {
  return [...partitions.map((partition) => partition.partitionKey)].sort().join("\n");
}

function scopeLabelFor(partitions: readonly ScopePartition[]): string {
  if (
    partitions.length === 1 &&
    partitions[0]!.channelId === null &&
    partitions[0]!.branchId === null
  ) {
    return "Organization total";
  }
  return `${partitions.length} reporting scope${partitions.length === 1 ? "" : "s"}`;
}

function unavailableView(
  horizonMonths: GrowthHorizonMonths,
  reasonCode: string,
): GrowthProgressView {
  return {
    horizonMonths,
    state: "unavailable",
    reasonCode,
    projectionId: null,
    projectionDigest: null,
    // No frozen period exists behind a denied/failed/missing read, but the
    // view schema requires one: the epoch placeholder marks "no period"
    // explicitly instead of borrowing a real projection's dates.
    period: {
      horizonMonths,
      cycleIndex: 0,
      startDate: "1970-01-01",
      endDateExclusive: "1970-01-02",
    },
    currency: null,
    scopeLabel: "Reporting scope unavailable",
    issuedAt: null,
    sourceCutoffDate: null,
    latestComparableDate: null,
    points: [],
    latestComparison: null,
    adviceRows: [],
    limitations: [],
    freshness: { status: "stale", note: "Growth data is temporarily unavailable." },
    sources: [],
  };
}

function missingView(horizonMonths: GrowthHorizonMonths): GrowthProgressView {
  const base = unavailableView(horizonMonths, "PROJECTION_MISSING");
  return {
    ...base,
    state: "missing",
    freshness: {
      status: "awaiting_reports",
      note: "No original projection is available for this period.",
    },
  };
}

function candidateAppliesToScope(
  candidate: GrowthAdviceCandidate,
  partitions: readonly ScopePartition[],
): boolean {
  // Organization-wide rows (proposals, synthesized items) read against every
  // horizon. Channel rows intersect the frozen scope on their channel, and on
  // their branch when they name one — an uncertain overlap stays out rather
  // than advising one scope from another's evidence.
  if (candidate.channelIds.length === 0 && candidate.branchIds.length === 0) return true;
  return partitions.some(
    (partition) =>
      partition.channelId !== null &&
      candidate.channelIds.includes(partition.channelId) &&
      (candidate.branchIds.length === 0 ||
        (partition.branchId !== null && candidate.branchIds.includes(partition.branchId))),
  );
}

export async function loadGrowthProgress(
  rawInput: LoadGrowthProgressInput,
  dependencies: GrowthProgressServiceDependencies,
): Promise<GrowthProgressSection> {
  const parsed = loadGrowthProgressInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { state: "failed", reasonCode: "INVALID_INPUT", retainedView: null };
  }
  const input = parsed.data;

  let todayLocal: string;
  try {
    todayLocal = organizationLocalDate(input.nowIso, input.timeZone);
  } catch {
    return { state: "failed", reasonCode: "INVALID_INPUT", retainedView: null };
  }

  // A viewer without projection access schedules no projection read at all:
  // the denial below is composed, never fetched, and identical for every
  // denied viewer.
  const envelope = input.permissions.canReadProjections
    ? await dependencies.progressReads.readProjections({
        organizationId: input.organizationId,
        asOfDate: todayLocal,
      })
    : { status: "denied" as const, reason: "PERMISSION_DENIED" as const };

  if (envelope.status === "denied") {
    return readySection(
      new Map(
        GROWTH_HORIZON_MONTHS.map((horizon) => [
          horizon,
          unavailableView(horizon, "PERMISSION_DENIED"),
        ]),
      ),
      input.permissions.canTriggerPublication,
    );
  }
  if (envelope.status === "failed") {
    return readySection(
      new Map(
        GROWTH_HORIZON_MONTHS.map((horizon) => [
          horizon,
          unavailableView(horizon, "SOURCE_READ_FAILED"),
        ]),
      ),
      input.permissions.canTriggerPublication,
    );
  }
  if (envelope.status === "corrupt") {
    return readySection(
      new Map(
        GROWTH_HORIZON_MONTHS.map((horizon) => [
          horizon,
          unavailableView(horizon, "PROJECTION_CORRUPT"),
        ]),
      ),
      input.permissions.canTriggerPublication,
    );
  }
  if (envelope.status === "missing") {
    return readySection(
      new Map(GROWTH_HORIZON_MONTHS.map((horizon) => [horizon, missingView(horizon)])),
      input.permissions.canTriggerPublication,
    );
  }

  const storedByHorizon = new Map<GrowthHorizonMonths, StoredGrowthProjection>();
  for (const stored of envelope.projections) {
    if (!storedByHorizon.has(stored.document.horizonMonths)) {
      storedByHorizon.set(stored.document.horizonMonths, stored);
    }
  }

  // One batched fact read per distinct frozen scope over that scope's union
  // window. Horizons sharing a scope share one read; a group that fails
  // degrades only its own horizons, with the stored identity preserved.
  const groups = new Map<string, ScopeGroup>();
  for (const stored of storedByHorizon.values()) {
    const key = scopeGroupKey(stored.document.scopePartitions);
    const group = groups.get(key);
    if (group) group.members.push(stored);
    else {
      groups.set(key, {
        key,
        partitions: stored.document.scopePartitions,
        members: [stored],
      });
    }
  }

  const factsByGroup = new Map<string, RevenueFactsEnvelope>();
  // Upcoming-only sections schedule no fact reads: the frozen curve is
  // shown with no current amounts, so there is nothing to compare yet.
  const allUpcoming = [...storedByHorizon.values()].every(
    (stored) => todayLocal < stored.document.startDate,
  );
  if (!allUpcoming) {
    for (const group of groups.values()) {
      const starts = group.members.map((member) => member.document.startDate);
      const ends = group.members.map((member) => member.document.endDateExclusive);
      try {
        factsByGroup.set(
          group.key,
          await dependencies.progressReads.readRevenueFacts({
            organizationId: input.organizationId,
            from: starts.sort()[0]!,
            toExclusive: ends.sort()[ends.length - 1]!,
            scopePartitions: [...group.partitions],
          }),
        );
      } catch {
        // The port reports denials, limits and failures as envelopes; a throw
        // is transport trouble, never a partial total.
        factsByGroup.set(group.key, { status: "failed", reason: "SOURCE_READ_FAILED" });
      }
    }
  }

  // Advice is read once for the whole section, only when a composed view can
  // use it and at least one permitted lane exists. A denied lane is never
  // fetched; a failed lane limits views to a visible note, never silence.
  const allowAdvice = {
    recommendations: input.permissions.canReadGrowth,
    items: input.permissions.canReadGrowth,
    proposals: input.permissions.canReadCampaigns,
  };
  let advice: GrowthAdviceReadResult = { candidates: [], laneErrors: {} };
  if (
    storedByHorizon.size > 0 &&
    (allowAdvice.recommendations || allowAdvice.items || allowAdvice.proposals)
  ) {
    try {
      advice = await dependencies.readAdvice({
        organizationId: input.organizationId,
        actorId: input.actorId,
        nowIso: input.nowIso,
        allow: allowAdvice,
      });
    } catch {
      advice = { candidates: [], laneErrors: { advice: "SOURCE_READ_FAILED" } };
    }
  }
  const adviceNotes =
    Object.keys(advice.laneErrors).length > 0 ? ["Advice is temporarily unavailable."] : [];
  const workspaceHref = input.permissions.canReadGrowth
    ? `/organizations/${input.organizationId}/growth-intelligence`
    : null;

  const views = new Map<GrowthHorizonMonths, GrowthProgressView>();
  for (const horizon of GROWTH_HORIZON_MONTHS) {
    const stored = storedByHorizon.get(horizon) ?? null;
    if (stored === null) {
      views.set(horizon, missingView(horizon));
      continue;
    }
    views.set(
      horizon,
      composeView({
        stored,
        todayLocal,
        facts: factsByGroup.get(scopeGroupKey(stored.document.scopePartitions)) ?? {
          status: "failed" as const,
          reason: "SOURCE_READ_FAILED" as const,
        },
        advice,
        adviceNotes,
        workspaceHref,
        organizationId: input.organizationId,
      }),
    );
  }
  return readySection(views, input.permissions.canTriggerPublication);
}

function readySection(
  views: Map<GrowthHorizonMonths, GrowthProgressView>,
  canTriggerImmediatePublication: boolean,
): GrowthProgressSection {
  return {
    state: "ready",
    initialHorizon: 3,
    canTriggerImmediatePublication,
    views: {
      1: views.get(1)!,
      3: views.get(3)!,
      6: views.get(6)!,
      12: views.get(12)!,
    },
  };
}

function composeView(input: {
  stored: StoredGrowthProjection;
  todayLocal: string;
  facts: RevenueFactsEnvelope;
  advice: GrowthAdviceReadResult;
  adviceNotes: readonly string[];
  workspaceHref: string | null;
  organizationId: string;
}): GrowthProgressView {
  const { stored, todayLocal } = input;
  const doc: FrozenGrowthProjection = stored.document;
  const base = {
    horizonMonths: doc.horizonMonths,
    projectionId: stored.projectionId,
    projectionDigest: stored.digest,
    period: {
      horizonMonths: doc.horizonMonths,
      cycleIndex: doc.cycleIndex,
      startDate: doc.startDate,
      endDateExclusive: doc.endDateExclusive,
    },
    currency: doc.currency,
    scopeLabel: scopeLabelFor(doc.scopePartitions),
    issuedAt: doc.issuedAt,
    sourceCutoffDate: doc.sourceCutoffDate,
    // Baseline-only manifests stay empty by Task-5 decision (a): the
    // publication boundary binds every manifest row to a ledger revision the
    // fact DTO does not carry, so a populated-but-unbound manifest could
    // never publish. Defensive mapping stays for a future bound manifest.
    sources: doc.sources.map((source) => ({
      label: `${source.table} ${source.startDate}–${source.endDateExclusive}`,
      href: null as string | null,
    })),
  };
  const limitations = (extra: readonly string[]): string[] =>
    [...doc.limitations, ...input.adviceNotes, ...extra].slice(0, 20);

  // Before the period starts the frozen curve is shown with no current
  // amount and no ahead/behind verdict — an outlook, not a score.
  if (todayLocal < doc.startDate) {
    const points = doc.points
      .filter((point) => !point.anchor)
      .map((point) => ({
        date: point.date,
        currentMinor: null as number | null,
        projectedLowMinor: point.lowMinor,
        projectedCentralMinor: point.centralMinor,
        projectedHighMinor: point.highMinor,
        currentCoverage: "missing" as const,
        reasonCode: "FUTURE_DATE" as const,
        breakBefore: false,
      }));
    return {
      ...base,
      state: "upcoming",
      reasonCode: "PROJECTION_UPCOMING",
      latestComparableDate: null,
      points,
      latestComparison: null,
      adviceRows: selectGrowthAdvice({
        comparisonState: null,
        comparisonVisible: false,
        latestComparableDate: null,
        organizationId: input.organizationId,
        workspaceHref: input.workspaceHref,
        candidates: scopedCandidates(input.advice.candidates, doc.scopePartitions),
      }),
      limitations: limitations([`This projection starts ${doc.startDate}; reports are awaited.`]),
      freshness: { status: "fresh", note: null },
    };
  }

  if (input.facts.status === "denied") {
    return {
      ...base,
      state: "unavailable",
      reasonCode: "PERMISSION_DENIED",
      latestComparableDate: null,
      points: [],
      latestComparison: null,
      adviceRows: [],
      limitations: limitations([]),
      freshness: { status: "stale", note: "Growth data is temporarily unavailable." },
    };
  }
  if (input.facts.status === "limited") {
    return {
      ...base,
      state: "unavailable",
      reasonCode: "SOURCE_LIMIT_EXCEEDED",
      latestComparableDate: null,
      points: [],
      latestComparison: null,
      adviceRows: [],
      limitations: limitations([]),
      freshness: { status: "stale", note: "Growth data is temporarily unavailable." },
    };
  }
  if (input.facts.status === "failed") {
    return {
      ...base,
      state: "unavailable",
      reasonCode: "SOURCE_READ_FAILED",
      latestComparableDate: null,
      points: [],
      latestComparison: null,
      adviceRows: [],
      limitations: limitations([]),
      freshness: { status: "stale", note: "Growth data is temporarily unavailable." },
    };
  }

  const facts: readonly RevenueFact[] = input.facts.facts;
  let series: ReturnType<typeof buildActualGrowthSeries>;
  try {
    series = buildActualGrowthSeries({
      periodStart: doc.startDate,
      periodEndExclusive: doc.endDateExclusive,
      currency: doc.currency,
      scopePartitions: [...doc.scopePartitions],
      facts: [...facts],
      candidateDates: doc.points.filter((point) => !point.anchor).map((point) => point.date),
      todayLocalDate: todayLocal,
    });
  } catch (error) {
    const reasonCode =
      error instanceof GrowthProgressError && error.code === "SOURCE_LIMIT_EXCEEDED"
        ? "SOURCE_LIMIT_EXCEEDED"
        : "SOURCE_READ_FAILED";
    return {
      ...base,
      state: "unavailable",
      reasonCode,
      latestComparableDate: null,
      points: [],
      latestComparison: null,
      adviceRows: [],
      limitations: limitations([]),
      freshness: { status: "stale", note: "Growth data is temporarily unavailable." },
    };
  }

  const byDate = new Map(series.points.map((point) => [point.date, point]));
  const projectedByDate = new Map(
    doc.points.filter((point) => !point.anchor).map((point) => [point.date, point]),
  );
  const points: GrowthProgressView["points"] = [];
  let previousDate: string | null = null;
  let previousCurrent: number | null = null;
  for (const point of doc.points) {
    if (point.anchor) continue;
    const actual = byDate.get(point.date);
    const currentMinor =
      actual !== undefined && actual.coverage === "complete"
        ? (actual.cumulativeMinor as number | null)
        : null;
    points.push({
      date: point.date,
      currentMinor,
      projectedLowMinor: point.lowMinor,
      projectedCentralMinor: point.centralMinor,
      projectedHighMinor: point.highMinor,
      currentCoverage:
        actual === undefined
          ? "missing"
          : actual.coverage === "complete"
            ? "complete"
            : actual.coverage === "conflict"
              ? "conflict"
              : actual.coverage === "incomparable"
                ? "incomparable"
                : "missing",
      reasonCode: actual === undefined || actual.coverage === "complete" ? null : actual.reasonCode,
      // The blue line never bridges a gap: a valued point breaks from its
      // predecessor across missing days and after any point without a
      // comparable value. Valueless points draw nothing, so they break
      // nothing themselves.
      breakBefore:
        currentMinor !== null &&
        previousDate !== null &&
        (point.date !== addLocalDays(previousDate, 1) || previousCurrent === null),
    });
    previousDate = point.date;
    previousCurrent = currentMinor;
  }

  // The latest comparable date is the latest endpoint with complete
  // coverage and a frozen day-end point — never now(), the newest single
  // report, or a month-end forecast.
  let latestComparableDate: string | null = null;
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index]!;
    if (point.currentMinor !== null && projectedByDate.has(point.date)) {
      latestComparableDate = point.date;
      break;
    }
  }

  if (latestComparableDate === null) {
    return {
      ...base,
      state: "awaiting_reports",
      reasonCode: null,
      latestComparableDate: null,
      points,
      latestComparison: null,
      adviceRows: selectGrowthAdvice({
        comparisonState: null,
        comparisonVisible: false,
        latestComparableDate: null,
        organizationId: input.organizationId,
        workspaceHref: input.workspaceHref,
        candidates: scopedCandidates(input.advice.candidates, doc.scopePartitions),
      }),
      limitations: limitations(["No complete comparable reports yet for this period."]),
      freshness: { status: "awaiting_reports", note: "No complete comparable reports yet." },
    };
  }

  const atDate = points.find((point) => point.date === latestComparableDate)!;
  const latestComparison = compareGrowthPoint({
    actualMinor: atDate.currentMinor,
    projectedLowMinor: atDate.projectedLowMinor,
    projectedCentralMinor: atDate.projectedCentralMinor,
    projectedHighMinor: atDate.projectedHighMinor,
  });

  const stale = daysBetweenLocal(latestComparableDate, todayLocal) > GROWTH_PROGRESS_FRESH_DAYS;
  return {
    ...base,
    state: "ready",
    reasonCode: null,
    latestComparableDate,
    points,
    latestComparison,
    adviceRows: selectGrowthAdvice({
      comparisonState: comparisonStateOf(latestComparison),
      comparisonVisible: true,
      latestComparableDate,
      organizationId: input.organizationId,
      workspaceHref: input.workspaceHref,
      candidates: scopedCandidates(input.advice.candidates, doc.scopePartitions),
    }),
    limitations: limitations([]),
    freshness: stale
      ? { status: "stale", note: `Latest comparable reports are from ${latestComparableDate}.` }
      : { status: "fresh", note: null },
  };
}

function scopedCandidates(
  candidates: readonly GrowthAdviceCandidate[],
  partitions: readonly ScopePartition[],
): GrowthAdviceCandidate[] {
  return candidates.filter((candidate) => candidateAppliesToScope(candidate, partitions));
}
