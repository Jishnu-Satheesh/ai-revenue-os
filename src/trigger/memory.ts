import { task, tasks } from "@trigger.dev/sdk";

import { createEventPublisher } from "@/domain/events/publisher";
import { createMemoryWorkerServiceClient } from "@/lib/supabase/service";
import { createEmbeddingProvider } from "@/modules/memory/infrastructure/embedding-provider";
import { createSupabaseMemoryWorkerRepository } from "@/modules/memory/infrastructure/worker-repository";
import {
  parseMemoryTaskPayload,
  type MemoryWorkerDependencies,
} from "@/workflows/memory/contracts";
import { runEmbedItems } from "@/workflows/memory/embed-items";
import { runExpireItems } from "@/workflows/memory/expire-items";
import { runReembedItem } from "@/workflows/memory/reembed-item";

const retry = {
  maxAttempts: 3,
  minTimeoutInMs: 1_000,
  maxTimeoutInMs: 30_000,
  factor: 2,
} as const;

/** Only Trigger registration creates service-role dependencies, after parsing. */
function createWorkerDependencies(signal: AbortSignal): MemoryWorkerDependencies {
  const supabase = createMemoryWorkerServiceClient();
  return {
    repository: createSupabaseMemoryWorkerRepository(supabase),
    embeddings: createEmbeddingProvider(),
    events: createEventPublisher(),
    signal,
  };
}

const cancellationParsers = {
  "memory.embed-items": (payload: unknown) => parseMemoryTaskPayload("memory.embed-items", payload),
  "memory.reembed-item": (payload: unknown) =>
    parseMemoryTaskPayload("memory.reembed-item", payload),
  "memory.expire-items": (payload: unknown) =>
    parseMemoryTaskPayload("memory.expire-items", payload),
} as const;

/**
 * Parsing cancellation payloads fails closed. These workers keep no separate
 * execution row, so their runners expose a cancelled terminal outcome when an
 * execution-aware cancellation dependency is supplied by the runtime.
 */
tasks.onCancel(async ({ task: taskId, payload }) => {
  const parsePayload = cancellationParsers[taskId as keyof typeof cancellationParsers];
  if (!parsePayload) return;
  parsePayload(payload);
});

export const memoryEmbedItemsTask = task({
  id: "memory.embed-items",
  retry,
  maxDuration: 300,
  run: async (payload: unknown, { signal }) => {
    parseMemoryTaskPayload("memory.embed-items", payload);
    return runEmbedItems(payload, createWorkerDependencies(signal));
  },
});

export const memoryReembedItemTask = task({
  id: "memory.reembed-item",
  retry,
  maxDuration: 120,
  run: async (payload: unknown, { signal }) => {
    parseMemoryTaskPayload("memory.reembed-item", payload);
    return runReembedItem(payload, createWorkerDependencies(signal));
  },
});

export const memoryExpireItemsTask = task({
  id: "memory.expire-items",
  retry,
  maxDuration: 120,
  run: async (payload: unknown, { signal }) => {
    parseMemoryTaskPayload("memory.expire-items", payload);
    return runExpireItems(payload, createWorkerDependencies(signal));
  },
});
