import { describe, expect, it, vi } from "vitest";

import { EconomicsError } from "@/domain/economics/errors";
import type { StoredCostRate } from "@/domain/economics/rates";
import { recomputeChannelEconomics, toEntryWrite } from "@/modules/economics/application/ledger";
import type {
  EconomicsCatalog,
  EconomicsCatalogPort,
  EconomicsEntryWrite,
  EconomicsLedgerStore,
} from "@/modules/economics/application/ports";
import type {
  MetricDefinitionRecord,
  MetricObservationRecord,
  MetricSeriesPort,
} from "@/modules/metrics/application/ports";

const COMMISSION_ID = "def-commission";
const FOOD_COST_ID = "def-food-cost";

const catalog: EconomicsCatalog = {
  components: [
    {
      id: COMMISSION_ID,
      definition: {
        key: "commission",
        label: "Marketplace commission",
        computationKind: "rate_of_revenue",
        appliesToChannels: null,
      },
    },
    {
      id: FOOD_COST_ID,
      definition: {
        key: "food_cost",
        label: "Food cost",
        computationKind: "rate_of_revenue",
        appliesToChannels: null,
      },
    },
  ],
  rates: [],
};

function withRates(...rates: StoredCostRate[]): EconomicsCatalog {
  return { ...catalog, rates };
}

function rate(overrides: Partial<StoredCostRate> & { id: string }): StoredCostRate {
  return {
    key: "commission",
    definitionKey: "commission",
    qualityTier: "measured",
    channel: null,
    branchId: null,
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    ...overrides,
  };
}

const definitionFor = (key: string): MetricDefinitionRecord => ({
  id: `metric-${key}`,
  key,
  valueKind: key.startsWith("transactions") ? "count" : "money",
  aggregation: "sum",
  percentileP: null,
  isActive: true,
});

function point(
  periodStart: string,
  numerator: number,
  overrides: Partial<MetricObservationRecord> = {},
): MetricObservationRecord {
  return {
    periodStart: new Date(periodStart),
    periodTimezone: "Asia/Dubai",
    channel: "talabat",
    numerator,
    denominator: null,
    currency: "AED",
    qualityTier: "measured",
    ...overrides,
  };
}

/** Two Dubai days: local midnight is 20:00 UTC the evening before. */
const window = {
  organizationId: "org-1",
  branchId: null,
  timeZone: "Asia/Dubai",
  grain: "day" as const,
  rangeStart: new Date("2026-05-31T20:00:00Z"),
  rangeEndExclusive: new Date("2026-06-02T20:00:00Z"),
};

const binding = {
  grossRevenue: "revenue.gross",
  transactionCount: "transactions.count",
  reportedMargin: "margin.contribution",
};

function stubMetrics(series: Record<string, MetricObservationRecord[]>): MetricSeriesPort {
  return {
    loadDefinition: async (_organizationId, metricKey) =>
      metricKey in series ? definitionFor(metricKey) : null,
    loadObservations: async (query) =>
      Object.entries(series).find(
        ([key]) => definitionFor(key).id === query.metricDefinitionId,
      )?.[1] ?? [],
  };
}

function stubDeps(
  series: Record<string, MetricObservationRecord[]>,
  loaded: EconomicsCatalog = catalog,
) {
  const recorded: EconomicsEntryWrite[] = [];
  const ledger: EconomicsLedgerStore = {
    recordEntries: vi.fn(async (_organizationId, entries) => {
      recorded.push(...entries);
      return { written: entries.length };
    }),
  };
  const catalogPort: EconomicsCatalogPort = {
    loadCatalog: async () => loaded,
    loadMetricBinding: async () => ({ grossRevenue: "revenue.gross" }),
  };

  return { deps: { metrics: stubMetrics(series), catalog: catalogPort, ledger }, recorded };
}

