import { campaignDeliverableReviewSchema } from "@/domain/campaigns/deliverable";
import type { CampaignDeliverableReview } from "@/domain/campaigns/deliverable";
import type { LaunchFailure, LaunchStore } from "@/modules/campaigns/application/launch-service";

/**
 * Reading the review record, and committing publication authority.
 *
 * The launch tables carry no INSERT grant for anyone. Authority is written only
 * by `approve_campaign_launch`, inside one transaction that re-checks every
 * selected output. This repository therefore has exactly two jobs: gather the
 * review state the domain needs in order to explain a refusal before anyone
 * clicks, and hand the manifest to that function.
 *
 * Reads are batched by `in(...)` rather than looped per selection. A launch may
 * carry sixty outputs, and sixty round trips to draw one screen is the kind of
 * cost that later gets "optimised" by caching the answer — which is precisely
 * the thing that must not be cached, since the whole point is that the check
 * reflects the state at this instant.
 */
export type LaunchPersistence = {
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
        in(
          column: string,
          values: readonly string[],
        ): Promise<{ data: unknown; error: { message?: string } | null }>;
      };
    };
  };
};

/**
 * Turns a PostgreSQL refusal into an outcome the service can act on.
 *
 * Matched on the exception name the migration raises, never on free message
 * text. The refusals that describe a specific output become `not_admissible`
 * carrying that output's reason, so the interface can say which one is blocking
 * rather than reporting a blanket failure.
 */
