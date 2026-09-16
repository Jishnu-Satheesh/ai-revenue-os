import type { CampaignState } from "@/domain/campaigns/state-machine";
import type { CampaignGeneration } from "@/modules/campaigns/application/studio-view";
import type {
  RevenueScenario,
  RevenueScenarioInput,
} from "@/domain/organizations/revenue-scenario";
import type {
  AssetHomeRecord as CampaignAssetHomeRecord,
  HomeSourceResult as CampaignHomeSourceResult,
  PrivatePreviewImage as CampaignPrivatePreviewImage,
} from "@/modules/campaigns/application/home-preview-types";

/** Server-minted private preview; never a storage path or bucket name. */
export type HomeImage = CampaignPrivatePreviewImage;

/** One home section: ready data, a safe failure, or a gated-off source. */
export type HomeSection<T> = CampaignHomeSourceResult<T>;

/** One gallery asset; the single declaration lives in Campaign-owned types. */
export type HomeAsset = CampaignAssetHomeRecord;

export type HomeCampaign = {
  id: string;
  title: string;
  objective: string | null;
  state: CampaignState;
  generation: CampaignGeneration;
  openable: boolean;
  updatedAt: string;
  actionLabel: "Review campaign" | "Continue draft" | "View campaign" | "View in Campaigns";
  href: string;
  cover: HomeImage | null;
  coverLabel: "Finished render" | "Campaign image" | null;
};

export type HomeAttentionItem = {
  id: string;
  sourceLabel: "Campaign" | "Organization";
  title: string;
  reason: string;
  actionLabel: string;
  href: string;
};

export type HomeActivityItem = {
  id: string;
  label: string;
  title: string | null;
  occurredAt: string;
  href: string | null;
  kind: "campaign" | "asset" | "organization";
};

export type HomeGoal = {
  id: string;
  name: string;
  target: string;
  deadline: string | null;
  scopeLabel: string;
};

export type HomeDestination = {
  key: "channels" | "growth" | "memory" | "integrations";
  label: string;
  description: string;
  href: string;
};

export type HomePermissions = {
  canCreateCampaign: boolean;
  canEditCampaign: boolean;
  canReviewCampaign: boolean;
  canManageCore: boolean;
};

/** Settled revenue-scenario reads behind the Current vs Projected section. */
export type HomeRevenueSource =
  | { status: "ready"; input: RevenueScenarioInput; fetchedAt: string; extraNotes: readonly string[] }
  | { status: "failed" }
  | { status: "disabled" };

export type OrganizationHomeView = {
  organizationId: string;
  name: string;
  description: string | null;
  status: string;
  timeZone: string;
  currency: string;
  logo: HomeImage | null;
  locations: readonly { id: string; name: string; kind: string }[];
  branchlessConfirmed: boolean;
  goals: readonly HomeGoal[];
  focusGoalId: string | null;
  permissions: HomePermissions;
  campaigns: HomeSection<readonly HomeCampaign[]>;
  assets: HomeSection<readonly HomeAsset[]>;
  assetsPartial: boolean;
  revenue: HomeSection<RevenueScenario>;
  attention: readonly HomeAttentionItem[];
  attentionIncomplete: boolean;
  destinations: readonly HomeDestination[];
  activity: readonly HomeActivityItem[];
};
