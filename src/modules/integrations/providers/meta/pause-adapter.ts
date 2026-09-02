import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";
import { Ad, AdSet, Campaign as AdsCampaign } from "facebook-nodejs-business-sdk";

import type { AdapterOutcome, ToolAdapter } from "@/modules/tool-gateway/application/ports";
import type { MetaGraphClient } from "@/modules/integrations/providers/meta/client";
import type { AdsObjectLedger } from "@/modules/integrations/providers/meta/ads-adapter";

/**
 * Stopping spend, as its own tool.
 *
 * A pause is a provider write like any other, so it gets its own action run,
 * its own idempotency key and its own unknown-outcome path. What makes it
 * different from a publish is worth stating, because the difference is what
 * this adapter is built on.
 *
 * A repeated publish creates a second post. A repeated pause changes nothing —
 * setting an already-paused object to PAUSED is the same request twice with the
 * same result. So this needs no ledger of its own and a retry is safe, where
 * the build adapter needed both.
 *
 * The severity runs the other way. An unresolved publish means a post may exist
 * that nobody meant to make; an unresolved pause means money may still be
 * leaving. So an unknown outcome here is never left as the final answer if it
 * can be settled: a pause can be *checked*, unlike a publish, and this always
 * reads the object back before reporting. Provider acknowledgement of the write
 * is not evidence the object stopped — `effective_status` is.
 *
 * Containment is deliberately allowed to reach past the ad. Delivery stops when
 * the ad stops, so the ad is paused first and fastest. But when a guardrail or
 * ceiling breach is what triggered this, or when the build's own outcome was
 * unknown and the ad id was never learned, the only sound containment is from
 * above: an ad created under a paused campaign inherits CAMPAIGN_PAUSED, known
 * to this platform or not.
 */

/**
 * What the write returns.
 *
 * Meta acknowledges an object update rather than returning the object, so the
 * SDK's declared `Promise<Ad>` is not what actually resolves — it passes the
 * response body straight through. Both documented acknowledgement shapes are
 * accepted; a `success: false` is not one of them and fails the parse.
 */
const acknowledgedSchema = z.union([
  z.object({ success: z.literal(true) }),
  z.object({ id: z.string().min(1) }),
]);

const effectiveStatusSchema = z.object({ effective_status: z.string().min(1) });

/**
 * The statuses that prove an object cannot deliver.
 *
 * Deliberately short. `PENDING_REVIEW`, `IN_PROCESS` and `WITH_ISSUES` all
 * describe objects that are not currently delivering but have not been stopped,
 * and reading them as containment would report a spend that is merely between
 * states as a spend that was halted.
 */
const CONTAINED_STATUSES = new Set([
  "PAUSED",
  "ADSET_PAUSED",
  "CAMPAIGN_PAUSED",
  "ARCHIVED",
  "DELETED",
]);

/**
 * The objects a pause can act on.
 *
 * A creative is deliberately absent: it carries no delivery state, so pausing
 * one is not a thing the provider offers or this platform should imply.
 */
type PausableObjectType = "ad" | "ad_set" | "campaign";

/** How far up the object graph containment reaches. */
export type PauseDepth = "ad" | "experiment";

export type PauseRequest = {
  /**
   * The action run that built the experiment. Its ledger rows carry the ids;
   * this run is the pause, and owns none of them.
   */
  targetActionRunId: string;
  depth: PauseDepth;
};

export type PauseAdapterDependencies = {
  client: MetaGraphClient;
  ledger: Pick<AdsObjectLedger, "read">;
  loadRequest(input: { organizationId: string; actionRunId: string }): Promise<PauseRequest>;
  now?: () => Date;
};

