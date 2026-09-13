import { campaignDeliverableReviewSchema } from "@/domain/campaigns/deliverable";
import type { CampaignDeliverableReview } from "@/domain/campaigns/deliverable";
import type {
  DeliverableFailure,
  DeliverableStore,
} from "@/modules/campaigns/application/deliverable-service";

/**
 * The narrow contract this repository needs.
 *
 * The deliverable tables are absent from `database.types.ts` on purpose: no
 * role holds an INSERT grant, and every write goes through a security-definer
 * function. A generated row type would invite a direct insert that skips the
 * review gate, and that gate is the only thing standing between a render and
 * publication.
 */
export type DeliverablePersistence = {
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
        ): Promise<{ data: unknown; error: { message?: string } | null }> & {
          maybeSingle(): Promise<{ data: unknown; error: { message?: string } | null }>;
        };
      };
    };
  };
};

/**
 * Turns a PostgreSQL refusal into an outcome the service can act on.
 *
 * Matched on the exception name the migration raises and on SQLSTATE, never on
 * free message text. Anything unrecognised becomes `unavailable` rather than
 * being guessed at: reporting a refusal we do not understand as a specific
 * business outcome would be a confident lie.
 */
export function deliverableFailure(error: {
  code?: string;
  message?: string;
}): DeliverableFailure {
  const message = error.message ?? "";

  if (message.includes("campaign_deliverable_superseded")) return { kind: "superseded" };
  if (message.includes("campaign_deliverable_content_changed")) return { kind: "content_changed" };
  if (message.includes("campaign_deliverable_idempotency_conflict")) return { kind: "conflict" };
  if (message.includes("campaign_deliverable_forbidden")) return { kind: "forbidden" };
  if (message.includes("campaign_deliverable_version_not_found")) return { kind: "not_found" };

  switch (error.code) {
    case "42501":
      return { kind: "forbidden" };
    case "P0002":
      return { kind: "not_found" };
    case "23505":
      return { kind: "conflict" };
    case "22023":
      return { kind: "superseded" };
    default:
      return { kind: "unavailable" };
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

export function createDeliverableRepository(client: DeliverablePersistence): DeliverableStore {
  return {
    async recordVersion(input) {
      const { data, error } = await client.rpc("record_campaign_deliverable_version", {
        target_organization_id: input.organizationId,
        input_version: input.payload,
      });
      if (error) throw deliverableFailure(error);

      const row = record(data);
      return {
        deliverableId: String(row.deliverable_id),
        deliverableVersionId: String(row.deliverable_version_id),
        version: Number(row.version),
        outcome: row.outcome === "replayed" ? "replayed" : "saved",
      };
    },

    async reviewVersion(input) {
      const { data, error } = await client.rpc("review_campaign_deliverable_version", {
        target_organization_id: input.organizationId,
        // Note what is absent: any actor. The function reads auth.uid() itself,
        // so a forged reviewer in a request body has nowhere to land.
        input_review: input.payload,
      });
      if (error) throw deliverableFailure(error);

      const row = record(data);
      return {
        reviewId: String(row.review_id),
        outcome: row.outcome === "replayed" ? "replayed" : "saved",
      };
    },

    async readVersionForPublication(input) {
      const versionResult = await client
        .from("campaign_deliverable_versions")
        .select("id,content_hash,version,deliverable_id")
        .eq("organization_id", input.organizationId)
        .eq("id", input.deliverableVersionId)
        .maybeSingle();

      if (versionResult.error || !versionResult.data) return null;
      const versionRow = record(versionResult.data);
      const deliverableId = String(versionRow.deliverable_id);

      const deliverableResult = await client
        .from("campaign_deliverables")
        .select("current_version_id")
        .eq("organization_id", input.organizationId)
        .eq("id", deliverableId)
        .maybeSingle();

      const currentId =
        deliverableResult.error || !deliverableResult.data
          ? null
          : record(deliverableResult.data).current_version_id;

      const reviewsResult = await client
        .from("campaign_deliverable_reviews")
        .select("id,organization_id,deliverable_id,deliverable_version_id,content_hash,actor_id,decision,reason_codes,note,reviewed_at")
        .eq("organization_id", input.organizationId)
        .eq("deliverable_version_id", input.deliverableVersionId);

      const rows = Array.isArray(reviewsResult.data) ? reviewsResult.data : [];

      // Parsed, not cast. A stored review that no longer satisfies the schema is
      // dropped rather than being allowed to authorize a publication.
      const reviews: CampaignDeliverableReview[] = [];
      for (const row of rows) {
        const mapped = record(row);
        const parsed = campaignDeliverableReviewSchema.safeParse({
          id: mapped.id,
          organizationId: mapped.organization_id,
          deliverableId: mapped.deliverable_id,
          deliverableVersionId: mapped.deliverable_version_id,
          contentHash: mapped.content_hash,
          actorId: mapped.actor_id,
          decision: mapped.decision,
          reasonCodes: mapped.reason_codes ?? [],
          note: mapped.note ?? null,
          reviewedAt: mapped.reviewed_at,
        });
        if (parsed.success) reviews.push(parsed.data);
      }

      return {
        version: {
          id: String(versionRow.id),
          contentHash: String(versionRow.content_hash),
          version: Number(versionRow.version),
        },
        // An unknown current version is treated as "this one is not current",
        // which fails closed: publication is refused rather than assumed.
        currentVersion:
          typeof currentId === "string" && currentId === String(versionRow.id)
            ? Number(versionRow.version)
            : Number(versionRow.version) + 1,
        reviews,
      };
    },
  };
}
