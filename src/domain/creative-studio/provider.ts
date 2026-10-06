import { z } from "zod";

import { studioUsageSchema } from "@/domain/creative-studio/schemas";

/**
 * The qualified provider port: what the Studio asks of an image model, and
 * what may come back. No model name is hardcoded anywhere here — a profile
 * names its exact model, and qualification proves it can show partial frames
 * and replay original context before the profile is enabled.
 */

const uuidSchema = z.string().uuid();

const contractSchema = z.strictObject({
  /** How the capability works, in words a reviewer can check. */
  mechanism: z.string().trim().min(1).max(240),
  /** The measurement that proved it, not a marketing claim. */
  provenByQualificationId: uuidSchema,
});
export type ProviderContract = z.infer<typeof contractSchema>;

/**
 * A qualified provider/model/API profile. Immutable: changing the profile
 * starts a new session or branch, never silently restyles an edit chain.
 */
export const studioProviderProfileSchema = z.strictObject({
  provider: z.string().trim().min(1).max(80),
  exactModelId: z.string().trim().min(1).max(160),
  apiFamily: z.string().trim().min(1).max(80),
  adapterVersion: z.string().trim().min(1).max(80),
  supportedRatios: z.array(z.string().trim().min(1).max(20)).min(1).max(12),
  maxInputBytes: z.number().int().positive(),
  maxImages: z.number().int().positive().max(32),
  partialFrameContract: contractSchema,
  continuationContract: contractSchema,
  retentionDisclosure: z.string().trim().min(1).max(2000),
  measuredQualificationId: uuidSchema,
  enabled: z.boolean(),
});
export type StudioProviderProfile = z.infer<typeof studioProviderProfileSchema>;

export const studioProviderOperationSchema = z.enum(["generate", "edit"]);
export type StudioProviderOperation = z.infer<typeof studioProviderOperationSchema>;

/**
 * The immutable input and asset manifest a provider call carries. Everything
 * the model may read is pinned here by id and hash; there is deliberately no
 * field for browser-authored provider state such as handles or tokens.
 */
export const studioProviderRequestSchema = z.strictObject({
  documentId: uuidSchema,
  runId: uuidSchema,
  operation: studioProviderOperationSchema,
  promptDigest: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  inputDigest: z.string().regex(/^[0-9a-f]{64}$/),
  profileId: uuidSchema,
  parentVersionId: uuidSchema.nullable(),
  markerCount: z.number().int().nonnegative().max(8),
  aspectRatio: z.string().trim().min(1).max(20),
});
export type StudioProviderRequest = z.infer<typeof studioProviderRequestSchema>;

export const studioPreviewMimeSchema = z.enum(["image/png", "image/jpeg", "image/webp"]);
export type StudioPreviewMime = z.infer<typeof studioPreviewMimeSchema>;

/**
 * What a provider call emits. Previews are independently decodable frames —
 * a text delta, a base64 fragment or a timed mock never counts. The final
 * completion carries the opaque continuation for the next edit; internal
 * provider text and reasoning are never forwarded.
 */
export type StudioProviderEvent =
  | {
      readonly kind: "preview";
      readonly bytes: Uint8Array;
      readonly mime: StudioPreviewMime;
      readonly index: number;
    }
  | {
      readonly kind: "completed";
      readonly bytes: Uint8Array;
      readonly mime: StudioPreviewMime;
      readonly continuation: { readonly continuationId: string } | null;
      readonly usage: z.infer<typeof studioUsageSchema>;
    }
  | { readonly kind: "refusal"; readonly code: string }
  | { readonly kind: "failure"; readonly code: string };

export type StudioEditContinuation =
  | { readonly state: "usable"; readonly continuationId: string }
  | { readonly state: "expired" }
  | { readonly state: "deleted" };

/**
 * The provider port Task 5 wires to a qualified adapter. Async-iterable so
 * partial frames stream; abort via the caller's signal, never by resending
 * a paid request.
 */
export interface StudioProvider {
  generate(
    request: StudioProviderRequest,
    signal?: AbortSignal,
  ): AsyncIterable<StudioProviderEvent>;
  edit(
    request: StudioProviderRequest,
    continuation: StudioEditContinuation,
    signal?: AbortSignal,
  ): AsyncIterable<StudioProviderEvent>;
}

export type ProviderCapCode =
  | "profile_disabled"
  | "ratio_unsupported"
  | "too_many_images"
  | "payload_too_large";

/** Admits a request against the profile's qualified envelope. */
export function checkProviderCaps(input: {
  readonly profile: StudioProviderProfile;
  readonly ratio: string;
  readonly totalImages: number;
  readonly estimatedInputBytes: number;
}):
  | { readonly admitted: true }
  | { readonly admitted: false; readonly code: ProviderCapCode; readonly detail: string } {
  if (!input.profile.enabled) {
    return {
      admitted: false,
      code: "profile_disabled",
      detail: `Provider ${input.profile.provider} is not enabled: qualify it before spending.`,
    };
  }
  if (!input.profile.supportedRatios.includes(input.ratio)) {
    return {
      admitted: false,
      code: "ratio_unsupported",
      detail: `Ratio ${input.ratio} is not qualified for ${input.profile.exactModelId}; it stays unavailable rather than approximated.`,
    };
  }
  if (input.totalImages > input.profile.maxImages) {
    return {
      admitted: false,
      code: "too_many_images",
      detail: `The qualified profile carries ${input.profile.maxImages} images; this request needs ${input.totalImages}.`,
    };
  }
  if (input.estimatedInputBytes > input.profile.maxInputBytes) {
    return {
      admitted: false,
      code: "payload_too_large",
      detail: `The qualified profile carries ${input.profile.maxInputBytes} bytes; this request needs about ${input.estimatedInputBytes}.`,
    };
  }
  return { admitted: true };
}

export type EditAdmissionCode =
  | "profile_changed"
  | "continuation_expired"
  | "continuation_deleted"
  | "foreign_parent";

/**
 * Admits a marker edit against its pinned profile and continuation. A changed
 * profile or a lost context never falls back silently: the operator gets an
 * explicitly labelled new branch. A parent from another document is refused
 * outright — no branch can make it the same editing session.
 */
export function admitStudioEdit(input: {
  readonly pinnedProfileId: string;
  readonly requestProfileId: string;
  readonly continuationState: StudioEditContinuation["state"];
  readonly sameDocument: boolean;
}):
  | { readonly admitted: true }
  | { readonly admitted: false; readonly code: EditAdmissionCode; readonly startBranch: boolean } {
  if (!input.sameDocument) {
    return { admitted: false, code: "foreign_parent", startBranch: false };
  }
  if (input.pinnedProfileId !== input.requestProfileId) {
    return { admitted: false, code: "profile_changed", startBranch: true };
  }
  if (input.continuationState === "expired") {
    return { admitted: false, code: "continuation_expired", startBranch: true };
  }
  if (input.continuationState === "deleted") {
    return { admitted: false, code: "continuation_deleted", startBranch: true };
  }
  return { admitted: true };
}
