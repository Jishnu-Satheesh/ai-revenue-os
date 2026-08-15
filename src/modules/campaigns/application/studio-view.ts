import type {
  CampaignAsset,
  CampaignBundleManifest,
  CampaignCopy,
  CampaignCreativeDirection,
  CampaignHashtagSet,
} from "@/domain/campaigns/schemas";
import { approvalStatus, type CampaignState } from "@/domain/campaigns/state-machine";
import type {
  BundleVersionDetail,
  BundleVersionSummary,
  CampaignApproval,
  CampaignSummary,
} from "@/modules/campaigns/application/ports";

/**
 * Turning stored campaign records into what the Studio renders.
 *
 * This layer exists to keep one rule enforceable in one place: the screen shows
 * what the campaign has actually produced, and nothing else. A campaign row on
 * its own carries a title, a source and a state — it does not carry an
 * objective, channels or a spend ceiling. Those live in a bundle version, and
 * until a version exists they are genuinely unknown.
 *
 * So they are modelled as `null`, not as `""` or `0`. An empty string reads as
 * "the objective is blank" and a zero reads as "this campaign may spend
 * nothing", and both are claims the data does not support.
 */

export type Money = { amountMinor: number; currency: string };

export type CampaignListItem = {
  id: string;
  title: string;
  state: CampaignState;
  sourceKind: CampaignSummary["sourceKind"];
  sourceLabel: string;
  updatedAt: string;
  /** Absent until a bundle version has been generated. */
  awaitingFirstVersion: boolean;
  version: number | null;
  objective: string | null;
  channels: readonly string[];
  spendCeiling: Money | null;
};

export type StudioApproval =
  | { status: "none" }
  | { status: "live"; approvedAt: string; expiresAt: string; actionKeys: readonly string[] }
  | { status: "expired"; expiresAt: string }
  | { status: "superseded"; coversVersionId: string }
  | { status: "digest_mismatch" }
  | { status: "revoked"; revokedReason: CampaignApproval["revokedReason"] };

export type StudioDirection = {
  id: string;
  kind: CampaignCreativeDirection["kind"];
  name: string;
  rationale: string;
  generationProfile: CampaignBundleManifest["generationProfile"];
  assetIds: readonly string[];
  assets: readonly CampaignAsset[];
  copy: readonly CampaignCopy[];
  hashtagSets: readonly CampaignHashtagSet[];
  internalContentTags: readonly CampaignCreativeDirection["internalContentTags"][number][];
  softConventionDepartures: readonly string[];
  experiment: CampaignCreativeDirection["experiment"];
};

export type StudioVersionEntry = {
  id: string;
  version: number;
  createdAt: string;
  parentVersionId: string | null;
  isCurrent: boolean;
};

export type StudioViewInput = {
  campaign: CampaignSummary;
  versions: readonly BundleVersionSummary[];
  version: BundleVersionDetail;
  approval: CampaignApproval | null;
  /** ISO instant, passed in so the view is deterministic under test. */
  now: string;
};

export type StudioView = {
  campaignId: string;
  title: string;
  state: CampaignState;
  sourceKind: CampaignSummary["sourceKind"];
  sourceLabel: string;
  objective: string;
  rationale: string;
  generationProfile: CampaignBundleManifest["generationProfile"];
  executionMode: CampaignBundleManifest["executionMode"];
  /** The digest an attestation and approval are bound to. */
  digest: string;
  versionNumber: number;
  versions: readonly StudioVersionEntry[];
  directions: readonly StudioDirection[];
  actions: CampaignBundleManifest["actions"];
  totalSpendCeiling: Money | null;
  measurement: CampaignBundleManifest["measurementPlan"];
  approval: StudioApproval;
};

const SOURCE_LABEL: Readonly<Record<CampaignSummary["sourceKind"], string>> = {
  decision_opportunity: "Decision Engine opportunity",
  manual_brief: "Manual brief",
};

/** Sorted so the same set of actions always reads the same way. */
function channelsOf(manifest: CampaignBundleManifest): readonly string[] {
  return [...new Set(manifest.actions.map((action) => action.channel))].sort();
}

