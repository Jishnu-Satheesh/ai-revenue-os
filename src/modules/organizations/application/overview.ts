import type { CompletenessGrade } from "@/domain/economics/types";
import { rollUpWindow, type LedgerEntry } from "@/domain/economics/rollup";
import type { OrganizationRole } from "@/domain/organizations/types";
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

/**
 * The window's money, split into what the evidence can and cannot state.
 *
 * `costsRecordedMinor` sums only the costs actually recorded. Subtracting the
 * kept floor from sales would look like a costs figure and would in fact be a
 * guess about the days that recorded no costs at all, which is exactly the
 * claim this platform does not make.
 */
export type OverviewMoneyScale = {
  currency: string;
  salesMinor: number;
  costsRecordedMinor: number;
  /** Contribution margin on the days that recorded enough to state one. */
  keptFloorMinor: number;
  /** The floor plus the at-most band the remaining days can support. */
  keptCeilingMinor: number;
  /** True when some day could only support a ceiling, so kept is a range. */
  hasUnprovenBand: boolean;
};

export function buildOverviewMoneyScale(economics: OverviewEconomics): OverviewMoneyScale | null {
  if (economics.state === "empty" || economics.currency === null) return null;

  let salesMinor = 0;
  let costsRecordedMinor = 0;
  let keptFloorMinor = 0;
  let keptCeilingMinor = 0;

  for (const point of economics.trend) {
    salesMinor += point.grossRevenueMinor;
    if (point.contributionMarginMinor !== null) {
      keptFloorMinor += point.contributionMarginMinor;
      keptCeilingMinor += point.contributionMarginMinor;
      costsRecordedMinor += point.grossRevenueMinor - point.contributionMarginMinor;
    } else if (point.atMostMinor !== null) {
      keptCeilingMinor += point.atMostMinor;
    }
  }

  return {
    currency: economics.currency,
    salesMinor,
    costsRecordedMinor,
    keptFloorMinor,
    keptCeilingMinor,
    hasUnprovenBand: keptCeilingMinor > keptFloorMinor,
  };
}

/**
 * This window's recorded revenue against the window immediately before it.
 *
 * Both amounts are stored; no ratio is. A percentage is the caller's
 * display-time division of the two, the same last-moment arithmetic the
 * analysis surfaces do, so nothing here can be re-aggregated wrongly later.
 *
 * Null rather than zero when there is nothing to compare against: a change
 * measured from a window that recorded no trade is not a change, and "+100%"
 * against nothing is a claim the ledger does not support.
 */
export type OverviewComparison = {
  currency: string;
  currentMinor: number;
  priorMinor: number;
  deltaMinor: number;
};

export function buildOverviewComparison(input: {
  economics: OverviewEconomics;
  priorEntries: readonly LedgerEntry[];
}): OverviewComparison | null {
  const { economics, priorEntries } = input;
  if (economics.state === "empty" || economics.currency === null) return null;
  if (priorEntries.length === 0) return null;

  // Mixed currencies cannot be summed into one comparison, and converting them
  // would invent a rate the ledger never recorded.
  const priorCurrencies = new Set(priorEntries.map((entry) => entry.currency));
  if (priorCurrencies.size !== 1 || !priorCurrencies.has(economics.currency)) return null;

  const currentMinor = sum(economics.trend.map((point) => point.grossRevenueMinor));
  const priorMinor = sum(priorEntries.map((entry) => entry.grossRevenueMinor));
  if (priorMinor <= 0) return null;

  return {
    currency: economics.currency,
    currentMinor,
    priorMinor,
    deltaMinor: currentMinor - priorMinor,
  };
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
  // Copy here is written for a non-technical reader and stays industry-neutral:
  // "items you sell", never "dishes". An industry pack supplies its own nouns.
  if (policiesMissing) {
    actions.push({
      kind: "foundation",
      title: "Nobody is named as the approver yet",
      impact: "Nothing this platform suggests can be acted on until a real person has to say yes.",
      ...(input.permissions.canManagePolicies
        ? { href: "#organization-management", actionLabel: "Name an approver" }
        : {}),
    });
  }

  if (input.integration.status === "ready" && input.integration.actionRequiredConnections > 0) {
    const count = input.integration.actionRequiredConnections;
    actions.push({
      kind: "integration",
      title: `${count} connection${count === 1 ? "" : "s"} stopped sending`,
      impact: `What already arrived is safe. Nothing new will reach this page until ${count === 1 ? "it is" : "they are"} reconnected.`,
      href: `/organizations/${input.organizationId}/integrations`,
      actionLabel: "Check the connection",
    });
  }

  if (
    !isEconomicsFailure(input.economics) &&
    (input.economics.gradeCounts.indicative > 0 || input.economics.gaps.length > 0)
  ) {
    const { priced, applicable } = input.economics.coverage;
    actions.push({
      kind: "economics",
      title:
        applicable > 0
          ? `${applicable - priced} of ${applicable} costs are not recorded yet`
          : "Some of what you sell has no cost recorded",
      impact: "Until they are in, we can only give you a range for what you kept — not one number.",
      ...(input.permissions.canManageCore
        ? {
            href: `/organizations/${input.organizationId}/onboarding?section=cost_structure`,
            actionLabel: "Add the missing costs",
          }
        : {}),
    });
  }

  for (const section of input.readiness.sections) {
    if (actions.length >= 3 || section.complete || section.key === "policies") continue;
    actions.push({
      kind: "foundation",
      title: `${section.label} is not on file yet`,
      impact: section.detail,
      ...(input.permissions.canManageCore
        ? { href: "#organization-management", actionLabel: "Add it" }
        : {}),
    });
  }

  return actions.slice(0, 3);
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

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
