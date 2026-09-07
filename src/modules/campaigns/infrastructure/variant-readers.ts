import { campaignBundleManifestSchema } from "@/domain/campaigns/schemas";
import type { CampaignBundleManifest } from "@/domain/campaigns/schemas";
import type { VariantEvidence } from "@/domain/campaigns/derivation";
import type { VariantContextReader } from "@/workflows/campaigns/generate-variants";
import { verifiedChannelLimits } from "@/modules/campaigns/application/verified-limits";

/**
 * What a variant run is allowed to work from.
 *
 * Reads the approved version, its live approval, and the evidence pinned when
 * the campaign was created. All of it comes from storage rather than the task
 * payload, so the queue never carries business text and a replayed message
 * cannot smuggle different evidence than the run was authorized against.
 */

type Row = Record<string, unknown>;

export type VariantContextPersistence = {
  from(table: "campaign_bundle_versions" | "campaign_approvals" | "campaign_source_snapshots"): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        eq(column: string, value: string): PromiseLike<{ data: Row[] | null; error: unknown }>;
      } & PromiseLike<{ data: Row[] | null; error: unknown }>;
    };
  };
};

export function createVariantContextLoader(
  persistence: VariantContextPersistence,
): VariantContextReader {
  return {
    async read({ organizationId, bundleVersionId }) {
      const { data: versions, error: versionError } = await persistence
        .from("campaign_bundle_versions")
        .select("id, campaign_id, manifest, digest")
        .eq("organization_id", organizationId)
        .eq("id", bundleVersionId);
      if (versionError) throw new Error("The approved version could not be read.");

      const [version] = versions ?? [];
      if (!version) throw new Error("The approved version could not be read.");

      const manifest = campaignBundleManifestSchema.parse(version.manifest);

      const { data: approvals } = await persistence
        .from("campaign_approvals")
        .select("bundle_version_id, bundle_digest, expires_at, revoked_at")
        .eq("organization_id", organizationId)
        .eq("bundle_version_id", bundleVersionId);

      // Newest first. An older approval for the same version is history, and
      // `approvalStatus` still has the final say on whether this one is live.
      const [approval] = [...(approvals ?? [])].sort((left, right) =>
        String(right.expires_at).localeCompare(String(left.expires_at)),
      );

      const { data: snapshots } = await persistence
        .from("campaign_source_snapshots")
        .select("facts")
        .eq("organization_id", organizationId)
        .eq("campaign_id", String(version.campaign_id));
      const [snapshot] = snapshots ?? [];
      const facts = (snapshot?.facts ?? {}) as Record<string, unknown>;

      return {
        manifest,
        digest: String(version.digest),
        approval: approval
          ? {
              bundleVersionId: String(approval.bundle_version_id),
              bundleDigest: String(approval.bundle_digest),
              expiresAt: String(approval.expires_at),
              revokedAt: approval.revoked_at === null ? null : String(approval.revoked_at),
            }
          : null,
        evidence: toVariantEvidence(manifest, facts),
        limits: verifiedChannelLimits().instagram ?? {
          maxHashtags: null,
          maxCopyCharacters: null,
        },
      };
    },
  };
}

/**
 * What a piece of prose is allowed to lean on.
 *
 * Exported because two callers need the same answer: the variant worker, which
 * checks generated copy, and the Studio's render route, which checks the one
 * free text box an operator can type into. Two builders of this would eventually
 * disagree about what the campaign's evidence is, and the free box is exactly
 * where that disagreement would be exploited.
 */
export function toVariantEvidence(
  manifest: CampaignBundleManifest,
  facts: Record<string, unknown>,
): VariantEvidence {
  return {
    offer: manifest.generationPolicy.lockedOfferRef,
    factKeys: manifest.generationPolicy.lockedAssertionKeys,
    // Flattened once, lowercased, so a claim check is a substring test over
    // exactly the text this campaign was built on and nothing else.
    factText: flattenFacts(facts).toLowerCase(),
    restrictedTerms: readStrings(facts.restrictedTerms),
  };
}

function flattenFacts(facts: Record<string, unknown>): string {
  const parts: string[] = [];
  const visit = (value: unknown) => {
    if (typeof value === "string") parts.push(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  visit(facts);
  return parts.join(" ");
}

function readStrings(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}
