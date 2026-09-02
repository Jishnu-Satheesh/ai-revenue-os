import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));

import { createMetaGraphClient } from "@/modules/integrations/providers/meta/client";
import { getMetaCampaignProviderContract } from "@/modules/integrations/providers/meta/contract";

const CONTRACT = getMetaCampaignProviderContract(new Date("2026-08-18T00:00:00.000Z"));
const schema = z.object({ id: z.string() });

function credential(value = "token-abc") {
  return {
    value,
    toJSON(): never {
      throw new Error("A credential must never be serialised.");
    },
  };
}

function client(
  call: (...args: unknown[]) => Promise<unknown>,
  overrides: { retryableStatuses?: readonly number[]; timeoutMs?: number } = {},
) {
  return createMetaGraphClient({
    contract: overrides.retryableStatuses
      ? { ...CONTRACT, retryableStatuses: [...overrides.retryableStatuses] }
      : CONTRACT,
    credential: credential(),
    apiFactory: () => ({ call }) as never,
    timeoutMs: overrides.timeoutMs,
  });
}

/** What the SDK throws for a response that arrived and was not a success. */
function requestError(status: number, error?: Record<string, unknown>) {
  return Object.assign(new Error("meta request failed"), {
    status,
    response: error ? { error } : undefined,
  });
}

describe("the SDK carries the transport and the version", () => {
  it("passes the path as segments, so the SDK prepends its version", async () => {
    const call = vi.fn(async () => ({ id: "1" }));
    await client(call).request({
      method: "GET",
      path: ["me", "media"],
      schema,
      signal: new AbortController().signal,
    });

    // A string path is used verbatim by the SDK and would produce an
    // unversioned request; an array is what makes it prepend v24.0.
    expect(call).toHaveBeenCalledWith("GET", ["me", "media"], {});
    expect(Array.isArray((call.mock.calls[0] as unknown[])[1])).toBe(true);
  });

  it("agrees with the version the contract records", () => {
    expect(CONTRACT.apiVersion).toBe("v24.0");
  });
});

describe("nothing retries unless the contract proves it", () => {
  it("reports a failure as not retryable while the contract lists no statuses", async () => {
    // The checked-in contract's list is empty: no status has been observed
    // against a controlled account, so nothing is proven retryable.
    expect(CONTRACT.retryableStatuses).toEqual([]);

    const result = await client(async () => {
      throw requestError(500, { type: "OAuthException", code: 1 });
    }).request({
      method: "POST",
      path: ["me", "media"],
      schema,
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({ outcome: "failed", retryable: false });
  });

  it("retries only a status the contract actually lists", async () => {
    const result = await client(
      async () => {
        throw requestError(503);
      },
      { retryableStatuses: [503] },
    ).request({
      method: "POST",
      path: ["me", "media"],
      schema,
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({ outcome: "failed", status: 503, retryable: true });
  });

  it("does not retry a neighbouring status the contract omits", async () => {
    const result = await client(
      async () => {
        throw requestError(502);
      },
      { retryableStatuses: [503] },
    ).request({
      method: "POST",
      path: ["me", "media"],
      schema,
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({ outcome: "failed", status: 502, retryable: false });
  });
});

describe("an answer that never arrived is unknown, not failed", () => {
  it("reports a timeout as unknown so the caller reconciles", async () => {
    const result = await client(() => new Promise(() => {}), { timeoutMs: 10 }).request({
      method: "POST",
      path: ["me", "media"],
      schema,
      signal: new AbortController().signal,
    });

    // Calling this failed would invite a retry, and a retried publish is a
    // second post nobody asked for. The SDK cannot abort the request, which is
    // exactly why the outcome is unknown rather than cancelled.
    expect(result).toEqual({ outcome: "unknown", reason: "timeout" });
  });

  it("reports a transport error with no status as unknown", async () => {
    const result = await client(async () => {
      throw new TypeError("socket hang up");
    }).request({
      method: "POST",
      path: ["me", "media"],
      schema,
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ outcome: "unknown", reason: "transport" });
  });
});

describe("no raw provider payload crosses the boundary", () => {
  it("returns parsed data and nothing else on success", async () => {
    const result = await client(async () => ({ id: "17841", extra: "ignored" })).request({
      method: "GET",
      path: ["me"],
      schema,
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ outcome: "succeeded", data: { id: "17841" } });
  });

  it("treats a success whose shape the contract does not describe as a failure", async () => {
    const result = await client(async () => ({ unexpected: true })).request({
      method: "GET",
      path: ["me"],
      schema,
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({
      failureCode: "meta.response_shape_unrecognized",
      retryable: false,
    });
  });

  it("builds a stable code from the status and error type, never the message", async () => {
    const result = await client(async () => {
      throw requestError(400, {
        type: "OAuthException",
        code: 190,
        message: "Caption said: buy one get one",
      });
    }).request({
      method: "POST",
      path: ["me", "media"],
      schema,
      signal: new AbortController().signal,
    });

    if (result.outcome !== "failed") throw new Error("expected a failure");
    expect(result.failureCode).toBe("meta.400.OAuthException.190");
    // A provider message can quote the request back, and a request can carry
    // anything a customer once wrote.
    expect(JSON.stringify(result)).not.toContain("buy one get one");
  });

  it("degrades to the status alone when the error envelope is unreadable", async () => {
    const result = await client(async () => {
      throw requestError(500);
    }).request({
      method: "POST",
      path: ["me", "media"],
      schema,
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({ failureCode: "meta.500" });
  });

  it("never returns a URL, so the query-string token cannot reach a log", async () => {
    // api.call puts the access token in the query string. Nothing here hands a
    // URL back, so it stays out of this platform's logs and error reports.
    const result = await client(async () => {
      throw requestError(400, { type: "OAuthException", code: 190 });
    }).request({
      method: "POST",
      path: ["me", "media"],
      schema,
      signal: new AbortController().signal,
    });

    expect(JSON.stringify(result)).not.toContain("token-abc");
    expect(JSON.stringify(result)).not.toContain("graph.facebook.com");
  });
});
