import { describe, expect, it } from "vitest";

import {
  createCampaignCycleReader,
  createDueActionReader,
  createExposureRecorder,
  createMetricsGrantReader,
  createMetricSubjectReader,
  type CampaignExecutionPersistence,
} from "@/modules/campaigns/infrastructure/execution-readers";

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const CAMPAIGN_A = "c0000000-0000-4000-8000-00000000000a";
const CAMPAIGN_B = "c0000000-0000-4000-8000-00000000000b";

type Row = Record<string, unknown>;

function persistence(options: {
  tables?: Record<string, Row[]>;
  rpc?: unknown;
  rpcError?: string;
  tableError?: string;
}) {
  const filters: { table: string; column: string; value: unknown }[] = [];
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];

  const client: CampaignExecutionPersistence = {
    from(table) {
      const result = options.tableError
        ? { data: null, error: { message: options.tableError } }
        : { data: options.tables?.[table] ?? [], error: null };
      const chain = {
        eq(column: string, value: string) {
          filters.push({ table, column, value });
          return chain;
        },
        is(column: string, value: null) {
          filters.push({ table, column, value });
          return chain;
        },
        lte(column: string, value: string) {
          filters.push({ table, column, value });
          return chain;
        },
        limit() {
          return chain;
        },
        then(resolve: (value: typeof result) => unknown) {
          return Promise.resolve(result).then(resolve);
        },
      };
      return { select: () => chain } as unknown as ReturnType<CampaignExecutionPersistence["from"]>;
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      return options.rpcError
        ? { data: null, error: { message: options.rpcError } }
        : { data: options.rpc ?? [], error: null };
    },
  };

  return { client, filters, rpcCalls };
}

describe("createDueActionReader", () => {
  it("reads the sweep the database offers", async () => {
    const { client, rpcCalls } = persistence({
      rpc: [
        {
          organization_id: ORGANIZATION_ID,
          campaign_id: CAMPAIGN_A,
          bundle_version_id: "d0000000-0000-4000-8000-000000000001",
          action_run_id: "e0000000-0000-4000-8000-000000000001",
          action_key: "a0000000-0000-4000-8000-000000000001",
          scheduled_for: "2026-09-06T09:00:00.000Z",
        },
      ],
    });

    const due = await createDueActionReader(client).listDue(25);

    expect(rpcCalls[0]).toEqual({
      name: "list_due_campaign_action_runs",
      args: { input_limit: 25 },
    });
    expect(due).toEqual([
      {
        organizationId: ORGANIZATION_ID,
        campaignId: CAMPAIGN_A,
        bundleVersionId: "d0000000-0000-4000-8000-000000000001",
        actionRunId: "e0000000-0000-4000-8000-000000000001",
        actionKey: "a0000000-0000-4000-8000-000000000001",
        scheduledFor: "2026-09-06T09:00:00.000Z",
      },
    ]);
  });

  it("fails loudly rather than sweeping nothing when the read breaks", async () => {
    const { client } = persistence({ rpcError: "connection lost" });

    await expect(createDueActionReader(client).listDue(10)).rejects.toThrow(/could not be read/);
  });

  /** An unreadable row is a disagreement about shape, not an empty sweep. */
  it("refuses a result it cannot read rather than returning a partial sweep", async () => {
    const { client } = persistence({ rpc: [{ organization_id: "not-a-uuid" }] });

    await expect(createDueActionReader(client).listDue(10)).rejects.toThrow(/unreadable/);
  });
});

