import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  hasOrganizationPermission,
  organizationRolePermissions,
  type OrganizationPermission,
} from "@/domain/access/permissions";
import type { OrganizationRole } from "@/domain/organizations/types";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { env } from "@/lib/env";
import { DomainError } from "@/lib/errors";
import type { Database } from "@/lib/supabase/database.types";
import { assertServiceRoleKey } from "@/lib/supabase/service";
import {
  DEFAULT_ASSET_INTAKE_LIMITS,
  type AssetIntakeResult,
} from "@/modules/campaigns/infrastructure/asset-intake";
import type { StudioUploadRecord } from "@/modules/creative-studio/infrastructure/reference-reader";

/**
 * Studio reference uploads: reserve, transfer, verify, finalize.
 *
 * The flow mirrors Creative History's three steps, and the order is the same
 * whole point: the database records the intent, the tenant and the exact
 * object key; the browser puts bytes at that key through its own session,
 * which the storage policy checks against the same tenant and the exact
 * reserved path; the server then fetches those bytes back, identifies them
 * from their own leading signature, re-encodes them, and only then marks the
 * upload ready.
 *
 * Verification runs inline in the complete route rather than in a worker:
 * the route authorizes the session, the org role and the reservation
 * ownership first, and only then touches the service client. The service
 * credential exists here for two operations the session cannot do — settling
 * the worker-only finalization RPC, and overwriting the transferred object
 * with the validated re-encode (there is no update policy on the uploads
 * bucket, so the session cannot upsert).
 */

export const STUDIO_UPLOADS_BUCKET = "studio-uploads";

const uuidSchema = z.string().uuid();

export const studioUploadKindSchema = z.enum(["design", "product", "brand_mark"]);
export type StudioUploadKind = z.infer<typeof studioUploadKindSchema>;

const studioUploadMimeSchema = z.enum(["image/png", "image/jpeg", "image/webp"]);

/**
 * The uploader's explicit attestation. A fresh upload becomes an authorized
 * current reference on the strength of this statement — it never silently
 * becomes approved history, so the statement is required up front and every
 * field is checked again before the bytes are finalized.
 */
export const studioUploadRightsSchema = z.strictObject({
  accepted: z.literal(true),
  attestationId: uuidSchema,
  authorizedAiProcessing: z.literal(true),
  intendedUse: z.string().trim().min(1).max(280),
});
export type StudioUploadRights = z.infer<typeof studioUploadRightsSchema>;

export const studioUploadReserveRequestSchema = z.strictObject({
  kind: studioUploadKindSchema,
  declaredSize: z.number().int().min(1).max(DEFAULT_ASSET_INTAKE_LIMITS.maxBytes),
  declaredMime: studioUploadMimeSchema,
  filename: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((value) => !/[\\/]/.test(value), "A filename cannot contain a path."),
  rights: studioUploadRightsSchema,
});
export type StudioUploadReserveRequest = z.infer<typeof studioUploadReserveRequestSchema>;

/** The complete call names nothing about the file except what the browser sent as. */
export const studioUploadCompleteRequestSchema = z.strictObject({
  declaredMime: studioUploadMimeSchema.optional(),
});
export type StudioUploadCompleteRequest = z.infer<typeof studioUploadCompleteRequestSchema>;

export type StudioUploadReservation = {
  uploadId: string;
  reservedPath: string;
  expiresAt: string;
  bucket: typeof STUDIO_UPLOADS_BUCKET;
  intake: {
    allowedMimeTypes: readonly string[];
    maxBytes: number;
    minWidthPx: number;
    minHeightPx: number;
    maxWidthPx: number;
    maxHeightPx: number;
    /** Client checks are early feedback. The server decides. */
    clientValidationIsAdvisory: true;
  };
};

export type StudioUploadCompletion =
  | {
      status: "ready";
      uploadId: string;
      /** True when the upload was already finalized and the record was replayed. */
      replayed: boolean;
      contentHash: string;
      mimeType: string;
      byteSize: number;
      widthPx: number;
      heightPx: number;
    }
  | {
      status: "refused";
      uploadId: string;
      replayed: boolean;
      reason:
        | "upload_missing"
        | "missing_rights"
        | "empty_file"
        | "too_large"
        | "unsupported_format"
        | "declared_type_mismatch"
        | "corrupt_image"
        | "dimensions_out_of_range"
        | "processor_unavailable"
        | "storage_failed"
        | "already_rejected";
      message: string;
    }
  | { status: "expired"; uploadId: string; replayed: boolean };

