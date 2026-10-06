import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "https://app.example.com" } }));

const mocks = vi.hoisted(() => ({
  ensureDevPersona: vi.fn(),
  mintDevPersonaSignInUrl: vi.fn(),
  createDevPersonaServiceClient: vi.fn(),
}));

vi.mock("@/modules/accounts/application/dev-personas", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/modules/accounts/application/dev-personas")>();
  return {
    ...actual,
    ensureDevPersona: mocks.ensureDevPersona,
    mintDevPersonaSignInUrl: mocks.mintDevPersonaSignInUrl,
    createDevPersonaServiceClient: mocks.createDevPersonaServiceClient,
  };
});

import { GET as devLoginAs } from "@/app/api/dev/login-as/route";
import { DomainError } from "@/lib/errors";

const ORGANIZATION_ID = "2dda45b8-82db-4f5f-b17d-611b9bbb7846";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function loginRequest(query: string) {
  return new Request(`http://localhost/api/dev/login-as${query}`, { method: "GET" });
}

describe("dev login-as route", () => {
  it("404s outside development without touching provisioning", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const response = await devLoginAs(loginRequest(`?org=${ORGANIZATION_ID}&role=owner`));

    expect(response.status).toBe(404);
    expect(mocks.createDevPersonaServiceClient).not.toHaveBeenCalled();
    expect(mocks.ensureDevPersona).not.toHaveBeenCalled();
  });

  it("redirects through the real callback in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    mocks.createDevPersonaServiceClient.mockReturnValue({ service: true });
    mocks.ensureDevPersona.mockResolvedValue({ userId: "user-1", email: "dev.owner@lunes.test" });
    mocks.mintDevPersonaSignInUrl.mockResolvedValue(
      "http://localhost:3000/auth/callback?token_hash=token-1&type=magiclink&next=%2F",
    );

    const response = await devLoginAs(loginRequest(`?org=${ORGANIZATION_ID}&role=owner`));

    expect(response.status).toBe(302);
    expect(mocks.ensureDevPersona).toHaveBeenCalledWith(
      { service: true },
      { organizationId: ORGANIZATION_ID, role: "owner" },
    );
    const location = response.headers.get("location") ?? "";
    expect(new URL(location).pathname).toBe("/auth/callback");
    expect(new URL(location).searchParams.get("token_hash")).toBe("token-1");
  });

  it("refuses a bad org or role without provisioning", async () => {
    vi.stubEnv("NODE_ENV", "development");

    for (const query of [
      `?org=not-a-uuid&role=owner`,
      `?org=${ORGANIZATION_ID}&role=superadmin`,
      `?org=${ORGANIZATION_ID}`,
    ]) {
      const response = await devLoginAs(loginRequest(query));
      expect(response.status).toBe(400);
    }
    expect(mocks.ensureDevPersona).not.toHaveBeenCalled();
  });

  it("maps a provisioning failure to a JSON error response", async () => {
    vi.stubEnv("NODE_ENV", "development");
    mocks.createDevPersonaServiceClient.mockReturnValue({ service: true });
    mocks.ensureDevPersona.mockRejectedValue(
      new DomainError("INTEGRATION_ERROR", "Persona provisioning failed."),
    );

    const response = await devLoginAs(loginRequest(`?org=${ORGANIZATION_ID}&role=owner`));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: { code: "INTEGRATION_ERROR", message: "Persona provisioning failed." },
    });
  });

  it.each(["https%3A%2F%2Fevil.example", "%2F%2Fevil.example", "%2F%5Cevil.example"])(
    "refuses an off-site next path (%s)",
    async (encodedNext) => {
      vi.stubEnv("NODE_ENV", "development");
      mocks.createDevPersonaServiceClient.mockReturnValue({ service: true });
      mocks.ensureDevPersona.mockResolvedValue({ userId: "user-1", email: "dev.owner@lunes.test" });
      mocks.mintDevPersonaSignInUrl.mockResolvedValue("http://localhost:3000/auth/callback");

      await devLoginAs(loginRequest(`?org=${ORGANIZATION_ID}&role=owner&next=${encodedNext}`));

      expect(mocks.mintDevPersonaSignInUrl).toHaveBeenCalledWith(
        { service: true },
        expect.objectContaining({ next: "/" }),
      );
    },
  );
});
