import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const organizationId = "11111111-1111-4111-8111-111111111111";
const dataSourceId = "22222222-2222-4222-8222-222222222222";

const mocks = vi.hoisted(() => ({
  getOrganizationContext: vi.fn(),
  createIntegrationService: vi.fn(),
  service: {
    createDataSource: vi.fn(),
    updateDataSource: vi.fn(),
    finalizeDataSourceUpload: vi.fn(),
    requestImport: vi.fn(),
    getSnapshot: vi.fn(),
  },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/api/organization-context", () => ({
  getOrganizationContext: mocks.getOrganizationContext,
}));
vi.mock("@/modules/integrations/application/service", () => ({
  createIntegrationService: mocks.createIntegrationService,
}));
vi.mock("@/modules/integrations/infrastructure/repository", () => ({
  createAuthenticatedIntegrationRepository: () => ({ repository: {} }),
}));
vi.mock("@/domain/integrations/provider-registry", () => ({ createProviderRegistry: () => ({}) }));
vi.mock("@/domain/events/publisher", () => ({
  createEventPublisher: () => ({ publish: vi.fn() }),
}));
vi.mock("@trigger.dev/sdk", () => ({ tasks: { trigger: vi.fn() } }));
vi.mock("@/lib/logger", () => ({ logger: mocks.logger }));

import { POST as createSource } from "@/app/api/organizations/[organizationId]/integrations/data-sources/route";
import { POST as importSource } from "@/app/api/organizations/[organizationId]/integrations/data-sources/[dataSourceId]/import/route";
import { PATCH as patchSource } from "@/app/api/organizations/[organizationId]/integrations/data-sources/[dataSourceId]/route";

function params() {
  return { params: Promise.resolve({ organizationId }) };
}
function sourceParams() {
  return { params: Promise.resolve({ organizationId, dataSourceId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOrganizationContext.mockResolvedValue({
    organizationId,
    user: { id: "user-1" },
    membership: { role: "operator" },
    supabase: {
      from: vi.fn(),
      storage: { from: vi.fn(() => ({ upload: vi.fn(), remove: vi.fn() })) },
    },
  });
  mocks.createIntegrationService.mockReturnValue(mocks.service);
  mocks.service.createDataSource.mockResolvedValue({
    id: dataSourceId,
    organization_id: organizationId,
    source_type: "manual",
    status: "ready",
  });
  mocks.service.updateDataSource.mockResolvedValue({ id: dataSourceId, status: "archived" });
  mocks.service.finalizeDataSourceUpload.mockResolvedValue({
    id: dataSourceId,
    source_type: "csv_import",
    status: "ready",
  });
  mocks.service.requestImport.mockResolvedValue({ runId: "run-1", status: "queued" });
  mocks.service.getSnapshot.mockResolvedValue({ dataSources: [] });
});

describe("data-source routes", () => {
  it("registers a manual source without requiring a file", async () => {
    const response = await createSource(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceType: "manual", name: "Daily revenue" }),
      }),
      params(),
    );
    expect(response.status).toBe(201);
    expect(mocks.service.createDataSource).toHaveBeenCalledWith(
      expect.objectContaining({ sourceType: "manual" }),
    );
  });

  it("uploads CSV privately and never returns a public URL", async () => {
    const form = new FormData();
    form.set("sourceType", "csv_import");
    form.set("name", "August CSV");
    form.set("columnMapping", JSON.stringify({ revenue: "revenue" }));
    form.set("file", new File(["date,revenue\n2026-08-01,42"], "august.csv", { type: "text/csv" }));
    const upload = vi.fn().mockResolvedValue({ data: { path: "ok" }, error: null });
    const remove = vi.fn().mockResolvedValue({ error: null });
    mocks.getOrganizationContext.mockResolvedValueOnce({
      organizationId,
      user: { id: "user-1" },
      membership: { role: "operator" },
      supabase: { from: vi.fn(), storage: { from: vi.fn(() => ({ upload, remove })) } },
    });
    mocks.service.createDataSource.mockResolvedValueOnce({
      id: dataSourceId,
      source_type: "csv_import",
      status: "pending",
    });
    mocks.service.updateDataSource.mockResolvedValueOnce({
      id: dataSourceId,
      source_type: "csv_import",
      status: "ready",
    });

    const response = await createSource(
      new Request("http://localhost", { method: "POST", body: form }),
      params(),
    );
    expect(response.status).toBe(201);
    expect(upload).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(`^${organizationId}/${dataSourceId}/[0-9a-f-]{36}/august\\.csv$`),
      ),
      expect.any(Uint8Array),
      expect.objectContaining({ contentType: "text/csv", upsert: false }),
    );
    expect(await response.text()).not.toContain("publicUrl");
  });

  it("enqueues imports with an idempotency key and archives without deleting history", async () => {
    const importResponse = await importSource(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey: "import-1" }),
      }),
      sourceParams(),
    );
    expect(importResponse.status).toBe(202);
    expect(mocks.service.requestImport).toHaveBeenCalledWith(
      expect.objectContaining({ dataSourceId, idempotencyKey: "import-1" }),
    );

    const archiveResponse = await patchSource(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "archived" }),
      }),
      sourceParams(),
    );
    expect(archiveResponse.status).toBe(200);
    expect(mocks.service.updateDataSource).toHaveBeenCalledWith(
      expect.objectContaining({ dataSourceId, status: "archived" }),
    );
  });
});
