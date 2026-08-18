import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));

import { createMetaGraphClient } from "@/modules/integrations/providers/meta/client";
import { getMetaCampaignProviderContract } from "@/modules/integrations/providers/meta/contract";

const CONTRACT = getMetaCampaignProviderContract(new Date("2026-08-18T00:00:00.000Z"));

function credential(value = "token-abc") {
  return {
    value,
    toJSON(): never {
      throw new Error("A credential must never be serialised.");
    },
  };
}

function client(
  fetchImpl: typeof fetch,
  overrides: { retryableStatuses?: readonly number[]; timeoutMs?: number } = {},
) {
  return createMetaGraphClient({
    contract: overrides.retryableStatuses
      ? { ...CONTRACT, retryableStatuses: [...overrides.retryableStatuses] }
      : CONTRACT,
    credential: credential(),
    fetchImpl,
    timeoutMs: overrides.timeoutMs,
  });
}

const schema = z.object({ id: z.string() });

function respond(status: number, body: unknown): typeof fetch {
  return vi.fn(
    async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
  ) as unknown as typeof fetch;
}

describe("a call goes to the pinned API version", () => {
  it("builds the path from the contract rather than a constant", async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify({ id: "1" }), { status: 200 }));
    await client(spy as unknown as typeof fetch).request({
      method: "GET",
      path: "me/media",
      schema,
      signal: new AbortController().signal,
    });

    const url = String((spy.mock.calls[0] as unknown[])[0]);
    expect(url).toContain(`/${CONTRACT.apiVersion}/me/media`);
  });

  it("sends the token as a header, never in the URL", async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify({ id: "1" }), { status: 200 }));
    await client(spy as unknown as typeof fetch).request({
      method: "GET",
      path: "me",
      schema,
      signal: new AbortController().signal,
    });

    const [url, init] = spy.mock.calls[0] as [URL, RequestInit];
    // A URL is logged by proxies and shows up in error reports; a header is not.
    expect(String(url)).not.toContain("token-abc");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer token-abc");
  });
});

describe("nothing retries unless the contract proves it", () => {
  it("reports a failure as not retryable while the contract lists no statuses", async () => {
    // The checked-in contract has an empty retryableStatuses list, because no
    // status has been observed against a controlled account.
    expect(CONTRACT.retryableStatuses).toEqual([]);

    const result = await client(
      respond(500, { error: { type: "OAuthException", code: 1 } }),
    ).request({ method: "POST", path: "me/media", schema, signal: new AbortController().signal });

    expect(result).toMatchObject({ outcome: "failed", retryable: false });
  });

  it("retries only a status the contract actually lists", async () => {
    const result = await client(respond(503, {}), { retryableStatuses: [503] }).request({
      method: "POST",
      path: "me/media",
      schema,
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({ outcome: "failed", status: 503, retryable: true });
  });

  it("does not retry a neighbouring status the contract omits", async () => {
    const result = await client(respond(502, {}), { retryableStatuses: [503] }).request({
      method: "POST",
      path: "me/media",
      schema,
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({ outcome: "failed", status: 502, retryable: false });
  });
});

describe("an answer that never arrived is unknown, not failed", () => {
  it("reports a timeout as unknown so the caller reconciles", async () => {
    const hang: typeof fetch = ((_url: unknown, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      })) as unknown as typeof fetch;

    const result = await client(hang, { timeoutMs: 10 }).request({
      method: "POST",
      path: "me/media",
      schema,
      signal: new AbortController().signal,
    });

    // Calling this failed would invite a retry, and a retried publish is a
    // second post nobody asked for.
    expect(result).toEqual({ outcome: "unknown", reason: "timeout" });
  });

  it("reports a transport error as unknown too", async () => {
    const broken: typeof fetch = (() => Promise.reject(new TypeError("network"))) as never;

    const result = await client(broken).request({
      method: "POST",
      path: "me/media",
      schema,
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ outcome: "unknown", reason: "transport" });
  });
});

describe("no raw provider payload crosses the boundary", () => {
  it("returns parsed data and nothing else on success", async () => {
    const result = await client(respond(200, { id: "17841", extra: "ignored" })).request({
      method: "GET",
      path: "me",
      schema,
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ outcome: "succeeded", data: { id: "17841" } });
  });

  it("treats a 200 whose shape the contract does not describe as a failure", async () => {
    const result = await client(respond(200, { unexpected: true })).request({
      method: "GET",
      path: "me",
      schema,
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({
      outcome: "failed",
      failureCode: "meta.response_shape_unrecognized",
      retryable: false,
    });
  });

  it("builds a stable code from the status and error type, never the message", async () => {
    const result = await client(
      respond(400, {
        error: { type: "OAuthException", code: 190, message: "Caption said: buy one get one" },
      }),
    ).request({ method: "POST", path: "me/media", schema, signal: new AbortController().signal });

    if (result.outcome !== "failed") throw new Error("expected a failure");
    expect(result.failureCode).toBe("meta.400.OAuthException.190");
    // The message can quote the request back, and the request can contain
    // anything a customer once wrote.
    expect(JSON.stringify(result)).not.toContain("buy one get one");
  });

  it("degrades to the status alone when the error envelope is unreadable", async () => {
    const result = await client(respond(500, "<html>gateway</html>")).request({
      method: "POST",
      path: "me/media",
      schema,
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({ failureCode: "meta.500" });
  });
});
