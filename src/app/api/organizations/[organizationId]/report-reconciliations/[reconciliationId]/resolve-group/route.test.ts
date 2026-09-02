import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  reportRequest: vi.fn(),
  runReportRoute: vi.fn(),
  resolveProjectionOverlapGroup: vi.fn(),
}));

vi.mock("@/modules/reports/application/api", () => ({
  reportProjectionReconciliationRouteParamsSchema: {},
  reportRequest: mocks.reportRequest,
  runReportRoute: mocks.runReportRoute,
}));
vi.mock("@/domain/reports/schemas", () => ({
  resolveReportProjectionOverlapSchema: {},
}));

import { POST } from "@/app/api/organizations/[organizationId]/report-reconciliations/[reconciliationId]/resolve-group/route";

const body = {
  resolution: "accept_correction" as const,
  idempotencyKey: "report-overlap-group-resolution:test",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.reportRequest.mockResolvedValue(body);
  mocks.resolveProjectionOverlapGroup.mockResolvedValue({ outcome: "resolved", resolvedCount: 20 });
  mocks.runReportRoute.mockResolvedValue(new Response("ok"));
});

describe("grouped report overlap resolution route", () => {
  it("passes one validated choice to the tenant-scoped service", async () => {
    await POST(new Request("https://example.test/resolve-group", { method: "POST" }), {
      params: Promise.resolve({
        organizationId: "11111111-1111-4111-8111-111111111111",
        reconciliationId: "22222222-2222-4222-8222-222222222222",
      }),
    });

    const options = mocks.runReportRoute.mock.calls[0][0] as {
      handler: (context: unknown) => Promise<{ body: unknown }>;
    };
    const context = {
      service: { resolveProjectionOverlapGroup: mocks.resolveProjectionOverlapGroup },
      params: { reconciliationId: "22222222-2222-4222-8222-222222222222" },
    };
    await expect(options.handler(context)).resolves.toEqual({
      body: { resolution: { outcome: "resolved", resolvedCount: 20 } },
    });
    expect(mocks.resolveProjectionOverlapGroup).toHaveBeenCalledWith(
      context,
      "22222222-2222-4222-8222-222222222222",
      "accept_correction",
      "report-overlap-group-resolution:test",
    );
  });
});
