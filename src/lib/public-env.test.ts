import { afterEach, describe, expect, it, vi } from "vitest";

import { appOrigin, authCallbackUrl } from "@/lib/public-env";

const original = process.env.NEXT_PUBLIC_APP_URL;

afterEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = original;
  vi.unstubAllGlobals();
});

describe("appOrigin", () => {
  /**
   * Every environment shares one hosted Supabase project and therefore one
   * redirect allowlist. The destination has to be a property of the environment,
   * not of whichever host the browser was opened on.
   */
  it("uses the configured application URL", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://staging.example.com";
    expect(appOrigin()).toBe("https://staging.example.com");
  });

  it("ignores the browser's own origin when configuration disagrees", () => {
    // `next dev` also serves on the machine's LAN address, so this is the case
    // that silently produced an unallowlisted redirect.
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    vi.stubGlobal("window", { location: { origin: "http://192.168.1.11:3000" } });

    expect(appOrigin()).toBe("http://localhost:3000");
  });

  it("tolerates a trailing slash rather than producing a doubled path", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://staging.example.com/";
    expect(authCallbackUrl()).toBe("https://staging.example.com/auth/callback");
  });

  it("falls back to the current origin when nothing is configured", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    vi.stubGlobal("window", { location: { origin: "https://observed.example.com" } });

    expect(appOrigin()).toBe("https://observed.example.com");
  });
});

describe("authCallbackUrl", () => {
  it("always points at the callback, which is where the code becomes a session", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://staging.example.com";
    expect(authCallbackUrl()).toBe("https://staging.example.com/auth/callback");
  });

  it("carries the destination so the link lands where it was going", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://staging.example.com";
    expect(authCallbackUrl("/invitations/abc-token")).toBe(
      "https://staging.example.com/auth/callback?next=%2Finvitations%2Fabc-token",
    );
  });

  it("encodes the destination, so a token's characters cannot split the query", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://staging.example.com";
    const url = authCallbackUrl("/invitations/a&b=c");

    expect(url).toContain("next=%2Finvitations%2Fa%26b%3Dc");
    expect(new URL(url).searchParams.get("next")).toBe("/invitations/a&b=c");
  });
});
