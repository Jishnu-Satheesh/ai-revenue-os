import type { CampaignReadPort } from "@/modules/campaigns/application/ports";
import {
  readAssetPreviewUrls,
  type AssetPathReader,
  type SignedUrlSource,
} from "@/modules/campaigns/infrastructure/asset-preview";
import {
  readChannelReadiness,
  type ReadinessRpcSource,
} from "@/modules/campaigns/infrastructure/readiness-reader";
import {
  toCampaignListItem,
  toStudioView,
  type CampaignListItem,
  type StudioView,
} from "@/modules/campaigns/application/studio-view";

/**
 * Server-side reads for the Studio.
 *
 * Everything here goes through `CampaignReadPort`, which is the session-scoped
 * repository: RLS decides what a member can see, and this layer never widens
 * that. There is no service-role client in this path, so a campaign belonging
 * to another organization is not "hidden" by a filter here — it is simply not
 * returned by the database.
 */

export type StudioClock = () => string;

const systemClock: StudioClock = () => new Date().toISOString();

/**
 * The portfolio list.
 *
 * A campaign's headline facts live in its newest bundle version, so each row
 * needs that version read as well. That is one extra read per campaign, which
 * is honest but not free; when the portfolio grows past a screenful this should
 * become a single view that returns campaigns already joined to their latest
 * version. It is left as a straightforward N+1 for now rather than hidden
 * behind a cache that would go stale the moment a new version is published.
 */
export async function readCampaignList(
  read: CampaignReadPort,
  organizationId: string,
  clock: StudioClock = systemClock,
): Promise<readonly CampaignListItem[]> {
  const campaigns = await read.listCampaigns(organizationId);
  const now = clock();

  return Promise.all(
    campaigns.map(async (campaign) => {
      const versions = await read.listVersions(organizationId, campaign.id);
      const newest = versions[0];
      // A campaign with no version yet is normal, not an error: generation is a
      // background run that may still be in flight.
      const latest = newest ? await read.getVersion(organizationId, newest.id) : null;
      // Only read the run when there is no version to explain the campaign. A
      // settled campaign's generation history is not what this list is for.
      const run = latest ? null : await read.latestGenerationRun(organizationId, campaign.id);
      return toCampaignListItem(campaign, latest, run, now);
    }),
  );
}

/**
 * One campaign, at a specific version or its newest.
 *
 * Returns `null` both when the campaign does not exist and when it belongs to
 * another organization. Distinguishing the two would confirm that another
 * tenant's campaign exists, which is exactly what tenant scoping is for.
 */
export async function readStudioView(
  read: CampaignReadPort,
  organizationId: string,
  campaignId: string,
  options: {
    versionId?: string;
    clock?: StudioClock;
    /** Supplied by the page. Omitted in tests that do not care about artwork. */
    previews?: { database: AssetPathReader; storage: SignedUrlSource };
    /** Supplied by the page. Omitted leaves readiness unknown, never green. */
    readiness?: ReadinessRpcSource;
  } = {},
): Promise<StudioView | null> {
  const campaign = await read.getCampaign(organizationId, campaignId);
  if (!campaign) return null;

  const versions = await read.listVersions(organizationId, campaignId);
  const targetId = options.versionId ?? versions[0]?.id;
  if (!targetId) return null;

  const version = await read.getVersion(organizationId, targetId);
  // A version id from the URL is a request parameter, so it is checked against
  // this campaign rather than trusted to belong to it.
  if (!version || version.campaignId !== campaignId) return null;

  // The Studio explains; it does not authorize. Reading the live-only approval
  // here rendered a superseded approval as "nothing has been approved for this
  // campaign yet", directly beside a panel saying an approval had been
  // invalidated. `toApproval` derives the real status from the row.
  const approval = await read.getLatestApproval(organizationId, campaignId);

  const previewUrls = options.previews
    ? await readAssetPreviewUrls(options.previews.database, options.previews.storage, {
        organizationId,
        bundleVersionId: version.id,
      })
    : {};

  // The version this one came from, so the change summary compares the two
  // documents rather than trusting a summary written when the version was made.
  const parentId =
    versions.find((entry) => entry.id === version.id)?.parentVersionId ??
    version.parentVersionId ??
    null;
  const parent = parentId ? await read.getVersion(organizationId, parentId) : null;
  const previousVersion =
    parent && parent.campaignId === campaignId
      ? { version: parent.version, manifest: parent.manifest }
      : null;

  const readiness = options.readiness
    ? await readChannelReadiness(options.readiness, {
        organizationId,
        bundleVersionId: version.id,
      })
    : null;

  return toStudioView({
    campaign,
    versions,
    version,
    approval,
    now: (options.clock ?? systemClock)(),
    previewUrls,
    readiness,
    previousVersion,
  });
}