export function createMetaAdsPauseAdapter(dependencies: PauseAdapterDependencies): ToolAdapter {
  const now = dependencies.now ?? (() => new Date());

  return {
    toolKey: "meta.ads.pause_ad",
    async invoke({ organizationId, actionRunId, signal }): Promise<AdapterOutcome> {
      const request = await dependencies.loadRequest({ organizationId, actionRunId });
      const built = await dependencies.ledger.read({
        organizationId,
        actionRunId: request.targetActionRunId,
      });

      if (!built.ad && !built.ad_set && !built.campaign) {
        // Nothing recorded is not the same as nothing existing: a build whose
        // outcome was unknown leaves objects under ids nobody learned. Reporting
        // a clean stop here would be an all-clear over possibly live spend.
        return { status: "failed", failureCode: "meta.ads.pause_target_unresolved" };
      }

      // An ad this platform cannot name can only be stopped from above it.
      const escalate = request.depth === "experiment" || !built.ad;

      const targets: { objectType: PausableObjectType; id: string }[] = [];
      // Ad first. It is the object whose pause actually stops delivery, so it
      // goes out before anything slower up the graph.
      if (built.ad) targets.push({ objectType: "ad", id: built.ad });
      if (escalate) {
        if (built.ad_set) targets.push({ objectType: "ad_set", id: built.ad_set });
        if (built.campaign) targets.push({ objectType: "campaign", id: built.campaign });
      }

      const paused: string[] = [];
      let unknownCode: string | null = null;
      let failureCode: string | null = null;

      for (const target of targets) {
        const result = await dependencies.client.guard({
          // `[]` is the SDK's fields argument, which its own implementation
          // discards for an update; the params object is the whole request.
          run: () => node(target, dependencies.client).update([], { status: "PAUSED" }),
          schema: acknowledgedSchema,
          signal,
        });

        if (result.outcome === "succeeded") {
          paused.push(target.objectType);
          continue;
        }
        // Neither branch stops the sweep. A pause that failed at one level may
        // still be achievable at the next one up, and containment anywhere in
        // the chain is containment.
        if (result.outcome === "unknown") {
          unknownCode ??= `meta.ads.pause_${target.objectType}_unknown`;
        } else {
          failureCode ??= result.failureCode;
        }
      }

      // The object whose status settles the question: the most specific one we
      // can name, because its effective status inherits everything above it.
      const witness = targets[0];
      const verified = await dependencies.client.guard({
        run: () => node(witness, dependencies.client).read(["effective_status"]),
        schema: effectiveStatusSchema,
        signal,
      });

      if (verified.outcome !== "succeeded") {
        // The write may well have landed. Nobody can say, and spend may be
        // live, so this is unknown rather than a failure that reads as settled.
        return { status: "unknown", failureCode: unknownCode ?? "meta.ads.pause_unconfirmed" };
      }

      const status = verified.data.effective_status;
      if (!CONTAINED_STATUSES.has(status)) {
        // Acknowledged writes and a still-delivering object. Either propagation
        // is lagging or the pause did not take; both mean unresolved, and
        // unresolved here means money.
        return {
          status: "unknown",
          failureCode: unknownCode ?? failureCode ?? "meta.ads.pause_not_reflected",
        };
      }

      // Contained, and proven by a read rather than by the provider's
      // acknowledgement of our own request. A write that failed or timed out no
      // longer matters: the object cannot deliver.
      const normalized = {
        targetActionRunId: request.targetActionRunId,
        depth: escalate ? "experiment" : "ad",
        pausedObjects: paused,
        witnessObject: witness.objectType,
        verifiedStatus: status,
      };

      return {
        status: "succeeded",
        externalReference: witness.id,
        providerStatus: status,
        occurredAt: now().toISOString(),
        payloadDigest: createHash("sha256")
          .update(JSON.stringify(normalized), "utf8")
          .digest("hex"),
        normalized,
        // A pause moves no money. It is recorded so approved, reserved and
        // settled spend still reconcile to one figure.
        settledMinor: 0,
      };
    },
  };
}

/** The SDK model for one object, bound to the client's own API instance. */
function node(target: { objectType: PausableObjectType; id: string }, client: MetaGraphClient) {
  switch (target.objectType) {
    case "ad":
      return new Ad(target.id, {}, undefined, client.api);
    case "ad_set":
      return new AdSet(target.id, {}, undefined, client.api);
    case "campaign":
      return new AdsCampaign(target.id, {}, undefined, client.api);
  }
}
