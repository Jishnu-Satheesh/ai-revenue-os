import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@trigger.dev/sdk", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  schemaTask: vi.fn((config) => config),
}));
vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-key",
  },
}));

// Finding 5's own fixtures: the projection task reads `status`, `channel_id`,
// `branch_id`, `declared_period_start`, `declared_period_end` off the
// completion RPC's jsonb through `unknown`-typed fields (see
// ProjectionCompletionSummary in auto-analysis.ts). Nothing before this test
// drove the task itself with those real column names -- auto-analysis.test.ts
// only exercises the selector against an already-typed, hand-built object, so
// a rename in reports.ts's field reads would compile clean and fail silently
// in production. These mocks let the test drive `reportPackageProjectionTask`
// end to end while stubbing only the RPC layer and the two collaborators that
// would otherwise need a live database and a live Trigger.dev dispatch.
const rpcMock = vi.hoisted(() => vi.fn());
const fromMock = vi.hoisted(() => vi.fn());
const runReportPackageProjectionMock = vi.hoisted(() => vi.fn());
const requestChannelAnalysisMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/service", () => ({
  createReportWorkerServiceClient: () => ({ rpc: rpcMock, from: fromMock }),
}));
vi.mock("@/workflows/reports/project-report-package", () => ({
  runReportPackageProjection: runReportPackageProjectionMock,
}));
vi.mock("@/modules/analysis/application/dispatch", () => ({
  requestChannelAnalysis: requestChannelAnalysisMock,
}));

import {
  advanceReportPackageOnAdmission,
  advanceReportPackageToProjection,
  reportPackageProjectionTask,
} from "@/trigger/reports";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

