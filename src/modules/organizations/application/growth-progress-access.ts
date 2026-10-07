import "server-only";

import { DomainError } from "@/lib/errors";
import { env } from "@/lib/env";
import { parseOrganizationAllowlist, resolveOrganizationAllowlist } from "@/lib/rollout-allowlist";

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

const OVERVIEW_GROWTH_ALLOWLIST = {
  variableName: "OVERVIEW_GROWTH_PROGRESS_ORGANIZATION_IDS",
  label: "Overview growth progress organization IDs",
  maxEntries: OVERVIEW_GROWTH_PROGRESS_MAX_ORGANIZATIONS,
} as const;

export function parseOverviewGrowthProgressOrganizationIds(value: string | undefined): Set<string> {
  return parseOrganizationAllowlist(value, OVERVIEW_GROWTH_ALLOWLIST);
}

export function isOverviewGrowthProgressEnabled(
  organizationId: string,
  enabledOrganizationIds = resolveOrganizationAllowlist(
    env.OVERVIEW_GROWTH_PROGRESS_ORGANIZATION_IDS,
    OVERVIEW_GROWTH_ALLOWLIST,
  ),
): boolean {
  return enabledOrganizationIds.has(organizationId.toLowerCase());
}

export function assertOverviewGrowthProgressEnabled(
  organizationId: string,
  enabledOrganizationIds = resolveOrganizationAllowlist(
    env.OVERVIEW_GROWTH_PROGRESS_ORGANIZATION_IDS,
    OVERVIEW_GROWTH_ALLOWLIST,
  ),
): void {
  if (!isOverviewGrowthProgressEnabled(organizationId, enabledOrganizationIds)) {
    throw new DomainError(
      "FEATURE_NOT_AVAILABLE",
      "Overview growth progress is not available for this organization.",
    );
  }
}
