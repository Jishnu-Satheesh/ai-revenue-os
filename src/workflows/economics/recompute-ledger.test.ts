import { describe, expect, it, vi } from "vitest";

import type {
  EconomicsCatalog,
  EconomicsCatalogPort,
  EconomicsEntryWrite,
  EconomicsLedgerStore,
} from "@/modules/economics/application/ports";
import type {
  MetricDefinitionRecord,
  MetricIngestionWindow,
  MetricIngestionWindowPort,
  MetricObservationRecord,
  MetricSeriesPort,
} from "@/modules/metrics/application/ports";
import { runRecomputeLedger } from "@/workflows/economics/recompute-ledger";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const INGESTION_RUN_ID = "22222222-2222-4222-8222-222222222222";

const catalog: EconomicsCatalog = {
  components: [
    {
      id: "def-commission",
      definition: {
        key: "commission",
        label: "Marketplace commission",
        computationKind: "rate_of_revenue",
        appliesToChannels: null,
      },
    },
  ],
  rates: [],
};

/** A single Dubai day: local midnight is 20:00 UTC the evening before. */
const dubaiDay: MetricIngestionWindow = {
  grain: "day",
  branchId: null,
  timeZone: "Asia/Dubai",
  rangeStart: new Date("2026-05-31T20:00:00Z"),
  lastPeriodStart: new Date("2026-05-31T20:00:00Z"),
  observationCount: 3,
};

const definitionFor = (key: string): MetricDefinitionRecord => ({
  id: `metric-${key}`,
  key,
  valueKind: "money",
  aggregation: "sum",
  percentileP: null,
  isActive: true,
});

const point = (periodStart: string, numerator: number): MetricObservationRecord => ({
  periodStart: new Date(periodStart),
  periodTimezone: "Asia/Dubai",
  channel: "talabat",
  numerator,
  denominator: null,
  currency: "AED",
  qualityTier: "measured",
});

function stubDeps(
  options: {
    window?: MetricIngestionWindow | null;
    series?: Record<string, MetricObservationRecord[]>;
    binding?: Awaited<ReturnType<EconomicsCatalogPort["loadMetricBinding"]>>;
  } = {},
) {
  const series = options.series ?? {
    "revenue.gross": [point("2026-05-31T20:00:00Z", 1_000_000)],
    "margin.contribution": [point("2026-05-31T20:00:00Z", 345_000)],
  };

  const recorded: EconomicsEntryWrite[] = [];
  const ledger: EconomicsLedgerStore = {
    recordEntries: vi.fn(async (_organizationId, entries) => {
      recorded.push(...entries);
      return { written: entries.length };
    }),
  };

  const metrics: MetricSeriesPort = {
    loadDefinition: async (_organizationId, metricKey) =>
      metricKey in series ? definitionFor(metricKey) : null,
    loadObservations: async (query) =>
      Object.entries(series).find(
        ([key]) => definitionFor(key).id === query.metricDefinitionId,
      )?.[1] ?? [],
  };

  const windows: MetricIngestionWindowPort = {
    loadIngestionRunWindow: vi.fn(async () =>
      options.window === undefined ? dubaiDay : options.window,
    ),
  };

  const catalogPort: EconomicsCatalogPort = {
    loadCatalog: async () => catalog,
    loadMetricBinding: async () =>
      options.binding ?? {
        grossRevenue: "revenue.gross",
        reportedMargin: "margin.contribution",
      },
  };

  const warnings: { message: string }[] = [];
  const logger = {
    info: vi.fn(),
    warn: vi.fn((message: string) => warnings.push({ message })),
  };

  return {
    deps: { metrics, windows, catalog: catalogPort, ledger, logger },
    recorded,
    warnings,
    windows,
  };
}

const payload = { organizationId: ORGANIZATION_ID, ingestionRunId: INGESTION_RUN_ID };

describe("runRecomputeLedger", () => {
  it("reprices exactly the periods the ingestion run wrote", async () => {
    const { deps, recorded } = stubDeps();

    const outcome = await runRecomputeLedger(payload, deps);

    expect(outcome).toMatchObject({ status: "recomputed", entriesWritten: 1 });
    expect(recorded[0]).toMatchObject({
      periodStart: new Date("2026-05-31T20:00:00Z"),
      // The end of the last period the run wrote, not its start, or the final
      // day of every import would fall outside its own recompute.
      periodEnd: new Date("2026-06-01T20:00:00Z"),
      currency: "AED",
    });
  });

  it("skips a run that wrote no observations instead of failing", async () => {
    // Every row rejected. Ordinary, not an error.
    const { deps, recorded } = stubDeps({ window: null });

    expect(await runRecomputeLedger(payload, deps)).toEqual({
      status: "skipped",
      reason: "no_observations",
    });
    expect(recorded).toEqual([]);
  });

  it("reads the branch and timezone from the run rather than assuming them", async () => {
    const { deps, recorded } = stubDeps({
      window: { ...dubaiDay, branchId: "33333333-3333-4333-8333-333333333333" },
    });

    await runRecomputeLedger(payload, deps);

    expect(recorded[0].branchId).toBe("33333333-3333-4333-8333-333333333333");
  });

  it("uses the metric binding the registry resolved, never a hard-coded key", async () => {
    // No reported-margin role bound, so the same data grades indicative
    // instead of recording a figure. This is the industry-neutrality boundary:
    // the workflow never names margin.contribution.
    const { deps, recorded } = stubDeps({ binding: { grossRevenue: "revenue.gross" } });

    await runRecomputeLedger(payload, deps);

    expect(recorded[0]).toMatchObject({
      marginSource: "derived",
      completenessGrade: "indicative",
      contributionMarginMinor: null,
    });
  });

  it("warns about a disagreement rather than swallowing it", async () => {
    const { deps, warnings } = stubDeps({
      series: {
        "revenue.gross": [point("2026-05-31T20:00:00Z", 1_000_000)],
        "margin.contribution": [point("2026-05-31T20:00:00Z", 400_000)],
      },
    });

    // A commission rate exists, so a derived figure stands beside the report.
    deps.catalog.loadCatalog = async () => ({
      ...catalog,
      rates: [
        {
          id: "rate-c",
          key: "commission",
          definitionKey: "commission",
          qualityTier: "measured",
          rateOfRevenue: 0.28,
          channel: null,
          branchId: null,
          effectiveFrom: "2026-01-01",
          effectiveTo: null,
        },
      ],
    });

    const outcome = await runRecomputeLedger(payload, deps);

    expect(outcome).toMatchObject({ status: "recomputed" });
    if (outcome.status !== "recomputed") return;
    expect(outcome.disagreements).toHaveLength(1);
    expect(warnings.map((warning) => warning.message)).toContain(
      "economics.ledger.reported_margin_disagreement",
    );
  });

  it("refuses a payload that is not a pair of tenant-scoped ids", async () => {
    const { deps } = stubDeps();

    await expect(
      runRecomputeLedger({ organizationId: ORGANIZATION_ID, ingestionRunId: "run-1" }, deps),
    ).rejects.toThrow();
  });
});
