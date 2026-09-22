"use client";

import { useCallback, useEffect, useState } from "react";
import { z } from "zod";

/**
 * One competitor saved against the organisation, shared by the New research
 * dialog and Guided onboarding. Shape matches the Track C1 list contract:
 * `{ name, website, locationHint }`, most-recent-first. No id: the name is
 * the key for update and delete.
 */
export const OrganizationCompetitorSchema = z.object({
  name: z.string().trim().min(1).max(160),
  website: z.string().trim().max(500).optional().default(""),
  locationHint: z.string().trim().max(240).optional().default(""),
});

export type OrganizationCompetitor = z.infer<typeof OrganizationCompetitorSchema>;

const ListResponseSchema = z.union([
  z.array(OrganizationCompetitorSchema),
  z.object({ competitors: z.array(OrganizationCompetitorSchema) }),
]);

function collectionPath(organizationId: string): string {
  return `/api/organizations/${organizationId}/growth-intelligence/competitors`;
}

function itemPath(organizationId: string, name: string): string {
  return `${collectionPath(organizationId)}/${encodeURIComponent(name)}`;
}

/** Accept a bare array or `{ competitors: [...] }`; keep returned order. */
function normalizeList(body: unknown): OrganizationCompetitor[] {
  const parsed = ListResponseSchema.safeParse(body);
  if (!parsed.success) return [];
  const list = Array.isArray(parsed.data) ? parsed.data : parsed.data.competitors;
  return list
    .map((row) => ({
      name: row.name.trim(),
      website: (row.website ?? "").trim(),
      locationHint: (row.locationHint ?? "").trim(),
    }))
    .filter((row) => row.name.length > 0);
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
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
  input: OrganizationCompetitor,
): Promise<OrganizationCompetitor | null> {
  const parsed = OrganizationCompetitorSchema.safeParse(input);
  if (!parsed.success) throw new Error("COMPETITOR_INVALID");
  const response = await fetch(collectionPath(organizationId), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: parsed.data.name,
      website: parsed.data.website ?? "",
      locationHint: parsed.data.locationHint ?? "",
    }),
  });
  if (!response.ok) throw new Error(`COMPETITOR_ADD_FAILED:${response.status}`);
  const body = await readJson(response);
  const single = OrganizationCompetitorSchema.safeParse(body);
  if (single.success) return single.data;
  const list = normalizeList(body);
  return (
    list.find((row) => row.name.toLowerCase() === parsed.data.name.toLowerCase()) ?? parsed.data
  );
}

export async function updateOrganizationCompetitor(
  organizationId: string,
  previousName: string,
  input: OrganizationCompetitor,
): Promise<OrganizationCompetitor | null> {
  const parsed = OrganizationCompetitorSchema.safeParse(input);
  if (!parsed.success) throw new Error("COMPETITOR_INVALID");
  const response = await fetch(itemPath(organizationId, previousName), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: parsed.data.name,
      website: parsed.data.website ?? "",
      locationHint: parsed.data.locationHint ?? "",
    }),
  });
  if (!response.ok) throw new Error(`COMPETITOR_UPDATE_FAILED:${response.status}`);
  const single = OrganizationCompetitorSchema.safeParse(await readJson(response));
  return single.success ? single.data : parsed.data;
}

export async function deleteOrganizationCompetitor(
  organizationId: string,
  name: string,
): Promise<void> {
  const response = await fetch(itemPath(organizationId, name), { method: "DELETE" });
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
  add: (input: OrganizationCompetitor) => Promise<OrganizationCompetitor | null>;
  update: (previousName: string, input: OrganizationCompetitor) => Promise<boolean>;
  remove: (name: string) => Promise<boolean>;
};

/**
 * Organisation-wide competitor store over the Track C1 list API. Reads fail
 * silently to an empty list so the dialog keeps working before the backend
 * ships; mutations report success so callers can keep the brief-local row
 * either way. No secrets are logged — failures carry status codes only.
 */
export function useOrganizationCompetitors(
  organizationId: string,
  enabled: boolean,
): UseOrganizationCompetitorsResult {
  const [competitors, setCompetitors] = useState<OrganizationCompetitor[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || organizationId.length === 0) return;
    let cancelled = false;
    setIsLoading(true);
    fetchOrganizationCompetitors(organizationId)
      .then((list) => {
        if (!cancelled) setCompetitors(list);
      })
      .catch(() => {
        if (!cancelled) setCompetitors((current) => current ?? []);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
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
    async (input: OrganizationCompetitor): Promise<OrganizationCompetitor | null> => {
      try {
        const created = await addOrganizationCompetitor(organizationId, input);
        setSyncError(null);
        if (created) {
          setCompetitors((current) => {
            const next = current ?? [];
            if (next.some((row) => row.name.toLowerCase() === created.name.toLowerCase())) {
              return next;
            }
            return [created, ...next];
          });
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
    async (previousName: string, input: OrganizationCompetitor): Promise<boolean> => {
      try {
        const saved = await updateOrganizationCompetitor(organizationId, previousName, input);
        setSyncError(null);
        if (saved) {
          setCompetitors((current) =>
            (current ?? []).map((row) =>
              row.name.toLowerCase() === previousName.toLowerCase() ? saved : row,
            ),
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
    async (name: string): Promise<boolean> => {
      try {
        await deleteOrganizationCompetitor(organizationId, name);
        setSyncError(null);
        setCompetitors((current) =>
          (current ?? []).filter((row) => row.name.toLowerCase() !== name.toLowerCase()),
        );
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
    isLoading,
    syncError,
    refresh,
    add,
    update,
    remove,
  };
}
