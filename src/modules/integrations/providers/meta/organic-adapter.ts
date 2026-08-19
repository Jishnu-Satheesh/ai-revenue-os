import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";
import { IGMedia, IGUser } from "facebook-nodejs-business-sdk";

import type { AdapterOutcome, ToolAdapter } from "@/modules/tool-gateway/application/ports";
import type { MetaGraphClient } from "@/modules/integrations/providers/meta/client";

/**
 * Publishing one image to Instagram, as Meta actually does it.
 *
 * This is not one call. Meta takes an image in three steps: a container is
 * created from a publicly fetchable URL, the container is polled until it
 * finishes processing, and only then is it published. Each step fails
 * differently and the middle one takes time.
 *
 * That shape decides how ambiguity is handled. The container id is the single
 * most valuable thing this adapter produces, because it survives every later
 * failure: if publishing times out, the container still exists and its own
 * status says whether the post went out. So the container id is reported on
 * every unknown outcome, and reconciliation reads `status_code` rather than
 * guessing. Without it a timeout would be unresolvable and the action stuck.
 *
 * Two provider constraints are enforced here rather than discovered in
 * production. Instagram accepts JPEG only, and the image must be reachable by
 * Meta's own fetchers — a private storage path is not enough.
 *
 * The calls themselves go through the Business SDK's own `IGUser` and `IGMedia`
 * models, so the endpoint shapes come from Meta. `client.guard` wraps each one
 * with the timeout, failure vocabulary, bounded parsing and unknown outcome the
 * SDK does not provide. See ADR 0025.
 */

const containerSchema = z.object({ id: z.string().min(1) });

const CONTAINER_STATUSES = ["EXPIRED", "ERROR", "FINISHED", "IN_PROGRESS", "PUBLISHED"] as const;
const statusSchema = z.object({
  status_code: z.enum(CONTAINER_STATUSES),
  id: z.string().optional(),
});

const publishedSchema = z.object({ id: z.string().min(1) });

/**
 * Meta's own guidance: poll about once a minute for no more than five. Beyond
 * that the container is not "slow", something is wrong, and continuing to wait
 * only holds a worker's lease.
 */
const POLL_INTERVAL_MS = 60_000;
const MAX_POLLS = 5;

export type OrganicPublishRequest = {
  /** The Instagram professional account this publishes to. */
  igUserId: string;
  /** A URL Meta can fetch. Private storage paths do not work. */
  imageUrl: string;
  caption: string;
  /** Stories use the same container flow with a media type. */
  placement: "feed_image" | "image_story";
  /** From the asset record. Instagram rejects anything but JPEG. */
  mimeType: string;
};

