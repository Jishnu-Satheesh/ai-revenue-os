import { z } from "zod";

import {
  researchFailure,
  type ResearchPersistence,
} from "@/modules/campaigns/infrastructure/research-policy-repository";

/**
 * The scheduler's handle on due evaluations.
 *
 * The due list and the evaluation both run on the worker's service-role
 * client: the EXECUTE grant is the gate, matching the other worker functions.
 * Every query repeats the organization id alongside the schedule lock, so
 * tenancy holds by explicit predicate even though RLS is bypassed.
 *
 * The evaluation verdict travels as a named outcome, never a bare boolean.
 * `refused` carries the admission vocabulary (`allowance_exceeded`,
 * `pending_limit`, `cooldown`) so the scheduler logs the same reason a
 * manual request would have shown — identical rules, identical names.
 */

const uuidSchema = z.string().uuid();

const evaluateDueResultSchema = z.strictObject({
  outcome: z.enum([
    "admitted",
    "replayed",
    "already_evaluated",
    "not_due",
    "no_qualifying_change",
    "refused",
  ]),
  runId: uuidSchema.nullable().default(null),
  policyVersion: z.number().int().positive().nullable().default(null),
  evidenceMaxAgeDays: z.number().int().positive().max(365).nullable().default(null),
  budgetMinor: z.number().int().nonnegative().nullable().default(null),
  allowanceCurrency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable()
    .default(null),
  reason: z.string().trim().min(1).max(120).nullable().default(null),
});
export type EvaluateDueResult = z.infer<typeof evaluateDueResultSchema>;

export type ResearchDueReader = {
  /**
   * The organizations holding a due schedule, oldest evaluation first.
   *
   * Advisory: each organization is rechecked under lock inside the
   * evaluation, so an organization that stopped being due between the list
   * and its turn is reported `not_due` rather than evaluated anyway.
   */
  listDueOrganizations(): Promise<readonly string[]>;
  /**
   * Claims the current window and evaluates it, atomically.
   *
   * The fingerprint names the evidence this tick compared against; the
   * candidate revision names the material revision within it. The
   * idempotency key must be stable per evidence (see
   * `scheduledIdempotencyKey`), so a retried tick replays rather than
   * duplicating.
   */
  evaluateDue(input: {
    organizationId: string;
    evidenceFingerprint: string;
    candidateRevision: string | null;
    requestDigest: string;
    idempotencyKey: string;
  }): Promise<EvaluateDueResult>;
};

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function camelCaseResult(row: Record<string, unknown>): Record<string, unknown> {
  return {
    outcome: row.outcome,
    runId: row.run_id ?? null,
    policyVersion: row.policy_version ?? null,
    evidenceMaxAgeDays: row.evidence_max_age_days ?? null,
    budgetMinor: row.budget_minor ?? null,
    allowanceCurrency: row.allowance_currency ?? null,
    reason: row.reason ?? null,
  };
}

export function createResearchDueReader(client: ResearchPersistence): ResearchDueReader {
  return {
    async listDueOrganizations(): Promise<readonly string[]> {
      const { data, error } = await client.rpc(
        "list_campaign_research_due_organizations",
        {},
      );
      if (error) throw researchFailure(error);
      // Anything that is not a list of ids is a contract the sweep does not
      // recognise, and sweeping nothing is the safe reading of it.
      return Array.isArray(data)
        ? data.filter((id): id is string => typeof id === "string")
        : [];
    },

    async evaluateDue(input): Promise<EvaluateDueResult> {
      const { data, error } = await client.rpc("evaluate_campaign_research_schedule_due", {
        target_organization_id: input.organizationId,
        input_evaluation: {
          evidence_fingerprint: input.evidenceFingerprint,
          candidate_revision: input.candidateRevision,
          request_digest: input.requestDigest,
          idempotency_key: input.idempotencyKey,
        },
      });
      if (error) throw researchFailure(error);

      // A shape nothing validated must not be reported as evaluated: the
      // scheduler would tell its logs research was considered on the
      // strength of it.
      return evaluateDueResultSchema.parse(camelCaseResult(record(data)));
    },
  };
}
