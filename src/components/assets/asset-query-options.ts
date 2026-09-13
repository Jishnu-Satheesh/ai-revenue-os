import { createClient } from "@/lib/supabase/browser";
import type { CreativeHistoryEligibility, CreativeHistoryMetadata } from "@/domain/campaigns/creative-history";
import type {
  CreativeHistoryBatchCompletionOutcome,
  CreativeHistoryCompletionOutcome,
  CreativeHistoryFolderView,
  CreativeHistoryIntakeContract,
  CreativeHistoryItemView,
  CreativeHistoryReservation,
  CreativeHistoryRights,
} from "@/modules/campaigns/application/creative-history-service";

/**
 * The client-side surface for Creative History: query keys, request helpers,
 * and the direct-to-storage upload step that the server API cannot do for the
 * browser.
 *
 * Every query key is shaped `["organizations", organizationId, "creative-history", ...]`
 * so a mutation can invalidate exactly this organization's Creative History
 * without touching another organization's cache and without guessing at a
 * shared root some other feature also uses.
 *
 * The three-step upload (reserve → transfer → finalize) is spread across two
 * files on purpose: `reserveCreativeItem` / `reserveCreativeVersion` and
 * `completeCreativeVersion` talk to this app's own API, which is the only
 * place with the authority to write `creative_items` rows. Between those two
 * calls, `uploadCreativeBytes` below talks directly to Supabase Storage using
 * the caller's own session — there is no server relay for the bytes
 * themselves, and there does not need to be one: the storage policy checks
 * the same tenant path the reservation already committed to.
 */

export type { CreativeHistoryEligibility, CreativeHistoryMetadata };
export type {
  CreativeHistoryBatchCompletionOutcome,
  CreativeHistoryCompletionOutcome,
  CreativeHistoryFolderView,
  CreativeHistoryIntakeContract,
  CreativeHistoryItemView,
  CreativeHistoryReservation,
  CreativeHistoryRights,
};

export const creativeHistoryQueryKeys = {
  root: (organizationId: string) =>
    ["organizations", organizationId, "creative-history"] as const,
  intake: (organizationId: string) =>
    [...creativeHistoryQueryKeys.root(organizationId), "intake"] as const,
  folders: (organizationId: string) =>
    [...creativeHistoryQueryKeys.root(organizationId), "folders"] as const,
  items: (organizationId: string, filtersHash: string) =>
    [...creativeHistoryQueryKeys.root(organizationId), "items", filtersHash] as const,
  item: (organizationId: string, itemId: string) =>
    [...creativeHistoryQueryKeys.root(organizationId), "item", itemId] as const,
};

export function creativeHistoryBasePath(organizationId: string): string {
  return `/api/organizations/${organizationId}/assets/creative-history`;
}

export type PublicApiError = { code: string; message: string };

export class CreativeHistoryRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "CreativeHistoryRequestError";
  }
}

/** Reads the safe public error envelope every route in this API guarantees. */
export async function creativeHistoryRequest<TResponse>(
  input: string,
  init?: RequestInit,
): Promise<TResponse> {
  const response = await fetch(input, init);
  const body = (await response.json().catch(() => null)) as
    | ({ error?: PublicApiError } & Record<string, unknown>)
    | null;
  if (!response.ok) {
    const error = body?.error;
    throw new CreativeHistoryRequestError(
      error?.code ?? "UNEXPECTED_ERROR",
      error?.message ?? "That did not go through. Nothing was changed.",
      response.status,
    );
  }
  return body as TResponse;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type CreativeHistoryItemFilters = {
  folderId?: string | null;
  eligibility?: CreativeHistoryEligibility;
  includeArchived?: boolean;
};

export function hashItemFilters(filters: CreativeHistoryItemFilters): string {
  return JSON.stringify([
    filters.folderId ?? null,
    filters.eligibility ?? null,
    filters.includeArchived ?? false,
  ]);
}

export function creativeHistoryIntakeQueryOptions(input: { organizationId: string }) {
  return {
    queryKey: creativeHistoryQueryKeys.intake(input.organizationId),
    queryFn: () =>
      creativeHistoryRequest<{
        intake: CreativeHistoryIntakeContract;
        reviewReasons: readonly { code: string; description: string }[];
      }>(`${creativeHistoryBasePath(input.organizationId)}/intake`),
    // The upload contract changes only when a migration or configuration
    // changes it, never per keystroke.
    staleTime: 60_000,
  };
}

export function creativeHistoryFoldersQueryOptions(input: { organizationId: string }) {
  return {
    queryKey: creativeHistoryQueryKeys.folders(input.organizationId),
    queryFn: () =>
      creativeHistoryRequest<{ folders: readonly CreativeHistoryFolderView[] }>(
        `${creativeHistoryBasePath(input.organizationId)}/folders`,
      ).then((body) => body.folders),
    staleTime: 15_000,
  };
}

export function creativeHistoryItemsQueryOptions(input: {
  organizationId: string;
  filters: CreativeHistoryItemFilters;
}) {
  const { organizationId, filters } = input;
  const search = new URLSearchParams();
  if (filters.folderId) search.set("folderId", filters.folderId);
  if (filters.eligibility) search.set("eligibility", filters.eligibility);
  if (filters.includeArchived) search.set("includeArchived", "true");
  const query = search.toString();
  return {
    queryKey: creativeHistoryQueryKeys.items(organizationId, hashItemFilters(filters)),
    queryFn: () =>
      creativeHistoryRequest<{ items: readonly CreativeHistoryItemView[] }>(
        `${creativeHistoryBasePath(organizationId)}/items${query ? `?${query}` : ""}`,
      ).then((body) => body.items),
    // Read against live RLS/review state; a stale hit could show a verdict
    // that was just overturned.
    staleTime: 5_000,
  };
}

export function creativeHistoryItemQueryOptions(input: {
  organizationId: string;
  itemId: string | null;
}) {
  return {
    queryKey: creativeHistoryQueryKeys.item(input.organizationId, input.itemId ?? ""),
    queryFn: () =>
      creativeHistoryRequest<{ item: CreativeHistoryItemView }>(
        `${creativeHistoryBasePath(input.organizationId)}/items/${input.itemId}`,
      ).then((body) => body.item),
    enabled: Boolean(input.itemId),
    staleTime: 5_000,
  };
}

export async function invalidateCreativeHistoryQueries(
  queryClient: { invalidateQueries: (filters: { queryKey: readonly unknown[] }) => Promise<void> },
  organizationId: string,
): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: creativeHistoryQueryKeys.root(organizationId) });
}

