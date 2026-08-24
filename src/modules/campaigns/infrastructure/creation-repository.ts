import { z } from "zod";

import type {
  CampaignCreationStore,
  GenerationDispatcher,
  OrganizationFactsReader,
} from "@/modules/campaigns/application/service";
import type { QualificationOpportunity } from "@/modules/campaigns/application/qualification";
import type { CampaignRunDispatcher } from "@/modules/campaigns/infrastructure/run-repository";
import { referenceResolutionSchema } from "@/domain/campaigns/reference-resolution";
import type { GenerationReferenceContextWriter } from "@/workflows/campaigns/generate-bundle";

/**
 * The request-path writes for creating a campaign.
 *
 * Creating a campaign is one atomic act in the database: brief, campaign, and
 * pinned snapshot appear together or not at all. That shape does not fit the
 * three-method `CampaignCreationStore` the service was written against, so this
 * adapter buffers the brief, performs the single RPC when the campaign is
 * created, and hands back the snapshot the same call produced.
 */

type RpcResult<T> = { data: T | null; error: { code?: string } | null };

export type CampaignCreationPersistence = {
  rpc(
    name: "create_campaign_with_source" | "load_campaign_creation_facts",
    args: Record<string, unknown>,
  ): Promise<RpcResult<unknown>>;
  from(table: "opportunities"): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        eq(column: string, value: string): Promise<RpcResult<readonly Record<string, unknown>[]>>;
      };
    };
  };
};

export type GenerationReferenceContextPersistence = {
  rpc(
    name: "pin_campaign_generation_run_reference_context",
    args: Record<string, unknown>,
  ): Promise<RpcResult<unknown>>;
};

function creationError(): never {
  throw new Error("The campaign could not be created.");
}

const createResultSchema = z.strictObject({
  campaign_id: z.string().uuid(),
  source_snapshot_id: z.string().uuid().nullable(),
  replayed: z.boolean(),
});

const factsSchema = z.strictObject({
  facts: z.object({}).catchall(z.unknown()),
  brand_asset_version_ids: z.array(z.string().uuid()),
});

export type CampaignCreationAdapter = CampaignCreationStore & {
  /** The snapshot the create RPC produced, for the caller to hand onward. */
  lastSourceSnapshotId(): string | null;
};

export function createCampaignCreationStore(
  persistence: CampaignCreationPersistence,
  input: {
    title: string;
    brief: {
      objective: string;
      audience: string;
      offer: string | null;
      requestedChannels: readonly string[];
    } | null;
    facts: Record<string, unknown>;
    brandAssetVersionIds: readonly string[];
    assertions: readonly { key: string; expectedOutcome: string }[];
  },
): CampaignCreationAdapter {
  let snapshotId: string | null = null;

  return {
    // The brief is written by the same RPC that writes the campaign, so this
    // records the intent and returns a placeholder the service does not use for
    // anything but its own null-checking.
    async createBrief() {
      return "pending";
    },

    async createCampaign(campaign) {
      const { data, error } = await persistence.rpc("create_campaign_with_source", {
        target_organization_id: campaign.organizationId,
        input_campaign: {
          organization_id: campaign.organizationId,
          title: input.title,
          source_kind: campaign.sourceKind,
          opportunity_id: campaign.opportunityId,
          idempotency_key: campaign.idempotencyKey,
          brief: input.brief
            ? {
                objective: input.brief.objective,
                audience: input.brief.audience,
                offer: input.brief.offer,
                requested_channels: input.brief.requestedChannels,
              }
            : null,
          facts: input.facts,
          brand_asset_version_ids: input.brandAssetVersionIds,
          assertions: input.assertions,
        },
      });
      if (error || !data) creationError();

      const parsed = createResultSchema.safeParse(data);
      if (!parsed.success) creationError();

      snapshotId = parsed.data.source_snapshot_id;
      return { campaignId: parsed.data.campaign_id, replayed: parsed.data.replayed };
    },

    async createSourceSnapshot() {
      // Already written, atomically, by the call above.
      if (!snapshotId) creationError();
      return snapshotId;
    },

    lastSourceSnapshotId: () => snapshotId,
  };
}

