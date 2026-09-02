import "server-only";

import { createHash } from "node:crypto";

import { campaignBundleManifestSchema } from "@/domain/campaigns/schemas";
import type {
  DispatchPlan,
  DispatchPlanner,
  DueAction,
} from "@/workflows/campaigns/dispatch-due-actions";
import type { ToolKey } from "@/modules/tool-gateway/application/ports";

/**
 * Turning an approved action into something a provider adapter can send.
 *
 * The interesting decision here is the signed URL. Meta does not accept image
 * bytes — it fetches `image_url` with its own crawlers — so a private storage
 * path is useless and the asset has to be briefly reachable from the internet.
 *
 * How briefly is a real trade. Too short and a container expires mid-processing
 * with the image already half-fetched; too long and a public link to a client's
 * unpublished creative outlives the work it was for. Meta's own guidance is to
 * poll a container for at most five minutes, so fifteen gives three times that
 * ceiling for queueing, retries and a slow fetch, and still dies well inside
 * the hour. It is deliberately shorter than the container's own 24-hour life:
 * once a container reaches FINISHED, Meta holds the image and the URL has done
 * its job.
 *
 * Nothing here grants permission. A plan is only a description of a call; the
 * Tool Gateway decides whether it may be made.
 */

/** Three times Meta's own five-minute polling ceiling. */
const PUBLISH_URL_TTL_SECONDS = 900;

const ASSET_BUCKET = "campaign-assets";

export type DispatchPlannerPersistence = {
  from(table: "campaign_bundle_versions" | "campaign_assets" | "integration_account_mappings"): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        eq(
          column: string,
          value: string,
        ): PromiseLike<{ data: Record<string, unknown>[] | null; error: unknown }>;
      } & PromiseLike<{ data: Record<string, unknown>[] | null; error: unknown }>;
    };
  };
  storage: {
    from(bucket: string): {
      createSignedUrl(
        path: string,
        expiresIn: number,
      ): Promise<{ data: { signedUrl: string } | null; error: unknown }>;
    };
  };
};

export type PlannedPublish = {
  igUserId: string;
  imageUrl: string;
  caption: string;
  placement: "feed_image" | "image_story";
  mimeType: string;
};

/**
 * The publishable request, kept beside the plan.
 *
 * The adapter needs the URL and the copy; the gateway needs the key and the
 * digest. They are produced together because they describe one call, and a
 * digest computed over different content than the adapter sends would make the
 * idempotency record meaningless.
 */
export type DispatchPlanWithRequest = DispatchPlan & { request: PlannedPublish };

export function createDispatchPlanner(
  persistence: DispatchPlannerPersistence,
  requests: Map<string, PlannedPublish>,
): DispatchPlanner {
  return {
    async plan(action: DueAction): Promise<DispatchPlan | null> {
      const built = await buildPlan(persistence, action);
      if (!built) return null;

      // Handed to the adapter by action-run id rather than through the gateway,
      // because the gateway's contract carries authority, not payloads.
      requests.set(action.actionRunId, built.request);

      const { request: _request, ...plan } = built;
      return plan;
    },
  };
}

async function buildPlan(
  persistence: DispatchPlannerPersistence,
  action: DueAction,
): Promise<DispatchPlanWithRequest | null> {
  const { data: versions } = await persistence
    .from("campaign_bundle_versions")
    .select("manifest")
    .eq("organization_id", action.organizationId)
    .eq("id", action.bundleVersionId);

  const [version] = versions ?? [];
  if (!version) return null;

  const manifest = campaignBundleManifestSchema.safeParse(version.manifest);
  if (!manifest.success) return null;

  const channelAction = manifest.data.actions.find((entry) => entry.id === action.actionKey);
  if (!channelAction) return null;

  const direction = manifest.data.directions.find(
    (entry) => entry.id === channelAction.directionId,
  );
  if (!direction) return null;

  // The copy written for exactly this channel and placement. Falling back to
  // another placement's words would publish something nobody reviewed here.
  const copy = direction.copy.find(
    (entry) =>
      entry.channel === channelAction.channel && entry.placement === channelAction.placement,
  );
  if (!copy) return null;

  const assetId = direction.assetIds[0];
  const asset = manifest.data.assets.find((entry) => entry.id === assetId);
  if (!asset) return null;

  const { data: assetRows } = await persistence
    .from("campaign_assets")
    .select("asset_key, storage_path")
    .eq("organization_id", action.organizationId)
    .eq("bundle_version_id", action.bundleVersionId);

  const storagePath = (assetRows ?? []).find((row) => row.asset_key === assetId)?.storage_path;
  if (typeof storagePath !== "string") return null;

  const signed = await persistence.storage
    .from(ASSET_BUCKET)
    .createSignedUrl(storagePath, PUBLISH_URL_TTL_SECONDS);
  if (!signed.data?.signedUrl) return null;

  const { data: mappings } = await persistence
    .from("integration_account_mappings")
    .select("external_account_id")
    .eq("organization_id", action.organizationId)
    .eq("channel", channelAction.channel);

  const igUserId = (mappings ?? [])[0]?.external_account_id;
  if (typeof igUserId !== "string") return null;

  const request: PlannedPublish = {
    igUserId,
    imageUrl: signed.data.signedUrl,
    caption: `${copy.hook}\n\n${copy.caption}`,
    placement: channelAction.placement,
    mimeType: asset.mimeType,
  };

  // The digest covers what will actually be sent, minus the signed URL — that
  // changes on every plan and would make two attempts at the same publication
  // look like two different requests, defeating the idempotency it feeds.
  const requestDigest = createHash("sha256")
    .update(
      JSON.stringify({
        igUserId,
        caption: request.caption,
        placement: request.placement,
        assetContentHash: asset.contentHash,
      }),
      "utf8",
    )
    .digest("hex");

  return {
    toolKey: toolKeyFor(channelAction.placement),
    capabilityKey: `meta.${channelAction.channel}.publish`,
    // Stable per action run, so a retried dispatch replays rather than
    // publishing a second time.
    idempotencyKey: `action:${action.actionRunId}`,
    requestDigest,
    assertedFacts: { credentialHealthy: true },
    request,
  };
}

function toolKeyFor(placement: "feed_image" | "image_story"): ToolKey {
  return placement === "image_story" ? "meta.publish_story" : "meta.publish_image";
}
