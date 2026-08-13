import type { CompletenessGrade } from "@/domain/economics/types";
import { rollUpWindow, type LedgerEntry } from "@/domain/economics/rollup";
import type { OrganizationRole } from "@/domain/organizations/types";
import type { DemoCampaignSummary } from "@/modules/campaigns/demo/fixtures";
import type { EconomicsView } from "@/modules/economics/application/read-model";
import type { IntegrationHubSnapshot } from "@/modules/integrations/application/read-model";
import type { DigitalTwinSnapshot } from "@/modules/organizations/infrastructure/repository";

export type ReadinessSectionKey =
  | "identity"
  | "branches"
  | "profile"
  | "facts"
  | "goals"
  | "policies";

export type DigitalTwinReadiness = {
  percentage: number;
  groundedCount: number;
  totalCount: number;
  sections: readonly {
    key: ReadinessSectionKey;
    label: string;
    complete: boolean;
    detail: string;
  }[];
  missingLabels: readonly string[];
};

export function buildDigitalTwinReadiness(snapshot: DigitalTwinSnapshot): DigitalTwinReadiness {
  const physicalBranchRequired = snapshot.organization.industry.toLowerCase() === "restaurant";
  const sections: DigitalTwinReadiness["sections"] = [
    {
      key: "identity",
      label: "Identity",
      complete: Boolean(snapshot.organization.name && snapshot.organization.industry),
      detail: `${snapshot.organization.industry} · ${snapshot.organization.base_currency}`,
    },
    {
      key: "branches",
      label: "Branches",
      complete:
        snapshot.organization.branchless_confirmed ||
        !physicalBranchRequired ||
        snapshot.branches.some((branch) => branch.kind === "physical" && branch.is_active),
      detail: snapshot.organization.branchless_confirmed
        ? "Branchless operation confirmed"
        : `${snapshot.branches.length} configured`,
    },
    {
      key: "profile",
      label: "Business profile",
      complete: Boolean(snapshot.profile?.business_model || snapshot.profile?.value_proposition),
      detail: snapshot.profile?.source ? `Source: ${snapshot.profile.source}` : "No profile yet",
    },
    {
      key: "facts",
      label: "Facts",
      complete: snapshot.facts.length > 0,
      detail: `${snapshot.facts.length} source-aware fact${snapshot.facts.length === 1 ? "" : "s"}`,
    },
    {
      key: "goals",
      label: "Goals",
      complete: snapshot.goals.length > 0,
      detail: `${snapshot.goals.length} measurable goal${snapshot.goals.length === 1 ? "" : "s"}`,
    },
    {
      key: "policies",
      label: "Policies",
      complete: snapshot.policies.some((policy) => policy.policy_type === "access"),
      detail: `${snapshot.policies.length} active polic${snapshot.policies.length === 1 ? "y" : "ies"}`,
    },
  ];
  const groundedCount = sections.filter(({ complete }) => complete).length;

  return {
    percentage: Math.round((groundedCount / sections.length) * 100),
    groundedCount,
    totalCount: sections.length,
    sections,
    missingLabels: sections.filter(({ complete }) => !complete).map(({ label }) => label),
  };
}

export type OverviewTrendPoint = {
  periodStart: string;
  grossRevenueMinor: number;
  contributionMarginMinor: number | null;
  atMostMinor: number | null;
  grade: CompletenessGrade;
};

export type OverviewChannelPoint = {
  channel: string;
  grossRevenueMinor: number;
  contributionMarginMinor: number | null;
  atMostMinor: number | null;
  grade: CompletenessGrade;
};

export type OverviewEconomics = {
  state: "ready" | "empty";
  currency: string | null;
  window: {
    rangeStart: string;
    rangeEndExclusive: string;
    timeZone: string;
  };
  trend: readonly OverviewTrendPoint[];
  channels: readonly OverviewChannelPoint[];
  gradeCounts: Readonly<Record<CompletenessGrade, number>>;
  coverage: EconomicsView["coverage"];
  catalogAvailable: boolean;
  gaps: EconomicsView["gaps"];
  takeaway: string;
};

