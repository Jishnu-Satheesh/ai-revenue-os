import type { CampaignListItem } from "@/modules/campaigns/application/studio-view";

/**
 * A server-minted private preview image. The URL is a short-lived signed link;
 * dimensions are positive integers. Never a storage path or bucket name.
 *
 * Declared here (Campaign-owned). Organizations aliases it as `HomeImage`.
 * Campaign code must not import Organizations home types.
 */
export type PrivatePreviewImage = {
  url: string;
  alt: string;
  width: number;
  height: number;
  expiresAt: string;
};

/**
 * The settled state of one home source. Empty arrays belong to ready, never
 * failed. Dates are canonical UTC ISO strings.
 */
export type HomeSourceResult<T> =
  | { status: "ready"; data: T; fetchedAt: string }
  | { status: "failed"; code: "HOME_READ_FAILED" }
  | { status: "disabled" };

/** One campaign row plus its chosen cover, if one could be signed. */
export type CampaignHomeRecord = {
  item: CampaignListItem;
  cover: PrivatePreviewImage | null;
  coverLabel: "Finished render" | "Campaign image" | null;
};

/**
 * The full shape of a home gallery asset. Declared here once; Organizations
 * aliases it as `HomeAsset` rather than redeclaring it.
 */
export type AssetHomeRecord = {
  id: string;
  sourceKind: "poster_render" | "brand_reference";
  label: string;
  sourceLabel: string;
  reviewLabel: string;
  reviewState: "approved" | "unreviewed";
  recordedAt: string;
  image: PrivatePreviewImage | null;
  sourceHref: string;
};

/** Already-settled campaign-side reads handed to the home composer. */
export type CampaignHomeReads = {
  campaigns: HomeSourceResult<readonly CampaignHomeRecord[]>;
  posters: HomeSourceResult<readonly AssetHomeRecord[]>;
  references: HomeSourceResult<readonly AssetHomeRecord[]>;
  logo: PrivatePreviewImage | null;
};
