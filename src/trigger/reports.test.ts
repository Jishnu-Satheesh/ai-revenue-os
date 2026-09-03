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

import { advanceReportPackageOnAdmission, advanceReportPackageToProjection } from "@/trigger/reports";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type FakeSupabaseClient = Partial<SupabaseClient<Database>> & {
  rpc: ReturnType<typeof vi.fn>;
};

describe("Report Package Trigger abort on refusal", () => {
  it("imports AbortTaskRunError from the Trigger SDK", async () => {
    const source = await readFile(resolve(process.cwd(), "src/trigger/reports.ts"), "utf8");
    expect(source).toMatch(/import\s*{\s*AbortTaskRunError\s*,\s*logger\s*,\s*schemaTask\s*}\s*from\s*"@trigger\.dev\/sdk"/);
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
    const profileAbort = profileBlock.indexOf('throw new AbortTaskRunError(`report-package refused');
    expect(profileAbortsInBlock).toHaveLength(1);
    expect(profileLogger).toBeGreaterThan(0);
    expect(profileAbort).toBeGreaterThan(profileLogger);

    // Validation task: from export const to next export const
    const validationStart = source.indexOf("export const reportPackageValidationTask");
    const validationEnd = source.indexOf("export const reportPackageProjectionTask");
    const validationBlock = source.slice(validationStart, validationEnd);
    const validationAbortsInBlock = validationBlock.match(/throw new AbortTaskRunError\(/g);
    const validationLogger = validationBlock.indexOf('logger.info("report_package.validation_completed"');
    const validationAbort = validationBlock.indexOf('throw new AbortTaskRunError(`report-package refused');
    expect(validationAbortsInBlock).toHaveLength(1);
    expect(validationLogger).toBeGreaterThan(0);
    expect(validationAbort).toBeGreaterThan(validationLogger);

    // Projection task: from export const to end of file
    const projectionStart = source.indexOf("export const reportPackageProjectionTask");
    const projectionBlock = source.slice(projectionStart);
    const projectionAbortsInBlock = projectionBlock.match(/throw new AbortTaskRunError\(/g);
    const projectionLogger = projectionBlock.indexOf('logger.info("report_package.projection_completed"');
    const projectionAbort = projectionBlock.indexOf('throw new AbortTaskRunError(`report-package refused');
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

  it("degrades network error to not_admitted without escaping", async () => {
    const fakeSupabase = {
      rpc: vi.fn().mockRejectedValue(new Error("Network timeout")),
    } as FakeSupabaseClient;

    await expect(
      advanceReportPackageOnAdmission(fakeSupabase, {
        organizationId: ORG_ID,
        packageId: PACKAGE_ID,
        correlationId: CORRELATION_ID,
      }),
    ).resolves.toEqual({ outcome: "not_admitted" });
  });

  it("handles semantic RPC error by returning not_admitted", async () => {
    const fakeSupabase = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "no admission matches" },
      }),
    } as FakeSupabaseClient;

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
    } as FakeSupabaseClient;

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

  it("degrades network error to not_ready without escaping", async () => {
    const fakeSupabase = {
      rpc: vi.fn().mockRejectedValue(new Error("Network timeout")),
    } as FakeSupabaseClient;

    await expect(
      advanceReportPackageToProjection(fakeSupabase, {
        organizationId: ORG_ID,
        packageId: PACKAGE_ID,
        correlationId: CORRELATION_ID,
      }),
    ).resolves.toEqual({ outcome: "not_ready" });
  });

  it("handles semantic RPC error by returning not_ready", async () => {
    const fakeSupabase = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: "NOT_READY" },
      }),
    } as FakeSupabaseClient;

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
    } as FakeSupabaseClient;

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