describe("Report Package Trigger abort on refusal", () => {
  it("imports AbortTaskRunError from the Trigger SDK", async () => {
    const source = await readFile(resolve(process.cwd(), "src/trigger/reports.ts"), "utf8");
    expect(source).toMatch(
      /import\s*{\s*AbortTaskRunError\s*,\s*logger\s*,\s*schemaTask\s*}\s*from\s*"@trigger\.dev\/sdk"/,
    );
  });

  it("aborts exactly three report tasks without retrying when a projection is refused", async () => {
    const source = await readFile(resolve(process.cwd(), "src/trigger/reports.ts"), "utf8");
    // Three runs reported Completed to a live operator while their output said
    // failed. Retrying an unparseable date three times helps nobody, so the
    // refusal must fail loudly and once.
    expect(source.match(/throw new AbortTaskRunError\(/g)).toHaveLength(3);
  });

  it("places exactly one abort after the logger.info call in each task", async () => {
    const source = await readFile(resolve(process.cwd(), "src/trigger/reports.ts"), "utf8");

    // Scope assertions to each task's function block to prevent global ordering
    // from masking missing guards in individual tasks.

    // Profile task: from export const to next export const
    const profileStart = source.indexOf("export const reportPackageProfilingTask");
    const profileEnd = source.indexOf("export const reportPackageValidationTask");
    const profileBlock = source.slice(profileStart, profileEnd);
    const profileAbortsInBlock = profileBlock.match(/throw new AbortTaskRunError\(/g);
    const profileLogger = profileBlock.indexOf('logger.info("report_package.profile_completed"');
    const profileAbort = profileBlock.indexOf(
      "throw new AbortTaskRunError(`report-package refused",
    );
    expect(profileAbortsInBlock).toHaveLength(1);
    expect(profileLogger).toBeGreaterThan(0);
    expect(profileAbort).toBeGreaterThan(profileLogger);

    // Validation task: from export const to next export const
    const validationStart = source.indexOf("export const reportPackageValidationTask");
    const validationEnd = source.indexOf("export const reportPackageProjectionTask");
    const validationBlock = source.slice(validationStart, validationEnd);
    const validationAbortsInBlock = validationBlock.match(/throw new AbortTaskRunError\(/g);
    const validationLogger = validationBlock.indexOf(
      'logger.info("report_package.validation_completed"',
    );
    const validationAbort = validationBlock.indexOf(
      "throw new AbortTaskRunError(`report-package refused",
    );
    expect(validationAbortsInBlock).toHaveLength(1);
    expect(validationLogger).toBeGreaterThan(0);
    expect(validationAbort).toBeGreaterThan(validationLogger);

    // Projection task: from export const to end of file
    const projectionStart = source.indexOf("export const reportPackageProjectionTask");
    const projectionBlock = source.slice(projectionStart);
    const projectionAbortsInBlock = projectionBlock.match(/throw new AbortTaskRunError\(/g);
    const projectionLogger = projectionBlock.indexOf(
      'logger.info("report_package.projection_completed"',
    );
    const projectionAbort = projectionBlock.indexOf(
      "throw new AbortTaskRunError(`report-package refused",
    );
    expect(projectionAbortsInBlock).toHaveLength(1);
    expect(projectionLogger).toBeGreaterThan(0);
    expect(projectionAbort).toBeGreaterThan(projectionLogger);
  });
});

describe("Link A (advanceReportPackageOnAdmission) error handling", () => {
  const ORG_ID = "11111111-1111-4111-8111-111111111111";
  const PACKAGE_ID = "22222222-2222-4222-8222-222222222222";
  const CORRELATION_ID = "33333333-3333-4333-8333-333333333333";
  const CONTRACT_VERSION_ID = "44444444-4444-4444-8444-444444444444";

  it("degrades network error to not_admitted and logs warning", async () => {
    const { logger } = await import("@trigger.dev/sdk");
    vi.clearAllMocks();

    const fakeSupabase = {
      rpc: vi.fn().mockRejectedValue(new Error("Network timeout")),
    } as unknown as SupabaseClient<Database>;

    await expect(
      advanceReportPackageOnAdmission(fakeSupabase, {
        organizationId: ORG_ID,
        packageId: PACKAGE_ID,
        correlationId: CORRELATION_ID,
      }),
    ).resolves.toEqual({ outcome: "not_admitted" });

    expect(logger.warn).toHaveBeenCalledWith(
      "report_package.admission_advance_failed",
      expect.any(Object),
    );
  });

  it("handles semantic RPC error by returning not_admitted", async () => {
    const fakeSupabase = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "no admission matches" },
      }),
    } as unknown as SupabaseClient<Database>;

    await expect(
      advanceReportPackageOnAdmission(fakeSupabase, {
        organizationId: ORG_ID,
        packageId: PACKAGE_ID,
        correlationId: CORRELATION_ID,
      }),
    ).resolves.toEqual({ outcome: "not_admitted" });
  });

  it("returns admitted with contractVersionId on success", async () => {
    const fakeSupabase = {
      rpc: vi.fn().mockResolvedValue({
        data: {
          outcome: "admitted",
          reportContractVersionId: CONTRACT_VERSION_ID,
        },
        error: null,
      }),
    } as unknown as SupabaseClient<Database>;

    await expect(
      advanceReportPackageOnAdmission(fakeSupabase, {
        organizationId: ORG_ID,
        packageId: PACKAGE_ID,
        correlationId: CORRELATION_ID,
      }),
    ).resolves.toEqual({
      outcome: "admitted",
      contractVersionId: CONTRACT_VERSION_ID,
    });
  });
});

