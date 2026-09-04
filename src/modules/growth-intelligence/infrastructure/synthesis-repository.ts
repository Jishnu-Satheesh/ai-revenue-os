import "server-only";

import { z } from "zod";

import { DomainError } from "@/lib/errors";

/**
 * Fenced synthesis persistence.
 *
 * The worker never writes synthesis tables directly: begin, completion,
 * failure, triage, and preferences all pass through claim- or actor-fenced
 * RPCs that check every rule again. This layer only shapes compact validated
 * input and maps persistence failures to safe domain errors.
 */

export type SynthesisPersistence = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

const uuidSchema = z.string().uuid();
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const safeCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{2,80}$/);

const metadataSchema = z
  .object({
    provider: z.string().trim().min(2).max(100),
    modelVersion: z.string().trim().min(1).max(160).nullable(),
    runFingerprint: digestSchema,
    correlationId: uuidSchema,
  })
  .strict();

const itemSchema = z
  .object({
    kind: z.enum(["insight", "recommendation", "data_gap"]),
    narrative: z.string().trim().min(1).max(2_000),
    itemFingerprint: digestSchema,
    evidenceFingerprint: digestSchema,
    geographicLayer: z.enum(["trade_area", "city", "country"]),
    geographyRef: z.string().trim().min(2).max(160),
    supportGrade: z.enum(["primary", "corroborated", "single_source", "contextual", "conflicted"]),
    freshness: z.enum(["current", "stale", "expired"]),
    urgency: z.enum(["high", "medium", "low"]),
    goalAlignment: z.enum(["direct", "indirect", "none"]),
    activityMonth: z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/),
    missingInput: z.string().trim().min(1).max(160).nullable(),
    claimIds: z.array(uuidSchema).max(200),
    findings: z.array(z.object({ id: uuidSchema, digest: digestSchema }).strict()).max(200),
    goals: z
      .array(
        z
          .object({
            ref: z.string().trim().min(2).max(160),
            alignment: z.enum(["direct", "indirect", "none"]),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();

const resultSchema = z
  .object({
    outcome: z.literal("completed"),
    resultDigest: digestSchema,
    items: z.array(itemSchema).max(200),
  })
  .strict();

const failureSchema = z.object({ safeFailureCode: safeCodeSchema }).strict();

const decisionSchema = z
  .object({
    itemId: uuidSchema,
    decision: z.enum([
      "acknowledged",
      "pinned",
      "unpinned",
      "planned",
      "snoozed",
      "dismissed",
      "resolved",
    ]),
    reason: z.string().trim().min(1).max(500).nullable(),
    snoozedUntil: z.string().datetime({ offset: true }).nullable(),
    itemFingerprint: digestSchema,
  })
  .strict();

const preferenceSchema = z
  .object({
    sourceKind: z.enum(["synthesis_item", "channel_recommendation", "opportunity"]),
    sourceId: uuidSchema,
    pinned: z.boolean(),
    snoozedUntil: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();

const decideInputSchema = decisionSchema
  .extend({
    organizationId: uuidSchema,
    actorId: uuidSchema,
  })
  .strict();

const preferenceInputSchema = preferenceSchema
  .extend({
    organizationId: uuidSchema,
    actorId: uuidSchema,
  })
  .strict();

export type SynthesisRunMetadata = z.infer<typeof metadataSchema>;
export type SynthesisItemPayload = z.infer<typeof itemSchema>;
export type SynthesisRunResult = z.infer<typeof resultSchema>;
export type SynthesisRunFailure = z.infer<typeof failureSchema>;
export type SynthesisItemDecision = z.infer<typeof decisionSchema>;
export type SynthesisPreference = z.infer<typeof preferenceSchema>;

export type SynthesisRepository = {
  begin(input: {
    organizationId: string;
    requestId: string;
    claimToken: string;
    metadata: SynthesisRunMetadata;
  }): Promise<{ runId: string; status: string; replayed: boolean }>;
  complete(input: {
    organizationId: string;
    requestId: string;
    claimToken: string;
    runId: string;
    result: SynthesisRunResult;
  }): Promise<{ runId: string; status: string; itemCount: number; supersededItemIds: string[] }>;
  fail(input: {
    organizationId: string;
    requestId: string;
    claimToken: string;
    runId: string;
    failure: SynthesisRunFailure;
  }): Promise<{ runId: string; status: string }>;
  decide(
    input: {
      organizationId: string;
      actorId: string;
    } & SynthesisItemDecision,
  ): Promise<{ decisionId: string; decision: string }>;
  setPreference(
    input: {
      organizationId: string;
      actorId: string;
    } & SynthesisPreference,
  ): Promise<{ sourceKind: string; pinned: boolean }>;
};

function boundaryError(): DomainError {
  return new DomainError("DOMAIN_ERROR", "Synthesis input was not usable.");
}

function persistenceError(
  operation: "begin" | "complete" | "fail" | "decide" | "preference",
): DomainError {
  const messages = {
    begin: "Synthesis could not be started.",
    complete: "Synthesis could not be completed.",
    fail: "Synthesis could not be marked as failed.",
    decide: "The item decision could not be recorded.",
    preference: "The preference could not be saved.",
  } as const;
  return new DomainError("DOMAIN_ERROR", messages[operation]);
}

function runOutcome(data: unknown): { runId: string; status: string; replayed: boolean } {
  const parsed = z
    .object({ runId: uuidSchema, status: z.string(), replayed: z.boolean() })
    .passthrough()
    .safeParse(data);
  if (!parsed.success) throw boundaryError();
  return parsed.data;
}

export function createSynthesisRepository(persistence: SynthesisPersistence): SynthesisRepository {
  async function invoke(
    operation: "begin" | "complete" | "fail" | "decide" | "preference",
    name: string,
    args: Record<string, unknown>,
  ) {
    const result = await persistence.rpc(name, args);
    if (result.error) throw persistenceError(operation);
    return result.data;
  }

  return {
    async begin(input) {
      const data = await invoke("begin", "begin_growth_intelligence_synthesis", {
        p_organization_id: input.organizationId,
        p_request_id: input.requestId,
        p_claim_token: input.claimToken,
        p_metadata: metadataSchema.parse(input.metadata),
      });
      return runOutcome(data);
    },

    async complete(input) {
      const result = resultSchema.parse(input.result);
      const data = await invoke("complete", "complete_growth_intelligence_synthesis", {
        p_organization_id: input.organizationId,
        p_request_id: input.requestId,
        p_claim_token: input.claimToken,
        p_synthesis_run_id: input.runId,
        p_result: {
          outcome: result.outcome,
          resultDigest: result.resultDigest,
          items: result.items.map((item) => ({
            kind: item.kind,
            narrative: item.narrative,
            itemFingerprint: item.itemFingerprint,
            evidenceFingerprint: item.evidenceFingerprint,
            geographicLayer: item.geographicLayer,
            geographyRef: item.geographyRef,
            supportGrade: item.supportGrade,
            freshness: item.freshness,
            urgency: item.urgency,
            goalAlignment: item.goalAlignment,
            activityMonth: item.activityMonth,
            missingInput: item.missingInput,
            claimIds: item.claimIds,
            findings: item.findings.map((finding) => ({
              id: finding.id,
              digest: finding.digest,
            })),
            goals: item.goals.map((goal) => ({ ref: goal.ref, alignment: goal.alignment })),
          })),
        },
      });
      const parsed = z
        .object({
          runId: uuidSchema,
          status: z.string(),
          itemCount: z.number().int().min(0),
          supersededItemIds: z.array(uuidSchema),
        })
        .passthrough()
        .safeParse(data);
      if (!parsed.success) throw boundaryError();
      return parsed.data;
    },

    async fail(input) {
      const failure = failureSchema.parse(input.failure);
      const data = await invoke("fail", "fail_growth_intelligence_synthesis", {
        p_organization_id: input.organizationId,
        p_request_id: input.requestId,
        p_claim_token: input.claimToken,
        p_synthesis_run_id: input.runId,
        p_safe_failure_code: failure.safeFailureCode,
      });
      const parsed = z
        .object({ runId: uuidSchema, status: z.string() })
        .passthrough()
        .safeParse(data);
      if (!parsed.success) throw boundaryError();
      return parsed.data;
    },

    async decide(input) {
      const decision = decideInputSchema.parse(input);
      const data = await invoke("decide", "decide_growth_intelligence_item", {
        p_organization_id: decision.organizationId,
        p_actor_id: decision.actorId,
        p_item_id: decision.itemId,
        p_decision: decision.decision,
        p_reason: decision.reason,
        p_snoozed_until: decision.snoozedUntil,
        p_item_fingerprint: decision.itemFingerprint,
      });
      const parsed = z
        .object({ decisionId: uuidSchema, decision: z.string() })
        .passthrough()
        .safeParse(data);
      if (!parsed.success) throw boundaryError();
      return parsed.data;
    },

    async setPreference(input) {
      const preference = preferenceInputSchema.parse(input);
      const data = await invoke("preference", "set_growth_intelligence_preference", {
        p_organization_id: preference.organizationId,
        p_actor_id: preference.actorId,
        p_source_kind: preference.sourceKind,
        p_source_id: preference.sourceId,
        p_pinned: preference.pinned,
        p_snoozed_until: preference.snoozedUntil,
      });
      const parsed = z
        .object({ sourceKind: z.string(), pinned: z.boolean() })
        .passthrough()
        .safeParse(data);
      if (!parsed.success) throw boundaryError();
      return parsed.data;
    },
  };
}
