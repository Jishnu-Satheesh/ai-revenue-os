import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const { trigger } = vi.hoisted(() => ({ trigger: vi.fn(async () => ({ id: "run_test" })) }));
vi.mock("@trigger.dev/sdk", () => ({ tasks: { trigger } }));
vi.mock("@/modules/integrations/application/feature-access", () => ({
  isGovernedReportProjectionEnabled: () => true,
  isGovernedReportValidationEnabled: () => true,
}));

import {
  requestReportPackageProfiling,
  requestReportPackageProjection,
  requestReportPackageValidation,
} from "@/modules/reports/application/dispatch";

/**
 * The retry that never ran.
 *
 * Trigger de-duplicates on the idempotency key it is handed. Keying a dispatch
 * on the package and the approved version made every attempt for that package
 * carry the same string, so the second dispatch was matched against the first
 * and dropped: the caller got a handle back, the operator was told the work was
 * queued, and no task ever ran. On staging that left a package sitting at
 * `awaiting_projection` through three presses of "Retry projection".
 *
 * The database was never the problem -- a failed run with the package back at
 * `awaiting_projection` makes the claim discard the stale operation and start a
 * fresh one. Only the transport dropped the retry, and only silently.
 */

const PACKAGE = "00000000-0000-4000-8000-000000000001";
const ORGANIZATION = "00000000-0000-4000-8000-000000000002";
const CONTRACT = "00000000-0000-4000-8000-000000000003";
const PROJECTION = "00000000-0000-4000-8000-000000000004";

const argOf = (call: number, index: number): { idempotencyKey: string } =>
  (trigger.mock.calls as unknown as unknown[][])[call]?.[index] as { idempotencyKey: string };
const keyOf = (call: number): string => argOf(call, 2).idempotencyKey;
const payloadKeyOf = (call: number): string => argOf(call, 1).idempotencyKey;

beforeEach(() => {
  trigger.mockClear();
});

describe("dispatching a projection", () => {
  it("gives each attempt its own key, so a retry is not dropped as a duplicate", async () => {
    await requestReportPackageProjection({
      organizationId: ORGANIZATION,
      packageId: PACKAGE,
      contractVersionId: CONTRACT,
      projectionVersionId: PROJECTION,
      correlationId: "c1",
    });
    await requestReportPackageProjection({
      organizationId: ORGANIZATION,
      packageId: PACKAGE,
      contractVersionId: CONTRACT,
      projectionVersionId: PROJECTION,
      correlationId: "c2",
    });

    expect(trigger).toHaveBeenCalledTimes(2);
    expect(keyOf(0)).not.toBe(keyOf(1));
  });

  it("de-duplicates a redelivery of the same attempt", async () => {
    // The key still does its job: the same run dispatched twice is one run.
    const projectionRunId = "00000000-0000-4000-8000-00000000000a";
    await requestReportPackageProjection({
      organizationId: ORGANIZATION, packageId: PACKAGE, contractVersionId: CONTRACT,
      projectionVersionId: PROJECTION, correlationId: "c1", projectionRunId,
    });
    await requestReportPackageProjection({
      organizationId: ORGANIZATION, packageId: PACKAGE, contractVersionId: CONTRACT,
      projectionVersionId: PROJECTION, correlationId: "c2", projectionRunId,
    });

    expect(keyOf(0)).toBe(keyOf(1));
  });

  it("hands the worker the same key it de-duplicates on", async () => {
    // The worker passes this string to the claim as its idempotency key, so the
    // two must not drift apart.
    await requestReportPackageProjection({
      organizationId: ORGANIZATION, packageId: PACKAGE, contractVersionId: CONTRACT,
      projectionVersionId: PROJECTION, correlationId: "c1",
    });

    expect(payloadKeyOf(0)).toBe(keyOf(0));
    // The claim refuses anything shorter than sixteen characters.
    expect(keyOf(0).length).toBeGreaterThanOrEqual(16);
    expect(keyOf(0).length).toBeLessThanOrEqual(200);
  });
});

describe("dispatching a validation", () => {
  it("gives each attempt its own key, so a retry is not dropped as a duplicate", async () => {
    await requestReportPackageValidation({
      organizationId: ORGANIZATION, packageId: PACKAGE, contractVersionId: CONTRACT,
      correlationId: "c1",
    });
    await requestReportPackageValidation({
      organizationId: ORGANIZATION, packageId: PACKAGE, contractVersionId: CONTRACT,
      correlationId: "c2",
    });

    expect(trigger).toHaveBeenCalledTimes(2);
    expect(keyOf(0)).not.toBe(keyOf(1));
    expect(payloadKeyOf(0)).toBe(keyOf(0));
    expect(keyOf(0).length).toBeGreaterThanOrEqual(16);
  });

  it("de-duplicates a redelivery of the same attempt", async () => {
    const validationRunId = "00000000-0000-4000-8000-00000000000b";
    await requestReportPackageValidation({
      organizationId: ORGANIZATION, packageId: PACKAGE, contractVersionId: CONTRACT,
      correlationId: "c1", validationRunId,
    });
    await requestReportPackageValidation({
      organizationId: ORGANIZATION, packageId: PACKAGE, contractVersionId: CONTRACT,
      correlationId: "c2", validationRunId,
    });

    expect(keyOf(0)).toBe(keyOf(1));
  });
});

describe("dispatching profiling", () => {
  it("keeps the worker's key stable while giving each retry its own dispatch", async () => {
    // Profiling is the one case where the two keys must differ. Its claim
    // stores the key it first saw and refuses a different one, so what the
    // worker presents has to stay the package's key; what Trigger
    // de-duplicates on has to change, or the retry is dropped.
    await requestReportPackageProfiling({
      organizationId: ORGANIZATION, packageId: PACKAGE, correlationId: "c1",
    });
    await requestReportPackageProfiling({
      organizationId: ORGANIZATION, packageId: PACKAGE, correlationId: "c2",
      attemptKey: "report-retry:00000000-0000-4000-8000-00000000000c",
    });
    await requestReportPackageProfiling({
      organizationId: ORGANIZATION, packageId: PACKAGE, correlationId: "c3",
      attemptKey: "report-retry:00000000-0000-4000-8000-00000000000d",
    });

    expect(payloadKeyOf(0)).toBe(payloadKeyOf(1));
    expect(payloadKeyOf(1)).toBe(payloadKeyOf(2));
    expect(keyOf(0)).not.toBe(keyOf(1));
    expect(keyOf(1)).not.toBe(keyOf(2));
  });

  it("still profiles once when an upload completes twice", async () => {
    // No attempt key means the first profiling of a package, which must not
    // run twice because the upload was completed twice.
    await requestReportPackageProfiling({
      organizationId: ORGANIZATION, packageId: PACKAGE, correlationId: "c1",
    });
    await requestReportPackageProfiling({
      organizationId: ORGANIZATION, packageId: PACKAGE, correlationId: "c2",
    });

    expect(keyOf(0)).toBe(keyOf(1));
  });
});