describe("createExposureRecorder", () => {
  it("records what the provider confirmed, through the one function that can", async () => {
    const { client, rpcCalls } = persistence({ rpc: {} });

    await createExposureRecorder(client).record({
      organizationId: ORGANIZATION_ID,
      actionRunId: "e0000000-0000-4000-8000-000000000001",
      externalReference: "post-1",
      providerStatus: "published",
      publishedAt: "2026-09-06T09:00:00.000Z",
      metricsEligibleAt: "2026-09-06T10:00:00.000Z",
    });

    expect(rpcCalls[0]?.name).toBe("record_campaign_exposure");
    expect(rpcCalls[0]?.args.target_organization_id).toBe(ORGANIZATION_ID);
    expect(rpcCalls[0]?.args.input_exposure).toMatchObject({
      // Repeated inside the payload because the function compares the two
      // before it writes anything.
      organization_id: ORGANIZATION_ID,
      external_reference: "post-1",
    });
  });

  it("raises rather than losing the record of a post that exists", async () => {
    const { client } = persistence({ rpcError: "conflict" });

    await expect(
      createExposureRecorder(client).record({
        organizationId: ORGANIZATION_ID,
        actionRunId: "e0000000-0000-4000-8000-000000000001",
        externalReference: "post-1",
        providerStatus: "published",
        publishedAt: "2026-09-06T09:00:00.000Z",
        metricsEligibleAt: "2026-09-06T10:00:00.000Z",
      }),
    ).rejects.toThrow(/could not be recorded/);
  });
});

describe("createCampaignCycleReader", () => {
  const future = "2099-01-01T00:00:00.000Z";
  const past = "2020-01-01T00:00:00.000Z";

  function reader(tables: Record<string, Row[]>) {
    const { client, filters } = persistence({ tables });
    return { reader: createCampaignCycleReader(client), filters };
  }

  it("scopes every read to the organization", async () => {
    const { reader: cycle, filters } = reader({ campaign_exposures: [] });

    await cycle.listDueCampaigns({ organizationId: ORGANIZATION_ID });

    expect(filters).toContainEqual({
      table: "campaign_exposures",
      column: "organization_id",
      value: ORGANIZATION_ID,
    });
  });

  it("counts a campaign once however many times it published", async () => {
    const { reader: cycle } = reader({
      campaign_exposures: [{ campaign_id: CAMPAIGN_A }, { campaign_id: CAMPAIGN_A }],
    });

    expect(await cycle.listDueCampaigns({ organizationId: ORGANIZATION_ID })).toEqual([CAMPAIGN_A]);
  });

  /**
   * The fast loop moves budget. Doing that under an approval that has been
   * revoked or has run out is spending under a licence nobody holds.
   */
  it("will not reallocate a campaign whose approval has lapsed", async () => {
    const { reader: cycle } = reader({
      campaign_exposures: [{ campaign_id: CAMPAIGN_A }, { campaign_id: CAMPAIGN_B }],
      campaign_approvals: [
        { campaign_id: CAMPAIGN_A, expires_at: future },
        { campaign_id: CAMPAIGN_B, expires_at: past },
      ],
    });

    expect(await cycle.listActiveCampaigns({ organizationId: ORGANIZATION_ID })).toEqual([
      CAMPAIGN_A,
    ]);
  });

  it("filters revoked approvals in the query rather than in memory", async () => {
    const { reader: cycle, filters } = reader({ campaign_approvals: [], campaign_exposures: [] });

    await cycle.listActiveCampaigns({ organizationId: ORGANIZATION_ID });

    expect(filters).toContainEqual({
      table: "campaign_approvals",
      column: "revoked_at",
      value: null,
    });
  });

  /** An approval the code cannot date is one it cannot vouch for. */
  it("does not treat a missing expiry as never expiring", async () => {
    const { reader: cycle } = reader({
      campaign_exposures: [{ campaign_id: CAMPAIGN_A }],
      campaign_approvals: [{ campaign_id: CAMPAIGN_A, expires_at: null }],
    });

    expect(await cycle.listActiveCampaigns({ organizationId: ORGANIZATION_ID })).toEqual([]);
  });

  /** Approved but never published has nothing to reallocate between. */
  it("will not reallocate a campaign that never published", async () => {
    const { reader: cycle } = reader({
      campaign_exposures: [],
      campaign_approvals: [{ campaign_id: CAMPAIGN_A, expires_at: future }],
    });

    expect(await cycle.listActiveCampaigns({ organizationId: ORGANIZATION_ID })).toEqual([]);
  });

  it("offers a lesson only for a campaign with a settled outcome", async () => {
    const { reader: cycle } = reader({ campaign_outcomes: [{ campaign_id: CAMPAIGN_B }] });

    expect(await cycle.listSettledCampaigns({ organizationId: ORGANIZATION_ID })).toEqual([
      CAMPAIGN_B,
    ]);
  });
});

