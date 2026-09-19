import { describe, expect, it } from "vitest";

import {
  buildBusinessPerformanceCard,
  buildChannelsOverviewView,
  buildOverviewWindows,
  compactRange,
  isWholeCalendarMonth,
  monthName,
  pickTrendWindows,
  previousEqualRange,
  resolveDefaultWindow,
  resolveOverviewWindow,
  wholeDaysOfRange,
  wholeMonthsOfRange,
  wholeWeeksOfRange,
} from "@/modules/analysis/application/channels-overview";
import type {
  ChannelBandRecord,
  ChannelEvidenceWindow,
  DailyMetricAggregate,
  MetricAggregateGrain,
} from "@/modules/analysis/application/ports";

const CHANNELS = [
  { id: "ch-talabat", display_name: "talabat", status: "active" },
  { id: "ch-noon", display_name: "noon", status: "active" },
  { id: "ch-deliveroo", display_name: "deliveroo", status: "active" },
  { id: "ch-keeta", display_name: "Keeta", status: "active" },
];

function window_(overrides: Partial<ChannelEvidenceWindow> = {}): ChannelEvidenceWindow {
  return {
    packageId: "pkg-1",
    channelId: "ch-talabat",
    branchId: "br-1",
    windowStart: "2026-01-01",
    windowEnd: "2026-02-28",
    timeZone: "Asia/Dubai",
    grain: "day",
    governedRowCount: 20,
    sourceFilename: "Talabat-Jan-Feb.xlsx",
    ...overrides,
  };
}

function band(input: {
  channelId: string;
  grossMinorUnits?: number;
  lostMinorUnits?: number;
  currency?: string;
}): ChannelBandRecord {
  const currency = input.currency ?? "AED";
  const findings = [];
  if (input.grossMinorUnits !== undefined) {
    findings.push({
      id: `f-gross-${input.channelId}`,
      analysisRunId: `run-${input.channelId}`,
      channelId: input.channelId,
      branchId: null,
      detectorKey: "revenue.window_gross",
      detectorVersion: 1,
      kind: "observation" as const,
      code: "WINDOW_GROSS_REVENUE",
      severity: null,
      priority: null,
      metricKey: "revenue.gross",
      periodStart: "2026-01-01",
      periodEnd: "2026-02-28",
      valueKind: "money" as const,
      valueNumerator: input.grossMinorUnits,
      valueDenominator: null,
      currency,
      monetaryImpactMinorUnits: null,
      expectedPeriodCount: 59,
      observedPeriodCount: 20,
      absentPeriodCount: 39,
      qualityState: "complete" as const,
      needsDataReason: null,
      limitations: [],
      calculationDigest: "a".repeat(64),
      createdAt: "2026-02-28T00:00:00Z",
    });
  }
  if (input.lostMinorUnits !== undefined) {
    findings.push({
      ...findings[0],
      id: `f-loss-${input.channelId}`,
      detectorKey: "orders.cancellation_loss",
      code: "ORDER_CANCELLATION_LOSS",
      metricKey: "order.avoidable_cancellation_count",
      valueKind: "count" as const,
      valueNumerator: 10,
      monetaryImpactMinorUnits: input.lostMinorUnits,
      currency,
    });
  }
  return {
    channelId: input.channelId,
    analysisRunId: `run-${input.channelId}`,
    findings: findings as ChannelBandRecord["findings"],
  };
}

const SELECTED = { windowStart: "2026-01-01", windowEnd: "2026-02-28", grain: "day" as const };

