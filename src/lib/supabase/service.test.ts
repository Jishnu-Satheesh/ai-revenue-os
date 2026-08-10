import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The module validates the whole environment on import; this suite only
// exercises the key guard, which needs none of it.
vi.mock("@/lib/env", () => ({
  env: { NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co" },
}));

import { assertServiceRoleKey } from "@/lib/supabase/service";

function jwt(role: string): string {
  const payload = Buffer.from(JSON.stringify({ role, iss: "supabase" }), "utf8").toString(
    "base64url",
  );
  return `eyJhbGciOiJIUzI1NiJ9.${payload}.signature`;
}

describe("assertServiceRoleKey", () => {
  it("accepts a service-role JWT and a current-generation secret key", () => {
    expect(assertServiceRoleKey(jwt("service_role"), "Workers")).toBe(jwt("service_role"));
    expect(assertServiceRoleKey("sb_secret_abc123", "Workers")).toBe("sb_secret_abc123");
  });

  it("rejects the placeholder that ships in .env.example", () => {
    // A worker started with this authenticates as anon: RLS hides every tenant
    // row and the run's RPCs return permission denied, far from the cause.
    expect(() =>
      assertServiceRoleKey("server-only-service-role-key", "Integration workers"),
    ).toThrow(/placeholder from \.env\.example/);
  });

  it("rejects a publishable key in either generation", () => {
    expect(() => assertServiceRoleKey("sb_publishable_abc123", "Workers")).toThrow(
      /publishable key/,
    );
    expect(() => assertServiceRoleKey(jwt("anon"), "Workers")).toThrow(/"anon" role/);
  });

  it("rejects an unset key", () => {
    expect(() => assertServiceRoleKey(undefined, "Memory workers")).toThrow(/is not set/);
  });

  it("names the worker so the failure says which one is misconfigured", () => {
    expect(() => assertServiceRoleKey(undefined, "Memory workers")).toThrow(/^Memory workers/);
  });

  it("rejects a token whose payload cannot be read", () => {
    expect(() =>
      assertServiceRoleKey("eyJhbGciOiJIUzI1NiJ9.!!!not-base64!!!.sig", "Workers"),
    ).toThrow(/could not be read|placeholder/);
  });
});
