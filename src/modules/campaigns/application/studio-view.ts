import type {
  CampaignAsset,
  CampaignBundleManifest,
  CampaignCopy,
  CampaignCreativeDirection,
  CampaignHashtagSet,
} from "@/domain/campaigns/schemas";
import { explainReadinessCode } from "@/domain/campaigns/channel-capabilities";
import { diffManifestChanges } from "@/domain/campaigns/diff";
import { approvalStatus, type CampaignState } from "@/domain/campaigns/state-machine";
import type { ChannelReadiness } from "@/modules/campaigns/infrastructure/readiness-reader";
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

/** A manifest asset plus the short-lived link that lets an operator see it. */
export type StudioAsset = CampaignAsset & { previewUrl: string | null };

export type StudioDirection = {
  id: string;
  kind: CampaignCreativeDirection["kind"];
  name: string;
  rationale: string;
  generationProfile: CampaignBundleManifest["generationProfile"];
  assetIds: readonly string[];
  assets: readonly StudioAsset[];
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
  /** Signed preview links keyed by manifest asset id. Empty when unavailable. */
  previewUrls?: Readonly<Record<string, string>>;
  /** Per-channel execution readiness. `null` when it could not be determined. */
  readiness?: readonly ChannelReadiness[] | null;
  /** The version this one was derived from, when there is one to compare with. */
  previousVersion?: { version: number; manifest: CampaignBundleManifest } | null;
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
  /** The version an attestation and approval are bound to, with its digest. */
  versionId: string;
  digest: string;
  versionNumber: number;
  versions: readonly StudioVersionEntry[];
  directions: readonly StudioDirection[];
  actions: CampaignBundleManifest["actions"];
  totalSpendCeiling: Money | null;
  measurement: CampaignBundleManifest["measurementPlan"];
  approval: StudioApproval;
  /**
   * `null` means the platform could not determine readiness, which is not the
   * same as everything being fine and must never be rendered as if it were.
   */
  readiness: readonly StudioChannelReadiness[] | null;
  /** `null` when this is the first version and there is nothing to compare. */
  changeSummary: StudioChangeSummary | null;
};

/**
 * What this version changed relative to the one before it.
 *
 * `null` when there is no earlier version, which is a different statement from
 * an empty change list. Nothing to compare against is not the same as compared
 * and found identical — and the second cannot happen anyway, since a version
 * that changed nothing is refused at the point it would have been created.
 */
export type StudioChangeSummary = {
  fromVersion: number;
  toVersion: number;
  changes: readonly { path: string; label: string; before: string | null; after: string | null }[];
};

/** A channel verdict with the sentences the panel shows, resolved once here. */
export type StudioChannelReadiness = ChannelReadiness & {
  blockers: readonly { code: string; reason: string; recovery: string }[];
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
  previewUrls: Readonly<Record<string, string>>,
): readonly StudioAsset[] {
  const byId = new Map(manifest.assets.map((asset) => [asset.id, asset]));
  return direction.assetIds.flatMap((id: string) => {
    const asset = byId.get(id);
    // Null rather than absent: "we could not sign a link for this image" is a
    // state the preview has to render, not one to hide behind a missing key.
    return asset ? [{ ...asset, previewUrl: previewUrls[asset.id] ?? null }] : [];
  });
}

export function toStudioView(input: StudioViewInput): StudioView {
  const { campaign, version, versions, approval, now } = input;
  const previewUrls = input.previewUrls ?? {};
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
    versionId: version.id,
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
      assets: directionAssets(direction, manifest, previewUrls),
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
    readiness: toReadiness(input.readiness),
    changeSummary: toChangeSummary(input.previousVersion, version.version, manifest),
  };
}

/**
 * The material differences between this version and the one before it.
 *
 * Computed from the two manifests rather than from a stored summary, because a
 * summary written at creation time could drift from the documents it claims to
 * describe, and this is the panel an operator reads before deciding whether an
 * approval still means anything.
 */
function toChangeSummary(
  previous: StudioViewInput["previousVersion"],
  toVersion: number,
  manifest: CampaignBundleManifest,
): StudioChangeSummary | null {
  if (!previous) return null;

  return {
    fromVersion: previous.version,
    toVersion,
    changes: diffManifestChanges(previous.manifest, manifest).map((change) => ({
      path: change.path,
      label: readableChangePath(change.path),
      before: change.before,
      after: change.after,
    })),
  };
}

/** `directions[0].copy[0].hook` reads as "Hook" to a person reading a diff. */
function readableChangePath(path: string): string {
  const leaf = path.split(".").at(-1)?.replace(/\[\d+\]/g, "") ?? path;
  const spaced = leaf.replace(/([A-Z])/g, " $1").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Attaches the sentence for each refusal code, keeping `null` as `null`.
 *
 * Distinguishing "no verdict" from "no blockers" is the entire point of the
 * panel. Collapsing them here would put a green tick on a channel nobody
 * checked, which is the failure the placeholder was there to prevent.
 */
function toReadiness(
  readiness: readonly ChannelReadiness[] | null | undefined,
): readonly StudioChannelReadiness[] | null {
  if (readiness === null || readiness === undefined) return null;

  return readiness.map((entry) => ({
    ...entry,
    blockers: entry.codes.map((code) => ({ code, ...explainReadinessCode(code) })),
  }));
}