describe("buildChannelsOverviewView", () => {
  it("sums the assessed channels and states how many it covered", () => {
    const view = buildChannelsOverviewView({
      channels: CHANNELS,
      bands: [band({ channelId: "ch-talabat", grossMinorUnits: 55300, lostMinorUnits: 35700 })],
      evidenceWindows: [window_()],
      selected: SELECTED,
    });

    expect(view.total.earned).toEqual({ minorUnits: 19600, currency: "AED" });
    expect(view.coverage.assessedCount).toBe(1);
    expect(view.coverage.channelCount).toBe(4);
    expect(view.coverage.unassessedNames).toEqual(["noon", "deliveroo", "Keeta"]);
    expect(view.refusalReason).toBeNull();
  });

  it("adds two assessed channels sharing a currency", () => {
    const view = buildChannelsOverviewView({
      channels: CHANNELS,
      bands: [
        band({ channelId: "ch-talabat", grossMinorUnits: 55300, lostMinorUnits: 35700 }),
        band({ channelId: "ch-noon", grossMinorUnits: 10000, lostMinorUnits: 2500 }),
      ],
      evidenceWindows: [window_()],
      selected: SELECTED,
    });

    expect(view.total).toEqual({
      potential: { minorUnits: 65300, currency: "AED" },
      lost: { minorUnits: 38200, currency: "AED" },
      earned: { minorUnits: 27100, currency: "AED" },
    });
    expect(view.coverage.assessedCount).toBe(2);
  });

  it("refuses to add across currencies rather than summing them", () => {
    const view = buildChannelsOverviewView({
      channels: CHANNELS,
      bands: [
        band({ channelId: "ch-talabat", grossMinorUnits: 55300, lostMinorUnits: 35700 }),
        band({
          channelId: "ch-noon",
          grossMinorUnits: 10000,
          lostMinorUnits: 2500,
          currency: "USD",
        }),
      ],
      evidenceWindows: [window_()],
      selected: SELECTED,
    });

    expect(view.total).toEqual({ potential: null, lost: null, earned: null });
    expect(view.refusalReason).toBe(
      "These channels reported in more than one currency, so no single total can be stated.",
    );
    // The per-channel rows still state their own figures; only the sum refuses.
    expect(view.rows.find((row) => row.channelId === "ch-noon")?.band.earned).toEqual({
      minorUnits: 7500,
      currency: "USD",
    });
  });

  it("refuses the total rather than asserting a currency when an assessed band's currency code is unusable", () => {
    // A finding's currency is typed `string`, and nothing in that type
    // forbids "". This is a real, type-legal input -- not a cast -- so the
    // module must handle it as its own branch rather than assume the first
    // currency in a non-empty set always exists.
    const view = buildChannelsOverviewView({
      channels: CHANNELS,
      bands: [
        band({
          channelId: "ch-talabat",
          grossMinorUnits: 55300,
          lostMinorUnits: 35700,
          currency: "",
        }),
      ],
      evidenceWindows: [window_()],
      selected: SELECTED,
    });

    expect(view.coverage.assessedCount).toBe(1);
    expect(view.total).toEqual({ potential: null, lost: null, earned: null });
    expect(view.refusalReason).toBe(
      "An assessed channel's band did not carry a usable currency code, so no total can be stated.",
    );
  });

  it("states a reason rather than a zero when no channel was analysed", () => {
    const view = buildChannelsOverviewView({
      channels: CHANNELS,
      bands: [],
      evidenceWindows: [window_()],
      selected: SELECTED,
    });

    expect(view.total).toEqual({ potential: null, lost: null, earned: null });
    expect(view.coverage.assessedCount).toBe(0);
    expect(view.refusalReason).toBe(
      "No channel has a completed analysis for this window, so nothing has been measured.",
    );
  });

  it("keeps a channel that reported revenue but no loss out of the sum", () => {
    // Gross without a recorded loss cannot be split, so this channel states no
    // earned figure. It must not silently enter the sum as its gross alone.
    const view = buildChannelsOverviewView({
      channels: CHANNELS,
      bands: [band({ channelId: "ch-talabat", grossMinorUnits: 55300 })],
      evidenceWindows: [window_()],
      selected: SELECTED,
    });

    expect(view.coverage.assessedCount).toBe(0);
    expect(view.total.earned).toBeNull();
  });

  it("counts a revenue-only channel as covered rather than as unread", () => {
    // Keeta's export reports what was sold and says nothing about what was
    // lost. Listing it beside the channels nobody has uploaded anything for
    // tells the operator their import achieved nothing, which is false.
    const view = buildChannelsOverviewView({
      channels: CHANNELS,
      bands: [
        band({ channelId: "ch-talabat", grossMinorUnits: 55300, lostMinorUnits: 35700 }),
        band({ channelId: "ch-keeta", grossMinorUnits: 40000 }),
      ],
      evidenceWindows: [window_()],
      selected: SELECTED,
    });

    expect(view.coverage.revenueOnlyNames).toEqual(["Keeta"]);
    expect(view.coverage.unassessedNames).toEqual(["noon", "deliveroo"]);
    expect(view.coverage.channelCount).toBe(4);
  });

  it("states a revenue-only channel's own revenue without inventing its loss", () => {
    const view = buildChannelsOverviewView({
      channels: CHANNELS,
      bands: [band({ channelId: "ch-keeta", grossMinorUnits: 40000 })],
      evidenceWindows: [window_()],
      selected: SELECTED,
    });

    const keeta = view.rows.find((row) => row.channelId === "ch-keeta");
    expect(keeta?.band).toEqual({
      state: "revenue_only",
      potential: { minorUnits: 40000, currency: "AED" },
      lost: null,
      earned: null,
    });
    expect(keeta?.assessed).toBe(false);
  });

  it("never adds a revenue-only channel's revenue into the total it cannot complete", () => {
    // The three figures in the total must keep reconciling: potential minus
    // lost equals earned. Folding in a revenue nobody can subtract from would
    // break that quietly, which is worse than leaving it out loudly.
    const view = buildChannelsOverviewView({
      channels: CHANNELS,
      bands: [
        band({ channelId: "ch-talabat", grossMinorUnits: 55300, lostMinorUnits: 35700 }),
        band({ channelId: "ch-keeta", grossMinorUnits: 40000 }),
      ],
      evidenceWindows: [window_()],
      selected: SELECTED,
    });

    expect(view.total).toEqual({
      potential: { minorUnits: 55300, currency: "AED" },
      lost: { minorUnits: 35700, currency: "AED" },
      earned: { minorUnits: 19600, currency: "AED" },
    });
    expect(view.coverage.assessedCount).toBe(1);
  });

  it("does not claim nothing was measured when a revenue-only channel was", () => {
    const view = buildChannelsOverviewView({
      channels: CHANNELS,
      bands: [band({ channelId: "ch-keeta", grossMinorUnits: 40000 })],
      evidenceWindows: [window_()],
      selected: SELECTED,
    });

    expect(view.total.earned).toBeNull();
    expect(view.refusalReason).toBe(
      "No channel has both a revenue figure and a recorded loss for this window, so no earned total can be stated.",
    );
  });

  it("offers each declared window once, newest first", () => {
    const view = buildChannelsOverviewView({
      channels: CHANNELS,
      bands: [],
      evidenceWindows: [
        window_({ channelId: "ch-talabat" }),
        // The same window from a second channel's package is one choice, not two.
        window_({ channelId: "ch-noon", packageId: "pkg-2" }),
        window_({ packageId: "pkg-3", windowStart: "2026-03-01", windowEnd: "2026-03-31" }),
      ],
      selected: SELECTED,
    });

    expect(view.windows.map((entry) => `${entry.windowStart}..${entry.windowEnd}`)).toEqual([
      "2026-03-01..2026-03-31",
      "2026-01-01..2026-02-28",
    ]);
  });

  it("states no window at all when the organization has imported nothing", () => {
    const view = buildChannelsOverviewView({
      channels: CHANNELS,
      bands: [],
      evidenceWindows: [],
      selected: null,
    });

    expect(view.windows).toEqual([]);
    expect(view.selectedWindow).toBeNull();
    expect(view.rows).toHaveLength(4);
  });
});

