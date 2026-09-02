import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  assertEnabled: vi.fn(),
  getOrganizationContext: vi.fn(),
  loadReadiness: vi.fn(),
  createRepository: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@/modules/integrations/application/feature-access", () => ({
  assertGovernedEconomicsReadinessEnabled: mocks.assertEnabled,
}));
vi.mock("@/lib/api/organization-context", () => ({
  getOrganizationContext: mocks.getOrganizationContext,
}));
vi.mock("@/modules/economics/application/readiness-service", () => ({
  createEvidenceReadinessService: () => ({ loadReadiness: mocks.loadReadiness }),
}));
vi.mock("@/modules/economics/infrastructure/readiness-repository", () => ({
  createAuthenticatedEvidenceReadinessRepository: mocks.createRepository,
}));
vi.mock("@/lib/logger", () => ({ logger: { warn: mocks.warn, info: vi.fn(), error: vi.fn() } }));

import { GET } from "@/app/api/organizations/[organizationId]/economics-readiness/route";
import { DomainError } from "@/lib/errors";

const ORGANIZATION = "44444444-4444-4444-8444-444444444444";

const view = {
  readModelVersion: 1,
  digest: "a".repeat(64),
  tuples: [],
  costCoverage: { outcome: "unchecked" },
  costSummary: "",
};

function request() {
  return new Request(`http://localhost/api/organizations/${ORGANIZATION}/economics-readiness`);
}

function params(organizationId = ORGANIZATION) {
  return { params: Promise.resolve({ organizationId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertEnabled.mockReturnValue(undefined);
  mocks.getOrganizationContext.mockResolvedValue({
    supabase: {},
    user: { id: "user-1" },
    organizationId: ORGANIZATION,
    membership: { role: "operator" },
  });
  mocks.loadReadiness.mockResolvedValue(view);
});

describe("economics readiness route", () => {
  it("returns the readiness view for an enabled organization", async () => {
    const response = await GET(request(), params());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(view);
    expect(mocks.loadReadiness).toHaveBeenCalledWith({
      organizationId: ORGANIZATION,
      role: "operator",
    });
  });

  it("never caches a response describing evidence about money", async () => {
    const response = await GET(request(), params());

    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("echoes a correlation id so a refusal can be traced", async () => {
    const response = await GET(
      new Request(`http://localhost/api/organizations/${ORGANIZATION}/economics-readiness`, {
        headers: { "x-correlation-id": "correlation-1" },
      }),
      params(),
    );

    expect(response.headers.get("x-correlation-id")).toBe("correlation-1");
  });

  describe("the feature flag", () => {
    it("refuses a disabled organization as if the route did not exist", async () => {
      mocks.assertEnabled.mockImplementation(() => {
        throw new DomainError("FEATURE_NOT_AVAILABLE", "Not enabled.");
      });

      const response = await GET(request(), params());

      expect(response.status).toBe(404);
    });

    it("checks the flag before resolving a session or reading anything", async () => {
      mocks.assertEnabled.mockImplementation(() => {
        throw new DomainError("FEATURE_NOT_AVAILABLE", "Not enabled.");
      });

      await GET(request(), params());

      expect(mocks.getOrganizationContext).not.toHaveBeenCalled();
      expect(mocks.loadReadiness).not.toHaveBeenCalled();
    });
  });

  describe("authorization", () => {
    it("returns 401 when there is no session", async () => {
      mocks.getOrganizationContext.mockRejectedValue(
        new DomainError("AUTHENTICATION_ERROR", "Authentication is required."),
      );

      expect((await GET(request(), params())).status).toBe(401);
    });

    it("returns 403 when the role may not read readiness", async () => {
      mocks.loadReadiness.mockRejectedValue(
        new DomainError("AUTHORIZATION_ERROR", "You do not have permission."),
      );

      expect((await GET(request(), params())).status).toBe(403);
    });

    it("returns 404 when the caller is outside the tenant", async () => {
      mocks.getOrganizationContext.mockRejectedValue(
        new DomainError("TENANT_SCOPE_ERROR", "Not your organization."),
      );

      expect((await GET(request(), params())).status).toBe(404);
    });

    it("rejects an organization id that is not a UUID", async () => {
      const response = await GET(request(), params("not-a-uuid"));

      expect(response.status).toBe(400);
      expect(mocks.assertEnabled).not.toHaveBeenCalled();
    });
  });

  describe("failure logging", () => {
    it("logs identifiers and a code, never the evidence", async () => {
      mocks.loadReadiness.mockRejectedValue(new Error("supabase exploded reading AED 91234"));

      await GET(request(), params());

      expect(mocks.warn).toHaveBeenCalledWith("economics_readiness_api.failed", {
        organizationId: ORGANIZATION,
        correlationId: expect.any(String),
        errorCode: "UNEXPECTED_ERROR",
      });
      expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain("91234");
    });

    it("does not leak an internal message to the caller", async () => {
      mocks.loadReadiness.mockRejectedValue(new Error("column value_numerator does not exist"));

      const response = await GET(request(), params());

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        error: { code: "UNEXPECTED_ERROR", message: "Something went wrong. Please try again." },
      });
    });
  });
});
