import { randomUUID } from "node:crypto";

import { approvalStatus, type ApprovalRow } from "@/domain/campaigns/state-machine";
import { bundleDigest } from "@/domain/campaigns/digest";
import type { CampaignDiff } from "@/domain/campaigns/diff";
import { diffManifests } from "@/domain/campaigns/digest";
import { DomainError } from "@/lib/errors";
import type { EventPublisher } from "@/domain/events/types";
import {
  qualifyCampaignSource,
  type QualificationOpportunity,
} from "@/modules/campaigns/application/qualification";
import type {
  BundleVersionSummary,
  CampaignReadPort,
  CampaignReviewPort,
  CampaignSummary,
} from "@/modules/campaigns/application/ports";
import type { CreateCampaignRequest } from "@/modules/campaigns/application/api-schemas";

/**
 * Where a campaign becomes a campaign.
 *
 * Both entry points — an operator's brief and a Decision Engine opportunity —
 * converge here and get the same treatment. The manual path is not a shortcut
 * around safety; it simply has no decision record behind it, which is recorded
 * as `null` rather than faked.
 *
 * Nothing in this service generates anything. Creating a campaign creates a
 * shell and a pinned snapshot of the facts generation is allowed to use, then
 * hands off. Generating inline in a request would tie a model call to an HTTP
 * timeout and leave a half-built version behind when it expired.
 */

export type CampaignCreationStore = {
  createBrief(input: {
    organizationId: string;
    objective: string;
    audience: string;
    offer: string | null;
    requestedChannels: readonly string[];
  }): Promise<string>;
  createCampaign(input: {
    organizationId: string;
    title: string;
    sourceKind: "manual_brief" | "decision_opportunity";
    briefId: string | null;
    opportunityId: string | null;
    idempotencyKey: string;
  }): Promise<{ campaignId: string; replayed: boolean }>;
  createSourceSnapshot(input: {
    organizationId: string;
    campaignId: string;
    facts: Record<string, unknown>;
    brandAssetVersionIds: readonly string[];
    assertions: readonly { key: string; expectedOutcome: string }[];
  }): Promise<string>;
};

export type GenerationDispatcher = {
  /** Records the intent durably. The worker picks it up; the request does not wait. */
  enqueueGeneration(input: {
    organizationId: string;
    campaignId: string;
    sourceSnapshotId: string;
    idempotencyKey: string;
    correlationId: string;
  }): Promise<{ runId: string; replayed?: boolean }>;
};

export type OrganizationFactsReader = {
  /** The verified facts and usable brand asset versions, as of now. */
  readVerifiedFacts(organizationId: string): Promise<{
    facts: Record<string, unknown>;
    brandAssetVersionIds: readonly string[];
  }>;
  findOpportunity(
    organizationId: string,
    opportunityId: string,
  ): Promise<QualificationOpportunity | null>;
};

export type CampaignServiceDependencies = {
  read: CampaignReadPort;
  review: CampaignReviewPort;
  store: CampaignCreationStore;
  facts: OrganizationFactsReader;
  generation: GenerationDispatcher;
  events: EventPublisher;
  now?: () => Date;
};

export type CreatedCampaign = {
  campaignId: string;
  sourceSnapshotId: string;
  runId: string;
  replayed: boolean;
};

