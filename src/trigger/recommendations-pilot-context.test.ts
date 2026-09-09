import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { BRANCH, CHANNEL, ORGANIZATION } from "@/domain/analysis/test-fixtures";
import type { Database } from "@/lib/supabase/database.types";
import type { NarrationPromptFinding } from "@/workflows/analysis/recommendation-prompt";
import { loadRecommendationPilotContext } from "./recommendation-pilot-context";

const RUN = "00000000-0000-4000-8000-0000000000c1";
const FOREIGN_CHANNEL = "00000000-0000-4000-8000-000000000099";

type RecordedQuery = { table: string; columns: string; filters: [string, string][] };

/**
 * Minimal postgrest-shaped stub: records every query's table, selected
 * columns, and equality filters, then filters in-memory rows. The cast at the
 * boundary is the whole point — production passes the real service client.
 */
function fakeClient(options: {
  rows: Record<string, Record<string, unknown>[]>;
  errorTables?: Record<string, string>;
}) {
  const queries: RecordedQuery[] = [];
  const client = {
    queries,
    from(table: string) {
      const filters: [string, string][] = [];
      let columns = "";
      const query = {
        select(selected: string) {
          columns = selected;
          return query;
        },
        eq(column: string, value: string) {
          filters.push([column, value]);
          return query;
        },
        async maybeSingle() {
          queries.push({ table, columns, filters: [...filters] });
          if (options.errorTables?.[table] !== undefined) {
            return { data: null, error: { code: options.errorTables[table] } };
          }
          const found =
            (options.rows[table] ?? []).find((row) =>
              filters.every(([column, value]) => row[column] === value),
            ) ?? null;
          return { data: found, error: null };
        },
      };
      return query;
    },
  };
  return client;
}

type FakeClient = ReturnType<typeof fakeClient>;

function asSupabase(fake: FakeClient): SupabaseClient<Database> {
  return fake as unknown as SupabaseClient<Database>;
}

function storedRows(): Record<string, Record<string, unknown>[]> {
  return {
    channel_analysis_runs: [{ id: RUN, organization_id: ORGANIZATION, channel_id: CHANNEL, branch_id: BRANCH }],
    organization_channels: [
      {
        id: CHANNEL,
        organization_id: ORGANIZATION,
        key: "talabat",
        display_name: "Talabat",
        category: "marketplace",
        template_key: "talabat_v1",
      },
    ],
    organizations: [
      {
        id: ORGANIZATION,
        name: "ACME Restaurants",
        industry: "restaurant",
        country_code: "AE",
        base_currency: "AED",
        default_timezone: "Asia/Dubai",
      },
    ],
    branches: [
      {
        id: BRANCH,
        organization_id: ORGANIZATION,
        name: "Marina",
        timezone: "Asia/Dubai",
        // PII-adjacent blobs the loader must never select nor return.
        service_area: { zone: "Marina" },
        operating_hours: { fri: "closed" },
        contact_details: { phone: "+971500000000" },
        capacity_metadata: { seats: 40 },
      },
    ],
  };
}

function cancellationFinding(overrides: Partial<NarrationPromptFinding> = {}): NarrationPromptFinding {
  return {
    id: "00000000-0000-4000-8000-000000000101",
    detectorKey: "orders.cancellation_loss",
    kind: "finding",
    code: "ORDERS_AVOIDABLE_CANCELLATION_LOSS",
    headline: "Avoidable cancellations cost money",
    detail: null,
    valueSummary: null,
    limitations: [],
    ...overrides,
  };
}

const BANNED_COLUMNS = ["service_area", "operating_hours", "contact_details", "capacity_metadata"];

describe("loadRecommendationPilotContext", () => {
  it("loads stored channel context and nothing else", async () => {
    const fake = fakeClient({ rows: storedRows() });

    const result = await loadRecommendationPilotContext(asSupabase(fake), {
      organizationId: ORGANIZATION,
      analysisRunId: RUN,
      findings: [
        cancellationFinding({
          code: "ORDERS_CLOSED_CANCELLATION_LOSS",
          headline: "Orders lost while the store showed CLOSED",
        }),
      ],
    });

    expect(result).toEqual({
      channelContext: {
        organizationName: "ACME Restaurants",
        industry: "restaurant",
        countryCode: "AE",
        baseCurrency: "AED",
        organizationTimezone: "Asia/Dubai",
        channelKey: "talabat",
        channelDisplayName: "Talabat",
        channelCategory: "marketplace",
        templateKey: "talabat_v1",
        branchName: "Marina",
        branchTimezone: "Asia/Dubai",
      },
    });
    // PII never reaches the context object even though the branch row carries it.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("+971");
    for (const banned of BANNED_COLUMNS) {
      expect(serialized).not.toContain(banned);
    }
    // And no query ever asked for those columns.
    for (const query of fake.queries) {
      for (const banned of BANNED_COLUMNS) {
        expect(query.columns).not.toContain(banned);
      }
    }
    // Every read stays inside the tenant: the channel lookup carries the
    // organization scope, which is what makes a foreign id miss.
    const channelQuery = fake.queries.find((query) => query.table === "organization_channels");
    expect(channelQuery?.filters).toContainEqual(["organization_id", ORGANIZATION]);
  });

  it("resolves a foreign-tenant channel id to null context (tenant isolation)", async () => {
    const rows = storedRows();
    rows.channel_analysis_runs = [{ id: RUN, organization_id: ORGANIZATION, channel_id: FOREIGN_CHANNEL, branch_id: null }];
    const fake = fakeClient({ rows });

    const result = await loadRecommendationPilotContext(asSupabase(fake), {
      organizationId: ORGANIZATION,
      analysisRunId: RUN,
      findings: [cancellationFinding()],
    });

    expect(result).toEqual({ channelContext: null });
  });

  it("returns null context without touching the channel table when the run has no channel", async () => {
    const rows = storedRows();
    rows.channel_analysis_runs = [{ id: RUN, organization_id: ORGANIZATION, channel_id: null, branch_id: null }];
    const fake = fakeClient({ rows });

    const result = await loadRecommendationPilotContext(asSupabase(fake), {
      organizationId: ORGANIZATION,
      analysisRunId: RUN,
      findings: [cancellationFinding()],
    });

    expect(result).toEqual({ channelContext: null });
    expect(fake.queries.map((query) => query.table)).not.toContain("organization_channels");
  });

  it("leaves branch fields null and skips the branch read when the run has no branch", async () => {
    const rows = storedRows();
    rows.channel_analysis_runs = [{ id: RUN, organization_id: ORGANIZATION, channel_id: CHANNEL, branch_id: null }];
    const fake = fakeClient({ rows });

    const result = await loadRecommendationPilotContext(asSupabase(fake), {
      organizationId: ORGANIZATION,
      analysisRunId: RUN,
      findings: [cancellationFinding()],
    });

    expect(result.channelContext?.branchName).toBeNull();
    expect(result.channelContext?.branchTimezone).toBeNull();
    expect(fake.queries.map((query) => query.table)).not.toContain("branches");
  });

  it("propagates a run-row database error so the workflow can fail open", async () => {
    const fake = fakeClient({ rows: {}, errorTables: { channel_analysis_runs: "XX000" } });

    await expect(
      loadRecommendationPilotContext(asSupabase(fake), {
        organizationId: ORGANIZATION,
        analysisRunId: RUN,
        findings: [cancellationFinding()],
      }),
    ).rejects.toThrow("Channel recommendation context load failed");
  });
});
