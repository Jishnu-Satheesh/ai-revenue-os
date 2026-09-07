import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  reportRequest: vi.fn(),
  runReportRoute: vi.fn(),
}));

vi.mock("@/modules/reports/application/api", () => ({
  reportProjectionVersionRouteParamsSchema: {},
  reportRequest: mocks.reportRequest,
  runReportRoute: mocks.runReportRoute,
}));

vi.mock("@/modules/integrations/application/feature-access", () => ({
  assertGovernedReportProjectionEnabled: vi.fn(),
}));

vi.mock("@/domain/reports/permissions", () => ({
  hasReportPermission: vi.fn((role: string) => role === "admin" || role === "owner"),
}));

import { POST } from "@/app/api/organizations/[organizationId]/report-projections/[projectionVersionId]/declarations/route";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const PROJECTION_VERSION_ID = "66666666-6666-4666-8666-666666666666";
const ACTOR_ID = "33333333-3333-4333-8333-333333333333";
const CORRELATION_ID = "44444444-4444-4444-8444-444444444444";
const NEW_VERSION_ID = "88888888-8888-4888-8888-888888888888";

const requestBody = { outputKey: "cancel_reason", value: "CLOSED" };

function service(overrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}) {
  return {
    proposeProjectionWithDeclaredValue: vi
      .fn()
      .mockResolvedValue({ id: NEW_VERSION_ID, version: 2 }),
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
    params: { organizationId: ORGANIZATION_ID, projectionVersionId: PROJECTION_VERSION_ID },
    ...overrides,
  };
}

async function capturedHandler(): Promise<
  (context: Record<string, unknown>) => Promise<{ body: unknown; status?: number }>
> {
  await POST(
    new Request("http://localhost/api/report-projections/declarations", {
      method: "POST",
      body: JSON.stringify(requestBody),
    }),
    {
      params: Promise.resolve({
        organizationId: ORGANIZATION_ID,
        projectionVersionId: PROJECTION_VERSION_ID,
      }),
    },
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
});

describe("POST projection categorical value declaration", () => {
  it("refuses an operator before any write starts", async () => {
    const handler = await capturedHandler();
    const context = baseContext("operator");

    await expect(handler(context)).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
    expect(
      (context.service as ReturnType<typeof service>).proposeProjectionWithDeclaredValue,
    ).not.toHaveBeenCalled();
  });

  it("lets an approver declare with a key derived from the declaration, and returns the new version", async () => {
    const handler = await capturedHandler();
    const context = baseContext("admin");

    const result = await handler(context);

    expect(result.status).toBe(201);
    expect(
      (result.body as { reportProjectionVersion: { id: string } }).reportProjectionVersion.id,
    ).toBe(NEW_VERSION_ID);
    expect(
      (context.service as ReturnType<typeof service>).proposeProjectionWithDeclaredValue,
    ).toHaveBeenCalledWith(
      context,
      PROJECTION_VERSION_ID,
      "cancel_reason",
      "CLOSED",
      `report-projection-declare:${PROJECTION_VERSION_ID}:cancel_reason:CLOSED`,
    );
  });
});