export type OrganicAdapterDependencies = {
  client: MetaGraphClient;
  /** Resolves the approved action into a publishable request. */
  loadRequest(input: {
    organizationId: string;
    actionRunId: string;
  }): Promise<OrganicPublishRequest>;
  /** Injected so tests do not wait five real minutes. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
};

export function createMetaOrganicAdapter(
  toolKey: "meta.publish_image" | "meta.publish_story",
  dependencies: OrganicAdapterDependencies,
): ToolAdapter {
  const sleep = dependencies.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = dependencies.now ?? (() => new Date());

  return {
    toolKey,
    async invoke({ organizationId, actionRunId, signal }): Promise<AdapterOutcome> {
      const request = await dependencies.loadRequest({ organizationId, actionRunId });

      // Refused before any call. Discovering this from a provider error would
      // mean a container already exists for an image that can never publish.
      if (request.mimeType !== "image/jpeg") {
        return { status: "failed", failureCode: "meta.image_must_be_jpeg" };
      }

      const igUser = new IGUser(request.igUserId, {}, undefined, dependencies.client.api);

      const created = await dependencies.client.guard({
        run: () =>
          igUser.createMedia([], {
            image_url: request.imageUrl,
            caption: request.caption,
            ...(request.placement === "image_story" ? { media_type: "STORIES" } : {}),
          }),
        schema: containerSchema,
        signal,
      });

      if (created.outcome === "unknown") {
        // No container id, so nothing to look up later. This is the one
        // genuinely unresolvable point in the flow, and it is also the safest:
        // a container that may or may not exist has published nothing.
        return { status: "unknown", failureCode: "meta.container_create_unknown" };
      }
      if (created.outcome === "failed") {
        return { status: "failed", failureCode: created.failureCode };
      }

      const containerId = created.data.id;

      const ready = await waitForContainer({
        client: dependencies.client,
        containerId,
        signal,
        sleep,
      });

      if (ready.outcome !== "finished") {
        return ready.outcome === "published"
          ? // Already out. Publishing again would duplicate the post, so this
            // reports success against the container rather than retrying.
            succeeded({ externalReference: containerId, providerStatus: "PUBLISHED", now })
          : {
              status: ready.outcome === "unknown" ? "unknown" : "failed",
              failureCode: ready.failureCode,
            };
      }

      const published = await dependencies.client.guard({
        run: () => igUser.createMediaPublish([], { creation_id: containerId }),
        schema: publishedSchema,
        signal,
      });

      if (published.outcome === "unknown") {
        // The container id makes this recoverable: its status_code says
        // whether the post went out, so reconciliation has a real question.
        return { status: "unknown", failureCode: `meta.publish_unknown:${containerId}` };
      }
      if (published.outcome === "failed") {
        return { status: "failed", failureCode: published.failureCode };
      }

      return succeeded({
        externalReference: published.data.id,
        providerStatus: "PUBLISHED",
        containerId,
        now,
      });
    },
  };
}

type ContainerWait =
  | { outcome: "finished" }
  | { outcome: "published" }
  | { outcome: "failed"; failureCode: string }
  | { outcome: "unknown"; failureCode: string };

async function waitForContainer(input: {
  client: MetaGraphClient;
  containerId: string;
  signal: AbortSignal;
  sleep: (ms: number) => Promise<void>;
}): Promise<ContainerWait> {
  for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
    if (input.signal.aborted) {
      // Cancelled mid-flight. The container exists and may still finish, so
      // this is unknown rather than failed.
      return { outcome: "unknown", failureCode: `meta.container_cancelled:${input.containerId}` };
    }

    const container = new IGMedia(input.containerId, {}, undefined, input.client.api);
    const status = await input.client.guard({
      run: () => container.get(["status_code"]),
      schema: statusSchema,
      signal: input.signal,
    });

    if (status.outcome === "unknown") {
      return { outcome: "unknown", failureCode: `meta.status_unknown:${input.containerId}` };
    }
    if (status.outcome === "failed") {
      return { outcome: "unknown", failureCode: `meta.status_unreadable:${input.containerId}` };
    }

    switch (status.data.status_code) {
      case "FINISHED":
        return { outcome: "finished" };
      case "PUBLISHED":
        return { outcome: "published" };
      case "ERROR":
        return { outcome: "failed", failureCode: "meta.container_error" };
      case "EXPIRED":
        return { outcome: "failed", failureCode: "meta.container_expired" };
      case "IN_PROGRESS":
        break;
    }

    if (attempt < MAX_POLLS - 1) await input.sleep(POLL_INTERVAL_MS);
  }

  // Still processing after Meta's own recommended ceiling. It may yet finish,
  // so the container is handed to reconciliation rather than called a failure.
  return {
    outcome: "unknown",
    failureCode: `meta.container_still_processing:${input.containerId}`,
  };
}

function succeeded(input: {
  externalReference: string;
  providerStatus: string;
  containerId?: string;
  now: () => Date;
}): AdapterOutcome {
  const normalized = {
    externalReference: input.externalReference,
    ...(input.containerId ? { containerId: input.containerId } : {}),
  };
  return {
    status: "succeeded",
    externalReference: input.externalReference,
    providerStatus: input.providerStatus,
    occurredAt: input.now().toISOString(),
    // A digest of what we recorded, not of the provider's body: the body is
    // not kept, so hashing it would produce a value nothing can re-derive.
    payloadDigest: createHash("sha256").update(JSON.stringify(normalized), "utf8").digest("hex"),
    normalized,
  };
}
