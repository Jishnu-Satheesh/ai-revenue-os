import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const { trigger } = vi.hoisted(() => ({ trigger: vi.fn(async () => ({ id: "run_test" })) }));
vi.mock("@trigger.dev/sdk", () => ({ tasks: { trigger } }));
vi.mock("@/modules/integrations/application/feature-access", () => ({
  isGovernedReportProjectionEnabled: () => true,
  isGovernedReportValidationEnabled: () => true,
}));

import {
  continueAdmittedReportPackage,
  requestReportPackageProfiling,
  requestReportPackageProjection,
  requestReportPackageValidation,
} from "@/modules/reports/application/dispatch";
import type { ReportStructureAdmission } from "@/modules/reports/application/admissions";

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
const CORRELATION = "00000000-0000-4000-8000-000000000005";
const CHANNEL = "00000000-0000-4000-8000-000000000006";
const ADMISSION = "00000000-0000-4000-8000-000000000007";

function admission(): ReportStructureAdmission {
  return {
    id: ADMISSION,
    channelId: CHANNEL,
    structureFingerprint: "a".repeat(64),
    reportType: "Performance",
    reportFamilyKey: null,
    contractVersionId: CONTRACT,
    projectionVersionId: PROJECTION,
    grantedBy: "00000000-0000-4000-8000-000000000008",
    grantedAt: "2026-09-02T00:00:00.000Z",
  };
}

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

describe("continuing a package once it is admitted", () => {
  it("starts validation itself when the structure is already admitted", async () => {
    const dispatched: string[] = [];
    const outcome = await continueAdmittedReportPackage(
      { organizationId: ORGANIZATION, packageId: PACKAGE, correlationId: CORRELATION },
      {
        findAdmissionForPackage: async () => admission(),
        requestValidation: async (input) => {
          dispatched.push(input.contractVersionId);
          return true;
        },
      },
    );
    expect(outcome).toBe("admitted");
    expect(dispatched).toEqual([admission().contractVersionId]);
  });

  it("waits for a person when the structure has never been admitted here", async () => {
    const dispatched: string[] = [];
    const outcome = await continueAdmittedReportPackage(
      { organizationId: ORGANIZATION, packageId: PACKAGE, correlationId: CORRELATION },
      {
        findAdmissionForPackage: async () => null,
        requestValidation: async () => {
          dispatched.push("should not happen");
          return true;
        },
      },
    );
    expect(outcome).toBe("awaiting_approval");
    expect(dispatched).toEqual([]);
  });

  it("still reports the structure admitted even when the validation dispatch itself fails", async () => {
    // Whether the dispatch lands is requestValidation's own concern -- it
    // already logs the failure. "admitted" answers a different question
    // (was this structure recognised), so a transport failure here must not
    // be confused with "nobody has admitted this yet", which would send the
    // package back to a human for a decision that was already made.
    const outcome = await continueAdmittedReportPackage(
      { organizationId: ORGANIZATION, packageId: PACKAGE, correlationId: CORRELATION },
      {
        findAdmissionForPackage: async () => admission(),
        requestValidation: async () => false,
      },
    );
    expect(outcome).toBe("admitted");
  });

  it("looks up the admission by organization and package, not by anything else", async () => {
    const seen: Array<{ organizationId: string; packageId: string }> = [];
    await continueAdmittedReportPackage(
      { organizationId: ORGANIZATION, packageId: PACKAGE, correlationId: CORRELATION },
      {
        findAdmissionForPackage: async (input) => {
          seen.push(input);
          return null;
        },
        requestValidation: async () => true,
      },
    );
    expect(seen).toEqual([{ organizationId: ORGANIZATION, packageId: PACKAGE }]);
  });
});