describe("resolveDefaultWindow", () => {
  const march = {
    windowStart: "2026-03-01",
    windowEnd: "2026-03-31",
    grain: "day" as const,
    label: "2026-03-01 to 2026-03-31",
    value: "2026-03-01..2026-03-31..day",
  };
  const janFeb = {
    windowStart: "2026-01-01",
    windowEnd: "2026-02-28",
    grain: "day" as const,
    label: "2026-01-01 to 2026-02-28",
    value: "2026-01-01..2026-02-28..day",
  };

  it("prefers the newest window that has a completed analysis", () => {
    // March is newer but nothing has been analysed over it. Opening there
    // would show an empty page while a window that can speak sits below.
    expect(
      resolveDefaultWindow({
        windows: [march, janFeb],
        analysed: [{ windowStart: "2026-01-01", windowEnd: "2026-02-28", grain: "day" }],
      }),
    ).toEqual(janFeb);
  });

  it("falls back to the newest declared window when nothing has been analysed", () => {
    expect(resolveDefaultWindow({ windows: [march, janFeb], analysed: [] })).toEqual(march);
  });

  it("states no window when none has been declared", () => {
    expect(resolveDefaultWindow({ windows: [], analysed: [] })).toBeNull();
  });

  it("matches on grain as well as dates", () => {
    // The same dates at a different grain are a different window, and an
    // analysis over one says nothing about the other.
    expect(
      resolveDefaultWindow({
        windows: [march, janFeb],
        analysed: [{ windowStart: "2026-01-01", windowEnd: "2026-02-28", grain: "month" }],
      }),
    ).toEqual(march);
  });
});

describe("buildOverviewWindows", () => {
  // Exported (not module-private, as the original brief had it) because the
  // next task needs the window list on its own, without harvesting it as a
  // side effect of calling buildChannelsOverviewView with empty bands.

  it("deduplicates the same window declared by more than one channel's package", () => {
    const windows = buildOverviewWindows([
      window_({ channelId: "ch-talabat", packageId: "pkg-1" }),
      window_({ channelId: "ch-noon", packageId: "pkg-2" }),
    ]);

    expect(windows).toEqual([
      {
        windowStart: "2026-01-01",
        windowEnd: "2026-02-28",
        grain: "day",
        label: "2026-01-01 to 2026-02-28",
        value: "2026-01-01..2026-02-28..day",
      },
    ]);
  });

  it("treats the same dates at a different grain as a distinct window", () => {
    const windows = buildOverviewWindows([
      window_({ packageId: "pkg-1", grain: "day" }),
      window_({ packageId: "pkg-2", grain: "month" }),
    ]);

    expect(windows).toHaveLength(2);
  });

  it("orders distinct windows newest first by end date", () => {
    const windows = buildOverviewWindows([
      window_({ packageId: "pkg-1", windowStart: "2026-01-01", windowEnd: "2026-01-31" }),
      window_({ packageId: "pkg-2", windowStart: "2026-03-01", windowEnd: "2026-03-31" }),
      window_({ packageId: "pkg-3", windowStart: "2026-02-01", windowEnd: "2026-02-28" }),
    ]);

    expect(windows.map((entry) => entry.value)).toEqual([
      "2026-03-01..2026-03-31..day",
      "2026-02-01..2026-02-28..day",
      "2026-01-01..2026-01-31..day",
    ]);
  });

  it("states nothing when there are no evidence windows", () => {
    expect(buildOverviewWindows([])).toEqual([]);
  });
});

