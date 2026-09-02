import { describe, expect, it } from "vitest";

import {
  buildChannelsOverviewView,
  buildOverviewWindows,
  resolveDefaultWindow,
} from "@/modules/analysis/application/channels-overview";
import type {
  ChannelBandRecord,
  ChannelEvidenceWindow,
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
