import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/lib/errors";
import { IntegrationError } from "@/domain/integrations/errors";

vi.mock("server-only", () => ({}));

const organizationId = "11111111-1111-4111-8111-111111111111";
const connectionId = "22222222-2222-4222-8222-222222222222";
const branchId = "33333333-3333-4333-8333-333333333333";

const mocks = vi.hoisted(() => ({
  getOrganizationContext: vi.fn(),
  createIntegrationService: vi.fn(),
  service: {
    getSnapshot: vi.fn(),
    getCatalog: vi.fn(),
    connectFixture: vi.fn(),
    requestConnectionTest: vi.fn(),
    requestSync: vi.fn(),
    replaceMappings: vi.fn(),
    disconnectConnection: vi.fn(),
  },
}));

const { getOrganizationContext, createIntegrationService, service } = mocks;

vi.mock("@/lib/api/organization-context", () => ({
  getOrganizationContext: mocks.getOrganizationContext,
}));
vi.mock("@/modules/integrations/application/service", () => ({
  createIntegrationService: mocks.createIntegrationService,
}));
vi.mock("@/modules/integrations/infrastructure/repository", () => ({
  createAuthenticatedIntegrationRepository: () => ({ repository: {} }),
}));
vi.mock("@/domain/integrations/provider-registry", () => ({
  createProviderRegistry: () => ({}),
}));
vi.mock("@/domain/events/publisher", () => ({
  createEventPublisher: () => ({ publish: vi.fn() }),
}));
vi.mock("@trigger.dev/sdk", () => ({
  tasks: { trigger: vi.fn() },
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { GET as getCatalog } from "@/app/api/organizations/[organizationId]/integrations/catalog/route";
import { POST as connectFixture } from "@/app/api/organizations/[organizationId]/integrations/connections/fixture/route";
import { DELETE as disconnect } from "@/app/api/organizations/[organizationId]/integrations/connections/[connectionId]/route";
import { PUT as replaceMappings } from "@/app/api/organizations/[organizationId]/integrations/connections/[connectionId]/mappings/route";
import { POST as requestSync } from "@/app/api/organizations/[organizationId]/integrations/connections/[connectionId]/sync/route";
import { POST as requestTest } from "@/app/api/organizations/[organizationId]/integrations/connections/[connectionId]/test/route";
import { GET as getSnapshot } from "@/app/api/organizations/[organizationId]/integrations/route";

function organizationParams() {
  return { params: Promise.resolve({ organizationId }) };
}

function connectionParams() {
  return { params: Promise.resolve({ organizationId, connectionId }) };
}

function jsonRequest(method: string, path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getOrganizationContext.mockResolvedValue({
    organizationId,
    user: { id: "user-1" },
    membership: { role: "operator" },
    supabase: { from: vi.fn() },
  });
  createIntegrationService.mockReturnValue(service);
  service.getSnapshot.mockResolvedValue({ connections: [] });
  service.getCatalog.mockResolvedValue([]);
  service.connectFixture.mockResolvedValue({
    connection: { id: connectionId, provider_key: "google_business_profile" },
    initialTest: { runId: "run-1", status: "queued" },
  });
  service.requestConnectionTest.mockResolvedValue({ runId: "run-test", status: "queued" });
  service.requestSync.mockResolvedValue({ runId: "run-sync", status: "queued" });
  service.replaceMappings.mockResolvedValue([]);
  service.disconnectConnection.mockResolvedValue({ runId: "run-disconnect", status: "queued" });
});

describe("Integration Hub API routes", () => {
  it("returns 401 before doing any work when authentication is absent", async () => {
    getOrganizationContext.mockRejectedValueOnce(
      new DomainError("AUTHENTICATION_ERROR", "Authentication is required."),
    );

    const response = await getSnapshot(new Request("http://localhost"), organizationParams());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "AUTHENTICATION_ERROR", message: "Authentication is required." },
    });
    expect(service.getSnapshot).not.toHaveBeenCalled();
  });

  it("lets viewers read a safe snapshot without credential references", async () => {
    getOrganizationContext.mockResolvedValueOnce({
      organizationId,
      user: { id: "viewer-1" },
      membership: { role: "viewer" },
      supabase: { from: vi.fn() },
    });
    service.getSnapshot.mockResolvedValueOnce({
      connections: [{ id: connectionId, provider_key: "google_business_profile" }],
    });

    const response = await getSnapshot(new Request("http://localhost"), organizationParams());

    expect(response.status).toBe(200);
    expect(response.headers.get("x-correlation-id")).toMatch(/^[0-9a-f-]{36}$/i);
    expect(await response.text()).not.toContain("credential_reference");
    expect(service.getSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId, actorId: "viewer-1", role: "viewer" }),
    );
  });

  it("returns a safe 404 when a tenant-scoped connection cannot be found", async () => {
    service.requestSync.mockRejectedValueOnce(
      new IntegrationError(
        "NOT_FOUND",
        "Integration connection was not found for this organization.",
        false,
        {},
        {
          credential: "must never leak",
        },
      ),
    );

    const response = await requestSync(
      jsonRequest("POST", "/sync", { idempotencyKey: "sync-1" }),
      connectionParams(),
    );

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("must never leak");
  });

  it("returns a feature-disabled public error without exposing internal causes", async () => {
    service.getCatalog.mockRejectedValueOnce(
      new DomainError(
        "FEATURE_NOT_AVAILABLE",
        "Integration Hub is not available for this organization.",
        {
          secret: "do-not-return",
        },
      ),
    );

    const response = await getCatalog(new Request("http://localhost"), organizationParams());

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("do-not-return");
  });

  it("rejects invalid route IDs and malformed mutation bodies", async () => {
    const invalidRoute = await requestTest(
      jsonRequest("POST", "/test", { idempotencyKey: "test-1" }),
      { params: Promise.resolve({ organizationId, connectionId: "not-a-uuid" }) },
    );
    const invalidBody = await requestTest(
      jsonRequest("POST", "/test", { idempotencyKey: "" }),
      connectionParams(),
    );

    expect(invalidRoute.status).toBe(400);
    expect(invalidBody.status).toBe(400);
    expect(service.requestConnectionTest).not.toHaveBeenCalled();
  });

  it("does not let a viewer enqueue work", async () => {
    getOrganizationContext.mockResolvedValueOnce({
      organizationId,
      user: { id: "viewer-1" },
      membership: { role: "viewer" },
      supabase: { from: vi.fn() },
    });
    service.requestConnectionTest.mockRejectedValueOnce(
      new IntegrationError(
        "AUTHORIZATION_ERROR",
        "You do not have permission for this integration action.",
        false,
      ),
    );

    const response = await requestTest(
      jsonRequest("POST", "/test", { idempotencyKey: "test-1" }),
      connectionParams(),
    );

    expect(response.status).toBe(403);
    expect(service.requestConnectionTest).toHaveBeenCalledWith(
      expect.objectContaining({ role: "viewer", connectionId, idempotencyKey: "test-1" }),
    );
  });

  it("returns 201 for a newly created fixture connection and its queued initial test", async () => {
    service.connectFixture.mockResolvedValueOnce({
      created: true,
      connection: { id: connectionId, provider_key: "google_business_profile" },
      initialTest: { runId: "run-1", status: "queued" },
    });

    const response = await connectFixture(
      jsonRequest("POST", "/fixture", {
        providerKey: "google_business_profile",
        externalAccountId: "fixture-account-main",
        externalAccountLabel: "Pilot Restaurant",
        grantedScopes: [],
        idempotencyKey: "connect-1",
      }),
      organizationParams(),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      connection: { id: connectionId },
      initialTest: { runId: "run-1", status: "queued" },
    });
  });

  it("returns an existing fixture connection without duplicating its public response", async () => {
    const response = await connectFixture(
      jsonRequest("POST", "/fixture", {
        providerKey: "google_business_profile",
        externalAccountId: "fixture-account-main",
        externalAccountLabel: "Pilot Restaurant",
        grantedScopes: [],
        idempotencyKey: "connect-1",
      }),
      organizationParams(),
    );

    expect(response.status).toBe(200);
    expect(service.connectFixture).toHaveBeenCalledTimes(1);
  });

  it("acknowledges queued test and sync work with 202 rather than a false success", async () => {
    const testResponse = await requestTest(
      jsonRequest("POST", "/test", { idempotencyKey: "test-1" }),
      connectionParams(),
    );
    const syncResponse = await requestSync(
      jsonRequest("POST", "/sync", { idempotencyKey: "sync-1" }),
      connectionParams(),
    );

    expect(testResponse.status).toBe(202);
    expect(syncResponse.status).toBe(202);
    await expect(syncResponse.json()).resolves.toEqual({ runId: "run-sync", status: "queued" });
  });

  it("validates mappings before asking the service to replace them", async () => {
    const invalid = await replaceMappings(
      jsonRequest("PUT", "/mappings", {
        mappings: [
          {
            externalResourceId: "location-1",
            externalResourceLabel: "Main branch",
            status: "mapped",
          },
        ],
      }),
      connectionParams(),
    );
    const valid = await replaceMappings(
      jsonRequest("PUT", "/mappings", {
        mappings: [
          {
            externalResourceId: "location-1",
            externalResourceLabel: "Main branch",
            branchId,
            status: "mapped",
          },
        ],
      }),
      connectionParams(),
    );

    expect(invalid.status).toBe(400);
    expect(valid.status).toBe(200);
    expect(service.replaceMappings).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId, mappings: expect.any(Array) }),
    );
  });

  it("requires the exact disconnect confirmation before queuing cleanup", async () => {
    service.disconnectConnection.mockRejectedValueOnce(
      new IntegrationError(
        "VALIDATION_ERROR",
        "Enter the displayed account name exactly to disconnect this integration.",
        false,
      ),
    );
    const response = await disconnect(
      jsonRequest("DELETE", "/disconnect", {
        idempotencyKey: "disconnect-1",
        confirmation: "wrong account",
      }),
      connectionParams(),
    );

    expect(response.status).toBe(400);
    expect(service.disconnectConnection).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId, confirmation: "wrong account" }),
    );
  });

  it("returns 202 only after the service accepts governed disconnect work", async () => {
    const response = await disconnect(
      jsonRequest("DELETE", "/disconnect", {
        idempotencyKey: "disconnect-1",
        confirmation: "Pilot Restaurant",
      }),
      connectionParams(),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      runId: "run-disconnect",
      status: "queued",
    });
  });
});