describe("resolveOverviewWindow", () => {
  const analysed = [
    { windowStart: "2026-01-01", windowEnd: "2026-01-31", grain: "month" as const },
  ];

  it("resolves a range matching exactly one declared window", () => {
    expect(
      resolveOverviewWindow({
        from: "2026-01-01",
        to: "2026-02-28",
        evidenceWindows: [window_({ grain: "day" })],
        analysed: [],
      }),
    ).toEqual({
      kind: "resolved",
      windowStart: "2026-01-01",
      windowEnd: "2026-02-28",
      grain: "day",
    });
  });

  it("stays unresolved when no declared window matches the range", () => {
    expect(
      resolveOverviewWindow({
        from: "2026-02-10",
        to: "2026-02-20",
        evidenceWindows: [window_({ grain: "day" })],
        analysed: [],
      }),
    ).toEqual({ kind: "unresolved" });
  });

  it("prefers the grain with a completed analysis on shared dates", () => {
    expect(
      resolveOverviewWindow({
        from: "2026-01-01",
        to: "2026-01-31",
        evidenceWindows: [
          window_({ packageId: "pkg-1", windowEnd: "2026-01-31", grain: "day" }),
          window_({ packageId: "pkg-2", windowEnd: "2026-01-31", grain: "month" }),
        ],
        analysed,
      }),
    ).toEqual({
      kind: "resolved",
      windowStart: "2026-01-01",
      windowEnd: "2026-01-31",
      grain: "month",
    });
  });

  it("breaks an unanalysed tie toward the coarser grain", () => {
    expect(
      resolveOverviewWindow({
        from: "2026-01-01",
        to: "2026-01-31",
        evidenceWindows: [
          window_({ packageId: "pkg-1", windowEnd: "2026-01-31", grain: "day" }),
          window_({ packageId: "pkg-2", windowEnd: "2026-01-31", grain: "week" }),
        ],
        analysed: [],
      }),
    ).toEqual({
      kind: "resolved",
      windowStart: "2026-01-01",
      windowEnd: "2026-01-31",
      grain: "week",
    });
  });
});

describe("picked ranges", () => {
  it("steps back the same day count, ending the day the range opens", () => {
    expect(previousEqualRange({ from: "2026-02-01", to: "2026-02-28" })).toEqual({
      from: "2026-01-04",
      to: "2026-01-31",
    });
    expect(previousEqualRange({ from: "2026-01-01", to: "2026-02-28" })).toEqual({
      from: "2025-11-03",
      to: "2025-12-31",
    });
  });

  it("recognises whole calendar months for the month-named copy", () => {
    expect(isWholeCalendarMonth({ from: "2026-02-01", to: "2026-02-28" })).toBe(true);
    expect(isWholeCalendarMonth({ from: "2026-01-01", to: "2026-02-28" })).toBe(false);
    expect(isWholeCalendarMonth({ from: "2026-02-05", to: "2026-02-28" })).toBe(false);
  });

  it("plots whole Monday weeks, leaving edge stubs out", () => {
    expect(wholeWeeksOfRange({ from: "2026-02-01", to: "2026-02-28" })).toEqual([
      { from: "2026-02-02", to: "2026-02-08" },
      { from: "2026-02-09", to: "2026-02-15" },
      { from: "2026-02-16", to: "2026-02-22" },
    ]);
    expect(wholeWeeksOfRange({ from: "2026-01-01", to: "2026-02-28" })).toEqual([
      { from: "2026-01-05", to: "2026-01-11" },
      { from: "2026-01-12", to: "2026-01-18" },
      { from: "2026-01-19", to: "2026-01-25" },
      { from: "2026-01-26", to: "2026-02-01" },
      { from: "2026-02-02", to: "2026-02-08" },
      { from: "2026-02-09", to: "2026-02-15" },
      { from: "2026-02-16", to: "2026-02-22" },
    ]);
    expect(monthName("2026-02-01")).toBe("February");
  });

  it("lists whole calendar months fully inside a range", () => {
    expect(wholeMonthsOfRange({ from: "2026-01-15", to: "2026-03-31" })).toEqual([
      { from: "2026-02-01", to: "2026-02-28" },
      { from: "2026-03-01", to: "2026-03-31" },
    ]);
    expect(wholeMonthsOfRange({ from: "2026-01-01", to: "2026-03-31" })).toEqual([
      { from: "2026-01-01", to: "2026-01-31" },
      { from: "2026-02-01", to: "2026-02-28" },
      { from: "2026-03-01", to: "2026-03-31" },
    ]);
  });

  it("picks analysed windows for maximum covered days without overlap", () => {
    const range = { from: "2026-01-01", to: "2026-03-31" };
    // Jan + March would silently drop February; Jan–Feb + March covers all.
    expect(
      pickTrendWindows(
        [
          { from: "2026-01-01", to: "2026-01-31" },
          { from: "2026-01-01", to: "2026-02-28" },
          { from: "2026-03-01", to: "2026-03-31" },
        ],
        range,
      ),
    ).toEqual([
      { from: "2026-01-01", to: "2026-02-28" },
      { from: "2026-03-01", to: "2026-03-31" },
    ]);
    // Windows outside the range, and the range itself, never plot.
    expect(
      pickTrendWindows(
        [
          { from: "2026-01-01", to: "2026-03-31" },
          { from: "2025-12-01", to: "2026-01-15" },
          { from: "2026-03-15", to: "2026-04-15" },
        ],
        range,
      ),
    ).toEqual([]);
  });

  it("names window buckets compactly", () => {
    expect(compactRange("2026-02-02", "2026-02-08")).toBe("2–8 Feb");
    expect(compactRange("2026-01-01", "2026-02-28")).toBe("1 Jan – 28 Feb");
    expect(compactRange("2025-12-01", "2026-01-31")).toBe("1 Dec – 31 Jan 2026");
  });
});

