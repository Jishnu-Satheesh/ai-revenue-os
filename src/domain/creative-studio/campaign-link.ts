import { z } from "zod";

import {
  studioFullPosterRenderInputsSchema,
  studioVersionSourceSchema,
  type StudioFullPosterRenderInputs,
  type StudioVersionSource,
} from "@/domain/campaigns/deliverable";
import { sha256HexBytes } from "@/domain/creative-studio/digest";

/**
 * The Campaign handoff: selecting an exact finished Studio revision for a
 * campaign, and resolving that selection back to bytes for preview, download
 * and review.
 *
 * A selection pins version, export and hash together. Until the campaign has
 * a real slot the selection waits as `awaiting_campaign_setup`; once one
 * exists the resolver binds those same bytes as an unreviewed deliverable.
 * Losing permission records `blocked` with a retry — never a silent attach,
 * never a substituted image, never an inherited approval.
 */

export const studioCampaignLinkStateSchema = z.enum([
  "awaiting_campaign_setup",
  "ready_for_review",
  "blocked",
  "superseded",
]);
export type StudioCampaignLinkState = z.infer<typeof studioCampaignLinkStateSchema>;

export const selectStudioCampaignCreativeSchema = z.strictObject({
  campaignId: z.string().uuid(),
  studioVersionId: z.string().uuid(),
  studioExportId: z.string().uuid().nullable(),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  // Task 2 decision: idempotency keys are 8..200 chars. The contract (§3/§5)
  // requires key+digest replay semantics but names no length bound; this range
  // rejects empty/accidental keys while staying a transport/DB guardrail only —
  // align with Task 3/4/9/10 DB validators.
  idempotencyKey: z.string().trim().min(8).max(200),
});
export type SelectStudioCampaignCreative = z.infer<typeof selectStudioCampaignCreativeSchema>;

/**
 * The selection identity: campaign aside, one Studio version plus one export
 * identity (native included) plus one hash is one selection. Retrying the
 * same selection replays; pointing at different bytes selects anew.
 */
export function studioSelectionIdentity(input: {
  readonly studioVersionId: string;
  readonly studioExportId: string | null;
  readonly contentHash: string;
}): string {
  return `${input.studioVersionId}:${input.studioExportId ?? "native"}:${input.contentHash}`;
}

export type StudioSourceResolutionReason = "cross_arm_mismatch" | "hash_mismatch";

export class StudioSourceResolutionError extends Error {
  readonly reason: StudioSourceResolutionReason;
  constructor(reason: StudioSourceResolutionReason, detail: string) {
    super(detail);
    this.name = "StudioSourceResolutionError";
    this.reason = reason;
  }
}

export type StudioArtifact = {
  readonly bytes: Uint8Array;
  readonly mime: string;
  readonly contentHash: string;
};

/**
 * Resolves a studio_version deliverable source to the exact bytes a person
 * previews, downloads or reviews. Three identities must agree: the source
 * arm, the v2 render-inputs arm (same version, same export, same hash), and
 * the hash of the stored bytes themselves (recomputed here, never trusted
 * from the caller's record). Anything else is a refusal, never a best
 * effort — resolving the wrong bytes under an approval would publish
 * something nobody agreed to.
 */
export function resolveDeliverableSource(input: {
  readonly source: StudioVersionSource;
  readonly renderInputs: StudioFullPosterRenderInputs | Record<string, unknown>;
  readonly artifact: StudioArtifact;
}): { readonly bytes: Uint8Array; readonly mime: string } {
  const source = studioVersionSourceSchema.parse(input.source);
  const parsedInputs = studioFullPosterRenderInputsSchema.safeParse(input.renderInputs);
  if (!parsedInputs.success) {
    throw new StudioSourceResolutionError(
      "cross_arm_mismatch",
      "A studio_version source requires studio_full_poster render inputs; the legacy compositor arm cannot render it.",
    );
  }
  const renderInputs = parsedInputs.data;

  const identitiesMatch =
    renderInputs.studioVersionId === source.studioVersionId &&
    renderInputs.studioExportId === source.studioExportId &&
    renderInputs.contentHash === source.contentHash;
  if (!identitiesMatch) {
    throw new StudioSourceResolutionError(
      "cross_arm_mismatch",
      "The source and the render inputs disagree on version, export or hash: they do not describe the same finished bytes.",
    );
  }

  if (input.artifact.contentHash !== source.contentHash) {
    throw new StudioSourceResolutionError(
      "hash_mismatch",
      "The stored bytes no longer match the selected hash: the approval would point at something its approver never saw.",
    );
  }

  // The record above is defense-in-depth only: the bytes themselves are
  // hashed, so corrupt/wrong-object bytes behind a stale-but-matching
  // record still refuse instead of resolving under someone else's approval.
  if (sha256HexBytes(input.artifact.bytes) !== source.contentHash) {
    throw new StudioSourceResolutionError(
      "hash_mismatch",
      "The stored bytes hash to a different value than the selected hash: the approval would point at something its approver never saw.",
    );
  }

  return { bytes: input.artifact.bytes, mime: input.artifact.mime };
}
