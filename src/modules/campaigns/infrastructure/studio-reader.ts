import type { CampaignReadPort } from "@/modules/campaigns/application/ports";
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
): Promise<readonly CampaignListItem[]> {
  const campaigns = await read.listCampaigns(organizationId);

  return Promise.all(
    campaigns.map(async (campaign) => {
      const versions = await read.listVersions(organizationId, campaign.id);
      const newest = versions[0];
      // A campaign with no version yet is normal, not an error: generation is a
      // background run that may still be in flight.
      const latest = newest ? await read.getVersion(organizationId, newest.id) : null;
      return toCampaignListItem(campaign, latest);
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
  options: { versionId?: string; clock?: StudioClock } = {},
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

  const approval = await read.getLiveApproval(organizationId, campaignId);

  return toStudioView({
    campaign,
    versions,
    version,
    approval,
    now: (options.clock ?? systemClock)(),
  });
}