const GROSS = "revenue.gross";
const PLACED = "listing.placed_orders";
const VIEWS = "listing.menu_views";
const CANCELLED = "order.avoidable_cancellation_count";
const COST = "cost.commission";

function agg(input: {
  day?: string;
  spanStart?: string;
  spanEnd?: string;
  grain?: MetricAggregateGrain;
  channelId?: string;
  metricKey?: string;
  total?: number;
  currency?: string | null;
}): DailyMetricAggregate {
  const spanStart = input.spanStart ?? input.day ?? "2026-02-01";
  const spanEnd = input.spanEnd ?? input.day ?? spanStart;
  const metricKey = input.metricKey ?? GROSS;
  return {
    day: spanStart,
    spanStart,
    spanEnd,
    grain: input.grain ?? "day",
    channelId: input.channelId ?? "ch-a",
    metricKey,
    totalNumerator: input.total ?? 0,
    currency:
      input.currency !== undefined ? input.currency : metricKey === GROSS ? "AED" : null,
  };
}

function salesRow(channelId: string, day: string, total: number, currency = "AED") {
  return agg({ channelId, day, metricKey: GROSS, total, currency });
}

function countRow(channelId: string, day: string, metricKey: string, total: number) {
  return agg({ channelId, day, metricKey, total, currency: null });
}

function cardInput(overrides: Partial<Parameters<typeof buildBusinessPerformanceCard>[0]> = {}) {
  return {
    month: { from: "2026-02-01", to: "2026-02-28" },
    channels: [
      { id: "ch-a", displayName: "Delivery A" },
      { id: "ch-b", displayName: "Delivery B" },
    ],
    currentAggregates: [
      salesRow("ch-a", "2026-02-02", 2_400_000),
      salesRow("ch-a", "2026-02-09", 3_600_000),
      salesRow("ch-b", "2026-02-02", 2_400_000),
      salesRow("ch-b", "2026-02-09", 3_600_000),
      countRow("ch-a", "2026-02-02", PLACED, 480),
      countRow("ch-a", "2026-02-09", PLACED, 720),
      countRow("ch-b", "2026-02-02", PLACED, 480),
      countRow("ch-b", "2026-02-09", PLACED, 720),
      countRow("ch-a", "2026-02-02", CANCELLED, 24),
      countRow("ch-a", "2026-02-09", CANCELLED, 36),
      countRow("ch-b", "2026-02-02", CANCELLED, 24),
      countRow("ch-b", "2026-02-09", CANCELLED, 36),
    ],
    previousAggregates: [
      salesRow("ch-a", "2026-01-02", 2_000_000),
      salesRow("ch-a", "2026-01-09", 3_000_000),
      salesRow("ch-b", "2026-01-02", 2_000_000),
      salesRow("ch-b", "2026-01-09", 3_000_000),
      countRow("ch-a", "2026-01-05", PLACED, 1000),
      countRow("ch-b", "2026-01-05", PLACED, 1000),
      countRow("ch-a", "2026-01-05", CANCELLED, 50),
      countRow("ch-b", "2026-01-05", CANCELLED, 50),
    ],
    locationCount: 2,
    channelScopeName: null,
    locationScopeName: null,
    reportFiles: ["DeliveryA-Feb.xlsx"],
    ...overrides,
  };
}

