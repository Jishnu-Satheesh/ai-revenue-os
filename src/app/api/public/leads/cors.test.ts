import { describe, expect, it } from "vitest";

import {
  corsHeaders,
  parseAllowedOrigins,
  resolveAllowedOrigin,
} from "@/app/api/public/leads/cors";

describe("parseAllowedOrigins", () => {
  it("parses a comma-separated allowlist", () => {
    expect(parseAllowedOrigins("https://lunes.in, https://staging.lunes.example")).toEqual([
      "https://lunes.in",
      "https://staging.lunes.example",
    ]);
  });

  it("treats missing or blank configuration as no allowed origin", () => {
    expect(parseAllowedOrigins(undefined)).toEqual([]);
    expect(parseAllowedOrigins("")).toEqual([]);
    expect(parseAllowedOrigins("   ")).toEqual([]);
  });

  it("drops blank entries and forgives a trailing slash", () => {
    expect(parseAllowedOrigins("https://lunes.in/, ,https://a.example")).toEqual([
      "https://lunes.in",
      "https://a.example",
    ]);
  });
});

describe("resolveAllowedOrigin", () => {
  const allowed = ["https://lunes.in"];

  it("echoes an allowlisted origin", () => {
    expect(resolveAllowedOrigin("https://lunes.in", allowed)).toBe("https://lunes.in");
  });

  it("refuses an origin that is merely similar", () => {
    // A substring match would admit evil-lunes.in and lunes.in.evil.example.
    expect(resolveAllowedOrigin("https://evil-lunes.in", allowed)).toBeNull();
    expect(resolveAllowedOrigin("https://lunes.in.evil.example", allowed)).toBeNull();
    expect(resolveAllowedOrigin("http://lunes.in", allowed)).toBeNull();
  });

  it("refuses every origin when nothing is configured", () => {
    expect(resolveAllowedOrigin("https://lunes.in", [])).toBeNull();
  });

  it("returns null when the request carries no origin", () => {
    expect(resolveAllowedOrigin(null, allowed)).toBeNull();
  });
});

describe("corsHeaders", () => {
  it("echoes the allowed origin rather than a wildcard", () => {
    const headers = corsHeaders("https://lunes.in");

    expect(headers["Access-Control-Allow-Origin"]).toBe("https://lunes.in");
    expect(headers["Access-Control-Allow-Methods"]).toBe("POST, OPTIONS");
    expect(headers["Access-Control-Allow-Headers"]).toBe("Content-Type");
    expect(headers["Vary"]).toBe("Origin");
  });

  it("omits the allow-origin header when nothing was allowed", () => {
    const headers = corsHeaders(null);

    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(headers["Vary"]).toBe("Origin");
  });
});
