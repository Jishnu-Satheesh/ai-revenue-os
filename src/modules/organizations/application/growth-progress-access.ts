import "server-only";

import { z } from "zod";

import { DomainError } from "@/lib/errors";
import { env } from "@/lib/env";

/**
 * The production rollout gate for the Overview actual-versus-fixed-projection
 * section.
 *
 * Like a guest list taped to the venue door: a blank list admits nobody, and
 * the same list guards both the dining room (home loading) and the kitchen
 * pass (nightly publication) — never the signpost alone. That is deliberate
 * for a surface whose numbers freeze permanently once published: the safe
 * default for "we forgot to configure it" has to be off.
 *
 * Server-only: reads the server env, so browser code must never import this
 * module. The Task 5 home composition calls it from server loaders only.
 */

/** Bounded explicit lookup alongside the legacy 500-org worker scan. */
export const OVERVIEW_GROWTH_PROGRESS_MAX_ORGANIZATIONS = 100;

const organizationIdSchema = z.string().uuid();

export function parseOverviewGrowthProgressOrganizationIds(value: string | undefined): Set<string> {
  if (value === undefined || value.trim() === "") return new Set();

  const organizationIds = value.split(",").map((organizationId) => organizationId.trim());

  if (organizationIds.some((organizationId) => organizationId.length === 0)) {
    throw new Error("Overview growth progress organization IDs must not contain empty values.");
  }

  const enabled = new Set<string>();
  for (const organizationId of organizationIds) {
    enabled.add(organizationIdSchema.parse(organizationId).toLowerCase());
  }

  if (enabled.size !== organizationIds.length) {
    throw new Error("Overview growth progress organization IDs must not contain duplicates.");
  }

  if (enabled.size > OVERVIEW_GROWTH_PROGRESS_MAX_ORGANIZATIONS) {
    throw new Error("Overview growth progress organization IDs must not exceed 100 entries.");
  }

  return enabled;
}

export function isOverviewGrowthProgressEnabled(
  organizationId: string,
  enabledOrganizationIds = parseOverviewGrowthProgressOrganizationIds(
    env.OVERVIEW_GROWTH_PROGRESS_ORGANIZATION_IDS,
  ),
): boolean {
  return enabledOrganizationIds.has(organizationId.toLowerCase());
}

export function assertOverviewGrowthProgressEnabled(
  organizationId: string,
  enabledOrganizationIds = parseOverviewGrowthProgressOrganizationIds(
    env.OVERVIEW_GROWTH_PROGRESS_ORGANIZATION_IDS,
  ),
): void {
  if (!isOverviewGrowthProgressEnabled(organizationId, enabledOrganizationIds)) {
    throw new DomainError(
      "FEATURE_NOT_AVAILABLE",
      "Overview growth progress is not available for this organization.",
    );
  }
}
