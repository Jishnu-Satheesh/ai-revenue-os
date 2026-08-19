import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";
import { AdAccount } from "facebook-nodejs-business-sdk";

import type { AdapterOutcome, ToolAdapter } from "@/modules/tool-gateway/application/ports";
import type { MetaGraphClient } from "@/modules/integrations/providers/meta/client";

/**
 * One capped Meta Ads experiment.
 *
 * This is the only adapter that spends money, and it is built around two facts
 * that make paid different from organic.
 *
 * A paid action is four provider writes, not one: campaign, ad set, creative,
 * ad. A retry that starts from the beginning creates a second campaign and a
 * second ad set, and the first pair still exists under the client's ad account,
 * still able to spend. So every id is persisted the moment the provider returns
 * it, and a retry resumes from what was already built. The ledger, not the
 * adapter's memory, is what makes that safe across process restarts.
 *
 * Everything is created PAUSED and activated last. A build that fails halfway
 * leaves objects that exist and cannot spend, which is recoverable. The reverse
 * ordering leaves a live campaign attached to a half-built experiment, which is
 * money leaving on a configuration nobody finished.
 *
 * Spend is enforced twice on purpose. The Tool Gateway reserves the full
 * ceiling before this runs; the ad set carries a provider-side daily budget and
 * an end time. Either alone is a single point of failure for the one thing this
 * platform must never get wrong.
 */

const createdSchema = z.object({ id: z.string().min(1) });

export type AdsObjectLedger = {
  /** What has already been built for this action run. */
  read(input: {
    organizationId: string;
    actionRunId: string;
  }): Promise<Partial<Record<AdsObjectType, string>>>;
  /** Records an id, or returns the one already recorded. */
  record(input: {
    organizationId: string;
    actionRunId: string;
    objectType: AdsObjectType;
    externalId: string;
    createdStatus: "PAUSED" | "ACTIVE";
  }): Promise<{ externalId: string }>;
};

export type AdsObjectType = "campaign" | "ad_set" | "ad_creative" | "ad";

export type CappedExperimentRequest = {
  adAccountId: string;
  pageId: string;
  name: string;
  objective: string;
  /** The approved ceiling, in the account's own minor units. */
  dailyBudgetMinor: number;
  /** Hard stop. The provider enforces this even if nothing here runs again. */
  endTime: string;
  imageUrl: string;
  caption: string;
  /** Placements the approval actually covers. Never widened here. */
  targeting: Record<string, unknown>;
};

export type AdsAdapterDependencies = {
  client: MetaGraphClient;
  ledger: AdsObjectLedger;
  loadRequest(input: {
    organizationId: string;
    actionRunId: string;
  }): Promise<CappedExperimentRequest>;
  now?: () => Date;
};

export function createMetaAdsAdapter(dependencies: AdsAdapterDependencies): ToolAdapter {
  const now = dependencies.now ?? (() => new Date());

  return {
    toolKey: "meta.ads.run_bounded_experiment",
    async invoke({ organizationId, actionRunId, signal }): Promise<AdapterOutcome> {
      const request = await dependencies.loadRequest({ organizationId, actionRunId });

      if (request.dailyBudgetMinor <= 0) {
        // A zero ceiling is not a free experiment, it is a configuration that
        // should never have been approved.
        return { status: "failed", failureCode: "meta.ads.budget_not_positive" };
      }

      const built = await dependencies.ledger.read({ organizationId, actionRunId });
      const account = new AdAccount(request.adAccountId, {}, undefined, dependencies.client.api);

      const step = async (
        objectType: AdsObjectType,
        run: () => Promise<unknown>,
      ): Promise<{ ok: true; id: string } | { ok: false; outcome: AdapterOutcome }> => {
        // Resumed rather than rebuilt. This is the whole point of the ledger.
        const existing = built[objectType];
        if (existing) return { ok: true, id: existing };

        const result = await dependencies.client.guard({ run, schema: createdSchema, signal });

        if (result.outcome === "unknown") {
          // An object may exist under an id we never learned. Retrying would
          // build a second one, so this stops and hands it to reconciliation.
          return {
            ok: false,
            outcome: { status: "unknown", failureCode: `meta.ads.${objectType}_unknown` },
          };
        }
        if (result.outcome === "failed") {
          return {
            ok: false,
            outcome: { status: "failed", failureCode: result.failureCode },
          };
        }

        // Written before the next call, never after. A crash between the two is
        // the exact case this ordering survives.
        const recorded = await dependencies.ledger.record({
          organizationId,
          actionRunId,
          objectType,
          externalId: result.data.id,
          createdStatus: "PAUSED",
        });

        return { ok: true, id: recorded.externalId };
      };

      const campaign = await step("campaign", () =>
        account.createCampaign([], {
          name: request.name,
          objective: request.objective,
          // Paused, so a half-built experiment cannot spend.
          status: "PAUSED",
          special_ad_categories: [],
        }),
      );
      if (!campaign.ok) return campaign.outcome;

      const adSet = await step("ad_set", () =>
        account.createAdSet([], {
          name: `${request.name} — set`,
          campaign_id: campaign.id,
          // The provider-side half of the double enforcement.
          daily_budget: request.dailyBudgetMinor,
          end_time: request.endTime,
          billing_event: "IMPRESSIONS",
          optimization_goal: "REACH",
          targeting: request.targeting,
          status: "PAUSED",
        }),
      );
      if (!adSet.ok) return adSet.outcome;

      const creative = await step("ad_creative", () =>
        account.createAdCreative([], {
          name: `${request.name} — creative`,
          object_story_spec: {
            page_id: request.pageId,
            link_data: { picture: request.imageUrl, message: request.caption },
          },
        }),
      );
      if (!creative.ok) return creative.outcome;

      const ad = await step("ad", () =>
        account.createAd([], {
          name: `${request.name} — ad`,
          adset_id: adSet.id,
          creative: { creative_id: creative.id },
          status: "PAUSED",
        }),
      );
      if (!ad.ok) return ad.outcome;

      const normalized = {
        campaignId: campaign.id,
        adSetId: adSet.id,
        creativeId: creative.id,
        adId: ad.id,
        dailyBudgetMinor: request.dailyBudgetMinor,
        endTime: request.endTime,
      };

      // Everything exists and nothing is spending. Activation is deliberately a
      // separate, explicit act rather than a status set during the build.
      return {
        status: "succeeded",
        externalReference: ad.id,
        providerStatus: "PAUSED",
        occurredAt: now().toISOString(),
        payloadDigest: createHash("sha256")
          .update(JSON.stringify(normalized), "utf8")
          .digest("hex"),
        normalized,
        // What the platform committed, so approved, reserved and settled spend
        // can be compared in one currency later.
        settledMinor: 0,
      };
    },
  };
}
