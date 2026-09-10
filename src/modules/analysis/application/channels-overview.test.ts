import { describe, expect, it } from "vitest";

import {
  buildBusinessPerformanceCard,
  buildChannelsOverviewView,
  buildOverviewWindows,
  enumerateCoveredMonths,
  monthName,
  previousCalendarMonth,
  resolveDefaultWindow,
  resolveOverviewWindow,
  snapToCoveredMonth,
  wholeWeeksOfMonth,
} from "@/modules/analysis/application/channels-overview";
import type {
  ChannelBandRecord,
  ChannelEvidenceWindow,
  ChannelFindingRecord,
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

describe("covered months", () => {
  const segments = [{ start: "2026-01-15", end: "2026-03-10" }];

  it("offers only whole months fully inside coverage, newest first", () => {
    expect(enumerateCoveredMonths(segments)).toEqual([{ from: "2026-02-01", to: "2026-02-28" }]);
    expect(enumerateCoveredMonths([{ start: "2026-01-01", end: "2026-03-31" }])).toEqual([
      { from: "2026-03-01", to: "2026-03-31" },
      { from: "2026-02-01", to: "2026-02-28" },
      { from: "2026-01-01", to: "2026-01-31" },
    ]);
  });

  it("snaps a legacy range to its month and refuses straddlers", () => {
    expect(snapToCoveredMonth("2026-02-05", "2026-02-20", segments)).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
    expect(snapToCoveredMonth("2026-01-28", "2026-02-05", segments)).toBeNull();
    expect(snapToCoveredMonth("2026-04-01", "2026-04-30", segments)).toBeNull();
  });

  it("steps back exactly one calendar month", () => {
    expect(previousCalendarMonth("2026-02-01")).toEqual({
      from: "2026-01-01",
      to: "2026-01-31",
    });
    expect(previousCalendarMonth("2026-03-01")).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
  });

  it("plots whole Monday weeks, leaving edge stubs out", () => {
    expect(wholeWeeksOfMonth({ from: "2026-02-01", to: "2026-02-28" })).toEqual([
      { from: "2026-02-02", to: "2026-02-08" },
      { from: "2026-02-09", to: "2026-02-15" },
      { from: "2026-02-16", to: "2026-02-22" },
    ]);
    expect(monthName("2026-02-01")).toBe("February");
  });
});

function cardFinding(input: {
  channelId: string;
  code: string;
  metricKey?: string;
  valueKind: "money" | "count" | "ratio";
  numerator: number | null;
  denominator?: number | null;
  currency?: string;
}): ChannelFindingRecord {
  return {
    id: `f-${input.channelId}-${input.code}-${input.metricKey ?? "none"}`,
    analysisRunId: `run-${input.channelId}`,
    channelId: input.channelId,
    branchId: null,
    detectorKey: "test.detector",
    detectorVersion: 1,
    kind: "observation",
    code: input.code,
    severity: null,
    priority: null,
    metricKey: input.metricKey ?? null,
    periodStart: "2026-02-01",
    periodEnd: "2026-02-28",
    valueKind: input.valueKind,
    valueNumerator: input.numerator,
    valueDenominator: input.denominator ?? null,
    currency: input.currency ?? (input.valueKind === "money" ? "AED" : null),
    monetaryImpactMinorUnits: null,
    expectedPeriodCount: 1,
    observedPeriodCount: 1,
    absentPeriodCount: 0,
    qualityState: "complete",
    needsDataReason: null,
    limitations: [],
    calculationDigest: "b".repeat(64),
    createdAt: "2026-02-28T00:00:00Z",
  };
}

const GROSS = "WINDOW_GROSS_REVENUE";
const LOSS = "ORDER_CANCELLATION_LOSS";
const FUNNEL = "FUNNEL_STAGE_CONVERSION";
const SHARE = "ORDER_CANCELLATION_ATTRIBUTION_SHARE_OF_ORDERS";
const PLACED = "listing.placed_orders";
const VIEWS = "listing.menu_views";

function monthRecords(
  entries: { channelId: string; findings: readonly ChannelFindingRecord[] }[],
): Map<string, readonly ChannelFindingRecord[]> {
  return new Map<string, readonly ChannelFindingRecord[]>(
    entries.map((entry) => [entry.channelId, entry.findings]),
  );
}

function fullMonth(input: { gross: number; orders: number; cancelled: number; shareDen: number }) {
  return [
    cardFinding({
      channelId: "ch-a",
      code: GROSS,
      valueKind: "money",
      numerator: input.gross,
    }),
    cardFinding({
      channelId: "ch-a",
      code: FUNNEL,
      metricKey: PLACED,
      valueKind: "ratio",
      numerator: input.orders,
      denominator: 100,
    }),
    cardFinding({
      channelId: "ch-a",
      code: LOSS,
      valueKind: "count",
      numerator: input.cancelled,
    }),
    cardFinding({
      channelId: "ch-a",
      code: SHARE,
      valueKind: "ratio",
      numerator: input.cancelled,
      denominator: input.shareDen,
    }),
  ];
}

function cardInput(overrides: Partial<Parameters<typeof buildBusinessPerformanceCard>[0]> = {}) {
  return {
    month: { from: "2026-02-01", to: "2026-02-28" },
    channels: [
      { id: "ch-a", displayName: "Delivery A" },
      { id: "ch-b", displayName: "Delivery B" },
    ],
    current: monthRecords([
      {
        channelId: "ch-a",
        findings: fullMonth({ gross: 6_000_000, orders: 1200, cancelled: 60, shareDen: 1200 }),
      },
      {
        channelId: "ch-b",
        findings: [
          cardFinding({ channelId: "ch-b", code: GROSS, valueKind: "money", numerator: 6_000_000 }),
          cardFinding({
            channelId: "ch-b",
            code: FUNNEL,
            metricKey: PLACED,
            valueKind: "ratio",
            numerator: 1200,
            denominator: 50,
          }),
          cardFinding({ channelId: "ch-b", code: LOSS, valueKind: "count", numerator: 60 }),
          cardFinding({
            channelId: "ch-b",
            code: SHARE,
            valueKind: "ratio",
            numerator: 60,
            denominator: 1200,
          }),
        ],
      },
    ]),
    previous: monthRecords([
      {
        channelId: "ch-a",
        findings: fullMonth({ gross: 5_000_000, orders: 1000, cancelled: 50, shareDen: 1000 }),
      },
      {
        channelId: "ch-b",
        findings: [
          cardFinding({ channelId: "ch-b", code: GROSS, valueKind: "money", numerator: 5_000_000 }),
          cardFinding({
            channelId: "ch-b",
            code: FUNNEL,
            metricKey: PLACED,
            valueKind: "ratio",
            numerator: 1000,
            denominator: 50,
          }),
          cardFinding({ channelId: "ch-b", code: LOSS, valueKind: "count", numerator: 50 }),
          cardFinding({
            channelId: "ch-b",
            code: SHARE,
            valueKind: "ratio",
            numerator: 50,
            denominator: 1000,
          }),
        ],
      },
    ]),
    trendWeeks: [
      {
        window: { from: "2026-02-02", to: "2026-02-08" },
        records: monthRecords([
          {
            channelId: "ch-a",
            findings: [
              cardFinding({
                channelId: "ch-a",
                code: GROSS,
                valueKind: "money",
                numerator: 2_400_000,
              }),
            ],
          },
          {
            channelId: "ch-b",
            findings: [
              cardFinding({
                channelId: "ch-b",
                code: GROSS,
                valueKind: "money",
                numerator: 2_400_000,
              }),
            ],
          },
        ]),
      },
      {
        window: { from: "2026-02-09", to: "2026-02-15" },
        records: monthRecords([
          {
            channelId: "ch-a",
            findings: [
              cardFinding({
                channelId: "ch-a",
                code: GROSS,
                valueKind: "money",
                numerator: 3_600_000,
              }),
            ],
          },
          {
            channelId: "ch-b",
            findings: [
              cardFinding({
                channelId: "ch-b",
                code: GROSS,
                valueKind: "money",
                numerator: 3_600_000,
              }),
            ],
          },
        ]),
      },
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
    const chA = input.current.get("ch-a") ?? [];
    input.current = monthRecords([
      {
        channelId: "ch-a",
        findings: [
          ...chA,
          cardFinding({
            channelId: "ch-a",
            code: FUNNEL,
            metricKey: VIEWS,
            valueKind: "ratio",
            numerator: 12000,
            denominator: 100,
          }),
        ],
      },
      { channelId: "ch-b", findings: input.current.get("ch-b") ?? [] },
    ]);
    const card = buildBusinessPerformanceCard(input);
    expect(card.tiles.views.value).toEqual({ kind: "count", value: 12000 });
    expect(card.tiles.views.footnote).toBe("Delivery A only");
    expect(card.footer).toContain("Menu views: Delivery A only.");
  });

  it("compares only channels analysed in both months", () => {
    const input = cardInput();
    input.previous = monthRecords([
      {
        channelId: "ch-a",
        findings: fullMonth({ gross: 6_000_000, orders: 1200, cancelled: 60, shareDen: 1200 }),
      },
    ]);
    const card = buildBusinessPerformanceCard(input);
    // ch-a is flat across the two months; ch-b is new and stays out of the delta.
    expect(card.tiles.sales.deltaPercent).toBe(0);
  });

  it("states no comparison rather than a delta when last month is missing", () => {
    const card = buildBusinessPerformanceCard(cardInput({ previous: new Map() }));
    expect(card.tiles.sales.value).not.toBeNull();
    expect(card.tiles.sales.deltaPercent).toBeNull();
    expect(card.tiles.sales.deltaAbsentReason).toBe("No earlier comparable period was analysed.");
    expect(card.headline).toBe(
      "Performance for February 2026. Cancellations still need attention.",
    );
  });

  it("writes the down and steady headlines by rule", () => {
    const down = buildBusinessPerformanceCard(
      cardInput({
        current: monthRecords([
          {
            channelId: "ch-a",
            findings: fullMonth({ gross: 4_000_000, orders: 800, cancelled: 60, shareDen: 800 }),
          },
        ]),
        previous: monthRecords([
          {
            channelId: "ch-a",
            findings: fullMonth({ gross: 5_000_000, orders: 1000, cancelled: 50, shareDen: 1000 }),
          },
        ]),
        channels: [{ id: "ch-a", displayName: "Delivery A" }],
        trendWeeks: [],
      }),
    );
    expect(down.headline).toBe("Sales are down. Cancellations still need attention.");

    const flat = buildBusinessPerformanceCard(
      cardInput({
        current: monthRecords([
          {
            channelId: "ch-a",
            findings: fullMonth({ gross: 5_000_000, orders: 1000, cancelled: 0, shareDen: 1000 }),
          },
        ]),
        previous: monthRecords([
          {
            channelId: "ch-a",
            findings: fullMonth({ gross: 5_000_000, orders: 1000, cancelled: 0, shareDen: 1000 }),
          },
        ]),
        channels: [{ id: "ch-a", displayName: "Delivery A" }],
        trendWeeks: [],
      }),
    );
    expect(flat.headline).toBe("Sales held steady. No cancellations recorded.");
  });

  it("keeps every tile absent with its reason when nothing was analysed", () => {
    const card = buildBusinessPerformanceCard(
      cardInput({ current: new Map(), previous: new Map(), trendWeeks: [] }),
    );
    expect(card.tiles.sales.value).toBeNull();
    expect(card.tiles.sales.unavailableReason).toBe(
      "No approved report carried a sales figure for this month.",
    );
    expect(card.tiles.orders.value).toBeNull();
    expect(card.headline).toBe("Performance for February 2026.");
    expect(card.trend).toEqual({
      state: "empty",
      reason: "Fewer than two weeks of this month have a completed analysis.",
      weeks: ["2–8 Feb", "9–15 Feb", "16–22 Feb"],
    });
    expect(card.shares).toBeNull();
  });

  it("refuses combined figures across currencies rather than converting them", () => {
    const input = cardInput();
    input.current = monthRecords([
      {
        channelId: "ch-a",
        findings: [
          cardFinding({
            channelId: "ch-a",
            code: GROSS,
            valueKind: "money",
            numerator: 6_000_000,
            currency: "USD",
          }),
        ],
      },
      { channelId: "ch-b", findings: input.current.get("ch-b") ?? [] },
    ]);
    const card = buildBusinessPerformanceCard(input);
    expect(card.tiles.sales.value).toBeNull();
    expect(card.tiles.sales.unavailableReason).toContain("more than one currency");
    expect(card.shares).toBeNull();
    expect(card.sharesAbsentReason).toContain("more than one currency");
  });

  it("plots analysed weeks and shares the channels behind them", () => {
    const card = buildBusinessPerformanceCard(cardInput());
    expect(card.trend).toEqual({
      state: "ready",
      buckets: [
        { label: "2–8 Feb", minorUnits: 4_800_000 },
        { label: "9–15 Feb", minorUnits: 7_200_000 },
      ],
      currency: "AED",
      coverageNote: "2 of 3 February weeks · 2 of 2 channels",
    });
    expect(card.shares?.rows.map((row) => row.sharePercent)).toEqual([50, 50]);
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
});
