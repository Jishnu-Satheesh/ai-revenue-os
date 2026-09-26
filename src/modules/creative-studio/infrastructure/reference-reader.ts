import "server-only";

import { z } from "zod";

import { DomainError } from "@/lib/errors";

/**
 * Reading Studio upload records and signing reference previews.
 *
 * Two halves with one rule between them: reads in this file never change
 * anything. The reservation row is read through the caller's own session, so
 * RLS decides what comes back, and the row is checked against the requested
 * tenant again on the way out — a future policy edit must not quietly widen
 * what the intake trusts. Preview signing mints fresh URLs for the same
 * stored objects; it never moves, copies, or rewrites a byte.
 */

const uuidSchema = z.string().uuid();

const uploadRowSchema = z.strictObject({
  id: uuidSchema,
  organization_id: uuidSchema,
  actor_id: uuidSchema,
  reserved_path: z.string().min(1),
  state: z.enum(["reserved", "ready", "rejected", "expired"]),
  rights_attestation: z.record(z.string(), z.unknown()),
  final_hash: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  final_mime: z.enum(["image/png", "image/jpeg", "image/webp"]).nullable(),
  final_width: z.number().int().nullable(),
  final_height: z.number().int().nullable(),
  final_bytes: z.number().int().nullable(),
  expires_at: z.string().min(1),
});

const UPLOAD_COLUMNS = [
  "id",
  "organization_id",
  "actor_id",
  "reserved_path",
  "state",
  "rights_attestation",
  "final_hash",
  "final_mime",
  "final_width",
  "final_height",
  "final_bytes",
  "expires_at",
].join(",");

export type StudioUploadRecord = {
  organizationId: string;
  uploadId: string;
  actorId: string;
  reservedPath: string;
  state: "reserved" | "ready" | "rejected" | "expired";
  rightsAttestation: Record<string, unknown>;
  finalHash: string | null;
  finalMime: "image/png" | "image/jpeg" | "image/webp" | null;
  finalWidth: number | null;
  finalHeight: number | null;
  finalBytes: number | null;
  expiresAt: string;
};

export type StudioUploadRecordPersistence = {
  from(table: "studio_uploads"): {
    select(columns: string): {
      eq(column: string, value: string): {
        eq(column: string, value: string): {
          maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: unknown }>;
        };
      };
    };
  };
};

function unreadable(cause?: unknown): never {
  throw new DomainError("DOMAIN_ERROR", "The Studio upload could not be read.", cause);
}

/**
 * The reservation row behind an upload id, or null when there is none.
 *
 * A foreign upload is not "forbidden", it is absent: RLS returns no row, and
 * the tenant check below means a future policy edit cannot turn absence into
 * a leak. The caller cannot tell "no such upload" from "another tenant's".
 */
export function createStudioUploadRecordReader(persistence: StudioUploadRecordPersistence) {
  return {
    async read(organizationId: string, uploadId: string): Promise<StudioUploadRecord | null> {
      const { data, error } = await persistence
        .from("studio_uploads")
        .select(UPLOAD_COLUMNS)
        .eq("organization_id", organizationId)
        .eq("id", uploadId)
        .maybeSingle();
      if (error) unreadable(error);
      if (!data) return null;

      const parsed = uploadRowSchema.safeParse(data);
      if (!parsed.success) unreadable(parsed.error);
      if (parsed.data.organization_id !== organizationId) return null;

      return {
        organizationId: parsed.data.organization_id,
        uploadId: parsed.data.id,
        actorId: parsed.data.actor_id,
        reservedPath: parsed.data.reserved_path,
        state: parsed.data.state,
        rightsAttestation: parsed.data.rights_attestation,
        finalHash: parsed.data.final_hash,
        finalMime: parsed.data.final_mime,
        finalWidth: parsed.data.final_width,
        finalHeight: parsed.data.final_height,
        finalBytes: parsed.data.final_bytes,
        expiresAt: parsed.data.expires_at,
      };
    },
  };
}

export type StudioReferenceSignEntry = {
  bucket: string;
  path: string;
};

/**
 * Fresh preview URLs keyed by storage identity (`${bucket}:${path}`), so a
 * re-signed preview is visibly the same object with a new URL rather than a
 * new object. Paths that cannot be signed are absent from the map, never
 * invented: one unsignable reference costs its own preview and no more.
 */
export type StudioReferenceSigner = {
  /**
   * The map key for one entry. Both sides of the sign/lookup contract call
   * this, so the writer and the reader cannot drift apart into silent misses.
   */
  keyFor(entry: StudioReferenceSignEntry): string;
  signPaths(
    entries: readonly StudioReferenceSignEntry[],
  ): Promise<Readonly<Record<string, string>>>;
};

/** Signed Studio links expire after 5 minutes; authorized reads sign anew. */
export const STUDIO_REFERENCE_PREVIEW_TTL_SECONDS = 300;

type StudioSignStorageClient = {
  storage: {
    from(bucket: string): {
      createSignedUrls(
        paths: string[],
        expiresIn: number,
      ): Promise<{ data: { path: string | null; signedUrl: string }[] | null; error: unknown }>;
    };
  };
};

export function signEntryKey(entry: StudioReferenceSignEntry): string {
  return `${entry.bucket}:${entry.path}`;
}

export function createSupabaseStudioReferenceSigner(
  client: StudioSignStorageClient,
): StudioReferenceSigner {
  // The port's key function: the map below and the service lookup both go
  // through this, so the contract has one implementation, not two literals.
  const keyFor = (entry: StudioReferenceSignEntry): string => signEntryKey(entry);
  return {
    keyFor,
    async signPaths(entries) {
      if (entries.length === 0) return {};

      const byBucket = new Map<string, string[]>();
      for (const entry of entries) {
        const bucket = byBucket.get(entry.bucket) ?? [];
        if (!bucket.includes(entry.path)) bucket.push(entry.path);
        byBucket.set(entry.bucket, bucket);
      }

      const urls: Record<string, string> = {};
      for (const [bucket, paths] of byBucket) {
        const { data, error } = await client.storage
          .from(bucket)
          .createSignedUrls(paths, STUDIO_REFERENCE_PREVIEW_TTL_SECONDS);
        if (error || !data) continue;
        for (const row of data) {
          // A per-path failure arrives as a row with no path rather than an
          // error, so one unsignable object costs its own preview and no more.
          if (row.path && row.signedUrl) urls[keyFor({ bucket, path: row.path })] = row.signedUrl;
        }
      }
      return urls;
    },
  };
}
