import "server-only";

import { z } from "zod";

import { embeddingTextFor } from "@/domain/memory/embedding-text";
import { memoryError } from "@/domain/memory/errors";
import { env } from "@/lib/env";

/** Fixed by the migration. A model of another width needs a migration, not a config change. */
export const EMBEDDING_DIMENSIONS = 1536;
export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_TIMEOUT_MS = 1_500;

export type EmbeddingProvider = {
  readonly model: string;
  readonly dimensions: number;
  embed(input: {
    organizationId: string;
    correlationId: string;
    texts: readonly string[];
    signal?: AbortSignal;
  }): Promise<readonly (readonly number[])[]>;
};

const embeddingResponseSchema = z.object({
  data: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        embedding: z.array(z.number()),
      }),
    )
    .min(1),
});

type ProviderOptions = {
  apiKey?: string;
  model?: string;
  fetchImplementation?: typeof fetch;
  timeoutMs?: number;
};

/**
 * Returns `null` when no key is configured. Absence is a supported state, not
 * an error: retrieval runs lexically and reports `EMBEDDING_NOT_CONFIGURED`.
 */
export function createEmbeddingProvider(options: ProviderOptions = {}): EmbeddingProvider | null {
  const apiKey = options.apiKey ?? env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const model = options.model ?? env.MEMORY_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL;
  const doFetch = options.fetchImplementation ?? fetch;
  const timeoutMs = options.timeoutMs ?? EMBEDDING_TIMEOUT_MS;

  return {
    model,
    dimensions: EMBEDDING_DIMENSIONS,
    async embed({ texts, signal }) {
      if (texts.length === 0) return [];

      const response = await doFetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, input: [...texts], dimensions: EMBEDDING_DIMENSIONS }),
        signal: signal
          ? AbortSignal.any([AbortSignal.timeout(timeoutMs), signal])
          : AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        // The provider body can contain the request echo; keep it out of the error.
        throw memoryError("CONFLICT", { status: response.status }, "embedding request failed");
      }

      const parsed = embeddingResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw memoryError("VALIDATION_ERROR", {}, "embedding response failed validation");
      }

      const ordered = [...parsed.data.data].sort((left, right) => left.index - right.index);
      if (ordered.length !== texts.length) {
        throw memoryError("VALIDATION_ERROR", {}, "embedding count mismatch");
      }

      // A width mismatch must fail here rather than reaching a column that
      // would accept it silently in some drivers.
      for (const entry of ordered) {
        if (entry.embedding.length !== EMBEDDING_DIMENSIONS) {
          throw memoryError(
            "VALIDATION_ERROR",
            { expected: EMBEDDING_DIMENSIONS, received: entry.embedding.length },
            "embedding dimensionality mismatch",
          );
        }
      }

      return ordered.map((entry) => entry.embedding);
    },
  };
}

export { embeddingTextFor };