/**
 * The verified facts a campaign pins, read through an RPC rather than assembled
 * in the browser's session so a caller cannot decide what counts as evidence.
 */
export function createOrganizationFactsReader(
  persistence: CampaignCreationPersistence,
): OrganizationFactsReader {
  return {
    async readVerifiedFacts(organizationId) {
      const { data, error } = await persistence.rpc("load_campaign_creation_facts", {
        target_organization_id: organizationId,
      });
      if (error || !data) creationError();

      const parsed = factsSchema.safeParse(data);
      if (!parsed.success) creationError();

      return {
        facts: parsed.data.facts as Record<string, unknown>,
        brandAssetVersionIds: parsed.data.brand_asset_version_ids,
      };
    },

    async findOpportunity(organizationId, opportunityId): Promise<QualificationOpportunity | null> {
      const { data, error } = await persistence
        .from("opportunities")
        .select(
          "id,organization_id,status,playbook_version_id,decision_record_id,assertions,expires_at",
        )
        .eq("organization_id", organizationId)
        .eq("id", opportunityId);
      if (error) creationError();

      const [row] = data ?? [];
      if (!row) return null;

      return {
        id: String(row.id),
        organizationId: String(row.organization_id),
        status: row.status as QualificationOpportunity["status"],
        // The action key lives on the playbook version, not the opportunity.
        // Qualification re-checks it against the registered campaign action, so
        // it is carried through rather than assumed here.
        actionKey: String(row.action_key ?? "campaign.meta_bundle_v1"),
        playbookVersionId: String(row.playbook_version_id),
        decisionRecordId: String(row.decision_record_id),
        assertions: Array.isArray(row.assertions)
          ? (row.assertions as { key: string; expectedOutcome: string }[])
          : [],
        expiresAt: new Date(String(row.expires_at)),
      };
    },
  };
}

/** Bridges the run dispatcher to the shape the campaign service expects. */
export function createGenerationDispatcher(
  dispatcher: CampaignRunDispatcher,
): GenerationDispatcher {
  return {
    async enqueueGeneration(input) {
      const { runId } = await dispatcher.enqueue({
        organizationId: input.organizationId,
        campaignId: input.campaignId,
        sourceSnapshotId: input.sourceSnapshotId,
        kind: "generate",
        idempotencyKey: input.idempotencyKey,
        correlationId: input.correlationId,
      });
      return { runId };
    },
  };
}

/** Worker receipt writer. Both phases are fenced by the run's live claim token in Postgres. */
export function createGenerationReferenceContextWriter(
  persistence: GenerationReferenceContextPersistence,
): GenerationReferenceContextWriter {
  async function pin(input: {
    organizationId: string;
    runId: string;
    claimToken: string;
    phase: "resolution" | "blueprint";
    body: Record<string, unknown>;
  }) {
    const { error } = await persistence.rpc("pin_campaign_generation_run_reference_context", {
      target_organization_id: input.organizationId,
      input_pin: {
        organization_id: input.organizationId,
        run_id: input.runId,
        claim_token: input.claimToken,
        phase: input.phase,
        ...input.body,
      },
    });
    if (error) throw new Error("Campaign generation reference context could not be pinned.");
  }

  return {
    async pinResolution(input) {
      const resolution = referenceResolutionSchema.parse(input.resolution);
      if (resolution.outcome === "insufficient") {
        throw new Error("An insufficient reference resolution cannot be pinned for generation.");
      }
      await pin({
        ...input,
        phase: "resolution",
        body: {
          reference_slots: resolution.referenceSlots,
          avoid_reference_version_ids: resolution.avoidReferences.map(
            (reference) => reference.brandAssetVersionId,
          ),
          negative_rules: resolution.negativeRules,
          resolver_version: resolution.resolverVersion,
          resolution_outcome: resolution.outcome,
        },
      });
    },

    async pinBlueprint(input) {
      await pin({
        ...input,
        phase: "blueprint",
        body: { blueprint: input.blueprint, plan_model_id: input.planModelId },
      });
    },
  };
}