export function launchFailure(error: { code?: string; message?: string }): LaunchFailure {
  const message = error.message ?? "";

  if (message.includes("campaign_launch_selection_unreviewed")) {
    return { kind: "not_admissible", reasonCode: "selection_not_reviewed" };
  }
  if (message.includes("campaign_launch_selection_rejected")) {
    return { kind: "not_admissible", reasonCode: "selection_rejected" };
  }
  if (message.includes("campaign_launch_selection_superseded")) {
    return { kind: "not_admissible", reasonCode: "selection_superseded" };
  }
  if (message.includes("campaign_launch_content_changed")) {
    return { kind: "not_admissible", reasonCode: "selection_content_changed" };
  }
  if (message.includes("campaign_launch_idempotency_conflict")) return { kind: "conflict" };
  if (message.includes("campaign_launch_forbidden")) return { kind: "forbidden" };
  // A selection naming another campaign's output, or one that is not there at
  // all, answers identically. Distinguishing them is how somebody confirms that
  // a particular deliverable exists somewhere else.
  if (message.includes("campaign_launch_selection_foreign_campaign")) return { kind: "not_found" };
  if (message.includes("campaign_launch_selection_not_found")) return { kind: "not_found" };
  // Unreachable through this service: the manifest schema requires at least one
  // selection. Reaching it means our own validation was bypassed, which is a
  // fault on our side and not a business outcome to report as one.
  if (message.includes("campaign_launch_empty_selection")) return { kind: "unavailable" };

  switch (error.code) {
    case "42501":
      return { kind: "forbidden" };
    case "P0002":
      return { kind: "not_found" };
    case "23505":
      return { kind: "conflict" };
    default:
      return { kind: "unavailable" };
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}

export function createLaunchRepository(client: LaunchPersistence): LaunchStore {
  return {
    async readReviewState(input) {
      const ids = [...new Set(input.deliverableVersionIds)];
      if (ids.length === 0) return new Map();

      const versionResult = await client
        .from("campaign_deliverable_versions")
        .select("id,content_hash,version,deliverable_id")
        .eq("organization_id", input.organizationId)
        .in("id", ids);

      // A read that failed is not the same as a set with nothing in it, and it
      // must not be reported as one: an empty map reads as "none of these were
      // reviewed", which the domain would turn into a confident refusal.
      if (versionResult.error) throw { kind: "unavailable" } satisfies LaunchFailure;

      const versionRows = rows(versionResult.data);
      if (versionRows.length === 0) return new Map();

      const deliverableIds = [
        ...new Set(versionRows.map((row) => String(row.deliverable_id))),
      ];

      const deliverableResult = await client
        .from("campaign_deliverables")
        .select("id,current_version_id")
        .eq("organization_id", input.organizationId)
        .in("id", deliverableIds);

      if (deliverableResult.error) throw { kind: "unavailable" } satisfies LaunchFailure;

      const currentVersionByDeliverable = new Map(
        rows(deliverableResult.data).map((row) => [
          String(row.id),
          row.current_version_id == null ? null : String(row.current_version_id),
        ]),
      );

      const reviewResult = await client
        .from("campaign_deliverable_reviews")
        .select(
          "id,organization_id,deliverable_id,deliverable_version_id,content_hash,actor_id,decision,reason_codes,note,reviewed_at",
        )
        .eq("organization_id", input.organizationId)
        .in("deliverable_version_id", ids);

      if (reviewResult.error) throw { kind: "unavailable" } satisfies LaunchFailure;

      const reviewsByVersion = new Map<string, CampaignDeliverableReview[]>();
      for (const row of rows(reviewResult.data)) {
        // Parsed, not cast. A stored review that no longer satisfies the schema
        // is dropped rather than allowed to authorize a publication.
        const parsed = campaignDeliverableReviewSchema.safeParse({
          id: row.id,
          organizationId: row.organization_id,
          deliverableId: row.deliverable_id,
          deliverableVersionId: row.deliverable_version_id,
          contentHash: row.content_hash,
          actorId: row.actor_id,
          decision: row.decision,
          reasonCodes: row.reason_codes ?? [],
          note: row.note ?? null,
          reviewedAt: row.reviewed_at,
        });
        if (!parsed.success) continue;

        const existing = reviewsByVersion.get(parsed.data.deliverableVersionId);
        if (existing) existing.push(parsed.data);
        else reviewsByVersion.set(parsed.data.deliverableVersionId, [parsed.data]);
      }

      const state = new Map<
        string,
        {
          version: { id: string; contentHash: string; version: number };
          currentVersion: number;
          reviews: readonly CampaignDeliverableReview[];
        }
      >();

      for (const row of versionRows) {
        const id = String(row.id);
        const version = Number(row.version);
        const currentId = currentVersionByDeliverable.get(String(row.deliverable_id)) ?? null;

        state.set(id, {
          version: { id, contentHash: String(row.content_hash), version },
          // An unknown or different current version is treated as "this one is
          // not current", which fails closed: publication is refused rather
          // than assumed.
          currentVersion: currentId === id ? version : version + 1,
          reviews: reviewsByVersion.get(id) ?? [],
        });
      }

      return state;
    },

    async approveLaunch(input) {
      const { data, error } = await client.rpc("approve_campaign_launch", {
        target_organization_id: input.organizationId,
        // Note what is absent: any actor. The function reads auth.uid() itself,
        // so a forged approver in a request body has nowhere to land.
        input_launch: input.payload,
      });
      if (error) throw launchFailure(error);

      const row = record(data);
      return {
        launchApprovalId: String(row.launch_approval_id),
        outcome: row.outcome === "replayed" ? "replayed" : "saved",
      };
    },
  };
}

/** The narrow read the detail page needs to answer "may this publish?". */
export type LaunchAuthorityReader = {
  from(table: "campaign_launch_approvals"): {
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
          ): Promise<{ data: unknown[] | null; error: unknown }>;
        };
      };
    };
  };
};

/**
 * Whether a live publication authority exists for this campaign.
 *
 * Returns `null` only when the read genuinely failed, and the panel says so
 * rather than reporting "not authorized" — claiming a campaign lacks authority
 * when we did not successfully look would send somebody to re-authorize
 * something already authorized.
 *
 * That distinction is why this reader exists at all. A permanent `null` because
 * nothing bothered to look would put an "incomplete" warning on every campaign
 * forever, and a warning that is always on is a warning nobody reads — which
 * would cost the real one its meaning on the day something actually cannot be
 * read.
 *
 * Only `authorized` counts. A superseded or revoked row is history: it records
 * what was once permitted and permits nothing now.
 */
export async function readLaunchAuthorized(
  client: LaunchAuthorityReader,
  input: { organizationId: string; campaignId: string },
): Promise<boolean | null> {
  try {
    const { data, error } = await client
      .from("campaign_launch_approvals")
      .select("id")
      .eq("organization_id", input.organizationId)
      .eq("campaign_id", input.campaignId)
      .eq("state", "authorized");

    if (error) return null;
    return Array.isArray(data) && data.length > 0;
  } catch {
    return null;
  }
}
