import { z } from "zod";

import {
  admitLaunch,
  campaignLaunchManifestSchema,
  launchDigest,
  type CampaignLaunchManifest,
  type LaunchAdmissionRefusal,
} from "@/domain/campaigns/launch";
import type { CampaignDeliverableReview } from "@/domain/campaigns/deliverable";

/**
 * Authorizing a publication.
 *
 * The domain decides admissibility from the review record; the database decides
 * it again inside the transaction. Both, deliberately. The check here lets the
 * interface explain precisely which output is blocking and why, before anyone
 * clicks. The check in the transaction is the one that actually holds, because
 * a check that ran when the screen was drawn proves nothing about the moment
 * the button lands.
 */

export const approveLaunchSchema = z.strictObject({
  manifest: campaignLaunchManifestSchema,
  idempotencyKey: z.string().trim().min(8).max(200),
});
export type ApproveLaunchInput = z.input<typeof approveLaunchSchema>;

export type LaunchOutcome =
  | { status: "saved"; launchApprovalId: string; launchDigest: string }
  | { status: "replayed"; launchApprovalId: string; launchDigest: string }
  | {
      status: "not_admissible";
      reasonCode: LaunchAdmissionRefusal;
      deliverableVersionId: string | null;
    }
  | { status: "forbidden" }
  | { status: "conflict" }
  | { status: "unavailable" };

export type LaunchStore = {
  readReviewState(input: {
    organizationId: string;
    deliverableVersionIds: readonly string[];
  }): Promise<
    ReadonlyMap<
      string,
      {
        version: { id: string; contentHash: string; version: number };
        currentVersion: number;
        reviews: readonly CampaignDeliverableReview[];
      }
    >
  >;
  approveLaunch(input: {
    organizationId: string;
    payload: Record<string, unknown>;
  }): Promise<{ launchApprovalId: string; outcome: "saved" | "replayed" }>;
};

export type LaunchFailure = {
  kind: "forbidden" | "not_found" | "conflict" | "not_admissible" | "unavailable";
  reasonCode?: LaunchAdmissionRefusal;
};

function failureToOutcome(error: unknown): LaunchOutcome {
  const failure =
    typeof error === "object" && error !== null && "kind" in error
      ? (error as LaunchFailure)
      : { kind: "unavailable" as const };

  switch (failure.kind) {
    case "forbidden":
      return { status: "forbidden" };
    case "conflict":
      return { status: "conflict" };
    case "not_admissible":
      return {
        status: "not_admissible",
        reasonCode: failure.reasonCode ?? "selection_not_reviewed",
        deliverableVersionId: null,
      };
    case "not_found":
      // Not visible and not there answer identically.
      return { status: "forbidden" };
    default:
      return { status: "unavailable" };
  }
}

export function createLaunchService(dependencies: { store: LaunchStore }) {
  return {
    /**
     * Computes the digest from the manifest rather than accepting one.
     *
     * A caller-supplied digest would let the record say one thing while the
     * terms said another — and the digest is the whole basis of the binding.
     */
    digestFor(manifest: CampaignLaunchManifest): string {
      return launchDigest(manifest);
    },

    async approve(input: {
      organizationId: string;
      request: ApproveLaunchInput;
    }): Promise<LaunchOutcome> {
      const parsed = approveLaunchSchema.parse(input.request);
      const manifest = parsed.manifest;

      const reviewState = await dependencies.store.readReviewState({
        organizationId: input.organizationId,
        deliverableVersionIds: manifest.selections.map(
          (selection) => selection.deliverableVersionId,
        ),
      });

      const admission = admitLaunch({ manifest, reviewState });
      if (admission.outcome === "refused") {
        return {
          status: "not_admissible",
          reasonCode: admission.reasonCode,
          deliverableVersionId: admission.deliverableVersionId,
        };
      }

      const digest = launchDigest(manifest);

      try {
        const saved = await dependencies.store.approveLaunch({
          organizationId: input.organizationId,
          payload: {
            campaign_id: manifest.campaignId,
            bundle_version_id: manifest.bundleVersionId,
            manifest,
            launch_digest: digest,
            idempotency_key: parsed.idempotencyKey,
            selections: manifest.selections.map((selection) => ({
              deliverable_version_id: selection.deliverableVersionId,
              content_hash: selection.contentHash,
            })),
          },
        });

        return {
          status: saved.outcome,
          launchApprovalId: saved.launchApprovalId,
          launchDigest: digest,
        };
      } catch (error) {
        return failureToOutcome(error);
      }
    },
  };
}

export type CampaignLaunchService = ReturnType<typeof createLaunchService>;

/** The status C04's outcome mapping fixes for each launch result. */
export function launchOutcomeStatus(outcome: LaunchOutcome): number {
  switch (outcome.status) {
    case "saved":
      return 201;
    case "replayed":
      return 200;
    case "not_admissible":
      return 422;
    case "conflict":
      return 409;
    case "forbidden":
      return 403;
    case "unavailable":
      return 503;
  }
}