export function buildOverviewEconomics(input: {
  view: EconomicsView;
  entries: readonly LedgerEntry[];
}): OverviewEconomics {
  const grouped = new Map<string, LedgerEntry[]>();
  for (const entry of input.entries) {
    const periodStart = entry.periodStart.toISOString();
    grouped.set(periodStart, [...(grouped.get(periodStart) ?? []), entry]);
  }

  const trend = [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([periodStart, entries]): OverviewTrendPoint => {
      const rollup = rollUpWindow(entries);
      const grossRevenueMinor = sum(rollup.channels.map((channel) => channel.grossRevenueMinor));
      const indicative = rollup.channels.some((channel) => channel.grade === "indicative");
      const partial = rollup.channels.some((channel) => channel.grade === "partial");
      const grade: CompletenessGrade = indicative ? "indicative" : partial ? "partial" : "complete";

      return {
        periodStart,
        grossRevenueMinor,
        contributionMarginMinor: indicative
          ? null
          : sum(
              rollup.channels.map((channel) =>
                channel.grade === "indicative" ? 0 : channel.contributionMarginMinor,
              ),
            ),
        atMostMinor: indicative
          ? sum(
              rollup.channels.map((channel) =>
                channel.grade === "indicative"
                  ? channel.atMostMinor
                  : channel.contributionMarginMinor,
              ),
            )
          : null,
        grade,
      };
    });

  const channels = input.view.rollup.channels.map(
    (channel): OverviewChannelPoint => ({
      channel: channel.channel ?? "Unattributed",
      grossRevenueMinor: channel.grossRevenueMinor,
      contributionMarginMinor:
        channel.grade === "indicative" ? null : channel.contributionMarginMinor,
      atMostMinor: channel.grade === "indicative" ? channel.atMostMinor : null,
      grade: channel.grade,
    }),
  );
  const gradeCounts = trend.reduce<Record<CompletenessGrade, number>>(
    (counts, point) => ({ ...counts, [point.grade]: counts[point.grade] + 1 }),
    { complete: 0, partial: 0, indicative: 0 },
  );
  const state = input.entries.length === 0 ? "empty" : "ready";

  return {
    state,
    currency: input.view.rollup.currency,
    window: {
      rangeStart: input.view.window.rangeStart.toISOString(),
      rangeEndExclusive: input.view.window.rangeEndExclusive.toISOString(),
      timeZone: input.view.window.timeZone,
    },
    trend,
    channels,
    gradeCounts,
    coverage: input.view.coverage,
    catalogAvailable: input.view.catalogAvailable,
    gaps: input.view.gaps,
    takeaway: economicsTakeaway({ state, trend, channels }),
  };
}

function economicsTakeaway(input: {
  state: OverviewEconomics["state"];
  trend: readonly OverviewTrendPoint[];
  channels: readonly OverviewChannelPoint[];
}): string {
  if (input.state === "empty")
    return "No trade is recorded in this window, so the page does not draw a performance chart.";
  const indicativeCount = input.trend.filter(({ grade }) => grade === "indicative").length;
  if (indicativeCount > 0)
    return `${indicativeCount} of ${input.trend.length} recorded day${input.trend.length === 1 ? "" : "s"} can only support a margin ceiling, not a profit conclusion.`;
  const partialCount = input.trend.filter(({ grade }) => grade === "partial").length;
  if (partialCount > 0)
    return `${partialCount} of ${input.trend.length} recorded day${input.trend.length === 1 ? "" : "s"} includes estimated cost evidence.`;
  const leading = input.channels[0];
  return leading
    ? `${leading.channel} records the most gross revenue in this window; this is a comparison, not attributed lift.`
    : "The recorded days have complete cost evidence.";
}

