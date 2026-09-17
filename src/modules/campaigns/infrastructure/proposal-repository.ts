import { z } from "zod";

import type { CampaignProposalDocument } from "@/domain/campaigns/proposal";
import { campaignProposalDocumentSchema } from "@/domain/campaigns/proposal";
import { logger } from "@/lib/logger";
import type {
  ProposalPersistenceFailure,
  ProposalStore,
  ProposalVersionResult,
} from "@/modules/campaigns/application/proposal-service";

/**
 * The narrow contract this repository needs, and nothing wider.
 *
 * The proposal tables are deliberately absent from `database.types.ts`: no role
 * holds an INSERT grant on any of them, and every write goes through a
 * security-definer function. Declaring the shape here keeps that true — there
 * is no generated row type sitting around inviting a direct insert that would
 * skip the approval transaction.
 */
export type ProposalPersistence = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
  from(table: string): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        eq(
          column: string,
          value: string,
        ): {
          eq(
            column: string,
            value: string,
          ): {
            maybeSingle(): Promise<{ data: unknown; error: { message?: string } | null }>;
          };
        };
      };
    };
  };
};

/**
 * Turns a PostgreSQL refusal into the outcome the service can act on.
 *
 * The mapping is by SQLSTATE and by the exception name the migration raises,
 * never by matching on message text — a message is for a person to read and may
 * be reworded; a code is a contract. Anything unrecognised becomes
 * `unavailable` rather than being guessed at, because reporting a refusal we do
 * not understand as a specific business outcome would be a lie with a
 * confident tone.
 */
export function proposalFailure(error: {
  code?: string;
  message?: string;
}): ProposalPersistenceFailure {
  const message = error.message ?? "";

  if (message.includes("campaign_proposal_stale_version")) return { kind: "stale_version" };
  if (message.includes("campaign_proposal_idempotency_conflict")) return { kind: "conflict" };
  if (message.includes("campaign_proposal_forbidden")) return { kind: "forbidden" };
  if (
    message.includes("campaign_proposal_not_found") ||
    message.includes("campaign_proposal_version_not_found")
  ) {
    return { kind: "not_found" };
  }
  if (
    message.includes("campaign_proposal_not_decidable") ||
    message.includes("campaign_proposal_not_revisable")
  ) {
    return { kind: "conflict" };
  }

  switch (error.code) {
    case "42501":
      return { kind: "forbidden" };
    case "P0002":
      return { kind: "not_found" };
    case "23505":
      return { kind: "conflict" };
    case "22023":
      return { kind: "stale_version" };
    default:
      return { kind: "unavailable" };
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

const refreshSnapshotResultSchema = z.strictObject({
  source_snapshot_id: z.string().uuid(),
  refreshed: z.boolean(),
});

export function createProposalRepository(client: ProposalPersistence): ProposalStore {
  return {
    async requestProposal(input) {
      const { data, error } = await client.rpc("request_campaign_proposal", {
        target_organization_id: input.organizationId,
        input_proposal: {
          source_kind: input.sourceKind,
          source_id: input.sourceId,
          dedupe_fingerprint: input.dedupeFingerprint,
          // Only the worker sends these, and only while it holds the claim.
          // The function re-checks the run is still claimed under this exact
          // token with an unexpired lease; nothing here is taken on trust.
          research_run_id: input.claim?.runId ?? null,
          research_claim_token: input.claim?.claimToken ?? null,
        },
      });
      if (error) throw proposalFailure(error);

      const row = record(data);
      return {
        proposalId: String(row.proposal_id),
        outcome: row.outcome === "replayed" ? "replayed" : "saved",
      };
    },

    async completeVersion(input): Promise<ProposalVersionResult> {
      const { data, error } = await client.rpc("complete_campaign_proposal_version", {
        target_organization_id: input.organizationId,
        input_version: {
          proposal_id: input.proposalId,
          document: input.document,
          digest: input.digest,
          source_revision_manifest: input.sourceRevisionManifest,
          state: "ready_for_review",
          research_run_id: input.claim?.runId ?? null,
          research_claim_token: input.claim?.claimToken ?? null,
        },
      });
      if (error) throw proposalFailure(error);

      const row = record(data);
      return {
        proposalVersionId: String(row.proposal_version_id),
        version: Number(row.version),
        digest: String(row.digest),
      };
    },

    async decide(input) {
      const { data, error } = await client.rpc("decide_campaign_proposal", {
        target_organization_id: input.organizationId,
        input_decision: {
          proposal_id: input.proposalId,
          proposal_version_id: input.proposalVersionId,
          proposal_digest: input.proposalDigest,
          decision: input.decision,
          reason: input.reason,
          instructions: input.instructions,
          snoozed_until: input.snoozedUntil,
          idempotency_key: input.idempotencyKey,
          // Note what is NOT sent: any actor identity. The function reads
          // auth.uid() itself, so a forged actor in a request body has nowhere
          // to land.
        },
      });
      if (error) throw proposalFailure(error);

      const row = record(data);
      const linked = row.linked_campaign_id;
      return {
        decisionId: String(row.decision_id),
        outcome: row.outcome === "replayed" ? "replayed" : "saved",
        linkedCampaignId: typeof linked === "string" ? linked : null,
      };
    },

    async readVersionDocument(input): Promise<CampaignProposalDocument | null> {
      const { data, error } = await client
        .from("campaign_proposal_versions")
        .select("document")
        .eq("organization_id", input.organizationId)
        .eq("proposal_id", input.proposalId)
        .eq("id", input.proposalVersionId)
        .maybeSingle();

      if (error || !data) return null;

      // Parsed rather than cast. A stored document that no longer satisfies the
      // current schema is reported as absent, so a caller never derives
      // authority from a shape nothing has validated.
      const parsed = campaignProposalDocumentSchema.safeParse(record(data).document);
      return parsed.success ? parsed.data : null;
    },

    /**
     * Pins the approval-time snapshot through the caller's own session.
     *
     * The writer is the ADR 0058 repair function, reused exactly as the
     * evidence-repair path calls it: same RPC, same `campaign.edit` check
     * inside the transaction, same never-rewrite guarantee. Members hold no
     * INSERT grant on `campaign_source_snapshots`, so there is no direct
     * write to reuse — this RPC is the only post-hoc writer.
     *
     * Never throws. The approval that minted the campaign is already
     * committed when this runs; refusing the whole decision because the pin
     * failed would report a decision as unmade when it was made. A pin that
     * cannot be written is logged with the tenant and campaign it belongs to
     * and reported as unpinned, and the campaign keeps the honest refusal
     * until an operator repairs it.
     */
    async pinApprovalSnapshot(input: {
      organizationId: string;
      campaignId: string;
    }): Promise<{ sourceSnapshotId: string | null; refreshed: boolean }> {
      const { data, error } = await client.rpc("refresh_campaign_source_snapshot", {
        target_organization_id: input.organizationId,
        target_campaign_id: input.campaignId,
      });

      const parsed =
        error === null ? refreshSnapshotResultSchema.safeParse(data) : { success: false as const };
      if (error !== null || !parsed.success) {
        logger.warn("campaign.proposal_snapshot_not_pinned", {
          organizationId: input.organizationId,
          campaignId: input.campaignId,
        });
        return { sourceSnapshotId: null, refreshed: false };
      }

      return { sourceSnapshotId: parsed.data.source_snapshot_id, refreshed: parsed.data.refreshed };
    },
  };
}
