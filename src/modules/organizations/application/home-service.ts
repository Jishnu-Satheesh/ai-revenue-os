import { hasOrganizationPermission } from "@/domain/access/permissions";
import type { OrganizationRole } from "@/domain/organizations/types";
import type {
  AssetHomeRecord,
  CampaignHomeReads,
} from "@/modules/campaigns/application/home-preview-types";
import type { DigitalTwinSnapshot } from "@/modules/organizations/infrastructure/repository";
import { getOverviewPermissions } from "@/modules/organizations/application/overview";
import type {
  HomeActivityItem,
  HomeAttentionItem,
  HomeCampaign,
  HomeDestination,
  HomeGoal,
  HomePermissions,
  OrganizationHomeView,
} from "@/modules/organizations/application/home-types";

export type BuildOrganizationHomeViewInput = {
  snapshot: DigitalTwinSnapshot;
  role: OrganizationRole;
  organizationId: string;
  now: string;
  sources: CampaignHomeReads;
  gates: { campaigns: boolean; growth: boolean; integrations: boolean };
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function portfolioHref(organizationId: string): string {
  return `/organizations/${organizationId}/campaigns`;
}

function campaignHref(organizationId: string, campaignId: string): string {
  if (!isUuid(campaignId)) return portfolioHref(organizationId);
  return `/organizations/${organizationId}/campaigns/${campaignId}`;
}

function campaignActionLabel(input: {
  openable: boolean;
  version: number | null;
  state: string;
  canEditCampaign: boolean;
  canReviewCampaign: boolean;
}): HomeCampaign["actionLabel"] {
  if (!input.openable || input.version === null) return "View in Campaigns";
  if (input.state === "ready_for_review" && input.canReviewCampaign) return "Review campaign";
  if (input.state === "draft" && input.canEditCampaign) return "Continue draft";
  return "View campaign";
}

function buildPermissions(
  role: OrganizationRole,
  gates: BuildOrganizationHomeViewInput["gates"],
): HomePermissions {
  const overview = getOverviewPermissions(role);
  const canCreateCampaign =
    gates.campaigns && hasOrganizationPermission(role, "campaign.create");
  const canEditCampaign = gates.campaigns && hasOrganizationPermission(role, "campaign.edit");
  // Review wording is navigation into the approval workflow, not approval
  // itself. Operators hold campaign.approve in the catalogue, but the home
  // reserves the Review wording for roles with policy authority so operators
  // and viewers consistently see View campaign here.
  const canReviewCampaign =
    gates.campaigns &&
    hasOrganizationPermission(role, "campaign.approve") &&
    overview.canManagePolicies;
  return {
    canCreateCampaign,
    canEditCampaign,
    canReviewCampaign,
    canManageCore: overview.canManageCore,
  };
}

function buildGoals(snapshot: DigitalTwinSnapshot): {
  goals: readonly HomeGoal[];
  focusGoalId: string | null;
} {
  const sorted = [...snapshot.goals].sort((left, right) => {
    if (left.priority !== right.priority) return left.priority - right.priority;
    return left.id.localeCompare(right.id);
  });
  const branchNames = new Map(snapshot.branches.map((branch) => [branch.id, branch.name]));
  const formatter = new Intl.NumberFormat("en-US");
  const goals: HomeGoal[] = sorted.map((goal) => {
    const target = `${formatter.format(goal.target_value)} ${goal.unit}${goal.currency ? ` ${goal.currency}` : ""}`;
    const scopeLabel =
      goal.scope_kind === "organization"
        ? "Organization"
        : (goal.scope_branch_id !== null && branchNames.get(goal.scope_branch_id)) ||
          "Branch goal";
    return {
      id: goal.id,
      name: goal.name,
      target,
      deadline: goal.deadline,
      scopeLabel,
    };
  });
  const focus = sorted.find((goal) => goal.scope_kind === "organization") ?? null;
  return { goals, focusGoalId: focus ? focus.id : null };
}

function toHomeCampaign(
  record: { item: { id: string; title: string; objective: string | null; state: string; generation: HomeCampaign["generation"]; openable: boolean; updatedAt: string; version: number | null }; cover: HomeCampaign["cover"]; coverLabel: HomeCampaign["coverLabel"] },
  organizationId: string,
  permissions: HomePermissions,
): HomeCampaign {
  const openable = record.item.openable;
  const href = openable ? campaignHref(organizationId, record.item.id) : portfolioHref(organizationId);
  return {
    id: record.item.id,
    title: record.item.title,
    objective: record.item.objective,
    state: record.item.state as HomeCampaign["state"],
    generation: record.item.generation,
    openable,
    updatedAt: record.item.updatedAt,
    actionLabel: campaignActionLabel({
      openable,
      version: record.item.version,
      state: record.item.state,
      canEditCampaign: permissions.canEditCampaign,
      canReviewCampaign: permissions.canReviewCampaign,
    }),
    href,
    cover: record.cover,
    coverLabel: record.coverLabel,
  };
}

type RankedAttention = { rank: number; item: HomeAttentionItem; updatedAt: string; id: string };

function attentionRank(state: string, generationStatus: string): number | null {
  let rank: number | null = null;
  if (generationStatus === "failed" || generationStatus === "stalled") {
    rank = 0;
  }
  if (state === "blocked" || state === "needs_data") {
    rank = rank === null ? 1 : Math.min(rank, 1);
  }
  if (state === "ready_for_review") {
    rank = rank === null ? 2 : Math.min(rank, 2);
  }
  return rank;
}

function attentionReason(state: string, generationStatus: string, rank: number): string {
  if (rank === 0) {
    return generationStatus === "failed"
      ? "Generation failed and can be started again."
      : "Generation stalled and can be started again.";
  }
  if (rank === 1) {
    return state === "blocked"
      ? "Campaign is blocked."
      : "Campaign needs more information before review.";
  }
  return "Campaign is ready for review.";
}

function buildAttention(input: {
  snapshot: DigitalTwinSnapshot;
  organizationId: string;
  permissions: HomePermissions;
  homeCampaigns: readonly HomeCampaign[] | null;
}): readonly HomeAttentionItem[] {
  const ranked = new Map<string, RankedAttention>();
  if (input.homeCampaigns) {
    for (const campaign of input.homeCampaigns) {
      const rank = attentionRank(campaign.state, campaign.generation.status);
      if (rank === null) continue;
      const existing = ranked.get(campaign.id);
      if (existing && existing.rank <= rank) continue;
      ranked.set(campaign.id, {
        rank,
        updatedAt: campaign.updatedAt,
        id: campaign.id,
        item: {
          id: `campaign:${campaign.id}`,
          sourceLabel: "Campaign",
          title: campaign.title,
          reason: attentionReason(campaign.state, campaign.generation.status, rank),
          actionLabel: campaign.actionLabel,
          href: campaign.href,
        },
      });
    }
  }
  const sorted = [...ranked.values()].sort((left, right) => {
    if (left.rank !== right.rank) return left.rank - right.rank;
    if (left.updatedAt !== right.updatedAt) return right.updatedAt.localeCompare(left.updatedAt);
    return right.id.localeCompare(left.id);
  });
  const attention: HomeAttentionItem[] = sorted.slice(0, 3).map((entry) => entry.item);

  if (attention.length < 3 && input.permissions.canManageCore) {
    const description = input.snapshot.profile?.value_proposition?.trim() || null;
    if (!description && attention.length < 3) {
      attention.push({
        id: "org:missing-profile",
        sourceLabel: "Organization",
        title: "Add a business description",
        reason: "The home header has no description yet.",
        actionLabel: "Add it",
        href: "#organization-management",
      });
    }
    const hasOrgGoal = input.snapshot.goals.some((goal) => goal.scope_kind === "organization");
    if (!hasOrgGoal && attention.length < 3) {
      attention.push({
        id: "org:missing-goals",
        sourceLabel: "Organization",
        title: "Add a goal",
        reason: "No organization goal is on file yet.",
        actionLabel: "Add it",
        href: "#organization-management",
      });
    }
  }
  return attention;
}

const AUDIT_LABELS: Readonly<Record<string, string>> = {
  "organization.created": "Organization created",
  "branch.created": "Location added",
  "business_profile.updated": "Business profile updated",
  "goal.created": "Goal added",
};

function buildActivity(input: {
  snapshot: DigitalTwinSnapshot;
  organizationId: string;
  permissions: HomePermissions;
  homeCampaigns: readonly HomeCampaign[] | null;
  gallery: readonly AssetHomeRecord[];
}): readonly HomeActivityItem[] {
  const candidates: HomeActivityItem[] = [];

  if (input.homeCampaigns) {
    for (const campaign of input.homeCampaigns) {
      candidates.push({
        id: `campaign:${campaign.id}`,
        label: "Campaign updated",
        title: campaign.title,
        occurredAt: campaign.updatedAt,
        href: campaign.href,
        kind: "campaign",
      });
    }
  }

  for (const asset of input.gallery) {
    const isPoster = asset.sourceKind === "poster_render";
    candidates.push({
      id: asset.id,
      label: isPoster ? "Poster render added" : "Reference added",
      title: asset.label,
      occurredAt: asset.recordedAt,
      href: asset.sourceHref,
      kind: "asset",
    });
  }

  const branchNames = new Map(input.snapshot.branches.map((branch) => [branch.id, branch.name]));
  const goalNames = new Map(input.snapshot.goals.map((goal) => [goal.id, goal.name]));
  const managementHref = input.permissions.canManageCore ? "#organization-management" : null;

  for (const event of input.snapshot.auditEvents) {
    const label = AUDIT_LABELS[event.event_name];
    if (!label) continue;
    if (event.organization_id !== null && event.organization_id !== input.organizationId) continue;
    let title: string | null = null;
    if (event.event_name === "organization.created") {
      title = input.snapshot.organization.name;
    } else if (event.event_name === "branch.created") {
      title = event.entity_id !== null ? (branchNames.get(event.entity_id) ?? null) : null;
    } else if (event.event_name === "goal.created") {
      title = event.entity_id !== null ? (goalNames.get(event.entity_id) ?? null) : null;
    } else {
      title = null;
    }
    candidates.push({
      id: `audit:${event.id}`,
      label,
      title,
      occurredAt: event.occurred_at,
      href: managementHref,
      kind: "organization",
    });
  }

  const seen = new Set<string>();
  const deduped: HomeActivityItem[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    deduped.push(candidate);
  }
  deduped.sort((left, right) => {
    if (left.occurredAt !== right.occurredAt) return right.occurredAt.localeCompare(left.occurredAt);
    return left.id.localeCompare(right.id);
  });
  return deduped.slice(0, 5);
}

function buildDestinations(input: {
  role: OrganizationRole;
  organizationId: string;
  gates: BuildOrganizationHomeViewInput["gates"];
}): readonly HomeDestination[] {
  const destinations: HomeDestination[] = [];
  if (hasOrganizationPermission(input.role, "channel.read")) {
    destinations.push({
      key: "channels",
      label: "Channels",
      description: "See organization-owned channels and their mappings.",
      href: `/organizations/${input.organizationId}/channels`,
    });
  }
  if (input.gates.growth && hasOrganizationPermission(input.role, "growth_intelligence.read")) {
    destinations.push({
      key: "growth",
      label: "Growth Intelligence",
      description: "Read governed business and market intelligence.",
      href: `/organizations/${input.organizationId}/growth-intelligence`,
    });
  }
  if (hasOrganizationPermission(input.role, "memory.read")) {
    destinations.push({
      key: "memory",
      label: "Business Memory",
      description: "Read business memory that is not sensitive.",
      href: `/organizations/${input.organizationId}/memory`,
    });
  }
  if (input.gates.integrations && hasOrganizationPermission(input.role, "integration.read")) {
    destinations.push({
      key: "integrations",
      label: "Integrations",
      description: "See connections, data sources, and their health.",
      href: `/organizations/${input.organizationId}/integrations`,
    });
  }
  return destinations;
}

/**
 * Composes the organization home from an already-loaded snapshot plus
 * already-settled campaign-side reads. Synchronous and pure: no Supabase,
 * Storage, environment, clock, or router access. All hrefs are built from the
 * explicit organization ID plus validated record IDs.
 */
export function buildOrganizationHomeView(input: BuildOrganizationHomeViewInput): OrganizationHomeView {
  const { snapshot, role, organizationId, sources, gates } = input;
  const permissions = buildPermissions(role, gates);

  const description = snapshot.profile?.value_proposition?.trim() || null;
  const locations = snapshot.branches
    .filter((branch) => branch.is_active)
    .map((branch) => ({ id: branch.id, name: branch.name, kind: branch.kind }));
  const { goals, focusGoalId } = buildGoals(snapshot);

  let campaigns: OrganizationHomeView["campaigns"];
  let homeCampaigns: readonly HomeCampaign[] | null = null;
  if (!gates.campaigns) {
    campaigns = { status: "disabled" };
  } else if (sources.campaigns.status === "ready") {
    homeCampaigns = sources.campaigns.data.map((record) => toHomeCampaign(record, organizationId, permissions));
    campaigns = { status: "ready", data: homeCampaigns, fetchedAt: sources.campaigns.fetchedAt };
  } else if (sources.campaigns.status === "failed") {
    campaigns = { status: "failed", code: "HOME_READ_FAILED" };
  } else {
    campaigns = { status: "disabled" };
  }

  let assets: OrganizationHomeView["assets"];
  let assetsPartial = false;
  let gallery: readonly AssetHomeRecord[] = [];
  if (!gates.campaigns) {
    assets = { status: "disabled" };
  } else {
    const posters = sources.posters;
    const references = sources.references;
    if (posters.status === "disabled" && references.status === "disabled") {
      assets = { status: "disabled" };
    } else if (posters.status === "failed" && references.status === "failed") {
      assets = { status: "failed", code: "HOME_READ_FAILED" };
    } else if (posters.status === "failed" && references.status === "disabled") {
      assets = { status: "failed", code: "HOME_READ_FAILED" };
    } else if (posters.status === "disabled" && references.status === "failed") {
      assets = { status: "failed", code: "HOME_READ_FAILED" };
    } else {
      const readyAssets: AssetHomeRecord[] = [];
      if (posters.status === "ready") readyAssets.push(...posters.data);
      if (references.status === "ready") readyAssets.push(...references.data);
      const merged = [...readyAssets].sort((left, right) => {
        if (left.recordedAt !== right.recordedAt) return right.recordedAt.localeCompare(left.recordedAt);
        return left.id.localeCompare(right.id);
      });
      gallery = merged.slice(0, 4);
      const fetchedAt =
        posters.status === "ready" && references.status === "ready"
          ? posters.fetchedAt > references.fetchedAt
            ? posters.fetchedAt
            : references.fetchedAt
          : posters.status === "ready"
            ? posters.fetchedAt
            : references.status === "ready"
              ? references.fetchedAt
              : input.now;
      assets = { status: "ready", data: gallery, fetchedAt };
      assetsPartial = posters.status === "failed" || references.status === "failed";
    }
  }

  const attention = buildAttention({ snapshot, organizationId, permissions, homeCampaigns });
  const attentionIncomplete = gates.campaigns && sources.campaigns.status === "failed";
  const destinations = buildDestinations({ role, organizationId, gates });
  const activity = buildActivity({ snapshot, organizationId, permissions, homeCampaigns, gallery });
  const logo = gates.campaigns ? sources.logo : null;

  return {
    organizationId,
    name: snapshot.organization.name,
    description,
    status: snapshot.organization.status,
    timeZone: snapshot.organization.default_timezone,
    currency: snapshot.organization.base_currency,
    logo,
    locations,
    branchlessConfirmed: snapshot.organization.branchless_confirmed,
    goals,
    focusGoalId,
    permissions,
    campaigns,
    assets,
    assetsPartial,
    attention,
    attentionIncomplete,
    destinations,
    activity,
  };
}
