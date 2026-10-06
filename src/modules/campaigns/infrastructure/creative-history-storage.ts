import type {
  CreativeHistoryObjectStore,
  CreativeHistoryStorageConfiguration,
} from "@/modules/campaigns/application/creative-history-service";

/**
 * Where a past design's bytes live, and what the bucket will actually accept.
 *
 * Creative History has its own private bucket rather than sharing
 * `campaign-assets`. A client's own photographs are not campaign output, and
 * one storage policy covering both would have to be the looser of the two.
 *
 * The two constants below are not browser conveniences. They mirror the bucket
 * row created in `supabase/migrations/20260909124757_creative_history_core.sql`
 * — `file_size_limit = 15728640` and
 * `allowed_mime_types = {image/png, image/jpeg, image/webp}` — because Storage
 * refuses an object that breaks them before any application code runs. The
 * intake contract in `asset-intake.ts` is the second authority; the DTO the
 * browser receives is the stricter of the two, so the client is never told it
 * may send something the server will throw away.
 *
 * Keeping them here, next to the adapter that talks to the bucket, means a
 * change to the bucket has one obvious place to land.
 */

export const CREATIVE_HISTORY_BUCKET = "creative-assets";

export const CREATIVE_HISTORY_BUCKET_ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export const CREATIVE_HISTORY_BUCKET_MAX_BYTES = 15_728_640;

export const creativeHistoryStorageConfiguration: CreativeHistoryStorageConfiguration = {
  bucket: CREATIVE_HISTORY_BUCKET,
  allowedMimeTypes: CREATIVE_HISTORY_BUCKET_ALLOWED_MIME_TYPES,
  maxBytes: CREATIVE_HISTORY_BUCKET_MAX_BYTES,
};

/**
 * `organizationId/creative-history/uploadIntentId/source`.
 *
 * The tenant is the first segment because that is the only thing the storage
 * policy checks. The intent id is a server-generated UUID rather than the
 * file's name: two people uploading `poster.png` on the same afternoon must not
 * land on the same object, and a filename is attacker-chosen text besides.
 *
 * There is no extension. The format is not known until the server has read the
 * bytes back and sniffed them, and a path that claims `.png` before anyone has
 * looked is a claim nobody checked.
 */
export function creativeHistoryStoragePath(input: {
  organizationId: string;
  uploadIntentId: string;
}): string {
  return `${input.organizationId}/creative-history/${input.uploadIntentId}/source`;
}

type SupabaseStorageClient = {
  storage: {
    from(bucket: string): {
      download(path: string): Promise<{ data: Blob | null; error: unknown }>;
      upload(
        path: string,
        body: Buffer,
        options: { contentType: string; upsert: boolean },
      ): Promise<{ error: unknown }>;
      createSignedUrls(
        paths: string[],
        expiresIn: number,
      ): Promise<{ data: { path: string | null; signedUrl: string }[] | null; error: unknown }>;
    };
  };
};

/**
 * Long enough to look properly at a design before deciding about it, short
 * enough that a link pasted into a chat is dead by the time anyone follows it.
 */
export const CREATIVE_HISTORY_PREVIEW_TTL_SECONDS = 600;

export function createSupabaseCreativeHistoryObjectStore(
  client: SupabaseStorageClient,
): CreativeHistoryObjectStore {
  const bucket = () => client.storage.from(CREATIVE_HISTORY_BUCKET);

  return {
    async download(path) {
      const { data, error } = await bucket().download(path);
      if (error || !data) return null;
      return Buffer.from(await data.arrayBuffer());
    },

    async upload(input) {
      const { error } = await bucket().upload(input.path, input.bytes, {
        contentType: input.contentType,
        // Replaces the browser's upload with the validated re-encode at the
        // same path, so nothing downstream has to learn a second location.
        upsert: true,
      });
      return !error;
    },

    /**
     * A failure returns an empty map rather than throwing. A library that
     * refuses to render because one thumbnail could not be signed is worse
     * than one that says a picture is unavailable.
     */
    async signPreviews(paths) {
      if (paths.length === 0) return {};
      const { data, error } = await bucket().createSignedUrls(
        [...paths],
        CREATIVE_HISTORY_PREVIEW_TTL_SECONDS,
      );
      if (error || !data) return {};

      const urls: Record<string, string> = {};
      for (const entry of data) {
        // A per-path failure arrives as a row with no path rather than an
        // error, so one unsignable design costs its own preview and no more.
        if (entry.path && entry.signedUrl) urls[entry.path] = entry.signedUrl;
      }
      return urls;
    },
  };
}