export type OverviewIntegrationState =
  | { status: "disabled" | "failed" }
  | {
      status: "ready";
      totalConnections: number;
      healthyConnections: number;
      actionRequiredConnections: number;
    };

export type OverviewIntegration = {
  totalConnections: number;
  healthyConnections: number;
  actionRequiredConnections: number;
  connections: readonly {
    id: string;
    providerKey: string;
    accountLabel: string;
    state: IntegrationHubSnapshot["connections"][number]["health"]["state"];
    explanation: string;
    lastSuccessfulSyncAt: string | null;
  }[];
};

const ACTION_REQUIRED_INTEGRATION_STATES = new Set(["degraded", "stale", "revoked"]);

export function buildOverviewIntegration(snapshot: IntegrationHubSnapshot): OverviewIntegration {
  return {
    totalConnections: snapshot.summary.totalConnections,
    healthyConnections: snapshot.summary.healthyConnections,
    actionRequiredConnections: snapshot.summary.actionRequiredConnections,
    connections: [...snapshot.connections]
      .sort((left, right) => {
        const leftNeedsAction = ACTION_REQUIRED_INTEGRATION_STATES.has(left.health.state);
        const rightNeedsAction = ACTION_REQUIRED_INTEGRATION_STATES.has(right.health.state);
        return Number(rightNeedsAction) - Number(leftNeedsAction);
      })
      .slice(0, 3)
      .map((connection) => ({
        id: connection.id,
        providerKey: connection.provider_key,
        accountLabel: connection.external_account_label,
        state: connection.health.state,
        explanation: connection.health.explanation,
        lastSuccessfulSyncAt: connection.health.lastSuccessfulSyncAt ?? null,
      })),
  };
}

export type StrategicBriefingItem = {
  kind: "foundation" | "economics" | "operations";
  conclusion: string;
  evidence: string;
  href: string;
};

export type OverviewActionItem = {
  kind: "foundation" | "integration" | "economics";
  title: string;
  impact: string;
  href?: string;
  actionLabel?: string;
};

type OverviewEconomicsResult = OverviewEconomics | { status: "failed" };

function isEconomicsFailure(value: OverviewEconomicsResult): value is { status: "failed" } {
  return "status" in value && value.status === "failed";
}

export function buildOverviewActionQueue(input: {
  organizationId: string;
  readiness: DigitalTwinReadiness;
  economics: OverviewEconomicsResult;
  integration: OverviewIntegrationState;
  permissions: ReturnType<typeof getOverviewPermissions>;
}): OverviewActionItem[] {
  const actions: OverviewActionItem[] = [];
  const policiesMissing = input.readiness.sections.some(
    ({ key, complete }) => key === "policies" && !complete,
  );
  if (policiesMissing) {
    actions.push({
      kind: "foundation",
      title: "Add an access policy",
      impact: "Governed work cannot rely on a missing access boundary.",
      ...(input.permissions.canManagePolicies
        ? { href: "#organization-management", actionLabel: "Manage policies" }
        : {}),
    });
  }

  if (input.integration.status === "ready" && input.integration.actionRequiredConnections > 0) {
    actions.push({
      kind: "integration",
      title: `${input.integration.actionRequiredConnections} connection${input.integration.actionRequiredConnections === 1 ? "" : "s"} needs attention`,
      impact: "Stale, degraded, or revoked connections can interrupt fresh evidence.",
      href: `/organizations/${input.organizationId}/integrations`,
      actionLabel: "Review integrations",
    });
  }

  if (
    !isEconomicsFailure(input.economics) &&
    (input.economics.gradeCounts.indicative > 0 || input.economics.gaps.length > 0)
  ) {
    actions.push({
      kind: "economics",
      title: "Close economics evidence gaps",
      impact: "Missing or weak costs limit the platform to margin ceilings or partial conclusions.",
      ...(input.permissions.canManageCore
        ? {
            href: `/organizations/${input.organizationId}/onboarding?section=cost_structure`,
            actionLabel: "Review cost structure",
          }
        : {}),
    });
  }

  for (const section of input.readiness.sections) {
    if (actions.length >= 3 || section.complete || section.key === "policies") continue;
    actions.push({
      kind: "foundation",
      title: `Ground ${section.label.toLowerCase()}`,
      impact: section.detail,
      ...(input.permissions.canManageCore
        ? { href: "#organization-management", actionLabel: "Manage Digital Twin" }
        : {}),
    });
  }

  return actions.slice(0, 3);
}

