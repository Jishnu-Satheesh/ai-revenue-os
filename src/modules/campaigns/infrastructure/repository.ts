import { logger } from "@/lib/logger";
import {
  approvalInputSchema,
  attestationInputSchema,
  bundleVersionDetailSchema,
  bundleVersionSummarySchema,
  campaignApprovalSchema,
  campaignSummarySchema,
  createBundleVersionInputSchema,
  createBundleVersionResultSchema,
  type BundleVersionDetail,
  type BundleVersionSummary,
  type CampaignApproval,
  type CampaignReadPort,
  type CampaignReviewPort,
  type CampaignSummary,
  type CampaignVersionWriterPort,
} from "@/modules/campaigns/application/ports";

/**
 * The narrow persistence surface the campaign repository needs.
 *
 * Deliberately structural rather than the full Supabase client type: it names
 * exactly the tables and RPCs campaigns touch, so a future call to something
 * else does not typecheck and has to be added here on purpose.
 */
type QueryResult<T> = { data: T | null; error: { code?: string; message?: string } | null };

type Filterable<TRow> = {
  eq(column: string, value: string): Filterable<TRow> & PromiseLike<QueryResult<readonly TRow[]>>;
  order(column: string, options: { ascending: boolean }): Filterable<TRow>;
  limit(count: number): Filterable<TRow>;
  is(column: string, value: null): Filterable<TRow>;
};

export type CampaignPersistence = {
  from(
    table:
      | "campaigns"
      | "campaign_bundle_versions"
      | "campaign_approvals"
      | "campaign_generation_runs",
  ): {
    select(columns: string): Filterable<Record<string, unknown>>;
  };
  rpc(
    name:
      | "create_campaign_bundle_version"
      | "approve_campaign_bundle"
      | "record_campaign_visual_attestation",
    args: Record<string, unknown>,
  ): Promise<QueryResult<unknown>>;
};

/**
 * One public message for every storage failure.
 *
 * A caller cannot act differently on "row not found" versus "policy refused",
 * and telling the two apart across a tenant boundary would confirm that another
 * organization's campaign exists.
 */
/**
 * The constraint a write tripped, and nothing else from the message.
 *
 * Postgres names the constraint in its error text and then quotes the offending
 * row, which is tenant data. The name alone says which rule was broken, which
 * is the part worth keeping.
 */
function constraintName(message: string | undefined): string | undefined {
  return /constraint "([a-z0-9_]+)"/i.exec(message ?? "")?.[1];
}

function campaignDatabaseError(context?: {
  operation: string;
  code?: string;
  organizationId?: string;
  campaignId?: string;
}): never {
  // The caller still gets one indistinguishable message. The SQLSTATE and the
  // operation are this system's own metadata rather than tenant data, and
  // without them a policy refusal and a constraint violation are the same
  // event in the log — which is no event at all.
  if (context) {
    logger.error("campaign.storage_failed", {
      organizationId: context.organizationId,
      campaignId: context.campaignId,
      errorCode: `${context.operation}:${context.code ?? "unknown"}`,
    });
  }
  throw new Error("Campaign data could not be loaded or saved.");
}

const CAMPAIGN_COLUMNS =
  "id,organization_id,title,source_kind,brief_id,opportunity_id,state,created_at,updated_at";
const VERSION_SUMMARY_COLUMNS =
  "id,campaign_id,version,parent_version_id,source_snapshot_id,digest,generation_profile,execution_mode,created_at";
const VERSION_DETAIL_COLUMNS = `${VERSION_SUMMARY_COLUMNS},manifest`;
const APPROVAL_COLUMNS =
  "id,campaign_id,bundle_version_id,bundle_digest,approved_by,approved_at,expires_at,action_keys,revoked_at,revoked_reason";

function toCampaign(row: Record<string, unknown>): CampaignSummary {
  return campaignSummarySchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    title: row.title,
    sourceKind: row.source_kind,
    briefId: row.brief_id ?? null,
    opportunityId: row.opportunity_id ?? null,
    state: row.state,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  });
}

