import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/modules/reports/application/dispatch", () => ({
  requestReportPackageValidation: vi.fn(),
  requestReportPackageProjection: vi.fn(),
}));

import {
  readAgentReportContinuation,
  readAgentReportContinuationWithPorts,
  type AgentReportContinuationPorts,
} from "./report-intake-continuation";

const input = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  turnId: "22222222-2222-4222-8222-222222222222",
  attachmentId: "33333333-3333-4333-8333-333333333333",
  leaseToken: "44444444-4444-4444-8444-444444444444",
};
const scope = {
  channelId: "55555555-5555-4555-8555-555555555555",
  branchId: "66666666-6666-4666-8666-666666666666",
  reportType: "performance_daily",
  periodStart: "2026-10-01",
  periodEnd: "2026-10-30",
  currency: "AED",
};
const packageId = "77777777-7777-4777-8777-777777777777";
const contractVersionId = "88888888-8888-4888-8888-888888888888";
const projectionVersionId = "99999999-9999-4999-8999-999999999999";

function ports(
  status: string,
  overrides: Partial<AgentReportContinuationPorts> = {},
): AgentReportContinuationPorts {
  return {
    load: async () => ({
      packageId,
      scope,
      status: status as never,
      hasCurrentEvidence: false,
      partial: false,
    }),
    advanceOnAdmission: async () => ({ outcome: "not_admitted" }),
    queueValidation: async () => true,
    requestProjection: async () => ({ outcome: "approval_required" }),
    queueProjection: async () => true,
    ...overrides,
  };
}

describe("agent waits for the governed report lifecycle", () => {
  it("checks large report lineage in bounded requests that fit the database gateway", async () => {
    const batches: number[] = [];
    const tables: Record<string, unknown[]> = {
      agent_attachments: [{ package_id: packageId, declared_scope: scope, status: "promoted" }],
      integration_report_packages: [
        {
          id: packageId,
          channel_id: scope.channelId,
          branch_id: scope.branchId,
          report_type: scope.reportType,
          declared_period_start: scope.periodStart,
          declared_period_end: scope.periodEnd,
          declared_currency: scope.currency,
          status: "projected",
        },
      ],
      integration_report_projection_runs: [
        { id: "projection", completed_at: "2026-10-04T00:00:00Z", output_count: 450 },
      ],
      report_projection_lineage: Array.from({ length: 450 }, (_, i) => ({
        normalized_metric_id: `metric-${i}`,
        exact_range_metric_observation_id: null,
      })),
    };
    const client = {
      rpc: async () => ({ data: {}, error: null }),
      from: (table: string) => {
        let ids: string[] = [];
        const result = () =>
          table === "normalized_metrics"
            ? {
                data: ids.includes("metric-449") ? [{ id: "metric-449" }] : [],
                error: ids.length > 100 ? { code: "REQUEST_TOO_LARGE" } : null,
              }
            : { data: tables[table] ?? [], error: null };
        const builder = {
          select: () => builder,
          eq: () => builder,
          is: () => builder,
          order: () => builder,
          limit: () => builder,
          in: (key: string, values: string[]) => {
            if (key === "id") {
              ids = values;
              batches.push(values.length);
            }
            return builder;
          },
          single: async () => ({ data: tables[table]?.[0], error: null }),
          maybeSingle: async () => ({ data: tables[table]?.[0], error: null }),
          then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
        };
        return builder;
      },
    };
    expect(
      await readAgentReportContinuation({ ...input, supabase: client as never }),
    ).toMatchObject({ kind: "ready", hasCurrentEvidence: true });
    expect(batches).toEqual([100, 100, 100, 100, 50]);
  });
  it("keeps profiling in progress instead of returning a completed business answer", async () => {
    expect(await readAgentReportContinuationWithPorts(input, ports("profiling"))).toMatchObject({
      kind: "processing",
      status: "profiling",
      packageId,
      scope,
    });
  });

  it("preserves first-time financial mapping as an explicit source approval gate", async () => {
    const queueValidation = vi.fn(async () => true);
    const result = await readAgentReportContinuationWithPorts(
      input,
      ports("awaiting_contract", { queueValidation }),
    );
    expect(result).toMatchObject({
      kind: "awaiting_approval",
      approvalKind: "report_contract",
      status: "awaiting_contract",
    });
    expect(queueValidation).not.toHaveBeenCalled();
  });

  it("advances a recognized approved standing admission through the source service", async () => {
    const queueValidation = vi.fn(async () => true);
    const result = await readAgentReportContinuationWithPorts(
      input,
      ports("awaiting_contract", {
        advanceOnAdmission: async () => ({ outcome: "admitted", contractVersionId }),
        queueValidation,
      }),
    );
    expect(result).toMatchObject({ kind: "processing", status: "awaiting_validation" });
    expect(queueValidation).toHaveBeenCalledWith(
      expect.objectContaining({ packageId, contractVersionId }),
    );
  });

  it("continues a per-upload human-approved projection without granting admission", async () => {
    const queueProjection = vi.fn(async () => true);
    const result = await readAgentReportContinuationWithPorts(
      input,
      ports("validated", {
        requestProjection: async () => ({
          outcome: "requested",
          contractVersionId,
          projectionVersionId,
        }),
        queueProjection,
      }),
    );
    expect(result).toMatchObject({ kind: "processing", status: "awaiting_projection" });
    expect(queueProjection).toHaveBeenCalledWith(expect.objectContaining({ projectionVersionId }));
  });

  it("waits for projection approval when the owning module has no approved binding", async () => {
    expect(await readAgentReportContinuationWithPorts(input, ports("validated"))).toMatchObject({
      kind: "awaiting_approval",
      approvalKind: "report_projection",
    });
  });

  it("marks changed overlapping values as a correction gate", async () => {
    expect(
      await readAgentReportContinuationWithPorts(input, ports("reconciliation_required")),
    ).toMatchObject({ kind: "awaiting_approval", approvalKind: "report_correction" });
  });

  it("requires current projected evidence before final channel analysis", async () => {
    expect(await readAgentReportContinuationWithPorts(input, ports("projected"))).toMatchObject({
      kind: "blocked",
      reason: "NO_CURRENT_REPORT_EVIDENCE",
    });
    const ready = await readAgentReportContinuationWithPorts(
      input,
      ports("partially_projected", {
        load: async () => ({
          packageId,
          scope,
          status: "partially_projected",
          hasCurrentEvidence: true,
          partial: true,
        }),
      }),
    );
    expect(ready).toMatchObject({ kind: "ready", scope, partial: true });
    expect(ready.reportHref).toBe(
      `/organizations/${input.organizationId}/integrations?tab=data-sources&package=${packageId}`,
    );
  });

  it("reports source failures without presenting them as missing data", async () => {
    expect(
      await readAgentReportContinuationWithPorts(input, ports("validation_failed")),
    ).toMatchObject({ kind: "blocked", reason: "REPORT_VALIDATION_FAILED" });
  });
});