export function createCampaignService(dependencies: CampaignServiceDependencies) {
  const now = dependencies.now ?? (() => new Date());

  return {
    /**
     * Creates the campaign shell, pins the evidence, and queues generation.
     *
     * The snapshot is taken here rather than read live at generation time so an
     * approval stays explicable later: when the brand assets or the profile
     * change next week, the record still says what this campaign was built on.
     */
    async create(
      organizationId: string,
      actorId: string,
      request: CreateCampaignRequest,
    ): Promise<CreatedCampaign> {
      const qualification = await qualifySource(dependencies, organizationId, request);

      const briefId =
        request.source.kind === "manual_brief" && request.brief
          ? await dependencies.store.createBrief({
              organizationId,
              objective: request.brief.objective,
              audience: request.brief.audience,
              offer: request.brief.offer,
              requestedChannels: request.brief.requestedChannels,
            })
          : null;

      const { campaignId, replayed } = await dependencies.store.createCampaign({
        organizationId,
        title: request.title,
        sourceKind: request.source.kind,
        briefId,
        opportunityId:
          request.source.kind === "decision_opportunity" ? request.source.opportunityId : null,
        idempotencyKey: request.idempotencyKey,
      });

      const verified = await dependencies.facts.readVerifiedFacts(organizationId);
      const sourceSnapshotId = await dependencies.store.createSourceSnapshot({
        organizationId,
        campaignId,
        facts: verified.facts,
        brandAssetVersionIds: verified.brandAssetVersionIds,
        assertions: qualification.assertions.map((assertion) => ({
          key: assertion.key,
          expectedOutcome: assertion.expectedOutcome,
        })),
      });

      const correlationId = randomUUID();
      const { runId } = await dependencies.generation.enqueueGeneration({
        organizationId,
        campaignId,
        sourceSnapshotId,
        idempotencyKey: request.idempotencyKey,
        correlationId,
      });

      await dependencies.events.publish({
        eventId: randomUUID(),
        eventName: "campaign.created",
        occurredAt: now().toISOString(),
        organizationId,
        actorType: "user",
        actorId,
        correlationId,
        schemaVersion: 1,
        payload: { campaignId, sourceKind: request.source.kind },
      });

      return { campaignId, sourceSnapshotId, runId, replayed };
    },

    /**
     * The version history, newest first, with the live approval resolved
     * against the version it actually covers.
     */
    async timeline(
      organizationId: string,
      campaignId: string,
    ): Promise<{
      campaign: CampaignSummary;
      versions: readonly BundleVersionSummary[];
      approval: { versionId: string; status: ReturnType<typeof approvalStatus> } | null;
    }> {
      const campaign = await dependencies.read.getCampaign(organizationId, campaignId);
      // Deliberately the same answer for "no such campaign" and "not yours".
      // Distinguishing them would confirm that another tenant's campaign exists.
      if (!campaign) {
        throw new DomainError("TENANT_SCOPE_ERROR", "This campaign is not available.");
      }

      const versions = await dependencies.read.listVersions(organizationId, campaignId);
      // A read for a reviewer, so it carries revoked approvals too and lets
      // `approvalStatus` say which kind of "not approved" this is. The status
      // object never reports a revoked row as approved, so nothing downstream
      // can read permission out of it.
      const live = await dependencies.read.getLatestApproval(organizationId, campaignId);
      const latest = versions[0];

      return {
        campaign,
        versions,
        approval: live
          ? {
              versionId: live.bundleVersionId,
              // Resolved against the *latest* version, so an approval left over
              // from an earlier one reads as superseded rather than valid.
              status: approvalStatus(toApprovalRow(live), latestSubject(latest, live), now()),
            }
          : null,
      };
    },

    /** The material difference between two versions of one campaign. */
    async diff(
      organizationId: string,
      fromVersionId: string,
      toVersionId: string,
    ): Promise<CampaignDiff> {
      const [before, after] = await Promise.all([
        dependencies.read.getVersion(organizationId, fromVersionId),
        dependencies.read.getVersion(organizationId, toVersionId),
      ]);
      if (!before || !after) {
        throw new DomainError("TENANT_SCOPE_ERROR", "One of those versions is not available.");
      }
      return diffManifests(before.manifest, after.manifest);
    },

    /**
     * Records the operator's visual-truth attestation.
     *
     * The digest is recomputed from the stored manifest and compared with the
     * one the operator's screen showed. A mismatch means they attested to a
     * different document from the one on file, which is a refusal rather than
     * something to reconcile.
     */
    async attest(
      organizationId: string,
      actorId: string,
      input: { bundleVersionId: string; bundleDigest: string; statement: string },
    ): Promise<string> {
      const version = await dependencies.read.getVersion(organizationId, input.bundleVersionId);
      if (!version) throw new DomainError("TENANT_SCOPE_ERROR", "This version is not available.");

      const recomputed = bundleDigest(version.manifest);
      if (recomputed !== input.bundleDigest || version.digest !== input.bundleDigest) {
        throw new DomainError(
          "VALIDATION_ERROR",
          "This proposal changed since you reviewed it. Reload and read the current version before attesting.",
        );
      }

      const attestationId = await dependencies.review.recordAttestation({
        organizationId,
        bundleVersionId: input.bundleVersionId,
        bundleDigest: input.bundleDigest,
        statement: input.statement,
      });

      await dependencies.events.publish({
        eventId: randomUUID(),
        eventName: "campaign.attested",
        occurredAt: now().toISOString(),
        organizationId,
        actorType: "user",
        actorId,
        correlationId: randomUUID(),
        schemaVersion: 1,
        payload: { campaignId: version.campaignId, bundleVersionId: input.bundleVersionId },
      });

      return attestationId;
    },
  };
}

