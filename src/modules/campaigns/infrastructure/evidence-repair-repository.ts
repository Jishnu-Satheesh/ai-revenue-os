import { mergeBrandContext } from "@/domain/onboarding/canonical-promotion";
import { DomainError } from "@/lib/errors";
import type { GoalInput } from "@/domain/organizations/types";
import type {
  EvidenceRepairGoal,
  EvidenceRepairPorts,
} from "@/modules/campaigns/application/evidence-repair";

/**
 * The database side of an evidence repair.
 *
 * Three writes against the caller's own session: the brand profile, the goal,
 * and the re-pin. Nothing here uses a service role — an operator repairing a
 * campaign may write exactly what RLS already lets them write, and the RPC
 * checks `campaign.edit` for itself rather than trusting this layer to have.
 */

export type EvidenceRepairPersistence = {
  from(table: string): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): { maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: unknown }> };
    };
    upsert(row: Record<string, unknown>): Promise<{ error: unknown }>;
  };
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: unknown }>;
};

export function createEvidenceRepairAdapter(input: {
  persistence: EvidenceRepairPersistence;
  organizationId: string;
  campaignId: string;
  userId: string;
  createGoal: (
    supabase: never,
    organizationId: string,
    userId: string,
    goal: GoalInput,
  ) => Promise<unknown>;
}): EvidenceRepairPorts {
  const { persistence, organizationId, campaignId, userId } = input;

  return {
    async saveBrandVoice(voice) {
      // Read-then-merge, exactly as onboarding promotes. A whole-row write here
      // would erase whatever another section had already put in brand_context,
      // which is the defect that made re-entering a brand voice look useless.
      const { data: existing, error: readError } = await persistence
        .from("business_profiles")
        .select("*")
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (readError) {
        throw new DomainError("DOMAIN_ERROR", "The brand profile could not be read.");
      }

      const { error } = await persistence.from("business_profiles").upsert({
        organization_id: organizationId,
        value_proposition: existing?.value_proposition ?? null,
        brand_context: mergeBrandContext(existing?.brand_context, { voice }),
        source: "operator",
        updated_by: userId,
        customer_segments: existing?.customer_segments ?? [],
        languages: existing?.languages ?? [],
        operating_model: existing?.operating_model ?? {},
        business_model: existing?.business_model ?? null,
      });
      if (error) {
        throw new DomainError("DOMAIN_ERROR", "The brand voice could not be saved.");
      }
    },

    async createGoal(goal: EvidenceRepairGoal) {
      await input.createGoal(persistence as never, organizationId, userId, {
        name: goal.name,
        // The display wording and the registered key are different things. The
        // label a person reads stays free text; `metricKey` is what campaign
        // generation resolves against.
        metric: goal.name,
        metricKey: goal.metricKey,
        baselineStatus: goal.baselineStatus,
        baselineValue: goal.baselineValue ?? null,
        targetValue: goal.targetValue,
        unit: goal.unit,
        currency: goal.currency ?? null,
        scopeKind: "organization",
        scopeBranchId: null,
        // Highest priority, because `load_campaign_creation_facts` picks the
        // highest-priority goal carrying a metric key. A goal created to answer
        // "what counts as this working" that then loses to an older one would
        // leave the operator repairing the same gap twice.
        priority: 1,
      });
    },

    async refreshSnapshot() {
      const { data, error } = await persistence.rpc("refresh_campaign_source_snapshot", {
        target_organization_id: organizationId,
        target_campaign_id: campaignId,
      });
      if (error || !data) {
        throw new DomainError(
          "DOMAIN_ERROR",
          "This campaign could not be moved onto the updated information.",
        );
      }

      const row = data as { source_snapshot_id?: unknown; refreshed?: unknown };
      if (typeof row.source_snapshot_id !== "string") {
        throw new DomainError(
          "DOMAIN_ERROR",
          "This campaign could not be moved onto the updated information.",
        );
      }

      return {
        sourceSnapshotId: row.source_snapshot_id,
        // Never assumed true. Claiming a refresh that did not happen sends
        // somebody to retry a run that must fail identically.
        refreshed: row.refreshed === true,
      };
    },
  };
}
