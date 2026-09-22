import "server-only";

import { z } from "zod";

import { cacheGet, cacheSet } from "@/lib/cache/redis";
import { logger } from "@/lib/logger";

/**
 * Recent research areas per organisation (Track C1 P3).
 *
 * The New research dialog's "Research area" field remembers what the operator
 * typed so the next brief starts from the last area instead of a blank input.
 * Values live in Upstash Redis (not Postgres) because they are a per-operator
 * convenience, not governed research state: losing them degrades to an empty
 * suggestion, never to a failed start.
 *
 * Storage follows the existing cache pattern (`@/lib/cache/redis`): one JSON
 * array per organisation, most-recent-first, capped at 10, validated on read
 * so a corrupt or stale-shape entry degrades to empty.
 */

export const RECENT_RESEARCH_AREAS_MAX = 10;
const RECENT_RESEARCH_AREAS_VERSION = "v1";
const RECENT_RESEARCH_AREAS_TTL_SECONDS = 90 * 24 * 60 * 60;

export const recentResearchAreaSchema = z.string().trim().min(1).max(160);

export const recentResearchAreasSchema = z
  .array(recentResearchAreaSchema)
  .max(RECENT_RESEARCH_AREAS_MAX);

export const recentResearchAreasResponseSchema = z
  .object({
    areas: z.array(z.string().trim().min(1).max(160)).max(RECENT_RESEARCH_AREAS_MAX),
    mostRecent: z.string().trim().min(1).max(160).nullable(),
  })
  .strict();

export type RecentResearchAreasResponse = z.infer<typeof recentResearchAreasResponseSchema>;

export function recentResearchAreasKey(organizationId: string): string {
  const parsed = z.string().uuid().parse(organizationId);
  return `gi:recent-areas:${RECENT_RESEARCH_AREAS_VERSION}:${parsed.toLowerCase()}`;
}

export function normalizeResearchArea(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function areaKey(value: string): string {
  return normalizeResearchArea(value).toLowerCase();
}

/**
 * Fold a new area into the stored list: most-recent-first, de-duplicated
 * case-insensitively, capped at 10. Pure so unit tests prove ordering without
 * touching Redis.
 */
export function mergeRecentResearchAreas(
  existing: readonly string[],
  candidate: string,
): string[] {
  const normalized = normalizeResearchArea(candidate);
  if (normalized.length === 0) return [...existing].slice(0, RECENT_RESEARCH_AREAS_MAX);
  const rest = existing
    .map((entry) => normalizeResearchArea(entry))
    .filter((entry) => entry.length > 0 && areaKey(entry) !== areaKey(normalized));
  return [normalized, ...rest].slice(0, RECENT_RESEARCH_AREAS_MAX);
}

export function toRecentResearchAreasResponse(areas: readonly string[]): RecentResearchAreasResponse {
  const parsed = recentResearchAreasSchema.safeParse(
    areas.map((entry) => normalizeResearchArea(entry)).filter((entry) => entry.length > 0),
  );
  const list = parsed.success ? parsed.data.slice(0, RECENT_RESEARCH_AREAS_MAX) : [];
  return recentResearchAreasResponseSchema.parse({
    areas: list,
    mostRecent: list[0] ?? null,
  });
}

type CacheDeps = {
  get: typeof cacheGet;
  set: typeof cacheSet;
};

const defaultCache: CacheDeps = { get: cacheGet, set: cacheSet };

export async function readRecentResearchAreas(
  organizationId: string,
  deps: CacheDeps = defaultCache,
): Promise<RecentResearchAreasResponse> {
  const key = recentResearchAreasKey(organizationId);
  try {
    const stored = await deps.get(key, recentResearchAreasSchema);
    return toRecentResearchAreasResponse(stored ?? []);
  } catch (error) {
    logger.warn("growth_intelligence.recent_areas_read_failed", {
      errorCode: error instanceof Error ? error.name : "unknown",
    });
    return { areas: [], mostRecent: null };
  }
}

/**
 * Record a research area. Best-effort by design: a Redis outage never fails
 * the research start that triggered it.
 */
export async function recordRecentResearchArea(
  organizationId: string,
  area: string,
  deps: CacheDeps = defaultCache,
): Promise<RecentResearchAreasResponse> {
  const normalized = normalizeResearchArea(area);
  if (normalized.length === 0) return readRecentResearchAreas(organizationId, deps);
  try {
    recentResearchAreaSchema.parse(normalized);
  } catch {
    return readRecentResearchAreas(organizationId, deps);
  }
  try {
    const key = recentResearchAreasKey(organizationId);
    const stored = await deps.get(key, recentResearchAreasSchema);
    const merged = mergeRecentResearchAreas(stored ?? [], normalized);
    await deps.set(key, merged, RECENT_RESEARCH_AREAS_TTL_SECONDS);
    return toRecentResearchAreasResponse(merged);
  } catch (error) {
    logger.warn("growth_intelligence.recent_areas_write_failed", {
      errorCode: error instanceof Error ? error.name : "unknown",
    });
    return { areas: [], mostRecent: null };
  }
}
