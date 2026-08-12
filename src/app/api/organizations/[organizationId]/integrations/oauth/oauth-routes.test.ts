import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const organizationId = "11111111-1111-4111-8111-111111111111";

const mocks = vi.hoisted(() => ({
  getOrganizationContext: vi.fn(),
  rpc: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/api/organization-context", () => ({
  getOrganizationContext: mocks.getOrganizationContext,
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
vi.mock("@trigger.dev/sdk", () => ({ tasks: { trigger: vi.fn() } }));
vi.mock("@/lib/logger", () => ({ logger: mocks.logger }));
// The organization is deliberately inside the rollout allowlist, so a refusal
// below proves the provider is unconfigured rather than the feature being off.
vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    INTEGRATION_HUB_V1_ORGANIZATION_IDS: "11111111-1111-4111-8111-111111111111",
  },
}));

import { POST as startOAuth } from "@/app/api/organizations/[organizationId]/integrations/oauth/[providerKey]/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOrganizationContext.mockResolvedValue({
    organizationId,
    user: { id: "22222222-2222-4222-8222-222222222222" },
    membership: { role: "operator" },
    supabase: { rpc: mocks.rpc, from: vi.fn() },
  });
});

/**
 * These assertions are about the production wiring, not the generic mechanism.
 * The lifecycle itself is proven against a fake provider in the service suite.
 */
describe("oauth start route", () => {
  it("refuses Meta and writes no session, because no verified contract registers it", async () => {
    const response = await startOAuth(
      new Request(`http://localhost/api/organizations/${organizationId}/integrations/oauth/meta`, {
        method: "POST",
      }),
      { params: Promise.resolve({ organizationId, providerKey: "meta" }) },
    );

    expect(response.status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();

    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).not.toMatch(/meta|client|secret/i);
  });

  it("refuses every other provider for the same reason", async () => {
    for (const providerKey of ["google_business_profile", "telegram", "instagram"]) {
      const response = await startOAuth(
        new Request(
          `http://localhost/api/organizations/${organizationId}/integrations/oauth/${providerKey}`,
          { method: "POST" },
        ),
        { params: Promise.resolve({ organizationId, providerKey }) },
      );

      expect(response.status).toBe(404);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects a malformed provider key before resolving an organization", async () => {
    const response = await startOAuth(
      new Request(`http://localhost/api/organizations/${organizationId}/integrations/oauth/Bad!`, {
        method: "POST",
      }),
      { params: Promise.resolve({ organizationId, providerKey: "Bad!" }) },
    );

    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