// ---------------------------------------------------------------------------
// Writes: reserve → transfer → finalize
// ---------------------------------------------------------------------------

export type ReserveCreativeItemInput = {
  label: string;
  creativeType: string;
  folderId: string | null;
  rights: CreativeHistoryRights;
  clientUploadId: string;
};

export function reserveCreativeItem(
  organizationId: string,
  input: ReserveCreativeItemInput,
  init?: { signal?: AbortSignal },
): Promise<CreativeHistoryReservation> {
  return creativeHistoryRequest(`${creativeHistoryBasePath(organizationId)}/items`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal: init?.signal,
  });
}

export function reserveCreativeVersion(
  organizationId: string,
  itemId: string,
  clientUploadId: string,
  init?: { signal?: AbortSignal },
): Promise<CreativeHistoryReservation> {
  return creativeHistoryRequest(
    `${creativeHistoryBasePath(organizationId)}/items/${itemId}/versions`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientUploadId }),
      signal: init?.signal,
    },
  );
}

/**
 * The transfer step: bytes go straight to private Storage through the
 * caller's own session, never through this app's server. `upsert: true`
 * because a retry after a failed transfer reuses the same reserved path —
 * the server re-reads and re-validates the bytes regardless of whether this
 * is the first write to that key or a replacement of a half-finished one.
 *
 * A failure here is reported with a plain, generic sentence rather than
 * `error.message` verbatim. Supabase Storage's own error text is a raw
 * Postgres/RLS message ("new row violates row-level security policy" was
 * seen live against staging on a retried upload before the storage policy
 * carried an UPDATE grant — see the `20260913110000` migration); surfacing
 * that to an operator both leaks implementation detail this platform's
 * communication rules forbid and reads as gibberish to someone who is not a
 * database engineer. The outcome is still an honest refusal — retry is still
 * offered — it is just never worded as though the server told the user
 * something intelligible when it did not.
 */
