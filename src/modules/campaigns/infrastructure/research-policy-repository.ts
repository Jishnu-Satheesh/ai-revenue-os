import {
  researchPolicySchema,
  type ResearchAdmissionRefusal,
  type ResearchPolicy,
  type ResearchPolicyInput,
} from "@/domain/campaigns/research-policy";

/**
 * The narrow contract the research repositories need, and nothing wider.
 *
 * The research tables are absent from `database.types.ts` on purpose: no role
 * holds any grant on them, and every read and write goes through a
 * security-definer function. There is no generated row type sitting around
 * inviting a direct query that would skip admission, the lease, or the event
 * capture.
 */
export type ResearchPersistence = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
};

export type ResearchLedger = {
  policy: ResearchPolicy | null;
  pendingCount: number;
  windowSpentMinor: number;
  lastAdmittedAt: string | null;
};

export type ResearchPersistenceFailure =
  | { kind: "refused"; reasonCode: ResearchAdmissionRefusal }
  | { kind: "forbidden" | "not_found" | "conflict" | "invalid" | "unavailable" };

export function isResearchPersistenceFailure(
  error: unknown,
): error is ResearchPersistenceFailure {
  return (
    typeof error === "object" &&
    error !== null &&
    "kind" in error &&
    typeof (error as { kind: unknown }).kind === "string"
  );
}

/**
 * Turns a PostgreSQL refusal into the outcome the service can act on.
 *
 * Named research exceptions map to their admission refusal; anything else
 * falls back to SQLSTATE mapping, and anything unrecognised becomes
 * `unavailable` rather than a guessed business outcome.
 */
export function researchFailure(error: {
  code?: string;
  message?: string;
}): ResearchPersistenceFailure {
  const message = error.message ?? "";

  if (message.includes("campaign_research_needs_setup"))
    return { kind: "refused", reasonCode: "needs_setup" };
  if (message.includes("campaign_research_stale_policy"))
    return { kind: "refused", reasonCode: "stale_policy" };
  if (message.includes("campaign_research_cooldown"))
    return { kind: "refused", reasonCode: "cooldown_active" };
  if (message.includes("campaign_research_pending_limit"))
    return { kind: "refused", reasonCode: "pending_limit_reached" };
  if (message.includes("campaign_research_allowance_exceeded"))
    return { kind: "refused", reasonCode: "allowance_exceeded" };
  if (message.includes("campaign_research_currency_mismatch"))
    return { kind: "refused", reasonCode: "currency_mismatch" };
  if (message.includes("campaign_research_forbidden")) return { kind: "forbidden" };
  if (message.includes("campaign_research_not_found")) return { kind: "not_found" };
  if (message.includes("campaign_research_invalid")) return { kind: "invalid" };
  if (message.includes("campaign_research_claim_lost")) return { kind: "not_found" };

  switch (error.code) {
    case "42501":
      return { kind: "forbidden" };
    case "P0002":
      return { kind: "not_found" };
    case "23505":
      return { kind: "conflict" };
    case "22023":
      return { kind: "invalid" };
    default:
      return { kind: "unavailable" };
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw researchFailure({ message: "campaign_research_invalid" });
  }
  return value;
}

function requiredNumber(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
    throw researchFailure({ message: "campaign_research_invalid" });
  }
  return parsed;
}

export type ResearchPolicyRepository = {
  readLedger(input: { organizationId: string }): Promise<ResearchLedger>;
  requestRun(input: {
    organizationId: string;
    triggerKind: string;
    budgetMinor: number;
    allowanceCurrency: string;
    sourceFingerprint: string | null;
    researchQuestion: string | null;
    requestDigest: string;
    idempotencyKey: string;
    knownPolicyVersion: number | null;
  }): Promise<{ runId: string; outcome: "saved" | "replayed" }>;
  /**
   * Records a new policy version and makes it the current one.
   *
   * There is no update: every run records the version that admitted it, so
   * editing a policy in place would retroactively rewrite what earlier spending
   * was allowed to be. The version number comes back from the database, which
   * mints it under a lock.
   */
  savePolicy(input: {
    organizationId: string;
    policy: ResearchPolicyInput;
  }): Promise<{ policyId: string; version: number; enabled: boolean }>;
};

export function createResearchPolicyRepository(
  client: ResearchPersistence,
): ResearchPolicyRepository {
  return {
    async readLedger(input): Promise<ResearchLedger> {
      const { data, error } = await client.rpc("read_campaign_research_ledger", {
        target_organization_id: input.organizationId,
      });
      if (error) throw researchFailure(error);

      const row = record(data);
      const policyValue = row.policy;
      return {
        // Parsed rather than cast: a policy row that no longer satisfies the
        // current schema admits nothing, instead of admitting under rules
        // nobody validated.
        policy:
          policyValue === null
            ? null
            : researchPolicySchema.parse(policyValue),
        pendingCount: requiredNumber(row.pending_count),
        windowSpentMinor: requiredNumber(row.window_spent_minor),
        lastAdmittedAt:
          row.last_admitted_at === null ? null : String(row.last_admitted_at),
      };
    },

    async savePolicy(input) {
      const { policy } = input;
      const { data, error } = await client.rpc("save_campaign_research_policy", {
        target_organization_id: input.organizationId,
        input_policy: {
          enabled: policy.enabled,
          schedule_timezone: policy.timezone,
          evidence_qualification_rule_version: policy.evidenceQualificationRuleVersion,
          evidence_max_age_days: policy.evidenceMaxAgeDays,
          cooldown_seconds: policy.cooldownSeconds,
          max_pending_proposals: policy.maxPendingProposals,
          max_attempts: policy.maxAttempts,
          per_run_allowance_minor: policy.perRunAllowance.amountMinor,
          window_allowance_minor: policy.windowAllowance.amountMinor,
          allowance_currency: policy.perRunAllowance.currency,
          window_days: policy.windowDays,
        },
      });
      if (error) throw researchFailure(error);

      const row = record(data);
      return {
        policyId: requiredString(row.policy_id, "policy_id"),
        version: requiredNumber(row.version),
        enabled: row.enabled === true,
      };
    },

    async requestRun(input) {
      const { data, error } = await client.rpc("request_campaign_research_run", {
        target_organization_id: input.organizationId,
        input_run: {
          trigger_kind: input.triggerKind,
          budget_minor: input.budgetMinor,
          allowance_currency: input.allowanceCurrency,
          source_fingerprint: input.sourceFingerprint,
          research_question: input.researchQuestion,
          request_digest: input.requestDigest,
          idempotency_key: input.idempotencyKey,
          known_policy_version: input.knownPolicyVersion,
        },
      });
      if (error) throw researchFailure(error);

      const row = record(data);
      return {
        runId: requiredString(row.run_id, "run_id"),
        outcome: row.outcome === "replayed" ? "replayed" : "saved",
      };
    },
  };
}
