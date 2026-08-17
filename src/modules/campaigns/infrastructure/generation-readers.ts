import { z } from "zod";

import { campaignBundleManifestSchema } from "@/domain/campaigns/schemas";
import type { PatchScopeKind } from "@/modules/campaigns/application/patch-service";
import type { GenerationSnapshotReader } from "@/workflows/campaigns/generate-bundle";
import type {
  RevisionPromptReader,
  RevisionSourceReader,
} from "@/workflows/campaigns/revise-bundle";

/**
 * Everything a claimed run is allowed to read.
 *
 * All of it comes through one RPC that requires the run's claim token, so the
 * pinned evidence and the operator's instruction are reachable only by the
 * worker currently holding the run. A plain table select would have let any
 * service-role caller read another run's context.
 */

type RpcResult<T> = { data: T | null; error: { code?: string } | null };

export type GenerationContextPersistence = {
  rpc(
    name: "load_campaign_generation_context",
    args: Record<string, unknown>,
  ): Promise<RpcResult<unknown>>;
};

const baseVersionSchema = z
  .strictObject({
    id: z.string().uuid(),
    digest: z.string().regex(/^[0-9a-f]{64}$/),
    manifest: campaignBundleManifestSchema,
    source_snapshot_id: z.string().uuid(),
    asset_storage_paths: z.record(z.string(), z.string()),
  })
  .nullable();

const contextSchema = z.strictObject({
  campaign_id: z.string().uuid(),
  source_snapshot_id: z.string().uuid(),
  kind: z.enum(["generate", "revise"]),
  facts: z.unknown(),
  assertions: z.unknown(),
  brand_asset_version_ids: z.array(z.string().uuid()),
  campaign_title: z.string(),
  latest_version_id: z.string().uuid().nullable(),
  operator_prompt: z.string().nullable(),
  patch_scope: z
    .enum(["bundle", "direction", "copy", "hashtags", "schedule", "generation_profile"])
    .nullable(),
  base_version: baseVersionSchema,
});

function contextError(): never {
  throw new Error("Campaign generation context could not be read.");
}

/**
 * One read per run, cached for the life of the worker call.
 *
 * The three readers below each need part of the same answer, and calling the
 * RPC three times would triple the round trips and open a window where the
 * three disagreed with each other.
 */
export function createGenerationContextLoader(
  persistence: GenerationContextPersistence,
  claim: { organizationId: string; runId: string },
) {
  let cached: z.infer<typeof contextSchema> | null = null;

  async function load(claimToken: string) {
    if (cached) return cached;

    const { data, error } = await persistence.rpc("load_campaign_generation_context", {
      target_organization_id: claim.organizationId,
      input_context: { run_id: claim.runId, claim_token: claimToken },
    });
    if (error || !data) contextError();

    const parsed = contextSchema.safeParse(data);
    if (!parsed.success) contextError();

    cached = parsed.data;
    return cached;
  }

  const snapshots: GenerationSnapshotReader = {
    async read(input) {
      const context = await load(input.claimToken);
      // The claim decides which campaign and snapshot this run is for. A
      // mismatch means the caller asked about work it does not hold.
      if (
        context.campaign_id !== input.campaignId ||
        context.source_snapshot_id !== input.sourceSnapshotId
      ) {
        return null;
      }

      return {
        snapshot: toSnapshotRecord(context),
        // Generation profile lives on the manifest of the version being
        // revised, or defaults for a first generation. Held here rather than
        // guessed downstream.
        generationProfile: context.base_version?.manifest.generationProfile ?? "brand_guided",
        brandAssetVersionIds: context.brand_asset_version_ids,
        // Synthetic imagery is permitted only when the snapshot said so.
        syntheticAssetsAllowed: readBoolean(context.facts, "syntheticAssetsAllowed"),
      };
    },
  };

  const revisionSource: RevisionSourceReader = {
    async read(input) {
      const context = await load(input.claimToken);
      const base = context.base_version;
      if (!base || base.id !== input.bundleVersionId) return null;

      return {
        campaignId: context.campaign_id,
        sourceSnapshotId: base.source_snapshot_id,
        digest: base.digest,
        manifest: base.manifest,
        // Null latest cannot happen for a revision, but defaulting to the base
        // would make a stale revision look current.
        latestVersionId: context.latest_version_id ?? "",
        assetStoragePaths: base.asset_storage_paths,
      };
    },
  };

  const revisionPrompts: RevisionPromptReader = {
    async read(input) {
      if (input.runId !== claim.runId) return null;
      const context = await load(input.claimToken);
      if (!context.operator_prompt || !context.patch_scope) return null;
      return {
        prompt: context.operator_prompt,
        scope: context.patch_scope as PatchScopeKind,
      };
    },
  };

  return { snapshots, revisionSource, revisionPrompts, load };
}

/**
 * Flattens the pinned snapshot into the shape `buildGenerationContext` reads.
 *
 * Deliberately tolerant: a snapshot missing a field produces a named
 * `needs_data` gap downstream rather than an exception here, because an
 * incomplete snapshot is an ordinary outcome an operator can fix.
 */
function toSnapshotRecord(context: z.infer<typeof contextSchema>): Record<string, unknown> {
  const facts = context.facts;
  if (typeof facts !== "object" || facts === null) return {};
  return { ...(facts as Record<string, unknown>) };
}

function readBoolean(source: unknown, key: string): boolean {
  if (typeof source !== "object" || source === null) return false;
  return (source as Record<string, unknown>)[key] === true;
}
