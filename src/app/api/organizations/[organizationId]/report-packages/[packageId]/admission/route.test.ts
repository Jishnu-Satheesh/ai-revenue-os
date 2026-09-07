import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  reportRequest: vi.fn(),
  runReportRoute: vi.fn(),
  requestReportPackageValidation: vi.fn(),
}));

vi.mock("@/modules/reports/application/api", () => ({
  reportPackageRouteParamsSchema: {},
  reportRequest: mocks.reportRequest,
  runReportRoute: mocks.runReportRoute,
}));

vi.mock("@/modules/reports/application/dispatch", () => ({
  requestReportPackageValidation: mocks.requestReportPackageValidation,
}));

import { POST } from "@/app/api/organizations/[organizationId]/report-packages/[packageId]/admission/route";
import { admissionIdempotencyKeys, UnprofiledReportPackageError } from "@/modules/reports/application/admissions";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const PACKAGE_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR_ID = "33333333-3333-4333-8333-333333333333";
const CORRELATION_ID = "44444444-4444-4444-8444-444444444444";
const CONTRACT_VERSION_ID = "55555555-5555-4555-8555-555555555555";
const PROJECTION_VERSION_ID = "66666666-6666-4666-8666-666666666666";
const ADMISSION_ID = "77777777-7777-4777-8777-777777777777";

const requestBody = {
  contract: { source: "human" as const, mappingDocument: {} },
  projection: { source: "human" as const, projectionDocument: {} },
};

function service(overrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}) {
  return {
    proposeContract: vi.fn().mockResolvedValue({ id: CONTRACT_VERSION_ID, provider_definition_key: null }),
    decideContract: vi.fn().mockResolvedValue({}),
    proposeProjection: vi.fn().mockResolvedValue({ id: PROJECTION_VERSION_ID, provider_definition_key: null }),
    decideProjection: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
}

function admissionService(overrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}) {
  return {
    grantAdmission: vi.fn().mockResolvedValue({
      id: ADMISSION_ID,
      channelId: "channel-1",
      structureFingerprint: "a".repeat(64),
      reportType: "Performance",
      reportFamilyKey: null,
      contractVersionId: CONTRACT_VERSION_ID,
      projectionVersionId: PROJECTION_VERSION_ID,
      grantedBy: ACTOR_ID,
      grantedAt: "2026-09-02T00:00:00.000Z",
    }),
    ...overrides,
  };
}

function baseContext(role: string, overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORGANIZATION_ID,
    actorId: ACTOR_ID,
    role,
    correlationId: CORRELATION_ID,
    service: service(),
    admissionService: admissionService(),
    params: { organizationId: ORGANIZATION_ID, packageId: PACKAGE_ID },
    ...overrides,
  };
}

async function capturedHandler(): Promise<
  (context: Record<string, unknown>) => Promise<{ body: unknown; status?: number }>
> {
  await POST(
    new Request("http://localhost/api/report-packages/admission", {
      method: "POST",
      body: JSON.stringify(requestBody),
    }),
    { params: Promise.resolve({ organizationId: ORGANIZATION_ID, packageId: PACKAGE_ID }) },
  );
  const options = mocks.runReportRoute.mock.calls.at(-1)?.[0] as {
    handler: (context: Record<string, unknown>) => Promise<{ body: unknown; status?: number }>;
  };
  return options.handler;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.reportRequest.mockResolvedValue(requestBody);
  mocks.runReportRoute.mockResolvedValue(new Response("ok"));
  mocks.requestReportPackageValidation.mockResolvedValue(true);
});