describe("buildBusinessPerformanceCard", () => {
  it("totals the tiles with previous-month deltas and the prototype headline", () => {
    const card = buildBusinessPerformanceCard(cardInput());
    expect(card.tiles.sales.value).toEqual({
      kind: "money",
      money: { minorUnits: 12_000_000, currency: "AED" },
    });
    expect(card.tiles.sales.deltaPercent).toBe(20);
    expect(card.tiles.sales.deltaLabel).toBe("vs January");
    expect(card.tiles.orders.value).toEqual({ kind: "count", value: 2400 });
    expect(card.tiles.orders.deltaPercent).toBe(20);
    expect(card.tiles.orders.footnote).toBe("2 channels");
    expect(card.tiles.cancelled.value).toEqual({ kind: "count", value: 120 });
    expect(card.headline).toBe("Sales are up. Cancellations still need attention.");
    expect(card.cancelledShare).toEqual({ percent: 5, pointChange: 0 });
    expect(card.footer).toBe(
      "Sales and orders: 2 channels · 2 locations. Menu views were not reported.",
    );
  });

  it("reads menu views from the reporting channel only", () => {
    const input = cardInput();
    input.currentAggregates = [
      ...input.currentAggregates,
      countRow("ch-a", "2026-02-02", VIEWS, 5000),
      countRow("ch-a", "2026-02-09", VIEWS, 7000),
    ];
    const card = buildBusinessPerformanceCard(input);
    expect(card.tiles.views.value).toEqual({ kind: "count", value: 12000 });
    expect(card.tiles.views.footnote).toBe("Delivery A only");
    expect(card.footer).toContain("Menu views: Delivery A only.");
  });

  it("compares only channels reporting in both periods", () => {
    const card = buildBusinessPerformanceCard(
      cardInput({
        currentAggregates: [
          salesRow("ch-a", "2026-02-02", 6_000_000),
          salesRow("ch-b", "2026-02-02", 6_000_000),
        ],
        previousAggregates: [salesRow("ch-a", "2026-01-02", 5_000_000)],
      }),
    );
    // ch-b reports only in the current period: it counts toward the 12M
    // total but stays out of the delta, which reads ch-a's +20% alone.
    expect(card.tiles.sales.value).toEqual({
      kind: "money",
      money: { minorUnits: 12_000_000, currency: "AED" },
    });
    expect(card.tiles.sales.deltaPercent).toBe(20);
  });

  it("states no comparison rather than a delta when nothing was reported before", () => {
    const card = buildBusinessPerformanceCard(cardInput({ previousAggregates: [] }));
    expect(card.tiles.sales.value).not.toBeNull();
    expect(card.tiles.sales.deltaPercent).toBeNull();
    expect(card.tiles.sales.deltaAbsentReason).toBe("No earlier comparable period was reported.");
    expect(card.headline).toBe(
      "Performance for February 2026. Cancellations still need attention.",
    );
  });

  it("writes the down and steady headlines by rule", () => {
    const down = buildBusinessPerformanceCard(
      cardInput({
        currentAggregates: [
          salesRow("ch-a", "2026-02-02", 4_000_000),
          countRow("ch-a", "2026-02-02", PLACED, 800),
          countRow("ch-a", "2026-02-02", CANCELLED, 60),
        ],
        previousAggregates: [
          salesRow("ch-a", "2026-01-02", 5_000_000),
          countRow("ch-a", "2026-01-02", PLACED, 1000),
          countRow("ch-a", "2026-01-02", CANCELLED, 50),
        ],
        channels: [{ id: "ch-a", displayName: "Delivery A" }],
      }),
    );
    expect(down.headline).toBe("Sales are down. Cancellations still need attention.");

    const flat = buildBusinessPerformanceCard(
      cardInput({
        currentAggregates: [
          salesRow("ch-a", "2026-02-02", 5_000_000),
          countRow("ch-a", "2026-02-02", PLACED, 1000),
          countRow("ch-a", "2026-02-02", CANCELLED, 0),
        ],
        previousAggregates: [
          salesRow("ch-a", "2026-01-02", 5_000_000),
          countRow("ch-a", "2026-01-02", PLACED, 1000),
          countRow("ch-a", "2026-01-02", CANCELLED, 0),
        ],
        channels: [{ id: "ch-a", displayName: "Delivery A" }],
      }),
    );
    expect(flat.headline).toBe("Sales held steady. No cancellations recorded.");
  });

  it("keeps every tile absent with its reason when nothing was reported", () => {
    const card = buildBusinessPerformanceCard(
      cardInput({ currentAggregates: [], previousAggregates: [] }),
    );
    expect(card.tiles.sales.value).toBeNull();
    expect(card.tiles.sales.unavailableReason).toBe(
      "No approved report carried a sales figure for this month.",
    );
    expect(card.tiles.orders.value).toBeNull();
    expect(card.headline).toBe("Performance for February 2026.");
    expect(card.trend).toEqual({
      state: "empty",
      reason: "Fewer than two days of this month have reported sales.",
      weeks: expect.arrayContaining(["Feb 1", "Feb 28"]),
    });
    if (card.trend.state === "empty") {
      expect(card.trend.weeks).toHaveLength(28);
    }
    expect(card.shares).toBeNull();
  });

  it("refuses combined figures across currencies rather than converting them", () => {
    const input = cardInput();
    input.currentAggregates = input.currentAggregates.map((row) =>
      row.channelId === "ch-a" && row.metricKey === GROSS ? { ...row, currency: "USD" } : row,
    );
    const card = buildBusinessPerformanceCard(input);
    expect(card.tiles.sales.value).toBeNull();
    expect(card.tiles.sales.unavailableReason).toContain("more than one currency");
    expect(card.shares).toBeNull();
    expect(card.sharesAbsentReason).toContain("more than one currency");
  });

  it("refuses the tile when one channel mixes currencies inside its own rows", () => {
    const card = buildBusinessPerformanceCard(
      cardInput({
        currentAggregates: [
          salesRow("ch-a", "2026-02-02", 6_000_000, "AED"),
          agg({
            channelId: "ch-a",
            spanStart: "2026-02-03",
            spanEnd: "2026-02-05",
            grain: "span",
            metricKey: GROSS,
            total: 1_000_000,
            currency: "USD",
          }),
        ],
        channels: [{ id: "ch-a", displayName: "Delivery A" }],
      }),
    );
    expect(card.tiles.sales.value).toBeNull();
    expect(card.tiles.sales.unavailableReason).toContain("more than one currency");
  });

  it("plots daily bars and shares the channels behind them", () => {
    const card = buildBusinessPerformanceCard(cardInput());
    expect(card.trend).toEqual({
      state: "ready",
      buckets: [
        { label: "Feb 2", minorUnits: 4_800_000 },
        { label: "Feb 9", minorUnits: 7_200_000 },
      ],
      currency: "AED",
      coverageNote: "2 of 28 days · 2 of 2 channels with reported sales",
    });
    expect(card.shares?.rows.map((row) => row.sharePercent)).toEqual([50, 50]);
  });

  it("leaves gap days absent instead of zero-filling them", () => {
    const card = buildBusinessPerformanceCard(
      cardInput({
        currentAggregates: [
          salesRow("ch-a", "2026-02-02", 1_000_000),
          salesRow("ch-a", "2026-02-27", 2_000_000),
        ],
        channels: [{ id: "ch-a", displayName: "Delivery A" }],
      }),
    );
    expect(card.trend).toMatchObject({
      state: "ready",
      buckets: [
        { label: "Feb 2", minorUnits: 1_000_000 },
        { label: "Feb 27", minorUnits: 2_000_000 },
      ],
    });
  });

  it("ignores rows from channels outside the visible scope", () => {
    const card = buildBusinessPerformanceCard(
      cardInput({
        currentAggregates: [
          ...cardInput().currentAggregates,
          salesRow("ch-stranger", "2026-02-02", 99_000_000),
          countRow("ch-stranger", "2026-02-02", PLACED, 9999),
        ],
      }),
    );
    expect(card.tiles.sales.value).toEqual({
      kind: "money",
      money: { minorUnits: 12_000_000, currency: "AED" },
    });
    expect(card.tiles.orders.value).toEqual({ kind: "count", value: 2400 });
    expect(card.channelCount).toBe(2);
  });

  it("states cost presence from the reported cost line", () => {
    const without = buildBusinessPerformanceCard(cardInput());
    expect(without.tiles.sales.footnote).toBe("Costs are not yet included");
    expect(without.sources.costNote).toContain("Cost reports are missing");

    const input = cardInput();
    input.currentAggregates = [
      ...input.currentAggregates,
      agg({ channelId: "ch-a", day: "2026-02-02", metricKey: COST, total: 900_000 }),
    ];
    const withCost = buildBusinessPerformanceCard(input);
    expect(withCost.tiles.sales.footnote).toBeNull();
    expect(withCost.sources.costNote).toBe(
      "Cost figures were reported for this month; profit is still not stated here.",
    );
  });

  it("derives the cancelled share from range totals with a point change", () => {
    const input = cardInput();
    // Previous: 60 cancelled over 2000 orders = 3%, against 5% now.
    input.previousAggregates = input.previousAggregates.map((row) =>
      row.metricKey === CANCELLED ? { ...row, totalNumerator: 30 } : row,
    );
    const card = buildBusinessPerformanceCard(input);
    expect(card.cancelledShare).toEqual({ percent: 5, pointChange: 2 });
  });

  it("leaves the cancelled share absent when orders are unmeasured", () => {
    const card = buildBusinessPerformanceCard(
      cardInput({
        currentAggregates: [countRow("ch-a", "2026-02-02", CANCELLED, 10)],
        previousAggregates: [],
        channels: [{ id: "ch-a", displayName: "Delivery A" }],
      }),
    );
    expect(card.cancelledShare).toBeNull();
  });

  it("carries the modal payloads without inventing cost context", () => {
    const card = buildBusinessPerformanceCard(cardInput());
    expect(card.sources.reportingPeriod).toBe("1–28 Feb 2026");
    expect(card.sources.scope).toBe("all channels · all locations");
    expect(card.sources.salesOrdersNote).toContain("DeliveryA-Feb.xlsx");
    expect(card.sources.menuViewsNote).toBe(
      "No approved report carried menu views for this month.",
    );
    expect(card.sources.costNote).toContain("Cost reports are missing");
    expect(card.fulfillment).toEqual({
      ordersPlaced: 2400,
      ordersAbsentReason: null,
      cancelled: 120,
      cancelledAbsentReason: null,
    });
  });

  it("names a single-day range too short to plot", () => {
    const card = buildBusinessPerformanceCard(
      cardInput({
        month: { from: "2026-02-02", to: "2026-02-02" },
        currentAggregates: [salesRow("ch-a", "2026-02-02", 1_000_000)],
        channels: [{ id: "ch-a", displayName: "Delivery A" }],
      }),
    );
    expect(card.trend).toEqual({
      state: "empty",
      reason: "The selected period holds fewer than two days to plot.",
      weeks: ["Feb 2"],
    });
  });
});