function toVersionSummary(row: Record<string, unknown>): BundleVersionSummary {
  return bundleVersionSummarySchema.parse({
    id: row.id,
    campaignId: row.campaign_id,
    version: Number(row.version),
    parentVersionId: row.parent_version_id ?? null,
    sourceSnapshotId: row.source_snapshot_id,
    digest: row.digest,
    generationProfile: row.generation_profile,
    executionMode: row.execution_mode,
    createdAt: toIso(row.created_at),
  });
}

function toVersionDetail(row: Record<string, unknown>): BundleVersionDetail {
  return bundleVersionDetailSchema.parse({
    ...toVersionSummary(row),
    manifest: row.manifest,
  });
}

function toApproval(row: Record<string, unknown>): CampaignApproval {
  return campaignApprovalSchema.parse({
    id: row.id,
    campaignId: row.campaign_id,
    bundleVersionId: row.bundle_version_id,
    bundleDigest: row.bundle_digest,
    approvedBy: row.approved_by,
    approvedAt: toIso(row.approved_at),
    expiresAt: toIso(row.expires_at),
    actionKeys: row.action_keys ?? [],
    revokedAt: row.revoked_at ? toIso(row.revoked_at) : null,
    revokedReason: row.revoked_reason ?? null,
  });
}

/** Postgres returns `+00` offsets; the domain speaks strict UTC ISO-8601. */
function toIso(value: unknown): string {
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) campaignDatabaseError();
  return parsed.toISOString();
}

export function createCampaignReadRepository(
  persistence: CampaignPersistence,
): CampaignReadPort & CampaignReviewPort {
  return {
    async listCampaigns(organizationId) {
      if (!organizationId) campaignDatabaseError();
      const { data, error } = await persistence
        .from("campaigns")
        .select(CAMPAIGN_COLUMNS)
        .order("updated_at", { ascending: false })
        .eq("organization_id", organizationId);
      if (error) campaignDatabaseError();
      return (data ?? []).map(toCampaign);
    },

    async latestGenerationRun(organizationId, campaignId) {
      if (!organizationId || !campaignId) campaignDatabaseError();
      const { data, error } = await persistence
        .from("campaign_generation_runs")
        .select("status, failure_code, lease_expires_at")
        .order("created_at", { ascending: false })
        .limit(1)
        .eq("organization_id", organizationId)
        .eq("campaign_id", campaignId);
      if (error) campaignDatabaseError();
      const [row] = (data ?? []) as {
        status: string;
        failure_code: string | null;
        lease_expires_at: string | null;
      }[];
      return row
        ? {
            status: row.status,
            failureCode: row.failure_code,
            leaseExpiresAt: row.lease_expires_at,
          }
        : null;
    },

    async getCampaign(organizationId, campaignId) {
      if (!organizationId || !campaignId) campaignDatabaseError();
      const { data, error } = await persistence
        .from("campaigns")
        .select(CAMPAIGN_COLUMNS)
        .eq("organization_id", organizationId)
        .eq("id", campaignId);
      if (error) campaignDatabaseError();
      const [row] = data ?? [];
      return row ? toCampaign(row) : null;
    },

    async listVersions(organizationId, campaignId) {
      if (!organizationId || !campaignId) campaignDatabaseError();
      const { data, error } = await persistence
        .from("campaign_bundle_versions")
        .select(VERSION_SUMMARY_COLUMNS)
        .order("version", { ascending: false })
        .eq("organization_id", organizationId)
        .eq("campaign_id", campaignId);
      if (error) campaignDatabaseError();
      return (data ?? []).map(toVersionSummary);
    },

    async getVersion(organizationId, versionId) {
      if (!organizationId || !versionId) campaignDatabaseError();
      const { data, error } = await persistence
        .from("campaign_bundle_versions")
        .select(VERSION_DETAIL_COLUMNS)
        .eq("organization_id", organizationId)
        .eq("id", versionId);
      if (error) campaignDatabaseError();
      const [row] = data ?? [];
      return row ? toVersionDetail(row) : null;
    },

    /**
     * The approval currently in force, if any. Revoked rows are filtered in the
     * query rather than in memory: a superseded approval must never reach a
     * caller that might treat "an approval exists" as authorization.
     */
    async getLiveApproval(organizationId, campaignId) {
      if (!organizationId || !campaignId) campaignDatabaseError();
      const { data, error } = await persistence
        .from("campaign_approvals")
        .select(APPROVAL_COLUMNS)
        .is("revoked_at", null)
        .eq("organization_id", organizationId)
        .eq("campaign_id", campaignId);
      if (error) campaignDatabaseError();
      const [row] = data ?? [];
      return row ? toApproval(row) : null;
    },

    async recordAttestation(input) {
      const validated = attestationInputSchema.parse(input);
      const { data, error } = await persistence.rpc("record_campaign_visual_attestation", {
        target_organization_id: validated.organizationId,
        target_bundle_version_id: validated.bundleVersionId,
        input_digest: validated.bundleDigest,
        input_statement: validated.statement,
      });
      if (error || typeof data !== "string") campaignDatabaseError();
      return data;
    },

    async approve(input) {
      const validated = approvalInputSchema.parse(input);
      const { data, error } = await persistence.rpc("approve_campaign_bundle", {
        target_organization_id: validated.organizationId,
        input_approval: {
          organization_id: validated.organizationId,
          bundle_version_id: validated.bundleVersionId,
          bundle_digest: validated.bundleDigest,
          attestation_id: validated.attestationId,
          expires_at: validated.expiresAt,
          capability_grant_versions: validated.capabilityGrantVersions,
          policy_version_ids: validated.policyVersionIds,
          action_keys: validated.actionKeys,
          total_spend_ceiling: validated.totalSpendCeiling,
        },
      });
      if (error || typeof data !== "string") campaignDatabaseError();
      return data;
    },
  };
}

