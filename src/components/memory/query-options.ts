"use client";

import { keepPreviousData } from "@tanstack/react-query";
import { useRef } from "react";

import type { MemoryRetrievalResponse } from "@/domain/memory/schemas";
import type { Sensitivity } from "@/domain/memory/types";
import type {
  MemoryItemDetail,
  MemoryItemView,
  MemorySnapshot,
} from "@/modules/memory/application/service";

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

/**
 * Timeline filters the route actually parses. Branch options come from the
 * authenticated snapshot, so the control offers only branches this reader can
 * already see rather than any value the route would accept.
 */
export type MemoryTimelineFilters = {
  sourceSystems: readonly string[];
  branchId?: string;
  limit?: number;
};

export type MemoryTimelinePage = {
  items: MemoryItemView[];
  nextCursor?: string;
};

export function hashTimelineFilters(filters: MemoryTimelineFilters): string {
  return JSON.stringify([
    [...filters.sourceSystems].sort(),
    filters.branchId ?? null,
    filters.limit ?? null,
  ]);
}

export function memoryTimelineQueryOptions(input: {
  organizationId: string;
  filters: MemoryTimelineFilters;
}) {
  const { organizationId, filters } = input;
  return {
    queryKey: memoryQueryKeys.timeline(organizationId, hashTimelineFilters(filters)),
    queryFn: async ({ pageParam }: { pageParam?: string }) => {
      const search = new URLSearchParams();
      search.set("limit", String(filters.limit ?? 50));
      for (const sourceSystem of filters.sourceSystems) search.append("sourceSystem", sourceSystem);
      if (filters.branchId) search.set("branchId", filters.branchId);
      if (pageParam) search.set("cursor", pageParam);
      return memoryRequest<MemoryTimelinePage>(
        `${memoryBasePath(organizationId)}/timeline?${search.toString()}`,
      );
    },
    initialPageParam: undefined as string | undefined,
    /**
     * Only the cursor the server returned is followed; the client never builds
     * one. The read model emits a cursor whenever a page has any rows, so a
     * short page is also treated as the end — otherwise the workspace would
     * keep offering "load older" for a page that can only come back empty.
     */
    getNextPageParam: (lastPage: MemoryTimelinePage) =>
      lastPage.items.length < (filters.limit ?? 50) ? undefined : lastPage.nextCursor,
    // A filter change must not blank the entries already being read.
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  };
}

export type MemoryLessonsResponse = {
  items: MemoryItemView[];
  evidence: Record<string, string[]>;
};

export function memoryLessonsQueryOptions(input: { organizationId: string; limit?: number }) {
  return {
    queryKey: memoryQueryKeys.lessons(input.organizationId),
    queryFn: async () =>
      memoryRequest<MemoryLessonsResponse>(
        `${memoryBasePath(input.organizationId)}/lessons?limit=${input.limit ?? 50}`,
      ),
    staleTime: 15_000,
  };
}

/**
 * Refreshes every organization-scoped read a governed write can affect. It runs
 * only after the server has confirmed the write: nothing here is optimistic, so
 * a row changes on screen because the next authenticated read said so.
 */
export async function invalidateMemoryQueries(
  queryClient: {
    invalidateQueries: (filters: { queryKey: readonly unknown[] }) => Promise<void>;
  },
  organizationId: string,
): Promise<void> {
  const root = memoryQueryKeys.root(organizationId);
  await Promise.all(
    [
      memoryQueryKeys.snapshot(organizationId),
      [...root, "item"],
      [...root, "search"],
      [...root, "timeline"],
      memoryQueryKeys.lessons(organizationId),
    ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
  );
}

/** Every retried side effect carries the same key, so a replay never doubles. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

/**
 * Keeps one idempotency key per distinct request payload.
 *
 * Retrying the *same* submission must reuse its key so a write whose response
 * was lost replays instead of committing twice. Submitting *different* content
 * must mint a new one: the server rejects a key reused for another request
 * fingerprint, so carrying the old key forward would make an edited resubmit
 * permanently unacceptable. Keying off the payload satisfies both.
 */
export function useIdempotencyKey() {
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  return {
    keyFor(payload: unknown): string {
      const fingerprint = JSON.stringify(payload);
      if (attempt.current?.fingerprint !== fingerprint) {
        attempt.current = { fingerprint, key: newIdempotencyKey() };
      }
      return attempt.current.key;
    },
    reset() {
      attempt.current = null;
    },
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
