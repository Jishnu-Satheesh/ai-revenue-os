import { describe, expect, it } from "vitest";

import {
  readCampaignPostPerformance,
  type PostPerformancePersistence,
} from "@/modules/campaigns/infrastructure/post-performance-reader";

const ORGANIZATION_ID = "b6000000-0000-4000-8000-000000000001";
const CAMPAIGN_ID = "b6000000-0000-4000-8000-000000000101";
const ACTION_A = "b6000000-0000-4000-8000-000000000201";
const ACTION_B = "b6000000-0000-4000-8000-000000000202";
const REACH_DEF = "b6000000-0000-4000-8000-000000000301";
const LIKES_DEF = "b6000000-0000-4000-8000-000000000302";

type Row = Record<string, unknown>;

function persistence(tables: Record<string, Row[]>, tableError?: string) {
  const filters: { table: string; column: string; value: unknown }[] = [];

  const client: PostPerformancePersistence = {
    from(table) {
      const result = tableError
        ? { data: null, error: { message: tableError } }
        : { data: tables[table] ?? [], error: null };
      const chain = {
        eq(column: string, value: string) {
          filters.push({ table, column, value });
          return chain;
        },
        in(column: string, value: readonly string[]) {
          filters.push({ table, column, value });
          return chain;
        },
        is(column: string, value: null) {
          filters.push({ table, column, value });
          return chain;
        },
        then(resolve: (value: typeof result) => unknown) {
          return Promise.resolve(result).then(resolve);
        },
      };
      return { select: () => chain } as unknown as ReturnType<
        PostPerformancePersistence["from"]
      >;
    },
  };

  return { client, filters };
}

const DEFINITIONS = [
  { id: REACH_DEF, key: "instagram.post_reach", label: "Instagram reach (lifetime)" },
  { id: LIKES_DEF, key: "instagram.post_likes", label: "Instagram likes (lifetime)" },
];

function observation(overrides: Row = {}): Row {
  return {
    action_run_id: ACTION_A,
    metric_definition_id: REACH_DEF,
    normalized_metric_id: "b6000000-0000-4000-8000-000000000401",
    period_start: "2026-09-14T20:00:00.000Z",
    presence: "observed",
    ...overrides,
  };
}

