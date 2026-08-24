import { z } from "zod";

import { DomainError } from "@/lib/errors";
import { env } from "@/lib/env";

const organizationIdSchema = z.string().uuid();

export function parseIntegrationOrganizationIds(value: string | undefined): Set<string> {
  if (!value) {
    return new Set();
  }

  const organizationIds = value.split(",").map((organizationId) => organizationId.trim());

  if (organizationIds.some((organizationId) => organizationId.length === 0)) {
    throw new Error("Integration Hub rollout organization IDs must not contain empty values.");
  }

  const enabledOrganizationIds = new Set<string>();

  for (const organizationId of organizationIds) {
    enabledOrganizationIds.add(organizationIdSchema.parse(organizationId).toLowerCase());
  }

  if (enabledOrganizationIds.size !== organizationIds.length) {
    throw new Error("Integration Hub rollout organization IDs must not contain duplicates.");
  }

  return enabledOrganizationIds;
}

export function assertIntegrationHubEnabled(
  organizationId: string,
  enabledOrganizationIds = parseIntegrationOrganizationIds(env.INTEGRATION_HUB_V1_ORGANIZATION_IDS),
): void {
  if (!isIntegrationHubEnabled(organizationId, enabledOrganizationIds)) {
    throw new DomainError(
      "FEATURE_NOT_AVAILABLE",
      "Integration Hub is not available for this organization.",
    );
  }
}

export function isIntegrationHubEnabled(
  organizationId: string,
  enabledOrganizationIds = parseIntegrationOrganizationIds(env.INTEGRATION_HUB_V1_ORGANIZATION_IDS),
): boolean {
  return enabledOrganizationIds.has(organizationId.toLowerCase());
}

export function isGovernedReportValidationEnabled(
  organizationId: string,
  enabledOrganizationIds = parseIntegrationOrganizationIds(
    env.GOVERNED_REPORT_VALIDATION_ORGANIZATION_IDS,
  ),
): boolean {
  return enabledOrganizationIds.has(organizationId.toLowerCase());
}

export function isGovernedReportProjectionEnabled(
  organizationId: string,
  enabledOrganizationIds = parseIntegrationOrganizationIds(
    env.GOVERNED_REPORT_PROJECTION_ORGANIZATION_IDS,
  ),
): boolean {
  return enabledOrganizationIds.has(organizationId.toLowerCase());
}

export function assertGovernedReportProjectionEnabled(organizationId: string): void {
  if (!isGovernedReportProjectionEnabled(organizationId)) {
    throw new DomainError("FEATURE_NOT_AVAILABLE", "Deterministic report projection is not enabled for this organization.");
  }
}

/**
 * Whether this organization sees governed economics evidence readiness.
 *
 * Unset means off for everyone. Rollback for the readiness slice is removing an
 * ID from this list: nothing is written by that surface, so turning it off
 * leaves no evidence, projection, or history behind to unwind.
 */
export function isGovernedEconomicsReadinessEnabled(
  organizationId: string,
  enabledOrganizationIds = parseIntegrationOrganizationIds(
    env.GOVERNED_ECONOMICS_READINESS_ORGANIZATION_IDS,
  ),
): boolean {
  return enabledOrganizationIds.has(organizationId.toLowerCase());
}

/**
 * Whether this organization sees governed channel analysis.
 *
 * Unset means off for everyone. Rollback is removing an ID from this list: the
 * findings a run already wrote stay readable and immutable, and no new run can
 * start, so nothing has to be unwound.
 */
export function isGovernedChannelAnalysisEnabled(
  organizationId: string,
  enabledOrganizationIds = parseIntegrationOrganizationIds(
    env.GOVERNED_CHANNEL_ANALYSIS_ORGANIZATION_IDS,
  ),
): boolean {
  return enabledOrganizationIds.has(organizationId.toLowerCase());
}

export function assertGovernedChannelAnalysisEnabled(organizationId: string): void {
  if (!isGovernedChannelAnalysisEnabled(organizationId)) {
    throw new DomainError(
      "FEATURE_NOT_AVAILABLE",
      "Governed channel analysis is not enabled for this organization.",
    );
  }
}

export function assertGovernedEconomicsReadinessEnabled(organizationId: string): void {
  if (!isGovernedEconomicsReadinessEnabled(organizationId)) {
    throw new DomainError(
      "FEATURE_NOT_AVAILABLE",
      "Economics evidence readiness is not enabled for this organization.",
    );
  }
}
