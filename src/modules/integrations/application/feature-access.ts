import { DomainError } from "@/lib/errors";
import { env } from "@/lib/env";
import { parseOrganizationAllowlist, resolveOrganizationAllowlist } from "@/lib/rollout-allowlist";

export function parseIntegrationOrganizationIds(
  value: string | undefined,
  variableName = "INTEGRATION_HUB_V1_ORGANIZATION_IDS",
): Set<string> {
  return parseOrganizationAllowlist(value, {
    variableName,
    label: "Integration Hub rollout organization IDs",
  });
}

function resolveIntegrationOrganizationIds(value: string | undefined, variableName: string) {
  return resolveOrganizationAllowlist(value, {
    variableName,
    label: "Integration Hub rollout organization IDs",
  });
}

export function assertIntegrationHubEnabled(
  organizationId: string,
  enabledOrganizationIds = resolveIntegrationOrganizationIds(
    env.INTEGRATION_HUB_V1_ORGANIZATION_IDS,
    "INTEGRATION_HUB_V1_ORGANIZATION_IDS",
  ),
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
  enabledOrganizationIds = resolveIntegrationOrganizationIds(
    env.INTEGRATION_HUB_V1_ORGANIZATION_IDS,
    "INTEGRATION_HUB_V1_ORGANIZATION_IDS",
  ),
): boolean {
  return enabledOrganizationIds.has(organizationId.toLowerCase());
}

export function parseAgentChatOrganizationIds(value: string | undefined): Set<string> {
  return parseOrganizationAllowlist(value, {
    variableName: "AGENT_CHAT_V1_ORGANIZATION_IDS",
    label: "Agent chat rollout organization IDs",
  });
}

/**
 * Whether this organization sees the universal agent shell and its routes.
 *
 * Unset means off for everyone (default off). Removing an ID stops new
 * requests and worker admission after the environment change is deployed.
 * Durable turns already in progress must be drained or reconciled under
 * their source permissions and lease fences; disabling the flag does not
 * cancel them. Retention continues to preserve content-free audit history.
 */
export function isAgentChatEnabled(
  organizationId: string,
  enabledOrganizationIds = resolveOrganizationAllowlist(env.AGENT_CHAT_V1_ORGANIZATION_IDS, {
    variableName: "AGENT_CHAT_V1_ORGANIZATION_IDS",
    label: "Agent chat rollout organization IDs",
  }),
): boolean {
  return enabledOrganizationIds.has(organizationId.toLowerCase());
}

export function assertAgentChatEnabled(organizationId: string): void {
  if (!isAgentChatEnabled(organizationId)) {
    throw new DomainError(
      "FEATURE_NOT_AVAILABLE",
      "The AI agent is not available for this organization.",
    );
  }
}

export function isGovernedReportValidationEnabled(
  organizationId: string,
  enabledOrganizationIds = resolveIntegrationOrganizationIds(
    env.GOVERNED_REPORT_VALIDATION_ORGANIZATION_IDS,
    "GOVERNED_REPORT_VALIDATION_ORGANIZATION_IDS",
  ),
): boolean {
  return enabledOrganizationIds.has(organizationId.toLowerCase());
}

export function isGovernedReportProjectionEnabled(
  organizationId: string,
  enabledOrganizationIds = resolveIntegrationOrganizationIds(
    env.GOVERNED_REPORT_PROJECTION_ORGANIZATION_IDS,
    "GOVERNED_REPORT_PROJECTION_ORGANIZATION_IDS",
  ),
): boolean {
  return enabledOrganizationIds.has(organizationId.toLowerCase());
}

export function assertGovernedReportProjectionEnabled(organizationId: string): void {
  if (!isGovernedReportProjectionEnabled(organizationId)) {
    throw new DomainError(
      "FEATURE_NOT_AVAILABLE",
      "Deterministic report projection is not enabled for this organization.",
    );
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
  enabledOrganizationIds = resolveIntegrationOrganizationIds(
    env.GOVERNED_ECONOMICS_READINESS_ORGANIZATION_IDS,
    "GOVERNED_ECONOMICS_READINESS_ORGANIZATION_IDS",
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
  enabledOrganizationIds = resolveIntegrationOrganizationIds(
    env.GOVERNED_CHANNEL_ANALYSIS_ORGANIZATION_IDS,
    "GOVERNED_CHANNEL_ANALYSIS_ORGANIZATION_IDS",
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