describe("buildBusinessPerformanceCard over a picked range", () => {
  const RANGE = { from: "2026-01-01", to: "2026-02-28" };

  function rangeInput(overrides: Partial<Parameters<typeof buildBusinessPerformanceCard>[0]> = {}) {
    return cardInput({ month: RANGE, ...overrides });
  }

  it("compares against the previous equal-length period, not a calendar month", () => {
    const card = buildBusinessPerformanceCard(rangeInput());
    expect(card.previous).toEqual({ from: "2025-11-03", to: "2025-12-31" });
    expect(card.tiles.sales.deltaLabel).toBe("vs 3 Nov – 31 Dec 2025");
  });

  it("names the range in titles and absent reasons instead of a month", () => {
    const card = buildBusinessPerformanceCard(
      rangeInput({ currentAggregates: [], previousAggregates: [] }),
    );
    expect(card.headline).toBe("Performance for 1 Jan – 28 Feb 2026.");
    expect(card.tiles.sales.unavailableReason).toBe(
      "No approved report carried a sales figure for the selected period.",
    );
    expect(card.trend).toMatchObject({
      state: "empty",
      reason: "Fewer than two days of the selected period have reported sales.",
    });
    if (card.trend.state === "empty") {
      expect(card.trend.weeks).toHaveLength(59);
      expect(card.trend.weeks[0]).toBe("Jan 1");
    }
  });
});