export function buildStrategicBriefing(input: {
  readiness: DigitalTwinReadiness;
  economics: OverviewEconomicsResult;
  integration: OverviewIntegrationState;
}): StrategicBriefingItem[] {
  const items: StrategicBriefingItem[] = [];
  if (input.readiness.missingLabels.length > 0) {
    const [firstMissing] = input.readiness.missingLabels;
    items.push({
      kind: "foundation",
      conclusion: `${firstMissing} is the next Digital Twin gap to ground.`,
      evidence: `${input.readiness.groundedCount} of ${input.readiness.totalCount} readiness sections are grounded.`,
      href: "#digital-twin-data",
    });
  }

  if (isEconomicsFailure(input.economics)) {
    items.push({
      kind: "economics",
      conclusion: "Channel performance could not be checked right now.",
      evidence: "The economics read failed; no performance conclusion was substituted.",
      href: "#channel-economics",
    });
  } else if (input.economics.state === "empty") {
    items.push({
      kind: "economics",
      conclusion: "There is not enough recorded trade to compare channels yet.",
      evidence: "The selected 30-day ledger window contains no rows.",
      href: "#channel-economics",
    });
  } else if (input.economics.gradeCounts.indicative > 0) {
    items.push({
      kind: "economics",
      conclusion: "Margin conclusions are limited by missing cost evidence.",
      evidence: `${input.economics.gradeCounts.indicative} recorded day${input.economics.gradeCounts.indicative === 1 ? "" : "s"} can only support a ceiling.`,
      href: "#channel-economics",
    });
  } else if (input.economics.gradeCounts.partial > 0) {
    items.push({
      kind: "economics",
      conclusion: "Channel margin is usable, with some estimated cost evidence.",
      evidence: `${input.economics.gradeCounts.partial} recorded day${input.economics.gradeCounts.partial === 1 ? "" : "s"} is graded partial.`,
      href: "#channel-economics",
    });
  } else {
    items.push({
      kind: "economics",
      conclusion: "Recorded channel economics are complete for this window.",
      evidence: `${input.economics.gradeCounts.complete} recorded day${input.economics.gradeCounts.complete === 1 ? "" : "s"} has complete cost evidence.`,
      href: "#channel-economics",
    });
  }

  if (input.integration.status === "ready" && input.integration.actionRequiredConnections > 0) {
    items.push({
      kind: "operations",
      conclusion: `${input.integration.actionRequiredConnections} integration connection${input.integration.actionRequiredConnections === 1 ? "" : "s"} needs attention.`,
      evidence: `${input.integration.healthyConnections} of ${input.integration.totalConnections} connections are currently healthy.`,
      href: "#integration-health",
    });
  }

  return items.slice(0, 3);
}

export function getOverviewPermissions(role: OrganizationRole): {
  canManageCore: boolean;
  canManagePolicies: boolean;
  canManageLifecycle: boolean;
} {
  return {
    canManageCore: role === "owner" || role === "admin" || role === "operator",
    canManagePolicies: role === "owner" || role === "admin",
    canManageLifecycle: role === "owner" || role === "admin",
  };
}

export function selectRecentCampaigns(
  campaigns: readonly DemoCampaignSummary[],
): DemoCampaignSummary[] {
  return [...campaigns]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 3);
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
