import "server-only";

/**
 * Fixed Tinyfish Search endpoint. Only this base ever receives a request:
 * the transport asserts the allowlist prefix below, so query text can
 * never redirect construction at another host.
 */
export const TINYFISH_SEARCH_ENDPOINT = "https://api.search.tinyfish.ai";

/**
 * Single-shot provider transport. Implementations must not retry, follow
 * redirects, or widen bounds: every retry is explicit in the runner and
 * accounted against the two-call allowance.
 */
export type TinyfishSearchTransport = {
  search(input: {
    url: string;
    timeoutMs: number;
    maxResponseBytes: number;
    abortSignal: AbortSignal;
  }): Promise<{ status: number; headers: Record<string, string>; body: Uint8Array }>;
};

/**
 * Single-shot live transport over the fixed Tinyfish Search endpoint.
 *
 * Exactly one HTTP request per call: no retries, no redirect following, no
 * bound widening. Every retry stays explicit in the runner and accounted
 * against the two-call allowance. The caller's timeout binds the request
 * through a combined abort signal, and over-bound bodies fail the attempt
 * outright instead of returning.
 *
 * The API key travels only as the `X-API-Key` header of this request. It is
 * never logged, never persisted, and never sent anywhere except the
 * allowlisted endpoint asserted below.
 *
 * This transport is intentionally UNWIRED: constructing it does not enable
 * paid research. Enablement still requires staged provider qualification
 * (account-specific storage/reuse rights, which a working key alone does
 * not prove), budget approval, and the controlled canary.
 */
export function createTinyfishSearchTransport(input: {
  apiKey: string;
  fetchImpl?: typeof globalThis.fetch;
}): TinyfishSearchTransport {
  const apiKey = input.apiKey;
  if (apiKey.length === 0) {
    throw new Error("A Tinyfish Search API key is required for the live transport.");
  }
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  return {
    async search(call) {
      if (!call.url.startsWith(`${TINYFISH_SEARCH_ENDPOINT}?`)) {
        throw new Error("Tinyfish search requests stay on the fixed allowlisted endpoint.");
      }
      // Own timeout bound combined with the caller's signal: either side
      // aborts the single in-flight request, and the abort propagates for
      // the runner to settle as unknown.
      const timeoutSignal = AbortSignal.timeout(call.timeoutMs);
      const signal = AbortSignal.any([call.abortSignal, timeoutSignal]);
      const response = await fetchImpl(call.url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-API-Key": apiKey,
        },
        // Zero redirects: a 3xx answer returns as-is and the runner fails
        // the attempt outright instead of following it anywhere.
        redirect: "manual",
        signal,
      });
      const headers: Record<string, string> = {};
      response.headers.forEach((value, name) => {
        headers[name.toLowerCase()] = value;
      });
      const buffer = await response.arrayBuffer();
      const body = new Uint8Array(buffer);
      if (body.byteLength > call.maxResponseBytes) {
        throw new Error("Tinyfish search response exceeded its byte bound.");
      }
      return { status: response.status, headers, body };
    },
  };
}