export async function uploadCreativeBytes(input: {
  bucket: string;
  storagePath: string;
  file: File;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const supabase = createClient();
  const { error } = await supabase.storage.from(input.bucket).upload(input.storagePath, input.file, {
    contentType: input.file.type || "application/octet-stream",
    upsert: true,
  });
  if (error) {
    return { ok: false, message: "That file could not be sent. Try uploading it again." };
  }
  return { ok: true };
}

const COMPLETION_OUTCOME_STATUSES = new Set(["usable", "refused", "conflict"]);

/**
 * Unlike every other route in this API, `complete` carries its real answer in
 * the HTTP status code on purpose — 201 usable, 409 conflict, 422 refused,
 * "never 200" — so a refusal can never be mistaken for success even by a
 * caller that only looks at `response.ok`. That means a non-2xx response
 * here is not necessarily a transport error to throw: it is very often the
 * expected typed outcome, still wearing the `{status: "refused", reason,
 * message}` shape `CreativeHistoryCompletionOutcome` declares, not the
 * `{error: PublicError}` envelope `creativeHistoryRequest` expects. Reading
 * the body itself and checking which shape came back — rather than trusting
 * `response.ok` — is what keeps a real refusal reason from collapsing into
 * this file's generic "that did not go through" fallback.
 */
export async function completeCreativeVersion(
  organizationId: string,
  itemId: string,
  versionId: string,
  init?: { signal?: AbortSignal },
): Promise<CreativeHistoryCompletionOutcome> {
  const response = await fetch(
    `${creativeHistoryBasePath(organizationId)}/items/${itemId}/versions/${versionId}/complete`,
    { method: "POST", signal: init?.signal },
  );
  const body = (await response.json().catch(() => null)) as
    | (CreativeHistoryCompletionOutcome & { status: string })
    | { error?: PublicApiError }
    | null;
  if (body && typeof body === "object" && "status" in body && COMPLETION_OUTCOME_STATUSES.has(body.status)) {
    return body as CreativeHistoryCompletionOutcome;
  }
  const error = (body as { error?: PublicApiError } | null)?.error;
  throw new CreativeHistoryRequestError(
    error?.code ?? "UNEXPECTED_ERROR",
    error?.message ?? "That did not go through. Nothing was changed.",
    response.status,
  );
}

export function completeCreativeUploadsBatch(
  organizationId: string,
  uploads: readonly { itemId: string; versionId: string }[],
): Promise<CreativeHistoryBatchCompletionOutcome> {
  return creativeHistoryRequest(`${creativeHistoryBasePath(organizationId)}/uploads/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ uploads }),
  });
}

// ---------------------------------------------------------------------------
// Writes: folders, review, metadata, archive
// ---------------------------------------------------------------------------

export function createCreativeFolder(
  organizationId: string,
  input: { name: string; parentFolderId: string | null; defaultMetadata: CreativeHistoryMetadata | null },
): Promise<{ folderId: string }> {
  return creativeHistoryRequest(`${creativeHistoryBasePath(organizationId)}/folders`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function reviewCreativeVersion(
  organizationId: string,
  itemId: string,
  input: {
    versionId: string;
    verdict: "approved" | "rejected";
    reasonCodes: readonly string[];
    note: string | null;
  },
): Promise<{ reviewId: string; verdict: string; reviewedAt: string }> {
  return creativeHistoryRequest(
    `${creativeHistoryBasePath(organizationId)}/items/${itemId}/reviews`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}

export function confirmCreativeMetadata(
  organizationId: string,
  itemId: string,
  confirmedMetadata: CreativeHistoryMetadata | null,
): Promise<{ itemId: string; metadataConfirmed: boolean }> {
  return creativeHistoryRequest(
    `${creativeHistoryBasePath(organizationId)}/items/${itemId}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmedMetadata }),
    },
  );
}

export function archiveCreativeItem(
  organizationId: string,
  itemId: string,
): Promise<{ itemId: string; archivedAt: string }> {
  return creativeHistoryRequest(`${creativeHistoryBasePath(organizationId)}/items/${itemId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ archived: true }),
  });
}

/** A local ID per file, so two files named `poster.png` never collide. */
export function newClientUploadId(): string {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// The existing brand-asset reference API — reused as-is for Products &
// Subjects and Brand Kit, per the binding decision that Task 2's new API is
// for Creative History only. Same reserve/transfer/finalize shape, different
// endpoints and a different classification body.
// ---------------------------------------------------------------------------

function brandAssetsBasePath(organizationId: string): string {
  return `/api/organizations/${organizationId}/assets`;
}

export type BrandAssetReservation = {
  brandAssetId: string;
  versionId: string;
  storagePath: string;
};

export type ReserveBrandAssetInput = {
  label: string;
  assetRole: "logo" | "product" | "venue" | "team" | "other";
  classification: {
    conditioningRoles: readonly string[];
    tags: readonly string[];
    scripts: readonly string[];
    ownership: "owned" | "third_party";
  };
};

export function reserveBrandAsset(
  organizationId: string,
  input: ReserveBrandAssetInput,
  init?: { signal?: AbortSignal },
): Promise<BrandAssetReservation> {
  return creativeHistoryRequest(brandAssetsBasePath(organizationId), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal: init?.signal,
  });
}

export type BrandAssetCompletionOutcome =
  | { status: "usable"; versionId: string; contentHash: string }
  | { status: "rejected"; reason: string; message: string };

export function completeBrandAssetVersion(
  organizationId: string,
  brandAssetId: string,
  versionId: string,
  init?: { signal?: AbortSignal },
): Promise<BrandAssetCompletionOutcome> {
  return creativeHistoryRequest(
    `${brandAssetsBasePath(organizationId)}/${brandAssetId}/versions/${versionId}/complete`,
    { method: "POST", signal: init?.signal },
  );
}

// ---------------------------------------------------------------------------
// Subjects: the create entry point `SubjectList` never had.
// ---------------------------------------------------------------------------

export type CreateSubjectInput = {
  name: string;
  slug: string;
  description: string | null;
};

export function createSubjectProfile(
  organizationId: string,
  input: CreateSubjectInput,
): Promise<{ subjectProfileId: string; state: string; created: boolean }> {
  return creativeHistoryRequest(`/api/organizations/${organizationId}/subjects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: input.name,
      slug: input.slug,
      description: input.description,
      tags: [],
      namesByScript: {},
      mustNotAppear: [],
      illustratedStyle: false,
    }),
  });
}