describe("reading what the provider reported about a campaign's posts", () => {
  it("returns a labelled figure per reading, grouped by the post it belongs to", async () => {
    const { client } = persistence({
      campaign_metric_observations: [
        observation(),
        observation({
          action_run_id: ACTION_B,
          metric_definition_id: LIKES_DEF,
          normalized_metric_id: "b6000000-0000-4000-8000-000000000402",
        }),
      ],
      metric_definitions: DEFINITIONS,
      normalized_metrics: [
        { id: "b6000000-0000-4000-8000-000000000401", value_numerator: 1840 },
        { id: "b6000000-0000-4000-8000-000000000402", value_numerator: 96 },
      ],
    });

    const series = await readCampaignPostPerformance(client, {
      organizationId: ORGANIZATION_ID,
      campaignId: CAMPAIGN_ID,
    });

    expect(series).toHaveLength(2);
    expect(series.find((s) => s.actionRunId === ACTION_A)?.points[0]).toEqual({
      metricKey: "instagram.post_reach",
      label: "Instagram reach (lifetime)",
      observedAt: "2026-09-14T20:00:00.000Z",
      presence: "observed",
      value: 1840,
    });
  });

  it("keeps a recorded gap a gap rather than a zero", async () => {
    const { client } = persistence({
      campaign_metric_observations: [
        observation({ presence: "absent", normalized_metric_id: null }),
      ],
      metric_definitions: DEFINITIONS,
      normalized_metrics: [],
    });

    const [series] = await readCampaignPostPerformance(client, {
      organizationId: ORGANIZATION_ID,
      campaignId: CAMPAIGN_ID,
    });

    // "Asked and told nothing" is a different claim from "it was nothing", and
    // a zero on a chart says the second one.
    expect(series?.points[0]?.presence).toBe("absent");
    expect(series?.points[0]?.value).toBeNull();
  });

  it("downgrades an observed reading whose value cannot be read", async () => {
    const { client } = persistence({
      campaign_metric_observations: [observation()],
      metric_definitions: DEFINITIONS,
      // The row the observation points at is missing.
      normalized_metrics: [],
    });

    const [series] = await readCampaignPostPerformance(client, {
      organizationId: ORGANIZATION_ID,
      campaignId: CAMPAIGN_ID,
    });

    expect(series?.points[0]?.presence).toBe("absent");
    expect(series?.points[0]?.value).toBeNull();
  });

  it("drops a figure whose metric cannot be named", async () => {
    const { client } = persistence({
      campaign_metric_observations: [observation({ metric_definition_id: "unknown-definition" })],
      metric_definitions: DEFINITIONS,
      normalized_metrics: [{ id: "b6000000-0000-4000-8000-000000000401", value_numerator: 1840 }],
    });

    // A number with no label is not a measurement anyone can act on.
    expect(
      await readCampaignPostPerformance(client, {
        organizationId: ORGANIZATION_ID,
        campaignId: CAMPAIGN_ID,
      }),
    ).toEqual([]);
  });

  it("reads only the live answer for each period", async () => {
    const { client, filters } = persistence({
      campaign_metric_observations: [],
      metric_definitions: [],
      normalized_metrics: [],
    });

    await readCampaignPostPerformance(client, {
      organizationId: ORGANIZATION_ID,
      campaignId: CAMPAIGN_ID,
    });

    // Showing a superseded row beside its replacement would present one
    // correction as two measurements.
    expect(filters).toContainEqual({
      table: "campaign_metric_observations",
      column: "superseded_by_id",
      value: null,
    });
  });

  it("scopes the read to one campaign in one organization", async () => {
    const { client, filters } = persistence({
      campaign_metric_observations: [],
      metric_definitions: [],
      normalized_metrics: [],
    });

    await readCampaignPostPerformance(client, {
      organizationId: ORGANIZATION_ID,
      campaignId: CAMPAIGN_ID,
    });

    expect(filters).toContainEqual({
      table: "campaign_metric_observations",
      column: "organization_id",
      value: ORGANIZATION_ID,
    });
    expect(filters).toContainEqual({
      table: "campaign_metric_observations",
      column: "campaign_id",
      value: CAMPAIGN_ID,
    });
  });

  it("orders each post's readings oldest first, so a series reads as growth", async () => {
    const { client } = persistence({
      campaign_metric_observations: [
        observation({ period_start: "2026-09-15T20:00:00.000Z" }),
        observation({
          period_start: "2026-09-13T20:00:00.000Z",
          normalized_metric_id: "b6000000-0000-4000-8000-000000000402",
        }),
      ],
      metric_definitions: DEFINITIONS,
      normalized_metrics: [
        { id: "b6000000-0000-4000-8000-000000000401", value_numerator: 1840 },
        { id: "b6000000-0000-4000-8000-000000000402", value_numerator: 1200 },
      ],
    });

    const [series] = await readCampaignPostPerformance(client, {
      organizationId: ORGANIZATION_ID,
      campaignId: CAMPAIGN_ID,
    });

    expect(series?.points.map((point) => point.value)).toEqual([1200, 1840]);
  });

  it("says so when the readings cannot be read at all", async () => {
    const { client } = persistence({}, "connection lost");

    // An empty list and an unreadable one would look identical on screen, and
    // only one of them means "nothing has happened yet".
    await expect(
      readCampaignPostPerformance(client, {
        organizationId: ORGANIZATION_ID,
        campaignId: CAMPAIGN_ID,
      }),
    ).rejects.toThrow(/could not be read/i);
  });
});
