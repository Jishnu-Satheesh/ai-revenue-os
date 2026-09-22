"use client";

import { useCallback, useEffect, useState } from "react";
import { z } from "zod";

/**
 * One competitor saved against the organisation, shared by the New research
 * dialog and Guided onboarding. Shape follows the Track C1 list API
 * (`GET .../growth-intelligence/competitors`): `{ competitors: [...] }`
 * with UUID ids, nullable website / location hint, served in name order.
 * The UI normalizes nulls to "" — the wire mapping (omit-empty on create,
 * null-clears on update) lives in the functions below.
 */
export const OrganizationCompetitorSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  website: z.string().trim().max(2_048).nullable().optional(),
  locationHint: z.string().trim().max(240).nullable().optional(),
});

export type OrganizationCompetitor = {
  id: string;
  name: string;
  website: string;
  locationHint: string;
};

export type OrganizationCompetitorInput = {
  name: string;
  website?: string;
  locationHint?: string;
};

const CompetitorRowSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(160),
  website: z.string().trim().max(2_048).nullable().optional(),
  locationHint: z.string().trim().max(240).nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

const ListResponseSchema = z.union([
  z.object({ competitors: z.array(CompetitorRowSchema) }),
  z.array(CompetitorRowSchema),
]);

const SingleResponseSchema = z.union([
  z.object({ competitor: CompetitorRowSchema }),
  CompetitorRowSchema,
]);

function collectionPath(organizationId: string): string {
  return `/api/organizations/${organizationId}/growth-intelligence/competitors`;
}

function itemPath(organizationId: string, competitorId: string): string {
  return `${collectionPath(organizationId)}/${competitorId}`;
}

function normalizeRow(row: z.infer<typeof CompetitorRowSchema>): OrganizationCompetitor {
  return {
    id: row.id,
    name: row.name.trim(),
    website: (row.website ?? "").trim(),
    locationHint: (row.locationHint ?? "").trim(),
  };
}

/** Keep the API's returned order; drop rows without a usable name. */
function normalizeList(body: unknown): OrganizationCompetitor[] {
  const parsed = ListResponseSchema.safeParse(body);
  if (!parsed.success) return [];
  const rows = Array.isArray(parsed.data) ? parsed.data : parsed.data.competitors;
  return rows.map(normalizeRow).filter((row) => row.name.length > 0);
}

function normalizeSingle(body: unknown): OrganizationCompetitor | null {
  const parsed = SingleResponseSchema.safeParse(body);
  if (!parsed.success) return null;
  const row = "competitor" in parsed.data ? parsed.data.competitor : parsed.data;
  const normalized = normalizeRow(row);
  return normalized.name.length > 0 ? normalized : null;
}

function byName(left: OrganizationCompetitor, right: OrganizationCompetitor): number {
  return left.name.localeCompare(right.name);
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

/** The create body omits empty optionals: the API rejects empty strings. */
function createBody(input: OrganizationCompetitorInput): Record<string, string> {
  const name = input.name.trim();
  const website = (input.website ?? "").trim();
  const locationHint = (input.locationHint ?? "").trim();
  return {
    name,
    ...(website ? { website } : {}),
    ...(locationHint ? { locationHint } : {}),
  };
}

export async function fetchOrganizationCompetitors(
  organizationId: string,
): Promise<OrganizationCompetitor[]> {
  const response = await fetch(collectionPath(organizationId), { cache: "no-store" });
  if (!response.ok) throw new Error(`COMPETITOR_LIST_FAILED:${response.status}`);
  return normalizeList(await readJson(response));
}

export async function addOrganizationCompetitor(
  organizationId: string,
  input: OrganizationCompetitorInput,
): Promise<OrganizationCompetitor | null> {
  if (input.name.trim().length === 0) throw new Error("COMPETITOR_INVALID");
  const response = await fetch(collectionPath(organizationId), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(createBody(input)),
  });
  if (!response.ok) throw new Error(`COMPETITOR_ADD_FAILED:${response.status}`);
  return normalizeSingle(await readJson(response));
}