describe("recomputeChannelEconomics", () => {
  it("prices every channel in one pass and records what it graded", async () => {
    const { deps, recorded } = stubDeps(
      {
        "revenue.gross": [
          point("2026-05-31T20:00:00Z", 1_000_000),
          point("2026-05-31T20:00:00Z", 400_000, { channel: "deliveroo" }),
        ],
        "transactions.count": [
          point("2026-05-31T20:00:00Z", 200, { currency: null }),
          point("2026-05-31T20:00:00Z", 80, { channel: "deliveroo", currency: null }),
        ],
      },
      withRates(
        rate({ id: "c", rateOfRevenue: 0.28 }),
        rate({ id: "f", definitionKey: "food_cost", key: "food_cost", rateOfRevenue: 0.3 }),
      ),
    );

    const result = await recomputeChannelEconomics(deps, {
      ...window,
      metricKeys: { grossRevenue: "revenue.gross", transactionCount: "transactions.count" },
    });

    expect(result.entriesWritten).toBe(2);
    expect(result.gradeCounts).toEqual({ complete: 2, partial: 0, indicative: 0 });
    expect(recorded.map((entry) => entry.channel)).toEqual(["talabat", "deliveroo"]);
    expect(recorded[0]).toMatchObject({
      grain: "period",
      contributionMarginMinor: 420_000,
      atMostMinor: null,
      currency: "AED",
      // A Dubai day, stepped by calendar unit rather than by 24 fixed hours.
      periodEnd: new Date("2026-06-01T20:00:00Z"),
    });
    expect(recorded[0].components).toHaveLength(2);
  });

  it("reports a day with no revenue rather than writing a zero-revenue entry", async () => {
    const { deps } = stubDeps({
      "revenue.gross": [point("2026-05-31T20:00:00Z", 1_000_000)],
      "transactions.count": [],
    });

    const result = await recomputeChannelEconomics(deps, {
      ...window,
      metricKeys: { grossRevenue: "revenue.gross", transactionCount: "transactions.count" },
    });

    // Two Dubai days asked for, one with trade. The other is absent, not zero.
    expect(result.entriesWritten).toBe(1);
    expect(result.periodStartsWithoutRevenue).toBe(1);
  });

  it("keeps a reported margin usable when no rate exists to derive one", async () => {
    const { deps, recorded } = stubDeps({
      "revenue.gross": [point("2026-05-31T20:00:00Z", 1_000_000)],
      "transactions.count": [point("2026-05-31T20:00:00Z", 200, { currency: null })],
      "margin.contribution": [point("2026-05-31T20:00:00Z", 345_000)],
    });

    const result = await recomputeChannelEconomics(deps, { ...window, metricKeys: binding });

    expect(result.reportedEntryCount).toBe(1);
    expect(result.gradeCounts.indicative).toBe(0);
    expect(recorded[0]).toMatchObject({
      marginSource: "reported",
      completenessGrade: "complete",
      contributionMarginMinor: 345_000,
      reportedQualityTier: "measured",
    });
    // A reported figure was never decomposed, so it offers no waterfall.
    expect(recorded[0].components).toEqual([]);
  });

  it("surfaces a disagreement between a derived figure and a reported one", async () => {
    const { deps } = stubDeps(
      {
        "revenue.gross": [point("2026-05-31T20:00:00Z", 1_000_000)],
        "transactions.count": [point("2026-05-31T20:00:00Z", 200, { currency: null })],
        "margin.contribution": [point("2026-05-31T20:00:00Z", 400_000)],
      },
      withRates(
        rate({ id: "c", rateOfRevenue: 0.28 }),
        rate({ id: "f", definitionKey: "food_cost", key: "food_cost", rateOfRevenue: 0.3 }),
      ),
    );

    const result = await recomputeChannelEconomics(deps, { ...window, metricKeys: binding });

    expect(result.disagreements).toEqual([
      {
        periodStart: new Date("2026-05-31T20:00:00Z"),
        channel: "talabat",
        reportedMinor: 400_000,
        differenceMinor: 20_000,
      },
    ]);
  });

  it("refuses a window rather than pricing it without a metric the caller named", async () => {
    const { deps } = stubDeps({ "revenue.gross": [point("2026-05-31T20:00:00Z", 1_000_000)] });

    // An unregistered key is a misconfiguration. Pricing the window anyway
    // would silently produce entries missing an input the caller asked for.
    await expect(
      recomputeChannelEconomics(deps, {
        ...window,
        metricKeys: { grossRevenue: "revenue.gross", unitCount: "units.count" },
      }),
    ).rejects.toThrow();
  });

  it("writes nothing when the window holds no revenue at all", async () => {
    const { deps, recorded } = stubDeps({ "revenue.gross": [] });

    const result = await recomputeChannelEconomics(deps, {
      ...window,
      metricKeys: { grossRevenue: "revenue.gross" },
    });

    expect(result.entriesWritten).toBe(0);
    expect(result.periodStartsWithoutRevenue).toBe(2);
    expect(recorded).toEqual([]);
  });
});

describe("toEntryWrite", () => {
  const indicativeEntry = {
    periodStart: new Date("2026-05-31T20:00:00Z"),
    periodEnd: new Date("2026-06-01T20:00:00Z"),
    periodTimezone: "Asia/Dubai",
    channel: "talabat",
    grossRevenueMinor: 1_000_000,
    transactionCount: 200,
    currency: "AED",
    rateIdByComponentKey: { commission: "rate-c" },
    margin: {
      marginSource: "derived",
      grade: "indicative",
      atMostMinor: 720_000,
      grossRevenueMinor: 1_000_000,
      currency: "AED",
      components: [
        { key: "commission", label: "Commission", amountMinor: 280_000, qualityTier: "measured" },
        { key: "food_cost", label: "Food cost", amountMinor: 0, qualityTier: "missing" },
      ],
      missingComponentKeys: ["food_cost"],
    },
  } as const;

  const definitionIds = new Map([
    ["commission", COMMISSION_ID],
    ["food_cost", FOOD_COST_ID],
  ]);

  it("records a missing component as a row rather than omitting it", () => {
    const write = toEntryWrite(indicativeEntry, definitionIds, null);

    // An absent row reads as a cost of nothing, which would silently inflate
    // the margin. It is the one way this table can lie.
    expect(write.components).toEqual([
      {
        definitionId: COMMISSION_ID,
        rateId: "rate-c",
        amountMinor: 280_000,
        qualityTier: "measured",
      },
      { definitionId: FOOD_COST_ID, rateId: null, amountMinor: 0, qualityTier: "missing" },
    ]);
    expect(write).toMatchObject({
      completenessGrade: "indicative",
      contributionMarginMinor: null,
      atMostMinor: 720_000,
    });
  });

  it("refuses a component whose definition is not registered", () => {
    expect(() =>
      toEntryWrite(indicativeEntry, new Map([["commission", COMMISSION_ID]]), null),
    ).toThrow(EconomicsError);
  });
});
