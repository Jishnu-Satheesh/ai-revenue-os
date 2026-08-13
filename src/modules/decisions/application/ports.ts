import type { DecisionRecord } from "@/domain/decisions/record";

export type OpportunityStatus =
  | "proposed"
  | "awaiting_approval"
  | "approved"
  | "rejected"
  | "snoozed"
  | "expired";

/** Safe feed projection: evidence payloads and worker inputs stay server-side. */
export type OpportunityFeedItem = {
  id: string;
  organizationId: string;
  decisionRecordId: string;
  playbookVersionId: string;
  title: string;
  summary: string;
  evidenceTier: "computed" | "observed" | "prior";
  impactLowMinor: number;
  impactHighMinor: number;
  executionCostMinor: number;
  expectedContributionMinor: number;
  currency: string;
  timeToImpactDays: number;
  status: OpportunityStatus;
  expiresAt: string;
};

export type DecisionFeedbackInput = {
  organizationId: string;
  opportunityId: string;
  feedbackKind: "approved" | "rejected" | "snoozed" | "edited" | "more_evidence_requested";
  reason: string | null;
  editDiff: Record<string, unknown> | null;
  correlationId: string;
};

export type DecisionReadPort = {
  listOpportunities(organizationId: string): Promise<readonly OpportunityFeedItem[]>;
};

export type DecisionFeedbackPort = {
  appendFeedback(input: DecisionFeedbackInput): Promise<string>;
};

/** Worker-only boundary. Browser repositories never expose this capability. */
export type DecisionWorkerStore = {
  persist(record: DecisionRecord): Promise<void>;
};