/**
 * The worker-only writer.
 *
 * Kept in a separate factory from the read repository so a request path cannot
 * reach `createVersion` by accident: importing it is a deliberate act, and the
 * database refuses it for any role but the worker regardless.
 */
export function createCampaignVersionWriter(
  persistence: CampaignPersistence,
): CampaignVersionWriterPort {
  return {
    async createVersion(input) {
      const validated = createBundleVersionInputSchema.parse(input);

      // Every asset in the manifest must have a storage path, and no path may
      // reference an asset the manifest does not carry. A mismatch here would
      // publish a version pointing at bytes nobody reviewed.
      const manifestAssetIds = new Set(validated.manifest.assets.map((asset) => asset.id));
      const pathAssetIds = new Set(Object.keys(validated.assetStoragePaths));
      if (
        manifestAssetIds.size !== pathAssetIds.size ||
        [...manifestAssetIds].some((assetId) => !pathAssetIds.has(assetId))
      ) {
        campaignDatabaseError({
          operation: "create_version.asset_paths",
          organizationId: validated.organizationId,
          campaignId: validated.campaignId,
        });
      }

      const { data, error } = await persistence.rpc("create_campaign_bundle_version", {
        target_organization_id: validated.organizationId,
        input_bundle: {
          organization_id: validated.organizationId,
          campaign_id: validated.campaignId,
          source_snapshot_id: validated.sourceSnapshotId,
          digest: validated.digest,
          manifest: validated.manifest,
          total_spend_ceiling: validated.manifest.totalSpendCeiling,
          directions: validated.manifest.directions,
          assets: validated.manifest.assets.map((asset) => ({
            ...asset,
            storagePath: validated.assetStoragePaths[asset.id],
          })),
          actions: validated.manifest.actions,
          measurement_plan: validated.manifest.measurementPlan,
        },
      });
      if (error || !data) {
        campaignDatabaseError({
          operation: "create_version.rpc",
          code: [error?.code, constraintName(error?.message)].filter(Boolean).join("/"),
          organizationId: validated.organizationId,
          campaignId: validated.campaignId,
        });
      }

      const result = data as Record<string, unknown>;
      return createBundleVersionResultSchema.parse({
        bundleVersionId: result.bundle_version_id,
        version: Number(result.version),
        parentVersionId: result.parent_version_id ?? null,
        revokedApprovalCount: Number(result.revoked_approval_count ?? 0),
      });
    },
  };
}
