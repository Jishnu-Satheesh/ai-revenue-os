import "server-only";

import { z } from "zod";
import { FacebookAdsApi } from "facebook-nodejs-business-sdk";

import type { VerifiedProviderContract } from "@/modules/integrations/providers/meta/contract";
import type { SensitiveCredential } from "@/domain/integrations/credential-store.server";

/**
 * The only way this platform speaks to Meta.
 *
 * Transport is the official Business SDK, so the endpoint shapes, URL building
 * and version pinning come from Meta rather than from us. Everything the
 * platform's own rules require sits on top of it, because the SDK does not
 * provide it: bounded response schemas, stable failure codes, retry
 * classification taken from the contract, and a separate answer for a request
 * whose outcome nobody knows.
 *
 * Two SDK behaviours are handled rather than inherited.
 *
 * Its crash reporter is enabled by default and sends diagnostics to Meta. It is
 * switched off here — this platform decides what leaves it.
 *
 * `api.call()` puts the access token in the query string, which is Meta's
 * documented form but worse for log hygiene than a header. Nothing in this
 * module logs a URL, and callers never receive one, so the token stays out of
 * this platform's own logs and error reports. See ADR 0023.
 */

export type MetaRequestOutcome<T> =
  | { outcome: "succeeded"; data: T }
  | { outcome: "failed"; status: number; failureCode: string; retryable: boolean }
  | { outcome: "unknown"; reason: "timeout" | "transport" };

export type MetaClientDependencies = {
  contract: VerifiedProviderContract;
  /** Resolved inside the adapter boundary. Never held above it, never logged. */
  credential: SensitiveCredential;
  /** Injected so tests drive the SDK's transport without the network. */
  apiFactory?: (accessToken: string) => Pick<FacebookAdsApi, "call">;
  timeoutMs?: number;
};

/**
 * Long enough for Meta's media endpoints, short enough that a hung socket does
 * not hold a campaign worker's lease. Past this the outcome is unknown.
 */
const DEFAULT_TIMEOUT_MS = 30_000;

/** Meta's error envelope, bounded to the fields worth acting on. */
const providerErrorSchema = z.object({
  code: z.number().int().optional(),
  error_subcode: z.number().int().optional(),
  type: z.string().optional(),
  http_status: z.number().int().optional(),
});

export function createMetaGraphClient(dependencies: MetaClientDependencies) {
  const timeoutMs = dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryable = new Set(dependencies.contract.retryableStatuses);

  // `crash_log: false` is the third argument. Left at its default the SDK
  // installs a global handler that reports crashes to Meta.
  const api =
    dependencies.apiFactory?.(dependencies.credential.value) ??
    new FacebookAdsApi(dependencies.credential.value, "en_US", false);

  return {
    /**
     * One Graph call at the version the SDK pins, which the contract mirrors.
     *
     * The path is given as segments rather than a string: the SDK only prepends
     * its version when handed an array, and a string path is used verbatim.
     * Passing a string would silently produce an unversioned request.
     */
    async request<T>(input: {
      method: "GET" | "POST";
      /** Path segments below the version, e.g. `["me", "media"]`. */
      path: readonly string[];
      params?: Readonly<Record<string, unknown>>;
      schema: z.ZodType<T>;
      signal: AbortSignal;
    }): Promise<MetaRequestOutcome<T>> {
      let raw: unknown;
      try {
        raw = await withTimeout(
          api.call(input.method, [...input.path], { ...(input.params ?? {}) }),
          timeoutMs,
          input.signal,
        );
      } catch (error) {
        if (error instanceof MetaTimeout) return { outcome: "unknown", reason: "timeout" };

        const status = statusOf(error);
        if (status === null) {
          // Nobody knows whether this reached Meta. Calling it a failure would
          // invite a retry, and a retried publish is a second post.
          return { outcome: "unknown", reason: "transport" };
        }

        return {
          outcome: "failed",
          status,
          failureCode: normalizedFailureCode(status, error),
          // Only what the contract proves. An empty list means nothing retries.
          retryable: retryable.has(status),
        };
      }

      const parsed = input.schema.safeParse(raw);
      if (!parsed.success) {
        // A success whose body is not what the contract describes is a failure
        // of this integration's understanding, not a provider error to retry.
        return {
          outcome: "failed",
          status: 200,
          failureCode: "meta.response_shape_unrecognized",
          retryable: false,
        };
      }

      return { outcome: "succeeded", data: parsed.data };
    },
  };
}

export type MetaGraphClient = ReturnType<typeof createMetaGraphClient>;

class MetaTimeout extends Error {}

/**
 * The SDK exposes no timeout or cancellation, so both are imposed here.
 *
 * The underlying request is not aborted — it cannot be — which is precisely why
 * the result is `unknown` rather than `failed`: the call may still land.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new MetaTimeout("timed out")), ms);
    const onAbort = () => reject(new MetaTimeout("cancelled"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    });
  });
}

/** `FacebookRequestError` carries the status; a transport failure does not. */
function statusOf(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const candidate = error as { status?: unknown; response?: { status?: unknown } };
  const status = candidate.status ?? candidate.response?.status;
  return typeof status === "number" && status >= 100 && status <= 599 ? status : null;
}

/**
 * A stable code from the status and Meta's own error type.
 *
 * Deliberately not the provider's message. The message is prose that changes
 * without notice and can quote the request back, and a request can carry a
 * caption a customer wrote.
 */
function normalizedFailureCode(status: number, error: unknown): string {
  const body = (error as { response?: { error?: unknown } })?.response?.error;
  const parsed = providerErrorSchema.safeParse(body);
  const type = parsed.success ? parsed.data.type : undefined;
  const code = parsed.success ? parsed.data.code : undefined;
  if (type && code !== undefined) return `meta.${status}.${type}.${code}`;
  if (type) return `meta.${status}.${type}`;
  return `meta.${status}`;
}
