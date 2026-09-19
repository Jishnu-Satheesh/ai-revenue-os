import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createTinyfishSearchTransport,
  TINYFISH_SEARCH_ENDPOINT,
} from "@/modules/growth-intelligence/infrastructure/research/tinyfish-search-transport";

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

function neverAbortingSignal(): AbortSignal {
  return new AbortController().signal;
}

describe("createTinyfishSearchTransport", () => {
  it("refuses an empty key without touching the network", () => {
    expect(() => createTinyfishSearchTransport({ apiKey: "" })).toThrow(/api key/i);
  });

  it("sends one GET to the fixed endpoint with the key header and manual redirects", async () => {
    const { fetchImpl, calls } = stubFetch((_url, init) => {
      expect(init.redirect).toBe("manual");
      expect(init.method).toBe("GET");
      const headers = new Headers(init.headers);
      expect(headers.get("X-API-Key")).toBe("secret-key");
      expect(headers.get("Accept")).toBe("application/json");
      return jsonResponse(200, { results: [] });
    });
    const transport = createTinyfishSearchTransport({ apiKey: "secret-key", fetchImpl });
    const result = await transport.search({
      url: `${TINYFISH_SEARCH_ENDPOINT}?q=dubai+restaurants&count=1`,
      timeoutMs: 20_000,
      maxResponseBytes: 524_288,
      abortSignal: AbortSignal.timeout(20_000),
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).not.toContain("secret-key");
    expect(result.status).toBe(200);
    expect(result.headers["content-type"]).toContain("application/json");
    expect(result.headers["x-custom"]).toBe("yes");
    expect(new TextDecoder().decode(result.body)).toContain("results");
  });

  it("refuses off-endpoint URLs before any request", async () => {
    const { fetchImpl, calls } = stubFetch(() => jsonResponse(200, { results: [] }));
    const transport = createTinyfishSearchTransport({ apiKey: "secret-key", fetchImpl });
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
    const transport = createTinyfishSearchTransport({ apiKey: "secret-key", fetchImpl });
    const result = await transport.search({
      url: `${TINYFISH_SEARCH_ENDPOINT}?q=x&count=1`,
      timeoutMs: 20_000,
      maxResponseBytes: 524_288,
      abortSignal: AbortSignal.timeout(20_000),
    });
    expect(result.status).toBe(301);
  });

  it("returns non-200 answers as-is for the runner to settle as unknown", async () => {
    const { fetchImpl, calls } = stubFetch(() => jsonResponse(429, { error: "busy" }));
    const transport = createTinyfishSearchTransport({ apiKey: "secret-key", fetchImpl });
    const result = await transport.search({
      url: `${TINYFISH_SEARCH_ENDPOINT}?q=x&count=1`,
      timeoutMs: 20_000,
      maxResponseBytes: 524_288,
      abortSignal: AbortSignal.timeout(20_000),
    });
    expect(calls).toHaveLength(1);
    expect(result.status).toBe(429);
    expect(new TextDecoder().decode(result.body)).toContain("busy");
  });

  it("refuses over-bound bodies without leaking the key", async () => {
    const { fetchImpl, calls } = stubFetch(() =>
      jsonResponse(200, { results: ["x".repeat(4_096)] }),
    );
    const transport = createTinyfishSearchTransport({ apiKey: "secret-key", fetchImpl });
    const failure = await transport
      .search({
        url: `${TINYFISH_SEARCH_ENDPOINT}?q=x&count=1`,
        timeoutMs: 20_000,
        maxResponseBytes: 64,
        abortSignal: AbortSignal.timeout(20_000),
      })
      .then(
        () => {
          throw new Error("expected the over-bound body to be refused");
        },
        (error: unknown) => error,
      );
    expect(calls).toHaveLength(1);
    expect(String(failure)).toMatch(/byte bound/);
    expect(String(failure)).not.toContain("secret-key");
  });

  it("propagates a caller abort for the runner to settle as unknown", async () => {
    const { fetchImpl } = stubFetch((_url, init) => {
      if (init.signal?.aborted) {
        throw new DOMException("aborted", "AbortError");
      }
      return jsonResponse(200, { results: [] });
    });
    const controller = new AbortController();
    controller.abort();
    const transport = createTinyfishSearchTransport({ apiKey: "secret-key", fetchImpl });
    await expect(
      transport.search({
        url: `${TINYFISH_SEARCH_ENDPOINT}?q=x&count=1`,
        timeoutMs: 20_000,
        maxResponseBytes: 524_288,
        abortSignal: controller.signal,
      }),
    ).rejects.toThrow("aborted");
  });

  it("enforces its own timeout bound when the caller never aborts", async () => {
    const { fetchImpl, calls } = stubFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    const transport = createTinyfishSearchTransport({ apiKey: "secret-key", fetchImpl });
    await expect(
      transport.search({
        url: `${TINYFISH_SEARCH_ENDPOINT}?q=x&count=1`,
        timeoutMs: 10,
        maxResponseBytes: 524_288,
        abortSignal: neverAbortingSignal(),
      }),
    ).rejects.toThrow(/abort/i);
    expect(calls).toHaveLength(1);
  });
});
