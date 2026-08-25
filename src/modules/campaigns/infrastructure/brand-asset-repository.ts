import {
  brandAssetReservationSchema,
  type BrandAssetObjectStore,
  type BrandAssetStore,
} from "@/modules/campaigns/application/brand-asset-service";
import { DomainError } from "@/lib/errors";
import {
  type BrandAssetPersistenceFailure,
  throwBrandAssetMutationError,
} from "@/modules/campaigns/infrastructure/brand-asset-persistence-error";

/**
 * Brand-asset writes, all through security-definer RPCs.
 *
 * `authenticated` holds select-only on both brand-asset tables, so there is no
 * path from a session to a row that claims a version is usable.
 */

type RpcResult<T> = { data: T | null; error: BrandAssetPersistenceFailure | null };

export type BrandAssetPersistence = {
  rpc(
    name: "create_brand_asset_version" | "finalize_brand_asset_version",
    args: Record<string, unknown>,
  ): Promise<RpcResult<unknown>>;
};

function brandAssetError(cause?: unknown): never {
  throw new DomainError(
    "DOMAIN_ERROR",
    "The brand asset could not be reserved or finalized.",
    cause,
  );
}

export function createBrandAssetStore(persistence: BrandAssetPersistence): BrandAssetStore {
  return {
    async reserve(input) {
      const { data, error } = await persistence.rpc("create_brand_asset_version", {
        target_organization_id: input.organizationId,
        input_asset: {
          organization_id: input.organizationId,
          brand_asset_id: input.brandAssetId,
          label: input.label,
          asset_role: input.assetRole,
          ...(input.classification === null
            ? {}
            : {
                conditioning_roles: input.classification.conditioningRoles,
                tags: input.classification.tags,
                scripts: input.classification.scripts,
                ownership: input.classification.ownership,
              }),
        },
      });
      if (error) throwBrandAssetMutationError(error);
      if (!data) brandAssetError();

      const parsed = brandAssetReservationSchema.safeParse({
        brandAssetId: (data as Record<string, unknown>).brand_asset_id,
        versionId: (data as Record<string, unknown>).version_id,
        storagePath: (data as Record<string, unknown>).storage_path,
      });
      if (!parsed.success) brandAssetError();
      return parsed.data;
    },

    async finalize(input) {
      const { error } = await persistence.rpc("finalize_brand_asset_version", {
        target_organization_id: input.organizationId,
        input_version: {
          version_id: input.versionId,
          // Every value here was read out of the stored bytes, never taken
          // from the request that uploaded them.
          content_hash: input.contentHash,
          mime_type: input.mimeType,
          byte_size: input.byteSize,
          width_px: input.widthPx,
          height_px: input.heightPx,
        },
      });
      if (error) throwBrandAssetMutationError(error);
    },
  };
}

/** Supabase Storage, narrowed to the two operations intake performs. */
export function createSupabaseBrandAssetObjectStore(client: {
  storage: {
    from(bucket: string): {
      download(path: string): Promise<{ data: Blob | null; error: unknown }>;
      upload(
        path: string,
        body: Buffer,
        options: { contentType: string; upsert: boolean },
      ): Promise<{ error: unknown }>;
    };
  };
}): BrandAssetObjectStore {
  return {
    async download(path) {
      const { data, error } = await client.storage.from("brand-assets").download(path);
      if (error || !data) return null;
      return Buffer.from(await data.arrayBuffer());
    },

    async upload(input) {
      const { error } = await client.storage.from("brand-assets").upload(input.path, input.bytes, {
        contentType: input.contentType,
        // Overwrites the client's upload with the validated re-encode at the
        // same path, so nothing else has to learn a second location.
        upsert: true,
      });
      return !error;
    },
  };
}
