import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  reportRequest: vi.fn(),
  runReportRoute: vi.fn(),
  requestReportPackageValidation: vi.fn(),
  isGovernedReportValidationEnabled: vi.fn(),
  retryValidation: vi.fn(),
  listSnapshot: vi.fn(),
  findAdmissionById: vi.fn(),
}));

vi.mock("@/modules/reports/application/api", () => ({
  reportPackageRouteParamsSchema: {},
  reportRequest: mocks.reportRequest,
  runReportRoute: mocks.runReportRoute,
}));
vi.mock("@/domain/reports/schemas", () => ({ retryReportPackageSchema: {} }));
vi.mock("@/modules/reports/application/dispatch", () => ({
  requestReportPackageValidation: mocks.requestReportPackageValidation,
}));
vi.mock("@/modules/integrations/application/feature-access", () => ({
  isGovernedReportValidationEnabled: mocks.isGovernedReportValidationEnabled,
}));

import { POST } from "@/app/api/organizations/[organizationId]/report-packages/[packageId]/validation-retry/route";

const ORGANIZATION_ID = "859cf039-1cd8-41b0-bd09-66c6c52e9c52";
const PACKAGE_ID = "ae99b309-ad74-4654-83d4-db40d2f87965";
const EARLIER_PACKAGE_ID = "e3d1a04c-bebf-40a9-a741-a2e857385472";
const ADMISSION_ID = "99d434ab-205a-4692-a03d-654b33e33906";
const ADMITTED_VERSION_ID = "91a9dfca-c8ad-4a7f-9631-2a28128e7cd1";

type RouteResult = {
  body: {
    validationQueued: boolean;
    reason?: "feature_disabled" | "contract_unresolved" | "dispatch_failed";
  };
};

/**
 * The staging state that produced the defect: a package admitted under a
 * standing admission (ADR 0046), so the approved contract version belongs to
 * an *earlier* upload and this package has none of its own, and no validation
 * run has ever been recorded for it.
 */
function admittedPackageSnapshot() {
  return {
    validationRuns: [],
    contractVersions: [{ id: ADMITTED_VERSION_ID, report_package_id: EARLIER_PACKAGE_ID }],
    contractDecisions: [
      { report_contract_version_id: ADMITTED_VERSION_ID, decision: "approved" },
    ],
  };
}

async function invokeRoute() {
  await POST(new Request("http://localhost/validation-retry", { method: "POST" }), {
    params: Promise.resolve({ organizationId: ORGANIZATION_ID, packageId: PACKAGE_ID }),
  });
  const options = mocks.runReportRoute.mock.calls[0][0] as {
    handler: (context: unknown) => Promise<RouteResult>;
  };
  return options.handler({
    organizationId: ORGANIZATION_ID,
    correlationId: "correlation",
    params: { organizationId: ORGANIZATION_ID, packageId: PACKAGE_ID },
    service: { retryValidation: mocks.retryValidation, listSnapshot: mocks.listSnapshot },
    admissionService: { findAdmissionById: mocks.findAdmissionById },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.reportRequest.mockResolvedValue({ idempotencyKey: "report-validation-retry:key" });
  mocks.runReportRoute.mockResolvedValue(new Response("ok"));
  mocks.isGovernedReportValidationEnabled.mockReturnValue(true);
  mocks.requestReportPackageValidation.mockResolvedValue(true);
  mocks.retryValidation.mockResolvedValue({
    id: PACKAGE_ID,
    admitted_under_admission_id: ADMISSION_ID,
  });
  mocks.listSnapshot.mockResolvedValue(admittedPackageSnapshot());
  mocks.findAdmissionById.mockResolvedValue({
    id: ADMISSION_ID,
    contractVersionId: ADMITTED_VERSION_ID,
  });
});

describe("validation retry route", () => {
  it("queues validation for a package admitted under a standing admission", async () => {
    const result = await invokeRoute();

    expect(mocks.findAdmissionById).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      admissionId: ADMISSION_ID,
    });
    expect(mocks.requestReportPackageValidation).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORGANIZATION_ID,
        packageId: PACKAGE_ID,
        contractVersionId: ADMITTED_VERSION_ID,
      }),
    );
    expect(result.body).toMatchObject({ validationQueued: true, reason: undefined });
  });

  it("says the feature is off only when the feature is actually off", async () => {
    mocks.isGovernedReportValidationEnabled.mockReturnValue(false);

    const result = await invokeRoute();

    expect(mocks.requestReportPackageValidation).not.toHaveBeenCalled();
    expect(result.body).toEqual(expect.objectContaining({
      validationQueued: false,
      reason: "feature_disabled",
    }));
  });

  it("distinguishes an upload with no approved structure from a disabled feature", async () => {
    mocks.retryValidation.mockResolvedValue({ id: PACKAGE_ID, admitted_under_admission_id: null });
    mocks.listSnapshot.mockResolvedValue({
      validationRuns: [],
      contractVersions: [],
      contractDecisions: [],
    });

    const result = await invokeRoute();

    expect(mocks.requestReportPackageValidation).not.toHaveBeenCalled();
    expect(result.body).toEqual(expect.objectContaining({
      validationQueued: false,
      reason: "contract_unresolved",
    }));
  });

  it("reports a transport failure as a transport failure", async () => {
    mocks.requestReportPackageValidation.mockResolvedValue(false);

    const result = await invokeRoute();

    expect(result.body).toEqual(expect.objectContaining({
      validationQueued: false,
      reason: "dispatch_failed",
    }));
  });
});
