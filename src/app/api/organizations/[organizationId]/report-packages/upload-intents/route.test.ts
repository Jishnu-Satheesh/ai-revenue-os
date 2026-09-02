import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  reportRequest: vi.fn(),
  runReportRoute: vi.fn(),
  beginUpload: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public-key",
  },
}));
vi.mock("@/modules/reports/application/api", () => ({
  organizationReportRouteParamsSchema: {},
  reportRequest: mocks.reportRequest,
  runReportRoute: mocks.runReportRoute,
}));
vi.mock("@/domain/reports/schemas", () => ({
  reportPackageUploadIntentSchema: {},
}));

import { POST } from "@/app/api/organizations/[organizationId]/report-packages/upload-intents/route";

const input = {
  channelId: "11111111-1111-4111-8111-111111111111",
  branchId: "22222222-2222-4222-8222-222222222222",
  reportType: "Performance",
  periodStart: "2026-01-01",
  periodEnd: "2026-01-31",
  currency: "AED",
  originalFilename: "report.xlsx",
  contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  contentLength: 123,
  idempotencyKey: "report-intent:test",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.reportRequest.mockResolvedValue(input);
  mocks.beginUpload.mockResolvedValue({
    package: { id: "33333333-3333-4333-8333-333333333333", storage_path: "path/report.xlsx" },
    upload: { token: "signed-token" },
  });
  mocks.runReportRoute.mockResolvedValue(new Response("ok"));
});

describe("report upload intent route", () => {
  it("uses the signed resumable endpoint and exposes the public API key", async () => {
    await POST(
      new Request("http://localhost/api/report-packages/upload-intents", {
        method: "POST",
        body: JSON.stringify(input),
      }),
      { params: Promise.resolve({ organizationId: "44444444-4444-4444-8444-444444444444" }) },
    );

    const options = mocks.runReportRoute.mock.calls[0][0] as {
      handler: (context: unknown) => Promise<{ body: { upload: Record<string, unknown> } }>;
    };
    const result = await options.handler({
      service: { beginUpload: mocks.beginUpload },
      params: {},
    });

    expect(result.body.upload).toEqual({
      endpoint: "https://example.supabase.co/storage/v1/upload/resumable/sign",
      token: "signed-token",
      apiKey: "public-key",
      chunkSize: 6 * 1024 * 1024,
    });
  });
});