export async function updateOrganizationCompetitor(
  organizationId: string,
  competitorId: string,
  input: OrganizationCompetitorInput,
): Promise<OrganizationCompetitor | null> {
  if (input.name.trim().length === 0) throw new Error("COMPETITOR_INVALID");
  const response = await fetch(itemPath(organizationId, competitorId), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    // Null clears a field; an empty string would fail validation.
    body: JSON.stringify({
      name: input.name.trim(),
      website: (input.website ?? "").trim() || null,
      locationHint: (input.locationHint ?? "").trim() || null,
    }),
  });
  if (!response.ok) throw new Error(`COMPETITOR_UPDATE_FAILED:${response.status}`);
  return normalizeSingle(await readJson(response));
}

export async function deleteOrganizationCompetitor(
  organizationId: string,
  competitorId: string,
): Promise<void> {
  const response = await fetch(itemPath(organizationId, competitorId), { method: "DELETE" });
  if (!response.ok) throw new Error(`COMPETITOR_DELETE_FAILED:${response.status}`);
}

export type UseOrganizationCompetitorsResult = {
  /** Empty until the first successful load; never null to callers. */
  competitors: OrganizationCompetitor[];
  isLoaded: boolean;
  isLoading: boolean;
  /** Latest mutation failure, if any. Reads fail silently (empty list). */
  syncError: string | null;
  refresh: () => Promise<void>;
  add: (input: OrganizationCompetitorInput) => Promise<OrganizationCompetitor | null>;
  update: (competitorId: string, input: OrganizationCompetitorInput) => Promise<boolean>;
  remove: (competitorId: string) => Promise<boolean>;
};

/**
 * Organisation-wide competitor store over the Track C1 list API. Reads fail
 * silently to an empty list so the dialog keeps working when the backend is
 * unreachable; mutations report success so callers can keep the brief-local
 * row either way. No secrets are logged — failures carry status codes only.
 */
export function useOrganizationCompetitors(
  organizationId: string,
  enabled: boolean,
): UseOrganizationCompetitorsResult {
  const [competitors, setCompetitors] = useState<OrganizationCompetitor[] | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || organizationId.length === 0) return;
    let cancelled = false;
    fetchOrganizationCompetitors(organizationId)
      .then((list) => {
        if (!cancelled) setCompetitors(list);
      })
      .catch(() => {
        if (!cancelled) setCompetitors((current) => current ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, organizationId]);

  const refresh = useCallback(async () => {
    if (organizationId.length === 0) return;
    try {
      setCompetitors(await fetchOrganizationCompetitors(organizationId));
    } catch {
      setCompetitors((current) => current ?? []);
    }
  }, [organizationId]);

  const add = useCallback(
    async (input: OrganizationCompetitorInput): Promise<OrganizationCompetitor | null> => {
      try {
        const created = await addOrganizationCompetitor(organizationId, input);
        setSyncError(null);
        if (created) {
          setCompetitors((current) =>
            [...(current ?? []).filter((row) => row.id !== created.id), created].sort(byName),
          );
        }
        return created;
      } catch {
        setSyncError("The organisation list could not be updated — kept in this brief only.");
        return null;
      }
    },
    [organizationId],
  );

  const update = useCallback(
    async (competitorId: string, input: OrganizationCompetitorInput): Promise<boolean> => {
      try {
        const saved = await updateOrganizationCompetitor(organizationId, competitorId, input);
        setSyncError(null);
        if (saved) {
          setCompetitors((current) =>
            (current ?? []).map((row) => (row.id === competitorId ? saved : row)).sort(byName),
          );
        }
        return true;
      } catch {
        setSyncError("The organisation list could not be updated — kept in this brief only.");
        return false;
      }
    },
    [organizationId],
  );

  const remove = useCallback(
    async (competitorId: string): Promise<boolean> => {
      try {
        await deleteOrganizationCompetitor(organizationId, competitorId);
        setSyncError(null);
        setCompetitors((current) => (current ?? []).filter((row) => row.id !== competitorId));
        return true;
      } catch {
        setSyncError("The organisation list could not be updated — kept in this brief only.");
        return false;
      }
    },
    [organizationId],
  );

  return {
    competitors: competitors ?? [],
    isLoaded: competitors !== null,
    isLoading: enabled && competitors === null,
    syncError,
    refresh,
    add,
    update,
    remove,
  };
}
