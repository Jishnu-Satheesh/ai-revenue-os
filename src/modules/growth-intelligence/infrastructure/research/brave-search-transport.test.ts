import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { BRAVE_WEB_SEARCH_ENDPOINT } from "@/modules/growth-intelligence/infrastructure/research/brave-search-adapter";
import { createBraveSearchTransport } from "@/modules/growth-intelligence/infrastructure/research/brave-search-transport";

function stubFetch(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond(url, init);
  });
  return { fetchImpl: fetchImpl as unknown as typeof globalThis.fetch, calls };
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "X-Custom": "yes" },
  });
}

describe("createBraveSearchTransport", () => {
  it("refuses an empty key without touching the network", () => {
    expect(() => createBraveSearchTransport({ apiKey: "" })).toThrow(/api key/i);
  });

  it("sends one GET to the fixed endpoint with the token header and manual redirects", async () => {
    const { fetchImpl, calls } = stubFetch((_url, init) => {
      expect(init.redirect).toBe("manual");
      expect(init.method).toBe("GET");
      const headers = new Headers(init.headers);
      expect(headers.get("X-Subscription-Token")).toBe("secret-key");
      expect(headers.get("Accept")).toBe("application/json");
      return jsonResponse(200, { results: [] });
    });
    const transport = createBraveSearchTransport({ apiKey: "secret-key", fetchImpl });
    const result = await transport.search({
      url: `${BRAVE_WEB_SEARCH_ENDPOINT}?q=dubai+restaurants&count=1`,
      timeoutMs: 20_000,
      maxResponseBytes: 524_288,
      abortSignal: AbortSignal.timeout(20_000),
    });
    expect(calls).toHaveLength(1);
    expect(result.status).toBe(200);
    expect(result.headers["content-type"]).toContain("application/json");
    expect(result.headers["x-custom"]).toBe("yes");
    expect(new TextDecoder().decode(result.body)).toContain("results");
  });

  it("refuses off-endpoint URLs before any request", async () => {
    const { fetchImpl, calls } = stubFetch(() => jsonResponse(200, { results: [] }));
    const transport = createBraveSearchTransport({ apiKey: "secret-key", fetchImpl });
    await expect(
      transport.search({
        url: "https://example.com/evil?q=x",
        timeoutMs: 20_000,
        maxResponseBytes: 524_288,
        abortSignal: AbortSignal.timeout(20_000),
      }),
    ).rejects.toThrow(/allowlisted endpoint/);
    expect(calls).toHaveLength(0);
  });

  it("returns 3xx answers as-is so the runner fails the attempt without following", async () => {
    const { fetchImpl } = stubFetch(() => new Response(null, { status: 301 }));
    const transport = createBraveSearchTransport({ apiKey: "secret-key", fetchImpl });
    const result = await transport.search({
      url: `${BRAVE_WEB_SEARCH_ENDPOINT}?q=x&count=1`,
      timeoutMs: 20_000,
      maxResponseBytes: 524_288,
      abortSignal: AbortSignal.timeout(20_000),
    });
    expect(result.status).toBe(301);
  });

  it("propagates transport failures for the runner to settle as unknown", async () => {
    const { fetchImpl } = stubFetch(() => {
      throw new DOMException("aborted", "AbortError");
    });
    const transport = createBraveSearchTransport({ apiKey: "secret-key", fetchImpl });
    await expect(
      transport.search({
        url: `${BRAVE_WEB_SEARCH_ENDPOINT}?q=x&count=1`,
        timeoutMs: 20_000,
        maxResponseBytes: 524_288,
        abortSignal: AbortSignal.timeout(20_000),
      }),
    ).rejects.toThrow("aborted");
  });
});