describe("buildBusinessPerformanceCard range-total dedup", () => {
  const CHANNELS = [{ id: "ch-a", displayName: "Delivery A" }];
  const MONTH = { from: "2026-02-01", to: "2026-02-28" };

  function totals(currentAggregates: DailyMetricAggregate[]) {
    return buildBusinessPerformanceCard({
      month: MONTH,
      channels: CHANNELS,
      currentAggregates,
      previousAggregates: [],
      locationCount: 0,
      channelScopeName: null,
      locationScopeName: null,
      reportFiles: [],
    });
  }

  it("lets fully-inside day rows win over coarser grains", () => {
    const card = totals([
      salesRow("ch-a", "2026-02-02", 100),
      agg({
        channelId: "ch-a",
        spanStart: "2026-02-02",
        spanEnd: "2026-02-08",
        grain: "week",
        metricKey: GROSS,
        total: 10_000,
      }),
      agg({
        channelId: "ch-a",
        spanStart: "2026-02-01",
        spanEnd: "2026-02-28",
        grain: "month",
        metricKey: GROSS,
        total: 1_000_000,
      }),
    ]);
    expect(card.tiles.sales.value).toEqual({
      kind: "money",
      money: { minorUnits: 100, currency: "AED" },
    });
  });

  it("reads week rows when no day rows sit fully inside", () => {
    const card = totals([
      agg({
        channelId: "ch-a",
        spanStart: "2026-02-02",
        spanEnd: "2026-02-08",
        grain: "week",
        metricKey: GROSS,
        total: 10_000,
      }),
      agg({
        channelId: "ch-a",
        spanStart: "2026-02-01",
        spanEnd: "2026-02-28",
        grain: "month",
        metricKey: GROSS,
        total: 1_000_000,
      }),
    ]);
    expect(card.tiles.sales.value).toEqual({
      kind: "money",
      money: { minorUnits: 10_000, currency: "AED" },
    });
  });

  it("falls back to month rows when nothing finer sits fully inside", () => {
    const card = totals([
      agg({
        channelId: "ch-a",
        spanStart: "2026-02-01",
        spanEnd: "2026-02-28",
        grain: "month",
        metricKey: GROSS,
        total: 1_000_000,
      }),
    ]);
    expect(card.tiles.sales.value).toEqual({
      kind: "money",
      money: { minorUnits: 1_000_000, currency: "AED" },
    });
    // A month row never plots as bars: with no day facts the trend stays empty.
    expect(card.trend.state).toBe("empty");
  });

  it("adds fully-inside spans once each on top of the winning grain", () => {
    const card = totals([
      salesRow("ch-a", "2026-02-02", 100),
      agg({
        channelId: "ch-a",
        spanStart: "2026-02-03",
        spanEnd: "2026-02-05",
        grain: "span",
        metricKey: GROSS,
        total: 500,
      }),
      agg({
        channelId: "ch-a",
        spanStart: "2026-02-10",
        spanEnd: "2026-02-12",
        grain: "span",
        metricKey: GROSS,
        total: 700,
      }),
    ]);
    expect(card.tiles.sales.value).toEqual({
      kind: "money",
      money: { minorUnits: 1300, currency: "AED" },
    });
    // The bars still plot only the single-day fact.
    expect(card.trend).toMatchObject({
      state: "empty",
      reason: "Fewer than two days of this month have reported sales.",
    });
  });

  it("adds spans on top of a coarser winning grain", () => {
    const card = totals([
      agg({
        channelId: "ch-a",
        spanStart: "2026-02-02",
        spanEnd: "2026-02-08",
        grain: "week",
        metricKey: GROSS,
        total: 10_000,
      }),
      agg({
        channelId: "ch-a",
        spanStart: "2026-02-10",
        spanEnd: "2026-02-12",
        grain: "span",
        metricKey: GROSS,
        total: 500,
      }),
    ]);
    expect(card.tiles.sales.value).toEqual({
      kind: "money",
      money: { minorUnits: 10_500, currency: "AED" },
    });
  });

  it("sums counts at the winning grain the same way", () => {
    const card = totals([
      countRow("ch-a", "2026-02-02", PLACED, 40),
      agg({
        channelId: "ch-a",
        spanStart: "2026-02-02",
        spanEnd: "2026-02-08",
        grain: "week",
        metricKey: PLACED,
        total: 999,
        currency: null,
      }),
    ]);
    expect(card.tiles.orders.value).toEqual({ kind: "count", value: 40 });
  });

  it("lists every calendar day of the range", () => {
    expect(wholeDaysOfRange({ from: "2026-02-01", to: "2026-02-03" })).toEqual([
      { from: "2026-02-01", to: "2026-02-01" },
      { from: "2026-02-02", to: "2026-02-02" },
      { from: "2026-02-03", to: "2026-02-03" },
    ]);
  });
});
