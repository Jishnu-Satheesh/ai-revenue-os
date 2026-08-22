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