export function toCampaignListItem(
  campaign: CampaignSummary,
  latest: BundleVersionDetail | null,
): CampaignListItem {
  const shared = {
    id: campaign.id,
    title: campaign.title,
    state: campaign.state as CampaignState,
    sourceKind: campaign.sourceKind,
    sourceLabel: SOURCE_LABEL[campaign.sourceKind],
    updatedAt: campaign.updatedAt,
  };

  if (!latest) {
    return {
      ...shared,
      awaitingFirstVersion: true,
      version: null,
      objective: null,
      channels: [],
      spendCeiling: null,
    };
  }

  return {
    ...shared,
    awaitingFirstVersion: false,
    version: latest.version,
    objective: latest.manifest.objective,
    channels: channelsOf(latest.manifest),
    spendCeiling: latest.manifest.totalSpendCeiling,
  };
}

function toApproval(
  approval: CampaignApproval | null,
  version: BundleVersionDetail,
  now: string,
): StudioApproval {
  if (!approval) return { status: "none" };

  const status = approvalStatus(
    {
      bundleVersionId: approval.bundleVersionId,
      bundleDigest: approval.bundleDigest,
      expiresAt: approval.expiresAt,
      revokedAt: approval.revokedAt,
    },
    { bundleVersionId: version.id, bundleDigest: version.digest },
    new Date(now),
  );

  if (status.isApproved) {
    return {
      status: "live",
      approvedAt: approval.approvedAt,
      expiresAt: approval.expiresAt,
      actionKeys: approval.actionKeys,
    };
  }

  switch (status.reason) {
    case "revoked":
      return { status: "revoked", revokedReason: approval.revokedReason };
    case "version_superseded":
      return { status: "superseded", coversVersionId: approval.bundleVersionId };
    case "digest_mismatch":
      return { status: "digest_mismatch" };
    case "expired":
      return { status: "expired", expiresAt: approval.expiresAt };
    case "no_approval":
      return { status: "none" };
  }
}

/**
 * Assets are attached to a direction by id.
 *
 * Position would be the easy join and the wrong one: the manifest carries one
 * shared asset pool, and two directions may reference the same image. Matching
 * by index would silently show one direction another's artwork.
 */
function directionAssets(
  direction: CampaignCreativeDirection,
  manifest: CampaignBundleManifest,
): readonly CampaignAsset[] {
  const byId = new Map(manifest.assets.map((asset) => [asset.id, asset]));
  return direction.assetIds.flatMap((id: string) => {
    const asset = byId.get(id);
    return asset ? [asset] : [];
  });
}

export function toStudioView(input: StudioViewInput): StudioView {
  const { campaign, version, versions, approval, now } = input;
  const manifest = version.manifest;

  return {
    campaignId: campaign.id,
    title: campaign.title,
    state: campaign.state as CampaignState,
    sourceKind: campaign.sourceKind,
    sourceLabel: SOURCE_LABEL[campaign.sourceKind],
    objective: manifest.objective,
    rationale: manifest.rationale,
    generationProfile: manifest.generationProfile,
    executionMode: manifest.executionMode,
    digest: version.digest,
    versionNumber: version.version,
    versions: [...versions]
      .sort((left, right) => right.version - left.version)
      .map((entry) => ({
        id: entry.id,
        version: entry.version,
        createdAt: entry.createdAt,
        parentVersionId: entry.parentVersionId,
        isCurrent: entry.id === version.id,
      })),
    directions: manifest.directions.map((direction) => ({
      id: direction.id,
      kind: direction.kind,
      name: direction.name,
      rationale: direction.rationale,
      generationProfile: direction.generationProfileOverride ?? manifest.generationProfile,
      assetIds: direction.assetIds,
      assets: directionAssets(direction, manifest),
      copy: direction.copy,
      hashtagSets: direction.hashtagSets,
      internalContentTags: direction.internalContentTags,
      softConventionDepartures: direction.softConventionDepartures,
      experiment: direction.experiment,
    })),
    actions: manifest.actions,
    totalSpendCeiling: manifest.totalSpendCeiling,
    // The preregistered plan, and only the plan. A verdict field here would
    // invite a component to render an outcome for a campaign that has not run.
    measurement: manifest.measurementPlan,
    approval: toApproval(approval, version, now),
  };
}
