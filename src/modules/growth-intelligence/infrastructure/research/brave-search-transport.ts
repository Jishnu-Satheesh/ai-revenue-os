import "server-only";

import {
  BRAVE_WEB_SEARCH_ENDPOINT,
  type BraveSearchTransport,
} from "@/modules/growth-intelligence/infrastructure/research/brave-search-adapter";

/**
 * Single-shot live transport over the fixed Brave Web Search endpoint.
 *
 * Exactly one HTTP request per call: no retries, no redirect following, no
 * bound widening. Every retry stays explicit in the runner and accounted
 * against the two-call allowance. Bodies stream with the caller's byte
 * budget enforced by the runner on return (over-bound bodies fail the
 * attempt, never imply support).
 *
 * The API key travels only as the `X-Subscription-Token` header of this
 * request. It is never logged, never persisted, and never sent anywhere
 * except the allowlisted endpoint asserted below.
 *
 * This transport is intentionally UNWIRED: constructing it does not enable
 * paid research. Enablement still requires staged provider qualification
 * (account-specific storage/reuse rights, which a working key alone does
 * not prove), budget approval, and the controlled canary.
 */
export function createBraveSearchTransport(input: {
  apiKey: string;
  fetchImpl?: typeof globalThis.fetch;
}): BraveSearchTransport {
  const apiKey = input.apiKey;
  if (apiKey.length === 0) {
    throw new Error("A Brave Search API key is required for the live transport.");
  }
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  return {
    async search(call) {
      if (!call.url.startsWith(`${BRAVE_WEB_SEARCH_ENDPOINT}?`)) {
        throw new Error("Brave search requests stay on the fixed allowlisted endpoint.");
      }
      const response = await fetchImpl(call.url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": apiKey,
        },
        // Zero redirects: a 3xx answer returns as-is and the runner fails
        // the attempt outright instead of following it anywhere.
        redirect: "manual",
        signal: call.abortSignal,
      });
      const headers: Record<string, string> = {};
      response.headers.forEach((value, name) => {
        headers[name.toLowerCase()] = value;
      });
      const buffer = await response.arrayBuffer();
      return { status: response.status, headers, body: new Uint8Array(buffer) };
    },
  };
}
