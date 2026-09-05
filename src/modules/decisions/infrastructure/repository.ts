import {
  artifactPromotionInputSchema,
  decisionFeedbackInputSchema,
} from "@/modules/decisions/application/ports";
import type {
  DecisionFeedbackPort,
  DecisionReadPort,
  DecisionWorkerStore,
  OpportunityFeedItem,
} from "@/modules/decisions/application/ports";

type RpcResult<T> = { data: T | null; error: { code?: string } | null };

export type DecisionPersistence = {
  from(table: "opportunities"): {
    select(columns: string): {
      order(
        column: string,
        options: { ascending: boolean },
      ): {
        eq(column: string, value: string): Promise<RpcResult<readonly OpportunityRow[]>>;
      };
    };
  };
  rpc(
    name: "append_decision_feedback" | "promote_decision_artifact",
    args: Record<string, unknown>,
  ): Promise<RpcResult<string | null>>;
};

type OpportunityRow = {
  id: string;
  organization_id: string;
  decision_record_id: string;
  playbook_version_id: string;
  action_key: unknown;
  created_at: string;
  title: string;
  summary: string;
  evidence_tier: OpportunityFeedItem["evidenceTier"];
  impact_low_minor: number | string;
  impact_high_minor: number | string;
  execution_cost_minor: number | string;
  expected_contribution_minor: number | string;
  currency: string;
  time_to_impact_days: number;
  status: OpportunityFeedItem["status"];
  expires_at: string;
  version: number;
};

function decisionDatabaseError(): never {
  throw new Error("Decision data could not be loaded or saved.");
}

function asNumber(value: number | string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) decisionDatabaseError();
  return parsed;
}

function storedActionKey(value: unknown): string {
  // The key lives on the opportunity row, written by the worker from the
  // selected playbook version. A missing or malformed value is a contract
  // break: callers must never paper over it with a code default.
  if (typeof value !== "string" || !/^[a-z][a-z0-9_.-]{0,119}$/.test(value)) {
    decisionDatabaseError();
  }
  return value as string;
}

function toFeedItem(row: OpportunityRow): OpportunityFeedItem {
  return {
    id: row.id,
    organizationId: row.organization_id,
    decisionRecordId: row.decision_record_id,
    playbookVersionId: row.playbook_version_id,
    actionKey: storedActionKey(row.action_key),
    createdAt: row.created_at,
    title: row.title,
    summary: row.summary,
    evidenceTier: row.evidence_tier,
    impactLowMinor: asNumber(row.impact_low_minor),
    impactHighMinor: asNumber(row.impact_high_minor),
    executionCostMinor: asNumber(row.execution_cost_minor),
    expectedContributionMinor: asNumber(row.expected_contribution_minor),
    currency: row.currency,
    timeToImpactDays: row.time_to_impact_days,
    status: row.status,
    expiresAt: row.expires_at,
    version: row.version,
  };
}

export function createDecisionRepository(
  persistence: DecisionPersistence,
): DecisionReadPort & DecisionFeedbackPort & DecisionWorkerStore {
  return {
    async listOpportunities(organizationId) {
      if (!organizationId) decisionDatabaseError();
      const { data, error } = await persistence
        .from("opportunities")
        .select(
          "id,organization_id,decision_record_id,playbook_version_id,action_key,created_at,title,summary,evidence_tier,impact_low_minor,impact_high_minor,execution_cost_minor,expected_contribution_minor,currency,time_to_impact_days,status,expires_at,version",
        )
        .order("expected_contribution_minor", { ascending: false })
        .eq("organization_id", organizationId);
      if (error) decisionDatabaseError();
      return (data ?? []).map(toFeedItem);
    },
    async appendFeedback(input) {
      const validated = decisionFeedbackInputSchema.parse(input);
      const { data, error } = await persistence.rpc("append_decision_feedback", {
        target_organization_id: validated.organizationId,
        target_opportunity_id: validated.opportunityId,
        input_feedback_kind: validated.feedbackKind,
        input_reason: validated.reason,
        input_edit_diff: validated.editDiff,
        input_correlation_id: validated.correlationId,
      });
      if (error || !data) decisionDatabaseError();
      return data;
    },
    async promoteArtifact(input) {
      const validated = artifactPromotionInputSchema.parse(input);
      const { data, error } = await persistence.rpc("promote_decision_artifact", {
        target_organization_id: validated.organizationId,
        input_promotion: {
          organization_id: validated.organizationId,
          artifact_key: validated.artifactKey,
          artifact_version_id: validated.artifactVersionId,
          expected_current_artifact_version_id: validated.expectedCurrentArtifactVersionId,
          promoted_by: validated.promotedBy,
        },
      });
      if (error || !data) decisionDatabaseError();
      return data;
    },
  };
}
