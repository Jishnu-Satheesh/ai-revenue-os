import "server-only";

import { z } from "zod";

import type { VerifiedProviderContract } from "@/modules/integrations/providers/meta/contract";
import type { SensitiveCredential } from "@/domain/integrations/credential-store.server";

/**
 * The only way this platform speaks to Meta.
 *
 * Three properties matter more than convenience here.
 *
 * It retries nothing the contract has not proven retryable. `retryableStatuses`
 * is currently empty, because no status has been observed against a controlled
 * account, so today this client retries nothing at all. That is the correct
 * reading of an unproven contract, not a gap to paper over — inventing a retry
 * class is how a publish becomes two publishes.
 *
 * It distinguishes a failure from an unknown. A response that arrived says what
 * happened. A timeout or a transport error after the request left does not, and
 * is reported as unknown so the caller reconciles instead of retrying.
 *
 * No raw provider payload crosses the boundary. Callers receive parsed, bounded
 * data or a stable code; a provider message can echo request content, and
 * request content can be anything a customer once wrote.
 */

export type MetaRequestOutcome<T> =
  | { outcome: "succeeded"; data: T }
  | { outcome: "failed"; status: number; failureCode: string; retryable: boolean }
  | { outcome: "unknown"; reason: "timeout" | "transport" };

export type MetaClientDependencies = {
  contract: VerifiedProviderContract;
  /** Resolved inside the adapter boundary. Never held above it, never logged. */
  credential: SensitiveCredential;
  /** Injected so tests drive it with MSW rather than the network. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/**
 * Long enough for Meta's media endpoints, short enough that a hung socket does
 * not hold a campaign worker's lease. Anything past this is unknown, not failed.
 */
const DEFAULT_TIMEOUT_MS = 30_000;

const GRAPH_ORIGIN = "https://graph.facebook.com";

/** Meta's own error envelope, bounded to the fields worth acting on. */
const providerErrorSchema = z.object({
  error: z
    .object({
      code: z.number().int().optional(),
      error_subcode: z.number().int().optional(),
      type: z.string().optional(),
    })
    .optional(),
});

export function createMetaGraphClient(dependencies: MetaClientDependencies) {
  const timeoutMs = dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch = dependencies.fetchImpl ?? fetch;
  const retryable = new Set(dependencies.contract.retryableStatuses);

  return {
    /**
     * One Graph call, against the pinned API version.
     *
     * The version comes from the contract rather than a constant, so a call can
     * never quietly outlive the contract that documented it.
     */
    async request<T>(input: {
      method: "GET" | "POST";
      /** Path below the version, e.g. `me/media`. Never a full URL. */
      path: string;
      query?: Readonly<Record<string, string>>;
      body?: Readonly<Record<string, unknown>>;
      /** Provider-side de-duplication for writes that support it. */
      idempotencyKey?: string;
      schema: z.ZodType<T>;
      signal: AbortSignal;
    }): Promise<MetaRequestOutcome<T>> {
      const url = new URL(
        `${GRAPH_ORIGIN}/${dependencies.contract.apiVersion}/${input.path.replace(/^\/+/, "")}`,
      );
      for (const [key, value] of Object.entries(input.query ?? {})) {
        url.searchParams.set(key, value);
      }

      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(), timeoutMs);
      // The caller's cancellation and our own timeout both have to stop the
      // request, and the caller's must not be mistaken for a timeout.
      const onAbort = () => timeout.abort();
      input.signal.addEventListener("abort", onAbort, { once: true });

      let response: Response;
      try {
        response = await doFetch(url, {
          method: input.method,
          signal: timeout.signal,
          headers: {
            // The token travels in a header, never the query string: a URL is
            // logged by proxies and appears in error reports.
            authorization: `Bearer ${dependencies.credential.value}`,
            "content-type": "application/json",
            ...(input.idempotencyKey ? { "x-meta-idempotency-key": input.idempotencyKey } : {}),
          },
          body: input.body ? JSON.stringify(input.body) : undefined,
        });
      } catch (error) {
        // Nobody knows whether this reached Meta. Calling it a failure would
        // invite a retry, and a retried publish is a duplicate post.
        return {
          outcome: "unknown",
          reason: isAbort(error) ? "timeout" : "transport",
        };
      } finally {
        clearTimeout(timer);
        input.signal.removeEventListener("abort", onAbort);
      }

      const text = await response.text().catch(() => "");

      if (!response.ok) {
        return {
          outcome: "failed",
          status: response.status,
          failureCode: normalizedFailureCode(response.status, text),
          // Only what the contract proves. An empty list means nothing retries.
          retryable: retryable.has(response.status),
        };
      }

      const parsed = input.schema.safeParse(safeJson(text));
      if (!parsed.success) {
        // A 200 whose body is not what the contract describes is a failure of
        // this integration's understanding, not a provider error to retry.
        return {
          outcome: "failed",
          status: response.status,
          failureCode: "meta.response_shape_unrecognized",
          retryable: false,
        };
      }

      return { outcome: "succeeded", data: parsed.data };
    },
  };
}

export type MetaGraphClient = ReturnType<typeof createMetaGraphClient>;

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * A stable code built from the status and Meta's own error type.
 *
 * Deliberately not the provider's message. The message is prose that changes
 * without notice and can quote back the request, which may contain a caption a
 * customer wrote.
 */
function normalizedFailureCode(status: number, text: string): string {
  const parsed = providerErrorSchema.safeParse(safeJson(text));
  const type = parsed.success ? parsed.data.error?.type : undefined;
  const code = parsed.success ? parsed.data.error?.code : undefined;
  if (type && code !== undefined) return `meta.${status}.${type}.${code}`;
  if (type) return `meta.${status}.${type}`;
  return `meta.${status}`;
}
