import { z } from "zod";

import { DomainError } from "@/lib/errors";
import type { PrivatePreviewImage } from "@/modules/campaigns/application/home-preview-types";

/**
 * Short-lived links to the pictures the organization home shows.
 *
 * The buckets stay private. The home mints one signed URL per chosen image for
 * that page load and nothing longer — the same posture as the Studio previews,
 * which sign with this exact TTL. A URL outlives nothing: it is never
 * persisted, logged, or cached, and it dies within ten minutes.
 */

/**
 * Long enough for a page load to use, short enough that a link pasted into a
 * chat is dead before anyone follows it. Shared with the home campaign and
 * asset readers; Task 3 reuses this constant rather than naming its own.
 */
export const HOME_PREVIEW_TTL_SECONDS = 600;

/** At most this many images are signed in one call. */
const MAX_PREVIEW_IMAGES_PER_CALL = 8;

export type HomePreviewBucket = "brand-assets" | "campaign-assets";

export type HomePreviewSignedEntry = {
  path: string | null;
  signedUrl: string;
};

/**
 * The only storage surface the home may touch: minting short-lived links for
 * already-validated tenant paths. No upload, no delete, no bucket management.
 */
export type HomePreviewStorage = {
  storage: {
    from(bucket: HomePreviewBucket): {
      createSignedUrls(
        paths: string[],
        expiresIn: number,
      ): Promise<{
        data: readonly HomePreviewSignedEntry[] | null;
        error: unknown;
      }>;
    };
  };
};

export type HomePreviewImageInput = {
  /** The record id the signed image belongs to; the output is keyed by it. */
  id: string;
  /** A tenant-scoped storage path, never a client-supplied URL. */
  path: string;
  alt: string;
  width: number;
  height: number;
};

export type SignHomePreviewImagesInput = {
  storage: HomePreviewStorage;
  organizationId: string;
  bucket: HomePreviewBucket;
  images: readonly HomePreviewImageInput[];
  /** The request clock; expiry is stamped from it, never beyond the TTL. */
  now: string;
  correlationId: string;
};

const imageInputSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  alt: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

function previewSigningError(): never {
  // One indistinguishable message. Which image, path, or bucket failed is
  // tenant detail a caller cannot act on, so it stays out of the message.
  throw new DomainError("DOMAIN_ERROR", "The home preview images could not be signed.");
}

/**
 * Whether a path tries to leave its tenant prefix through dot segments.
 *
 * A path beginning with `organizationId + "/"` is necessary but not enough:
 * `org/../other/x.png` starts with the prefix and still names another
 * tenant's bytes. Empty segments (`org//x.png`) are rejected the same way,
 * since no writer in this codebase produces them.
 */
function hasTraversalSegment(path: string): boolean {
  return path.split("/").some((segment) => segment === "" || segment === "." || segment === "..");
}

/**
 * Signed preview images keyed by the caller's record id.
 *
 * Untrusted entries never reach the signer: foreign-tenant paths, traversal
 * paths, and malformed dimensions are dropped before the call. A per-path
 * signing failure costs only its own image; a refused signing call returns no
 * images rather than throwing, so the home keeps its text. Returned paths are
 * matched by exact path, never by position, and paths nobody asked for are
 * ignored. Records sharing one path each keep their own identity.
 */
export async function signHomePreviewImages(
  input: SignHomePreviewImagesInput,
): Promise<Readonly<Record<string, PrivatePreviewImage>>> {
  const { storage, organizationId, bucket, images, now } = input;
  if (!organizationId) previewSigningError();
  if (images.length > MAX_PREVIEW_IMAGES_PER_CALL) previewSigningError();

  const prefix = `${organizationId}/`;
  const valid = images.filter((image) => {
    if (!imageInputSchema.safeParse(image).success) return false;
    if (!image.path.startsWith(prefix)) return false;
    if (hasTraversalSegment(image.path)) return false;
    return true;
  });
  if (valid.length === 0) return {};

  // One signature per distinct path; records keep separate identities below.
  const uniquePaths = [...new Set(valid.map((image) => image.path))];

  let signed: readonly HomePreviewSignedEntry[];
  try {
    const result = await storage.storage
      .from(bucket)
      .createSignedUrls(uniquePaths, HOME_PREVIEW_TTL_SECONDS);
    if (result.error || !result.data) return {};
    signed = result.data;
  } catch {
    return {};
  }

  const urlByPath = new Map<string, string>();
  for (const entry of signed) {
    if (!entry || entry.path === null) continue;
    if (!uniquePaths.includes(entry.path)) continue;
    if (typeof entry.signedUrl !== "string" || entry.signedUrl.length === 0) continue;
    if (!urlByPath.has(entry.path)) urlByPath.set(entry.path, entry.signedUrl);
  }

  const parsed = Date.parse(now);
  const expiresAt = new Date(
    (Number.isNaN(parsed) ? Date.now() : parsed) + HOME_PREVIEW_TTL_SECONDS * 1000,
  ).toISOString();

  const out: Record<string, PrivatePreviewImage> = {};
  for (const image of valid) {
    const url = urlByPath.get(image.path);
    if (!url) continue;
    out[image.id] = {
      url,
      alt: image.alt,
      width: image.width,
      height: image.height,
      expiresAt,
    };
  }
  return out;
}