describe("createMetricsGrantReader", () => {
  it("reads a granted capability as permission", async () => {
    const { client } = persistence({
      tables: {
        integration_capability_grants: [
          { capability_key: "read_meta_metrics", availability: "available" },
        ],
      },
    });

    expect(await createMetricsGrantReader(client).canRead(ORGANIZATION_ID)).toBe(true);
  });

  /** Blocked and disabled both mean "do not call the provider". */
  it("does not treat a blocked grant as permission", async () => {
    const { client } = persistence({
      tables: {
        integration_capability_grants: [
          { capability_key: "read_meta_metrics", availability: "blocked" },
        ],
      },
    });

    expect(await createMetricsGrantReader(client).canRead(ORGANIZATION_ID)).toBe(false);
  });

  it("treats an absent grant as no permission", async () => {
    const { client } = persistence({ tables: { integration_capability_grants: [] } });

    expect(await createMetricsGrantReader(client).canRead(ORGANIZATION_ID)).toBe(false);
  });

  /**
   * A read that failed is not a grant. Returning true on an error would call a
   * provider on the strength of a dropped connection.
   */
  it("refuses when the grant cannot be read at all", async () => {
    const { client } = persistence({ tableError: "connection lost" });

    expect(await createMetricsGrantReader(client).canRead(ORGANIZATION_ID)).toBe(false);
  });
});

describe("createMetricSubjectReader", () => {
  const NOW = new Date("2026-09-06T12:00:00.000Z");

  function subjectReader(tables: Record<string, Row[]>) {
    const { client, filters } = persistence({ tables });
    return { reader: createMetricSubjectReader(client, () => NOW), filters };
  }

  const exposure = {
    organization_id: ORGANIZATION_ID,
    campaign_id: CAMPAIGN_A,
    action_run_id: "e0000000-0000-4000-8000-000000000001",
    external_reference: "post-1",
    published_at: "2026-09-01T08:00:00.000Z",
  };

  const organization = { base_currency: "AED", default_timezone: "Asia/Dubai" };

  it("offers a published action as a metric subject, with the day window it covers", async () => {
    const { reader } = subjectReader({
      campaign_exposures: [exposure],
      organizations: [organization],
    });

    expect(await reader.listDue(50)).toEqual([
      {
        organizationId: ORGANIZATION_ID,
        campaignId: CAMPAIGN_A,
        subject: { kind: "campaign_action", actionRunId: exposure.action_run_id },
        channel: null,
        currency: "AED",
        timezone: "Asia/Dubai",
        providerReference: "post-1",
        since: "2026-09-01",
        until: "2026-09-06",
      },
    ]);
  });

  /**
   * Provider insights are empty in the minutes after a post, and a zero
   * recorded then reads exactly like a measured zero.
   */
  it("asks the database for only what is past its eligibility instant", async () => {
    const { reader, filters } = subjectReader({
      campaign_exposures: [],
      organizations: [organization],
    });

    await reader.listDue(50);

    expect(filters).toContainEqual({
      table: "campaign_exposures",
      column: "metrics_eligible_at",
      value: NOW.toISOString(),
    });
  });

  /** A guessed currency would turn a spend figure into a different number. */
  it("skips a subject whose organization currency cannot be read", async () => {
    const { reader } = subjectReader({ campaign_exposures: [exposure], organizations: [] });

    expect(await reader.listDue(50)).toEqual([]);
  });
});

describe("createUnavailableInsightsReader", () => {
  /** No amount of retrying connects an account. */
  it("reports an unconnected provider as a permanent failure, not a throw", async () => {
    const { createUnavailableInsightsReader } = await import(
      "@/modules/campaigns/infrastructure/execution-readers"
    );

    await expect(
      createUnavailableInsightsReader().readAdInsights(
        { metricKeys: [] } as never,
        new AbortController().signal,
      ),
    ).resolves.toEqual({
      outcome: "failed",
      failureCode: "meta.connection_absent",
      retryable: false,
    });
  });
});