async function qualifySource(
  dependencies: CampaignServiceDependencies,
  organizationId: string,
  request: CreateCampaignRequest,
) {
  // The service is built around an injected clock and this function reached
  // past it to the wall clock, so an opportunity's expiry was judged against a
  // different "now" than everything else the same request records. Nothing
  // caught it until a fixture's expiry date arrived in real life.
  const now = dependencies.now ?? (() => new Date());
  if (request.source.kind === "manual_brief") {
    const result = qualifyCampaignSource({
      organizationId,
      source: { kind: "manual_brief", briefId: randomUUID() },
      now: now(),
    });
    if (result.outcome === "blocked") {
      throw new DomainError("VALIDATION_ERROR", "This brief cannot start a campaign.");
    }
    return result;
  }

  const opportunity = await dependencies.facts.findOpportunity(
    organizationId,
    request.source.opportunityId,
  );
  if (!opportunity) {
    throw new DomainError("TENANT_SCOPE_ERROR", "That opportunity is not available.");
  }

  const result = qualifyCampaignSource({
    organizationId,
    source: { kind: "decision_opportunity", opportunity },
    now: now(),
  });
  if (result.outcome === "blocked") {
    // The reason is deliberately specific here: unlike a tenant boundary, an
    // operator can act on "this expired" or "this was already answered".
    throw new DomainError("VALIDATION_ERROR", blockedMessage(result.reason));
  }
  return result;
}

function blockedMessage(reason: string): string {
  switch (reason) {
    case "opportunity_expired":
      return "That opportunity expired. The next decision cycle may raise it again.";
    case "opportunity_not_proposed":
      return "That opportunity has already been answered.";
    case "action_not_campaign":
      return "That opportunity is not a campaign recommendation.";
    case "assertions_missing":
      return "That opportunity carries nothing to re-check at execution, so it cannot start a campaign.";
    default:
      return "That opportunity cannot start a campaign.";
  }
}

function toApprovalRow(approval: {
  bundleVersionId: string;
  bundleDigest: string;
  expiresAt: string;
  revokedAt: string | null;
}): ApprovalRow {
  return {
    bundleVersionId: approval.bundleVersionId,
    bundleDigest: approval.bundleDigest,
    expiresAt: approval.expiresAt,
    revokedAt: approval.revokedAt,
  };
}

function latestSubject(
  latest: BundleVersionSummary | undefined,
  approval: { bundleVersionId: string; bundleDigest: string },
) {
  return latest
    ? { bundleVersionId: latest.id, bundleDigest: latest.digest }
    : { bundleVersionId: approval.bundleVersionId, bundleDigest: approval.bundleDigest };
}