describe("POST report structure admission", () => {
  it("refuses an operator, who holds report.upload and report.retry but not report.contract_approve", async () => {
    const handler = await capturedHandler();
    const context = baseContext("operator");

    await expect(handler(context)).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
    expect((context.service as ReturnType<typeof service>).proposeContract).not.toHaveBeenCalled();
    expect((context.admissionService as ReturnType<typeof admissionService>).grantAdmission).not.toHaveBeenCalled();
  });

  it("lets an admin grant, orchestrating all five calls with keys derived from the package id, and names the admission in the response", async () => {
    const handler = await capturedHandler();
    const context = baseContext("admin");

    const result = await handler(context);

    expect(result.status).toBe(200);
    expect((result.body as { admission: { id: string } }).admission.id).toBe(ADMISSION_ID);

    const keys = admissionIdempotencyKeys(PACKAGE_ID);
    const svc = context.service as ReturnType<typeof service>;
    const admissions = context.admissionService as ReturnType<typeof admissionService>;

    expect(svc.proposeContract).toHaveBeenCalledWith(
      context,
      PACKAGE_ID,
      expect.objectContaining({ idempotencyKey: keys.contractPropose }),
      keys.contractPropose,
    );
    expect(svc.decideContract).toHaveBeenCalledWith(
      context,
      CONTRACT_VERSION_ID,
      "approved",
      undefined,
      keys.contractDecide,
    );
    expect(svc.proposeProjection).toHaveBeenCalledWith(
      context,
      CONTRACT_VERSION_ID,
      expect.objectContaining({ idempotencyKey: keys.projectionPropose }),
      keys.projectionPropose,
    );
    expect(svc.decideProjection).toHaveBeenCalledWith(
      context,
      PROJECTION_VERSION_ID,
      "approved",
      undefined,
      keys.projectionDecide,
    );
    expect(admissions.grantAdmission).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      actorId: ACTOR_ID,
      packageId: PACKAGE_ID,
      contractVersionId: CONTRACT_VERSION_ID,
      projectionVersionId: PROJECTION_VERSION_ID,
      reportFamilyKey: null,
      correlationId: CORRELATION_ID,
    });

    // A second click of the same package produces the same five keys --
    // this is what makes each RPC's own idempotency ledger absorb the retry
    // instead of minting a second contract, projection, or admission.
    const secondContext = baseContext("admin");
    await handler(secondContext);
    const secondSvc = secondContext.service as ReturnType<typeof service>;
    expect(secondSvc.proposeContract).toHaveBeenCalledWith(
      secondContext,
      PACKAGE_ID,
      expect.objectContaining({ idempotencyKey: keys.contractPropose }),
      keys.contractPropose,
    );
  });

  it("carries the recognised family key into the grant only when both the contract and the projection came from it", async () => {
    const handler = await capturedHandler();
    const context = baseContext("admin", {
      service: service({
        proposeContract: vi
          .fn()
          .mockResolvedValue({ id: CONTRACT_VERSION_ID, provider_definition_key: "talabat.performance.v1" }),
        proposeProjection: vi
          .fn()
          .mockResolvedValue({ id: PROJECTION_VERSION_ID, provider_definition_key: "talabat.performance.v1" }),
      }),
    });

    await handler(context);

    expect((context.admissionService as ReturnType<typeof admissionService>).grantAdmission).toHaveBeenCalledWith(
      expect.objectContaining({ reportFamilyKey: "talabat.performance.v1" }),
    );
  });

  it("answers 409 with a profiling message when the package has no recorded structure fingerprint", async () => {
    const handler = await capturedHandler();
    const context = baseContext("admin", {
      admissionService: admissionService({
        grantAdmission: vi.fn().mockRejectedValue(new UnprofiledReportPackageError()),
      }),
    });

    const result = await handler(context);

    expect(result.status).toBe(409);
    expect((result.body as { error: { message: string } }).error.message).toMatch(/has not been profiled yet/);
  });

  /**
   * The upload that earned the admission has to start too.
   *
   * Every *later* upload of this structure is carried by profiling, which
   * finds the standing admission and dispatches validation itself. The file
   * the operator was looking at when they pressed Approve was profiled before
   * the admission existed, so nothing in that path reaches it: without this
   * dispatch it sits at `awaiting_validation` with no run, no failure, and
   * nothing on the page to say why.
   */
  it("starts validation for the very upload that earned the admission", async () => {
    const handler = await capturedHandler();
    const context = baseContext("admin");

    const result = await handler(context);

    expect(mocks.requestReportPackageValidation).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      packageId: PACKAGE_ID,
      contractVersionId: CONTRACT_VERSION_ID,
      correlationId: CORRELATION_ID,
    });
    expect((result.body as { validationQueued: boolean }).validationQueued).toBe(true);
  });

  // The grant is what the operator asked for and it is already recorded. A
  // transport that would not take the follow-on dispatch is worth reporting,
  // not worth throwing away an approval over -- the Retry button on the
  // package covers it.
  it("still reports the grant when the validation dispatch does not land", async () => {
    mocks.requestReportPackageValidation.mockResolvedValue(false);
    const handler = await capturedHandler();

    const result = await handler(baseContext("admin"));

    expect(result.status).toBe(200);
    expect((result.body as { admission: { id: string } }).admission.id).toBe(ADMISSION_ID);
    expect((result.body as { validationQueued: boolean }).validationQueued).toBe(false);
  });

  it("dispatches nothing when the grant itself failed", async () => {
    const handler = await capturedHandler();
    const context = baseContext("admin", {
      admissionService: admissionService({
        grantAdmission: vi.fn().mockRejectedValue(new UnprofiledReportPackageError()),
      }),
    });

    await handler(context);

    expect(mocks.requestReportPackageValidation).not.toHaveBeenCalled();
  });

  it("leaves the package on the manual path when an intermediate step fails, without granting anything", async () => {
    const handler = await capturedHandler();
    const failure = new Error("report contract document is invalid");
    const context = baseContext("admin", {
      service: service({ decideContract: vi.fn().mockRejectedValue(failure) }),
    });

    await expect(handler(context)).rejects.toBe(failure);
    expect((context.admissionService as ReturnType<typeof admissionService>).grantAdmission).not.toHaveBeenCalled();
  });
});