export type StudioUploadReserveStore = {
  reserveReservation(input: {
    organizationId: string;
    upload: Record<string, unknown>;
  }): Promise<{ uploadId: string; reservedPath: string; expiresAt: string }>;
};

export type StudioUploadCompleteObjectStore = {
  download(path: string): Promise<Buffer | null>;
  upload(input: { path: string; bytes: Buffer; contentType: string }): Promise<boolean>;
};

export type StudioUploadIntake = (input: {
  bytes: Buffer;
  declaredMimeType?: string;
}) => Promise<AssetIntakeResult>;

export type StudioUploadSettler = {
  settleReservation(input: {
    organizationId: string;
    uploadId: string;
    receipt: Record<string, unknown>;
  }): Promise<{ uploadId: string; state: string; replayed: boolean }>;
};

function notAvailable(): never {
  throw new DomainError("TENANT_SCOPE_ERROR", "That upload is not available.");
}

function incompleteRecord(): never {
  throw new DomainError(
    "DOMAIN_ERROR",
    "The upload record is incomplete. Reserve a new upload and try again.",
  );
}

function reservationContract(): StudioUploadReservation["intake"] {
  return {
    // The bucket row (`file_size_limit = 15728640`,
    // `allowed_mime_types = {image/png, image/jpeg, image/webp}`) and the
    // intake adapter agree; the browser is told the stricter of the two, so
    // it is never told it may send something the server will throw away.
    allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
    maxBytes: DEFAULT_ASSET_INTAKE_LIMITS.maxBytes,
    minWidthPx: DEFAULT_ASSET_INTAKE_LIMITS.minWidthPx,
    minHeightPx: DEFAULT_ASSET_INTAKE_LIMITS.minHeightPx,
    maxWidthPx: DEFAULT_ASSET_INTAKE_LIMITS.maxWidthPx,
    maxHeightPx: DEFAULT_ASSET_INTAKE_LIMITS.maxHeightPx,
    clientValidationIsAdvisory: true,
  };
}

/** Step one: the database records the intent, the tenant and the exact object key. */
export function createStudioUploadReserver(store: StudioUploadReserveStore) {
  return {
    async reserve(input: {
      organizationId: string;
      request: unknown;
    }): Promise<StudioUploadReservation> {
      const organizationId = uuidSchema.parse(input.organizationId);
      const request = studioUploadReserveRequestSchema.parse(input.request);

      const receipt = await store.reserveReservation({
        organizationId,
        upload: {
          kind: request.kind,
          declaredSize: request.declaredSize,
          declaredMime: request.declaredMime,
          filename: request.filename,
          rightsAttestation: request.rights,
        },
      });

      // The browser uploads to this path through its own session. A path
      // outside the tenant's folder would hand it another organization's
      // key, so a reservation that comes back wrong is refused, not returned.
      if (!receipt.reservedPath.startsWith(`${organizationId}/`)) {
        throw new DomainError("DOMAIN_ERROR", "The upload reservation came back invalid.");
      }

      return {
        uploadId: receipt.uploadId,
        reservedPath: receipt.reservedPath,
        expiresAt: receipt.expiresAt,
        bucket: STUDIO_UPLOADS_BUCKET,
        intake: reservationContract(),
      };
    },
  };
}

type VerifiedUploadFields = {
  contentHash: string;
  mimeType: string;
  byteSize: number;
  widthPx: number;
  heightPx: number;
};