describe("Link B (advanceReportPackageToProjection) error handling", () => {
  const ORG_ID = "11111111-1111-4111-8111-111111111111";
  const PACKAGE_ID = "22222222-2222-4222-8222-222222222222";
  const CORRELATION_ID = "33333333-3333-4333-8333-333333333333";
  const CONTRACT_VERSION_ID = "44444444-4444-4444-8444-444444444444";
  const PROJECTION_VERSION_ID = "55555555-5555-4555-8555-555555555555";

  it("degrades network error to not_ready and logs warning", async () => {
    const { logger } = await import("@trigger.dev/sdk");
    vi.clearAllMocks();

    const fakeSupabase = {
      rpc: vi.fn().mockRejectedValue(new Error("Network timeout")),
    } as unknown as SupabaseClient<Database>;

    await expect(
      advanceReportPackageToProjection(fakeSupabase, {
        organizationId: ORG_ID,
        packageId: PACKAGE_ID,
        correlationId: CORRELATION_ID,
      }),
    ).resolves.toEqual({ outcome: "not_ready" });

    expect(logger.warn).toHaveBeenCalledWith(
      "report_package.projection_advance_failed",
      expect.any(Object),
    );
  });

  it("handles semantic RPC error by returning not_ready", async () => {
    const fakeSupabase = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: "NOT_READY" },
      }),
    } as unknown as SupabaseClient<Database>;

    await expect(
      advanceReportPackageToProjection(fakeSupabase, {
        organizationId: ORG_ID,
        packageId: PACKAGE_ID,
        correlationId: CORRELATION_ID,
      }),
    ).resolves.toEqual({ outcome: "not_ready" });
  });

  it("returns requested with version IDs on success", async () => {
    const fakeSupabase = {
      rpc: vi.fn().mockResolvedValue({
        data: {
          outcome: "requested",
          reportContractVersionId: CONTRACT_VERSION_ID,
          reportProjectionVersionId: PROJECTION_VERSION_ID,
        },
        error: null,
      }),
    } as unknown as SupabaseClient<Database>;

    await expect(
      advanceReportPackageToProjection(fakeSupabase, {
        organizationId: ORG_ID,
        packageId: PACKAGE_ID,
        correlationId: CORRELATION_ID,
      }),
    ).resolves.toEqual({
      outcome: "requested",
      contractVersionId: CONTRACT_VERSION_ID,
      projectionVersionId: PROJECTION_VERSION_ID,
    });
  });
});

