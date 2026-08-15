import { z } from "zod";

import { campaignBundleManifestSchema } from "@/domain/campaigns/schemas";

/**
 * The boundary between campaign services and storage.
 *
 * The split that matters is read versus write. A member's session may read
 * campaigns, versions, and approvals through RLS. Publishing a version is a
 * worker act; attesting and approving are human acts performed in a session.
 * Each goes through its own security-definer RPC, so no caller assembles a
 * multi-table campaign write from the browser.
 */

const uuidSchema = z.string().uuid();
const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);
const isoTimestampSchema = z.string().datetime({ offset: false });

export const campaignSummarySchema = z.strictObject({
  id: uuidSchema,
  organizationId: uuidSchema,
  title: z.string(),
  sourceKind: z.enum(["manual_brief", "decision_opportunity"]),
  briefId: uuidSchema.nullable(),
  opportunityId: uuidSchema.nullable(),
  state: z.string(),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
});
export type CampaignSummary = z.infer<typeof campaignSummarySchema>;

export const bundleVersionSummarySchema = z.strictObject({
  id: uuidSchema,
  campaignId: uuidSchema,
  version: z.number().int().positive(),
  parentVersionId: uuidSchema.nullable(),
  sourceSnapshotId: uuidSchema,
  digest: sha256HexSchema,
  generationProfile: z.enum(["brand_restricted", "brand_guided", "full_visual_freedom"]),
  executionMode: z.enum(["best_effort", "all_channels_required"]),
  createdAt: isoTimestampSchema,
});
export type BundleVersionSummary = z.infer<typeof bundleVersionSummarySchema>;

export const bundleVersionDetailSchema = bundleVersionSummarySchema.extend({
  manifest: campaignBundleManifestSchema,
});
export type BundleVersionDetail = z.infer<typeof bundleVersionDetailSchema>;

export const campaignApprovalSchema = z.strictObject({
  id: uuidSchema,
  campaignId: uuidSchema,
  bundleVersionId: uuidSchema,
  bundleDigest: sha256HexSchema,
  approvedBy: uuidSchema,
  approvedAt: isoTimestampSchema,
  expiresAt: isoTimestampSchema,
  actionKeys: z.array(uuidSchema),
  revokedAt: isoTimestampSchema.nullable(),
  revokedReason: z
    .enum(["superseded_by_new_version", "operator_revoked", "capability_lost"])
    .nullable(),
});
export type CampaignApproval = z.infer<typeof campaignApprovalSchema>;

/**
 * What a worker hands the database to publish one version.
 *
 * The manifest arrives already validated by `campaignBundleSchema` and already
 * digested. The RPC assigns the version number itself under a campaign lock:
 * a caller-supplied number would be a guess made before the lock was taken.
 */
export const createBundleVersionInputSchema = z.strictObject({
  organizationId: uuidSchema,
  campaignId: uuidSchema,
  sourceSnapshotId: uuidSchema,
  digest: sha256HexSchema,
  manifest: campaignBundleManifestSchema,
  /** Storage path per asset, keyed by the manifest asset id. */
  assetStoragePaths: z.record(uuidSchema, z.string().min(1).max(1024)),
});
export type CreateBundleVersionInput = z.infer<typeof createBundleVersionInputSchema>;

export const createBundleVersionResultSchema = z.strictObject({
  bundleVersionId: uuidSchema,
  version: z.number().int().positive(),
  parentVersionId: uuidSchema.nullable(),
  revokedApprovalCount: z.number().int().nonnegative(),
});
export type CreateBundleVersionResult = z.infer<typeof createBundleVersionResultSchema>;

export const attestationInputSchema = z.strictObject({
  organizationId: uuidSchema,
  bundleVersionId: uuidSchema,
  bundleDigest: sha256HexSchema,
  statement: z.string().trim().min(1).max(1_000),
});
export type AttestationInput = z.infer<typeof attestationInputSchema>;

export const approvalInputSchema = z.strictObject({
  organizationId: uuidSchema,
  bundleVersionId: uuidSchema,
  bundleDigest: sha256HexSchema,
  attestationId: uuidSchema,
  expiresAt: isoTimestampSchema,
  capabilityGrantVersions: z.record(z.string(), z.string()),
  policyVersionIds: z.array(uuidSchema),
  actionKeys: z.array(uuidSchema).min(1),
  totalSpendCeiling: z
    .strictObject({ amountMinor: z.number().int().nonnegative(), currency: z.string().length(3) })
    .nullable(),
});
export type ApprovalInput = z.infer<typeof approvalInputSchema>;

/** Reads available to any member of the organization, through RLS. */
export type CampaignReadPort = {
  listCampaigns(organizationId: string): Promise<readonly CampaignSummary[]>;
  getCampaign(organizationId: string, campaignId: string): Promise<CampaignSummary | null>;
  listVersions(
    organizationId: string,
    campaignId: string,
  ): Promise<readonly BundleVersionSummary[]>;
  getVersion(organizationId: string, versionId: string): Promise<BundleVersionDetail | null>;
  getLiveApproval(organizationId: string, campaignId: string): Promise<CampaignApproval | null>;
};

/** Human acts performed inside a session, re-authorized in the database. */
export type CampaignReviewPort = {
  recordAttestation(input: AttestationInput): Promise<string>;
  approve(input: ApprovalInput): Promise<string>;
};

/** Worker-only. A browser repository never exposes this. */
export type CampaignVersionWriterPort = {
  createVersion(input: CreateBundleVersionInput): Promise<CreateBundleVersionResult>;
};
