import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createAdmissionService, UnprofiledReportPackageError } from "@/modules/reports/application/admissions";
import type { ReportStructureAdmissionRow } from "@/modules/reports/application/ports";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ORGANIZATION_ID = "99999999-9999-4999-8999-999999999999";
const CHANNEL_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR_ID = "33333333-3333-4333-8333-333333333333";
const PACKAGE_ID = "44444444-4444-4444-8444-444444444444";
const CONTRACT_VERSION_ID = "55555555-5555-4555-8555-555555555555";
const PROJECTION_VERSION_ID = "66666666-6666-4666-8666-666666666666";
const ADMISSION_ID = "77777777-7777-4777-8777-777777777777";
const CORRELATION_ID = "88888888-8888-4888-8888-888888888888";

function admissionRow(overrides: Partial<ReportStructureAdmissionRow> = {}): ReportStructureAdmissionRow {
  return {
    id: ADMISSION_ID,
    organization_id: ORGANIZATION_ID,
    channel_id: CHANNEL_ID,
    structure_fingerprint: "a".repeat(64),
    structure_version: 1,
    declared_currency: "AED",
    outlet_grain: "branch",
    report_type: "Performance",
    report_family_key: null,
    report_contract_version_id: CONTRACT_VERSION_ID,
    report_projection_version_id: PROJECTION_VERSION_ID,
    active: true,
    granted_by: ACTOR_ID,
    granted_at: "2026-09-02T00:00:00.000Z",
    revoked_by: null,
    revoked_at: null,
    correlation_id: CORRELATION_ID,
    ...overrides,
  };
}

/**
 * A client that behaves the way a database without a WHERE clause would:
 * it hands back whatever rows it was given, no matter what `.eq()` filters
 * were chained in front of it. That is deliberate -- it is the shape needed
 * to prove the service itself refuses another organization's row, rather
 * than proving only that the mock was configured correctly.
 */
function fakeClient(options: { rows?: ReportStructureAdmissionRow[] } = {}) {
  const rows = options.rows ?? [];
  const query = {
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => ({ data: rows[0] ?? null, error: null })),
  };
  query.eq.mockReturnValue(query);
  return {
    from: vi.fn(() => ({ select: vi.fn(() => query) })),
    rpc: vi.fn(),
  };
}

describe("findActiveAdmission", () => {
  it("returns no admission when the structure was never granted", async () => {
    const service = createAdmissionService(fakeClient({ rows: [] }) as never);
    await expect(
      service.findActiveAdmission({
        organizationId: ORGANIZATION_ID,
        channelId: CHANNEL_ID,
        structureFingerprint: "a".repeat(64),
        declaredCurrency: "AED",
      }),
    ).resolves.toBeNull();
  });

  it("never returns another organization's grant", async () => {
    // The database refuses this too. Asserting it here as well means a future
    // refactor that drops the organization filter fails in unit tests rather
    // than silently relying on RLS to catch it.
    const service = createAdmissionService(
      fakeClient({ rows: [admissionRow({ organization_id: OTHER_ORGANIZATION_ID })] }) as never,
    );
    await expect(
      service.findActiveAdmission({
        organizationId: ORGANIZATION_ID,
        channelId: CHANNEL_ID,
        structureFingerprint: "a".repeat(64),
        declaredCurrency: "AED",
      }),
    ).resolves.toBeNull();
  });

  it("maps a genuine match to the public admission shape", async () => {
    const service = createAdmissionService(fakeClient({ rows: [admissionRow()] }) as never);
    await expect(
      service.findActiveAdmission({
        organizationId: ORGANIZATION_ID,
        channelId: CHANNEL_ID,
        structureFingerprint: "a".repeat(64),
        declaredCurrency: "AED",
      }),
    ).resolves.toEqual({
      id: ADMISSION_ID,
      channelId: CHANNEL_ID,
      structureFingerprint: "a".repeat(64),
      reportType: "Performance",
      reportFamilyKey: null,
      contractVersionId: CONTRACT_VERSION_ID,
      projectionVersionId: PROJECTION_VERSION_ID,
      grantedBy: ACTOR_ID,
      grantedAt: "2026-09-02T00:00:00.000Z",
    });
  });
});

describe("grantAdmission", () => {
  const grantInput = {
    organizationId: ORGANIZATION_ID,
    actorId: ACTOR_ID,
    packageId: PACKAGE_ID,
    contractVersionId: CONTRACT_VERSION_ID,
    projectionVersionId: PROJECTION_VERSION_ID,
    reportFamilyKey: null as string | null,
    correlationId: CORRELATION_ID,
  };

  beforeEach(() => vi.clearAllMocks());

  it("grants with an idempotency key derived deterministically from the package id", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: admissionRow(), error: null });
    const service = createAdmissionService({ rpc, from: vi.fn() } as never);

    const result = await service.grantAdmission(grantInput);

    expect(result.id).toBe(ADMISSION_ID);
    expect(rpc).toHaveBeenCalledTimes(1);
    const [fnName, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(fnName).toBe("grant_governed_report_structure_admission");
    expect(args).toMatchObject({
      p_organization_id: ORGANIZATION_ID,
      p_actor_id: ACTOR_ID,
      p_report_package_id: PACKAGE_ID,
      p_report_contract_version_id: CONTRACT_VERSION_ID,
      p_report_projection_version_id: PROJECTION_VERSION_ID,
      p_report_family_key: null,
      p_correlation_id: CORRELATION_ID,
    });
    expect(typeof args.p_idempotency_key).toBe("string");
    expect((args.p_idempotency_key as string).length).toBeGreaterThanOrEqual(16);

    // Calling again for the same package must reuse exactly the same key --
    // that is what makes a double-click land on the RPC's own idempotency
    // ledger instead of minting a second admission.
    await service.grantAdmission(grantInput);
    const secondArgs = rpc.mock.calls[1][1] as Record<string, unknown>;
    expect(secondArgs.p_idempotency_key).toBe(args.p_idempotency_key);
  });

  it("translates the unprofiled-package check into a distinguishable, catchable error", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "23514", message: "report package has no recorded structure fingerprint" },
    });
    const service = createAdmissionService({ rpc, from: vi.fn() } as never);

    await expect(service.grantAdmission(grantInput)).rejects.toBeInstanceOf(
      UnprofiledReportPackageError,
    );
  });

  it("surfaces any other grant failure honestly instead of swallowing it", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "23514", message: "report contract version is not an approved proposal for this package" },
    });
    const service = createAdmissionService({ rpc, from: vi.fn() } as never);

    const failure = service.grantAdmission(grantInput);
    await expect(failure).rejects.toThrow();
    await expect(failure).rejects.not.toBeInstanceOf(UnprofiledReportPackageError);
  });
});