/** Steps three and four: read the transferred bytes back and settle the reservation. */
export function createStudioUploadCompleter(dependencies: {
  readReservation(organizationId: string, uploadId: string): Promise<StudioUploadRecord | null>;
  objects: StudioUploadCompleteObjectStore;
  ingest: StudioUploadIntake;
  settleReservation: StudioUploadSettler["settleReservation"];
}) {
  /** An already-settled row replays its own outcome: bytes are never re-verified. */
  function settledFromRecord(record: StudioUploadRecord): StudioUploadCompletion {
    if (record.state === "expired") {
      return { status: "expired", uploadId: record.uploadId, replayed: true };
    }
    if (record.state === "rejected") {
      return {
        status: "refused",
        uploadId: record.uploadId,
        replayed: true,
        reason: "already_rejected",
        message: "This upload was already refused. Reserve a new upload and try again.",
      };
    }
    if (
      record.state === "ready" &&
      record.finalHash !== null &&
      record.finalMime !== null &&
      record.finalWidth !== null &&
      record.finalHeight !== null &&
      record.finalBytes !== null
    ) {
      return {
        status: "ready",
        uploadId: record.uploadId,
        replayed: true,
        contentHash: record.finalHash,
        mimeType: record.finalMime,
        byteSize: record.finalBytes,
        widthPx: record.finalWidth,
        heightPx: record.finalHeight,
      };
    }
    incompleteRecord();
  }

  async function rereadOrFail(organizationId: string, uploadId: string): Promise<StudioUploadRecord> {
    const record = await dependencies.readReservation(organizationId, uploadId);
    if (!record) notAvailable();
    return record;
  }

  return {
    async complete(input: {
      organizationId: string;
      uploadId: string;
      callerId: string;
      declaredMime?: string;
    }): Promise<StudioUploadCompletion> {
      const organizationId = uuidSchema.parse(input.organizationId);
      const uploadId = uuidSchema.parse(input.uploadId);
      const callerId = uuidSchema.parse(input.callerId);

      const record = await dependencies.readReservation(organizationId, uploadId);
      // Missing and foreign read the same: absent. The caller cannot tell
      // "no such upload" from "another tenant's", and ownership below is
      // checked the same silent way.
      if (!record) notAvailable();
      if (record.organizationId !== organizationId) notAvailable();
      // A reservation belongs to the member who made it. The storage policy
      // already refused anyone else's transfer; this refuses anyone else's
      // finalization of the bytes.
      if (record.actorId !== callerId) notAvailable();
      if (!record.reservedPath.startsWith(`${organizationId}/`)) notAvailable();

      // A duplicate finalization replays the settled outcome. The original
      // source record is preserved exactly: settled bytes are never
      // re-verified, re-encoded, or overwritten.
      if (record.state !== "reserved") return settledFromRecord(record);

      // The database marks an expired reservation expired whenever completion
      // is attempted, whatever the verdict says — so the attempt is still
      // made, and the row records the expiry instead of lingering reserved.
      if (Date.parse(record.expiresAt) <= Date.now()) {
        const settled = await dependencies.settleReservation({
          organizationId,
          uploadId,
          receipt: { verdict: "rejected" },
        });
        if (settled.state === "expired") {
          return { status: "expired", uploadId, replayed: settled.replayed };
        }
        return settledFromRecord(await rereadOrFail(organizationId, uploadId));
      }

      // Rights travel with the reservation, not the bytes: a reservation
      // without an accepted attestation can never become a reference, so it
      // is settled rejected rather than left for its bytes to be judged.
      const attestation = record.rightsAttestation;
      if (attestation["accepted"] !== true) {
        const settled = await dependencies.settleReservation({
          organizationId,
          uploadId,
          receipt: { verdict: "rejected" },
        });
        if (settled.state === "rejected") {
          return {
            status: "refused",
            uploadId,
            replayed: settled.replayed,
            reason: "missing_rights",
            message: "This upload carries no accepted rights attestation, so it cannot be used.",
          };
        }
        return settledFromRecord(await rereadOrFail(organizationId, uploadId));
      }

      // The path comes from the row, never from the request. A request that
      // can name its own object can name somebody else's.
      const uploaded = await dependencies.objects.download(record.reservedPath);
      if (!uploaded) {
        // No settlement: the transfer may simply not have arrived yet, and a
        // missing object must not consume the reservation.
        return {
          status: "refused",
          uploadId,
          replayed: false,
          reason: "upload_missing",
          message: "No file was found at that upload location. Try uploading it again.",
        };
      }

      const ingested = await dependencies.ingest({
        bytes: uploaded,
        declaredMimeType: input.declaredMime,
      });
      if (ingested.outcome !== "accepted") {
        // The bytes proved unusable, so the reservation is consumed: the same
        // object would fail the same way on retry.
        const settled = await dependencies.settleReservation({
          organizationId,
          uploadId,
          receipt: { verdict: "rejected" },
        });
        if (settled.state === "rejected") {
          return {
            status: "refused",
            uploadId,
            replayed: settled.replayed,
            reason: ingested.reason,
            message: ingested.message,
          };
        }
        return settledFromRecord(await rereadOrFail(organizationId, uploadId));
      }

      const verified: VerifiedUploadFields = {
        contentHash: ingested.contentHash,
        mimeType: ingested.mimeType,
        byteSize: ingested.byteSize,
        widthPx: ingested.widthPx,
        heightPx: ingested.heightPx,
      };

      // Replaces the browser's upload with the metadata-stripped re-encode at
      // the same key — the stricter storage policy only allows the exact
      // reserved path, so there is nowhere else to put it. If this fails the
      // reservation stays open, which is the safe direction: finalization
      // must never point at bytes nobody checked.
      const stored = await dependencies.objects.upload({
        path: record.reservedPath,
        bytes: ingested.bytes,
        contentType: ingested.mimeType,
      });
      if (!stored) {
        return {
          status: "refused",
          uploadId,
          replayed: false,
          reason: "storage_failed",
          message: "The checked image could not be stored. Try uploading it again.",
        };
      }

      // The receipt carries the verified hash, so the settled record equals
      // the checked bytes by construction.
      const settled = await dependencies.settleReservation({
        organizationId,
        uploadId,
        receipt: {
          verdict: "ready",
          finalHash: verified.contentHash,
          finalMime: verified.mimeType,
          finalWidth: verified.widthPx,
          finalHeight: verified.heightPx,
          finalBytes: verified.byteSize,
        },
      });
      if (settled.state === "ready") {
        return { status: "ready", uploadId, replayed: settled.replayed, ...verified };
      }
      return settledFromRecord(await rereadOrFail(organizationId, uploadId));
    },
  };
}

