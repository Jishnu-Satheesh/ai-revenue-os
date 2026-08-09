import type { MemoryRetrievalResponse } from "@/domain/memory/schemas";
import type { Sensitivity } from "@/domain/memory/types";
import type { MemoryItemDetail, MemorySnapshot } from "@/modules/memory/application/service";

/**
 * Exactly the memory types `searchMemorySchema` accepts. It deliberately omits
 * `fact_proposal`, which the search contract does not allow, so the filter UI
 * cannot offer a value the strict schema would reject.
 */
export const searchableMemoryTypes = [
  "structured_fact",
  "document",
  "note",
  "episode",
  "decision",
  "outcome",
  "lesson",
] as const;

export type SearchableMemoryType = (typeof searchableMemoryTypes)[number];

/**
 * Every Business Memory cache entry hangs off the organization it was read for,
 * so switching tenants can never surface another organization's memory and a
 * later mutation can invalidate exactly the scope it touched.
 */
export const memoryQueryKeys = {
  root: (organizationId: string) => ["organizations", organizationId, "memory"] as const,
  snapshot: (organizationId: string) =>
    [...memoryQueryKeys.root(organizationId), "snapshot"] as const,
  search: (organizationId: string, queryHash: string) =>
    [...memoryQueryKeys.root(organizationId), "search", queryHash] as const,
  timeline: (organizationId: string, filtersHash: string) =>
    [...memoryQueryKeys.root(organizationId), "timeline", filtersHash] as const,
  lessons: (organizationId: string) =>
    [...memoryQueryKeys.root(organizationId), "lessons"] as const,
  item: (organizationId: string, itemId: string) =>
    [...memoryQueryKeys.root(organizationId), "item", itemId] as const,
};

export function memoryBasePath(organizationId: string): string {
  return `/api/organizations/${organizationId}/memory`;
}

export type PublicApiError = { code: string; message: string; retryable?: boolean };

export class MemoryRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "MemoryRequestError";
  }
}

/**
 * Reads the safe public error envelope the API guarantees. The browser never
 * receives an internal cause, so nothing else is worth surfacing here.
 */
export async function memoryRequest<TResponse>(
  input: string,
  init?: RequestInit,
): Promise<TResponse> {
  const response = await fetch(input, init);
  const body = (await response.json().catch(() => null)) as
    | ({ error?: PublicApiError } & Record<string, unknown>)
    | null;
  if (!response.ok) {
    const error = body?.error;
    throw new MemoryRequestError(
      error?.code ?? "UNEXPECTED_ERROR",
      error?.message ?? "The memory request could not be completed.",
      response.status,
      error?.retryable ?? false,
    );
  }
  return body as TResponse;
}

/**
 * The exact request body `searchMemorySchema` accepts. The schema is strict, so
 * this type deliberately carries no field the server would reject, and no
 * `idempotencyKey`: search is a read that the contract refuses to treat as a
 * write.
 */
export type MemorySearchInput = {
  query: string;
  memoryTypes?: readonly SearchableMemoryType[];
  sensitivityAllowance?: Sensitivity;
  maxAgeDays?: number;
  includeSuperseded: boolean;
  includeExpired: boolean;
  limit?: number;
};

/**
 * A stable browser cache discriminator for one search. It is derived from the
 * request the user composed and is never sent anywhere, never persisted, and
 * never used as an authorization input.
 */
export function hashSearchInput(input: MemorySearchInput): string {
  return JSON.stringify([
    input.query,
    [...(input.memoryTypes ?? [])].sort(),
    input.sensitivityAllowance ?? null,
    input.maxAgeDays ?? null,
    input.includeSuperseded,
    input.includeExpired,
    input.limit ?? null,
  ]);
}

/** Drops absent optional filters so a strict schema never sees a null field. */
function searchRequestBody(input: MemorySearchInput): Record<string, unknown> {
  return {
    query: input.query,
    ...(input.memoryTypes?.length ? { memoryTypes: input.memoryTypes } : {}),
    ...(input.sensitivityAllowance ? { sensitivityAllowance: input.sensitivityAllowance } : {}),
    ...(input.maxAgeDays ? { maxAgeDays: input.maxAgeDays } : {}),
    includeSuperseded: input.includeSuperseded,
    includeExpired: input.includeExpired,
    ...(input.limit ? { limit: input.limit } : {}),
  };
}

export function memorySnapshotQueryOptions(input: {
  organizationId: string;
  initialData?: MemorySnapshot;
  initialDataUpdatedAt?: number;
}) {
  return {
    queryKey: memoryQueryKeys.snapshot(input.organizationId),
    queryFn: async () =>
      (await memoryRequest<{ snapshot: MemorySnapshot }>(memoryBasePath(input.organizationId)))
        .snapshot,
    initialData: input.initialData,
    initialDataUpdatedAt: input.initialDataUpdatedAt,
    // Review depth and embedding backlog are only meaningful when recent, so
    // the snapshot goes stale quickly while never blanking what is on screen.
    staleTime: 15_000,
  };
}

/**
 * Search is deliberately cache-free on the server. The browser query cache is a
 * per-tab render cache only: the response keeps `servedFromCache: false`, and
 * nothing here writes to a shared or server-side cache.
 */
export function memorySearchQueryOptions(input: {
  organizationId: string;
  search: MemorySearchInput | null;
}) {
  const search = input.search;
  return {
    queryKey: memoryQueryKeys.search(input.organizationId, search ? hashSearchInput(search) : ""),
    queryFn: async () =>
      memoryRequest<MemoryRetrievalResponse>(`${memoryBasePath(input.organizationId)}/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(searchRequestBody(search as MemorySearchInput)),
      }),
    enabled: search !== null,
    // Retrieval is evaluated against live RLS state; a stale hit would show a
    // reader rows their role may no longer reach.
    staleTime: 0,
    gcTime: 60_000,
  };
}

export function memoryItemQueryOptions(input: {
  organizationId: string;
  itemId: string | null;
  enabled: boolean;
}) {
  return {
    queryKey: memoryQueryKeys.item(input.organizationId, input.itemId ?? ""),
    queryFn: async () =>
      memoryRequest<MemoryItemDetail>(
        `${memoryBasePath(input.organizationId)}/items/${input.itemId}`,
      ),
    enabled: input.enabled && Boolean(input.itemId),
    staleTime: 15_000,
  };
}