describe("reportPackageProjectionTask auto-analysis dispatch wiring", () => {
  const ORG_ID = "11111111-1111-4111-8111-111111111111";
  const PACKAGE_ID = "22222222-2222-4222-8222-222222222222";
  const CONTRACT_VERSION_ID = "44444444-4444-4444-8444-444444444444";
  const PROJECTION_VERSION_ID = "55555555-5555-4555-8555-555555555555";
  const PROJECTION_RUN_ID = "66666666-6666-4666-8666-666666666666";
  const CORRELATION_ID = "33333333-3333-4333-8333-333333333333";
  const CHANNEL_ID = "77777777-7777-4777-8777-777777777777";
  const BRANCH_ID = "88888888-8888-4888-8888-888888888888";

  // Approved, valid per reportProjectionDocumentSchema -- this is what the
  // claim RPC hands back, and `claim()` in reports.ts is real code here, not
  // a mock, so it parses this document exactly as production does.
  const PROJECTION_DOCUMENT = {
    schemaVersion: 1,
    outputKind: "period_grain",
    grain: "day",
    periodKey: { normalizedSheetName: "csv", canonicalField: "business_date" },
    outputs: [
      {
        key: "revenue_gross",
        normalizedSheetName: "csv",
        canonicalField: "revenue_gross",
        metricKey: "revenue.gross",
        valueKind: "money",
        aggregation: "sum",
      },
    ],
  };

  type ProjectionTaskRunner = {
    run: (payload: {
      organizationId: string;
      packageId: string;
      contractVersionId: string;
      projectionVersionId: string;
      projectionRunId: string;
      correlationId: string;
      idempotencyKey: string;
    }) => Promise<{ outcome: string; absentRowCount?: number }>;
  };

  it("reads the completion RPC's real column names into the auto-analysis dispatch", async () => {
    vi.clearAllMocks();

    // Only the two RPC names this run actually calls are wired -- claim (to
    // set the grain, exactly as reports.ts does) and complete (whose payload
    // uses the real report_packages column names: status, channel_id,
    // branch_id, declared_period_start, declared_period_end,
    // period_timezone). Anything else is a test bug, not a case to swallow.
    //
    // `period_timezone` is not optional here. The auto-analysis selector
    // refuses to dispatch without it, deliberately: a run whose window carries
    // no calendar would be analysed against the server's zone rather than the
    // branch's, and every date would be quietly shifted. The real RPC returns
    // `to_jsonb(package_row)`, so the column is always present -- a fixture
    // that omits it is describing a row the database cannot produce.
    rpcMock.mockImplementation(async (name: string) => {
      if (name === "claim_governed_report_package_projection") {
        return {
          data: {
            outcome: "acquired",
            reportPackage: { storage_path: "irrelevant-for-this-test" },
            contractVersion: { mapping_document: {} },
            projectionVersion: { projection_document: PROJECTION_DOCUMENT },
          },
          error: null,
        };
      }
      if (name === "complete_governed_report_package_projection") {
        return {
          data: {
            status: "projected",
            channel_id: CHANNEL_ID,
            branch_id: BRANCH_ID,
            declared_period_start: "2026-03-01",
            declared_period_end: "2026-03-31",
            period_timezone: "Asia/Dubai",
          },
          error: null,
        };
      }
      throw new Error(`unexpected rpc call in test: ${name}`);
    });
    fromMock.mockReturnValue({
      select: () => ({
        in: () => ({
          eq: () => ({
            or: () =>
              Promise.resolve({
                data: [{ id: "metric-1", key: "revenue.gross", value_kind: "money" }],
                error: null,
              }),
          }),
        }),
      }),
    });
    // Stands in for the deterministic projection engine: it invokes the same
    // `claim` and `complete` callbacks reports.ts wires up to the real RPC
    // helper, so this test exercises reports.ts's own field-picking code
    // rather than re-testing the engine (already covered elsewhere).
    runReportPackageProjectionMock.mockImplementation(
      async (
        payload: { organizationId: string; packageId: string; projectionRunId: string },
        deps: {
          claim: (input: Record<string, unknown>) => Promise<unknown>;
          complete: (input: Record<string, unknown>) => Promise<void>;
        },
      ) => {
        await deps.claim({
          organizationId: payload.organizationId,
          packageId: payload.packageId,
          contractVersionId: CONTRACT_VERSION_ID,
          projectionVersionId: PROJECTION_VERSION_ID,
          projectionRunId: payload.projectionRunId,
          idempotencyKey: "test-idempotency-key-00001",
          claimToken: "claim-token",
          correlationId: CORRELATION_ID,
        });
        await deps.complete({
          organizationId: payload.organizationId,
          packageId: payload.packageId,
          projectionRunId: payload.projectionRunId,
          claimToken: "claim-token",
          resultDigest: "a".repeat(64),
          result: {
            status: "projected",
            qualityState: "complete",
            completenessState: "complete",
            errorCodes: [],
            warningCodes: [],
          },
          outputs: [],
        });
        return { outcome: "projected", absentRowCount: 0 };
      },
    );
    requestChannelAnalysisMock.mockResolvedValue(true);

    await (reportPackageProjectionTask as unknown as ProjectionTaskRunner).run({
      organizationId: ORG_ID,
      packageId: PACKAGE_ID,
      contractVersionId: CONTRACT_VERSION_ID,
      projectionVersionId: PROJECTION_VERSION_ID,
      projectionRunId: PROJECTION_RUN_ID,
      correlationId: CORRELATION_ID,
      idempotencyKey: "test-idempotency-key-00001",
    });

    expect(requestChannelAnalysisMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG_ID,
        channelId: CHANNEL_ID,
        branchId: BRANCH_ID,
        windowStart: "2026-03-01",
        windowEnd: "2026-03-31",
        periodGrain: "day",
        correlationId: CORRELATION_ID,
      }),
    );
  });
});