type SupabaseUploadStorageClient = {
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
};

/** The uploads bucket through whichever client the caller authorizes. */
export function createSupabaseStudioUploadObjectStore(
  client: SupabaseUploadStorageClient,
): StudioUploadCompleteObjectStore {
  const bucket = () => client.storage.from(STUDIO_UPLOADS_BUCKET);
  return {
    async download(path) {
      const { data, error } = await bucket().download(path);
      if (error || !data) return null;
      return Buffer.from(await data.arrayBuffer());
    },

    async upload(input) {
      const { error } = await bucket().upload(input.path, input.bytes, {
        contentType: input.contentType,
        // Overwrites the transferred object with the validated re-encode at
        // the same path, so nothing downstream learns a second location.
        upsert: true,
      });
      return !error;
    },
  };
}

/**
 * Verification-only service client for the complete route.
 *
 * Constructed only after the route has authorized the session, the org role,
 * and the reservation ownership (the completer checks ownership again before
 * the credential is used for anything). It settles the worker-only RPC and
 * performs the privileged object overwrite — never a general server client.
 */
export function createStudioUploadServiceClient(): SupabaseClient<Database> {
  const key = assertServiceRoleKey(env.SUPABASE_SERVICE_ROLE_KEY, "Studio upload verification");
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

// ---------------------------------------------------------------------------
// Thin route glue: membership first, then the parsed body. The order is the
// point — checking anything else before membership would let an outsider tell
// "not enabled" from "not a member" and enumerate organizations.
// ---------------------------------------------------------------------------

function rolesWithStudioPermission(permission: OrganizationPermission): OrganizationRole[] {
  return (Object.keys(organizationRolePermissions) as OrganizationRole[]).filter((role) =>
    hasOrganizationPermission(role, permission),
  );
}

export async function studioUploadRouteContext(
  params: Promise<{ organizationId: string }>,
  permission: OrganizationPermission,
) {
  return getOrganizationContext(params, rolesWithStudioPermission(permission));
}

/** Malformed JSON is a validation failure, never an unhandled exception. */
export async function parseStudioJsonBody(request: Request): Promise<unknown> {
  return request.json().catch(() => {
    throw new DomainError("VALIDATION_ERROR", "The request body is not valid JSON.");
  });
}

/** The complete call may carry no body at all; absent means "as transferred". */
export async function parseStudioOptionalJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new DomainError("VALIDATION_ERROR", "The request body is not valid JSON.");
  }
}

export function parseStudioUploadId(value: string | undefined): string {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) throw new DomainError("VALIDATION_ERROR", "Upload ID is invalid.");
  return parsed.data;
}
