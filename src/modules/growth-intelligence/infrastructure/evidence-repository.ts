import "server-only";

import { z } from "zod";

import { GrowthIntelligenceError } from "@/domain/growth-intelligence/errors";
import {
  RESEARCH_PIPELINE_STAGES,
  researchCoverageEntrySchema,
} from "@/domain/growth-intelligence/research-pipeline";
import { DomainError } from "@/lib/errors";

const identifierSchema = z.string().uuid();
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const safeCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{2,80}$/);
const timestampSchema = z.string().datetime({ offset: true });
const keySchema = z.string().regex(/^[a-z][a-z0-9_.-]{0,79}$/);
const publicUrlSchema = z
  .string()
  .min(8)
  .max(2_048)
  .regex(/^https?:\/\/[^/?#:@]+(?:\/[^?#]*)?$/);

const sourceSchema = z
  .object({
    key: keySchema,
    url: publicUrlSchema,
    domain: z
      .string()
      .min(3)
      .max(253)
      .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/),
    publisher: z.string().min(1).max(200).nullable(),
    sourceClass: z.enum(["official", "first_party", "industry_research", "public_signal"]),
    availability: z.enum(["available", "unavailable", "excluded"]),
    contentDigest: digestSchema.nullable(),
    safeFailureCode: safeCodeSchema.nullable(),
    retrievedAt: timestampSchema,
    publishedAt: timestampSchema.nullable(),
    observedAt: timestampSchema.nullable(),
    excerptText: z.string().min(1).max(2_000).nullable().optional(),
    excerptDigest: digestSchema.nullable().optional(),
    qualificationVersion: z.string().min(1).max(80).nullable().optional(),
    retainUntil: timestampSchema.nullable().optional(),
  })
  .strict()
  .superRefine((source, context) => {
    let hostname: string;
    try {
      hostname = new URL(source.url).hostname.toLowerCase();
    } catch {
      context.addIssue({ code: "custom", message: "Citation URLs must be publicly usable." });
      return;
    }
    if (hostname !== source.domain) {
      context.addIssue({
        code: "custom",
        message: "Citation source domains must match their public URL.",
      });
    }
    if (
      (source.availability === "available" && (!source.contentDigest || source.safeFailureCode)) ||
      (source.availability !== "available" && !source.safeFailureCode)
    ) {
      context.addIssue({
        code: "custom",
        message: "Source availability must match its digest and safe failure code.",
      });
    }
    const excerptText = source.excerptText ?? null;
    const excerptDigest = source.excerptDigest ?? null;
    const qualificationVersion = source.qualificationVersion ?? null;
    const retainUntil = source.retainUntil ?? null;
    if ((excerptText === null) !== (excerptDigest === null)) {
      context.addIssue({
        code: "custom",
        message: "A retained excerpt needs both its text and its digest.",
      });
    }
    if (excerptText !== null && (qualificationVersion === null || retainUntil === null)) {
      context.addIssue({
        code: "custom",
        message: "A retained excerpt must record its qualification and retain-until policy.",
      });
    }
  });

const claimSchema = z
  .object({
    key: keySchema,
    claimDigest: digestSchema,
    subjectKind: z.enum([
      "market",
      "competitor",
      "event",
      "regulation",
      "seasonality",
      "audience",
      "topic",
    ]),
    subjectRef: z.string().min(1).max(160),
    claimKind: z.string().regex(/^[a-z][a-z0-9_.-]{1,119}$/),
    paraphrase: z.string().min(1).max(1_000),
    quotation: z.string().min(1).max(500).nullable(),
    geographicLayer: z.enum(["trade_area", "city", "country"]),
    geographyRef: z.string().min(2).max(160),
    sourceKeys: z.array(keySchema).min(1).max(50),
    freshnessClass: z.enum(["fast", "standard", "structural"]),
    claimCategory: z.enum([
      "availability",
      "offer",
      "price",
      "event",
      "review_trend",
      "demand_trend",
      "regulation",
      "seasonality",
      "structural_context",
    ]),
    freshnessRegistryVersion: z.literal(1),
    publishedAt: timestampSchema.nullable(),
    observedAt: timestampSchema.nullable(),
    staleAt: timestampSchema,
    expiresAt: timestampSchema,
    limitations: z.array(safeCodeSchema).max(20),
  })
  .strict()
  .superRefine((claim, context) => {
    if (new Set(claim.sourceKeys).size !== claim.sourceKeys.length) {
      context.addIssue({ code: "custom", message: "Claim source keys must be unique." });
    }
    const expectedFreshnessClass =
      claim.claimCategory === "availability"
        ? "fast"
        : claim.claimCategory === "seasonality" || claim.claimCategory === "structural_context"
          ? "structural"
          : "standard";
    if (claim.freshnessClass !== expectedFreshnessClass) {
      context.addIssue({
        code: "custom",
        message: "Claim category must use the governed freshness class.",
      });
    }
  });

export const marketEvidencePayloadSchema = z
  .object({
    sources: z.array(sourceSchema).max(50),
    claims: z.array(claimSchema).max(200),
    links: z
      .array(
        z
          .object({
            fromClaimKey: keySchema,
            toClaimKey: keySchema,
            relation: z.enum(["corroborates", "contradicts"]),
          })
          .strict(),
      )
      .max(400),
  })
  .strict()
  .superRefine((payload, context) => {
    const sourceKeys = new Set(payload.sources.map((source) => source.key));
    const claimKeys = new Set(payload.claims.map((claim) => claim.key));
    if (sourceKeys.size !== payload.sources.length) {
      context.addIssue({ code: "custom", message: "Evidence source keys must be unique." });
    }
    if (claimKeys.size !== payload.claims.length) {
      context.addIssue({ code: "custom", message: "Evidence claim keys must be unique." });
    }
    for (const claim of payload.claims) {
      for (const sourceKey of claim.sourceKeys) {
        if (!sourceKeys.has(sourceKey)) {
          context.addIssue({
            code: "custom",
            message: "Every claim source must be present in this compact evidence payload.",
          });
        }
      }
    }
    for (const link of payload.links) {
      if (
        link.fromClaimKey === link.toClaimKey ||
        !claimKeys.has(link.fromClaimKey) ||
        !claimKeys.has(link.toClaimKey)
      ) {
        context.addIssue({
          code: "custom",
          message: "Evidence links must reference two different recorded claims.",
        });
      }
    }
  });

export type MarketEvidencePayload = z.infer<typeof marketEvidencePayloadSchema>;

const metadataSchema = z
  .object({
    adapterProvider: z.string().min(2).max(100),
    adapterVersion: z.string().min(1).max(160),
    modelProvider: z.string().min(2).max(100).nullable(),
    modelVersion: z.string().min(1).max(160).nullable(),
    runFingerprint: digestSchema,
    queryPlanDigest: digestSchema,
    correlationId: identifierSchema,
  })
  .strict();

const resultSchema = z
  .object({
    outcome: z.enum(["completed", "partial"]),
    resultDigest: digestSchema,
    sourceAttemptCount: z.number().int().min(0).max(200),
    sourceSuccessCount: z.number().int().min(0).max(200),
    adapterCostMicrosUsd: z.number().int().min(0).max(50_000_000),
    adapterLatencyMs: z.number().int().min(0).max(600_000),
  })
  .strict()
  .refine((result) => result.sourceSuccessCount <= result.sourceAttemptCount, {
    message: "Successful source count cannot exceed the attempted source count.",
  });

const appendEventSchema = z
  .object({
    claimId: identifierSchema,
    reasonCode: safeCodeSchema,
    occurredAt: timestampSchema,
  })
  .strict();

const failureSchema = z
  .object({
    safeFailureCode: safeCodeSchema,
    adapterCostMicrosUsd: z.number().int().min(0).max(50_000_000),
    adapterLatencyMs: z.number().int().min(0).max(600_000),
  })
  .strict();

const runOutcomeSchema = z
  .object({
    runId: identifierSchema,
    status: z.enum(["running", "completed", "partial", "failed"]),
    replayed: z.boolean(),
  })
  .passthrough();

const recordOutcomeSchema = z
  .object({
    runId: identifierSchema,
    claimCount: z.number().int().min(0).max(200),
    replayed: z.boolean(),
  })
  .strict();

const appendOutcomeSchema = z
  .object({
    claimId: identifierSchema,
    eventId: identifierSchema,
    replayed: z.boolean(),
  })
  .strict();

/**
 * The atomic handoff input: the worker's bounded result digest plus the
 * retrieval coverage manifest. Eligibility is decided server-side from
 * persisted claims, never from these worker counts.
 */
const pipelineCoverageSchema = z
  .array(researchCoverageEntrySchema)
  .min(1)
  .max(26, "Coverage cannot exceed the planned query slots.");

const pipelineHandoffSchema = z
  .object({
    runId: identifierSchema,
    pipelineStage: z.enum(RESEARCH_PIPELINE_STAGES),
    synthesisRequestId: identifierSchema.nullable(),
    eligibleClaimCount: z.number().int().min(0).max(200),
    replayed: z.boolean(),
  })
  .strict();

const synthesisFinalizeResultSchema = z
  .object({
    outcome: z.literal("completed"),
    resultDigest: digestSchema,
    // Items ride through to the fenced persistence RPC, which validates
    // every item strictly. The boundary only bounds the envelope.
    items: z.array(z.unknown()).max(200),
  })
  .strict();

const synthesisFinalizeOutcomeSchema = z
  .object({
    runId: identifierSchema,
    itemCount: z.number().int().min(0).max(200),
    supersededItemIds: z.array(identifierSchema).max(200).optional().default([]),
    pipelineStage: z.enum(RESEARCH_PIPELINE_STAGES),
    replayed: z.boolean(),
  })
  .strict();

const synthesisFailOutcomeSchema = z
  .object({
    runId: identifierSchema,
    pipelineStage: z.enum(RESEARCH_PIPELINE_STAGES),
    replayed: z.boolean(),
  })
  .strict();

export type MarketEvidencePersistence = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

export type MarketEvidenceRepository = {
  begin(input: {
    organizationId: string;
    requestId: string;
    claimToken: string;
    metadata: z.infer<typeof metadataSchema>;
  }): Promise<z.infer<typeof runOutcomeSchema>>;
  record(input: {
    organizationId: string;
    requestId: string;
    claimToken: string;
    runId: string;
    payload: MarketEvidencePayload;
  }): Promise<z.infer<typeof recordOutcomeSchema>>;
  complete(input: {
    organizationId: string;
    requestId: string;
    claimToken: string;
    runId: string;
    result: z.infer<typeof resultSchema>;
  }): Promise<z.infer<typeof runOutcomeSchema>>;
  fail(input: {
    organizationId: string;
    requestId: string;
    claimToken: string;
    runId: string;
    failure: z.infer<typeof failureSchema>;
  }): Promise<z.infer<typeof runOutcomeSchema>>;
  appendEvent(input: {
    organizationId: string;
    requestId: string;
    claimToken: string;
    eventType: "expired" | "withdrawn" | "excluded" | "corrected" | "superseded";
    event: z.infer<typeof appendEventSchema>;
  }): Promise<z.infer<typeof appendOutcomeSchema>>;
  completePipeline(input: {
    organizationId: string;
    pipelineId: string;
    requestId: string;
    claimToken: string;
    runId: string;
    result: z.infer<typeof resultSchema>;
    coverage: z.input<typeof pipelineCoverageSchema>;
  }): Promise<z.infer<typeof pipelineHandoffSchema>>;
  completeSynthesisPipeline(input: {
    organizationId: string;
    requestId: string;
    claimToken: string;
    runId: string;
    result: z.infer<typeof synthesisFinalizeResultSchema>;
  }): Promise<z.infer<typeof synthesisFinalizeOutcomeSchema>>;
  failSynthesisPipeline(input: {
    organizationId: string;
    requestId: string;
    claimToken: string;
    runId: string;
    failureCode: string;
  }): Promise<z.infer<typeof synthesisFailOutcomeSchema>>;
};

function boundaryError(): DomainError {
  return new DomainError(
    "DOMAIN_ERROR",
    "Market Evidence must contain compact citations and claims only.",
  );
}

function persistenceError(
  operation:
    | "begin"
    | "record"
    | "complete"
    | "fail"
    | "append"
    | "completePipeline"
    | "completeSynthesis"
    | "failSynthesis",
): DomainError {
  const messages = {
    begin: "Market research could not be started.",
    record: "Market Evidence could not be recorded.",
    complete: "Market research could not be completed.",
    fail: "Market research could not be marked as failed.",
    append: "Market Evidence state could not be updated.",
    completePipeline: "Market research handoff could not be completed.",
    completeSynthesis: "Market synthesis could not be finalized.",
    failSynthesis: "Market synthesis could not be marked as failed.",
  } as const;
  return new DomainError("DOMAIN_ERROR", messages[operation]);
}

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "";
}

function claimLostError(): GrowthIntelligenceError {
  return new GrowthIntelligenceError(
    "RESEARCH_CLAIM_LOST",
    "The research lease is no longer current; no evidence was changed.",
  );
}

async function invoke(
  persistence: MarketEvidencePersistence,
  name: string,
  args: Record<string, unknown>,
  outputSchema: z.ZodType,
  operation:
    | "begin"
    | "record"
    | "complete"
    | "fail"
    | "append"
    | "completePipeline"
    | "completeSynthesis"
    | "failSynthesis",
): Promise<unknown> {
  let result: { data: unknown; error: unknown };
  try {
    result = await persistence.rpc(name, args);
  } catch (error: unknown) {
    // A lost lease (expiry or same-branch supersession, which cancels the
    // claimed request) must surface distinctly so the worker stops mutating
    // instead of retrying evidence writes under a dead claim token.
    if (errorMessage(error).includes("market_research_claim_lost")) throw claimLostError();
    throw persistenceError(operation);
  }
  if (result.error) {
    if (errorMessage(result.error).includes("market_research_claim_lost")) throw claimLostError();
    throw persistenceError(operation);
  }
  const parsed = outputSchema.safeParse(result.data);
  if (!parsed.success) throw persistenceError(operation);
  return parsed.data;
}

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw boundaryError();
  return parsed.data;
}

export function createMarketEvidenceRepository(
  persistence: MarketEvidencePersistence,
): MarketEvidenceRepository {
  return {
    async begin(input) {
      const metadata = parseOrThrow(metadataSchema, input.metadata);
      return (await invoke(
        persistence,
        "begin_market_research_run",
        {
          p_organization_id: parseOrThrow(identifierSchema, input.organizationId),
          p_request_id: parseOrThrow(identifierSchema, input.requestId),
          p_claim_token: parseOrThrow(identifierSchema, input.claimToken),
          p_metadata: metadata,
        },
        runOutcomeSchema,
        "begin",
      )) as z.infer<typeof runOutcomeSchema>;
    },

    async record(input) {
      const payload = parseOrThrow(marketEvidencePayloadSchema, input.payload);
      // Deterministic admission at the boundary: a claim may only cite
      // available sources. Unavailable, excluded or erased sources are kept
      // as retrieval lineage, but the link trigger would refuse them as
      // support — fail here with safe copy before any RPC crosses.
      const availabilityByKey = new Map(
        payload.sources.map((source) => [source.key, source.availability] as const),
      );
      for (const claim of payload.claims) {
        if (
          !claim.sourceKeys.every((sourceKey) => availabilityByKey.get(sourceKey) === "available")
        ) {
          throw boundaryError();
        }
      }
      return (await invoke(
        persistence,
        "record_market_evidence_claims",
        {
          p_organization_id: parseOrThrow(identifierSchema, input.organizationId),
          p_request_id: parseOrThrow(identifierSchema, input.requestId),
          p_claim_token: parseOrThrow(identifierSchema, input.claimToken),
          p_market_research_run_id: parseOrThrow(identifierSchema, input.runId),
          p_payload: payload,
        },
        recordOutcomeSchema,
        "record",
      )) as z.infer<typeof recordOutcomeSchema>;
    },

    async complete(input) {
      const result = parseOrThrow(resultSchema, input.result);
      return (await invoke(
        persistence,
        "complete_market_research_run",
        {
          p_organization_id: parseOrThrow(identifierSchema, input.organizationId),
          p_request_id: parseOrThrow(identifierSchema, input.requestId),
          p_claim_token: parseOrThrow(identifierSchema, input.claimToken),
          p_market_research_run_id: parseOrThrow(identifierSchema, input.runId),
          p_result: result,
        },
        runOutcomeSchema,
        "complete",
      )) as z.infer<typeof runOutcomeSchema>;
    },

    async fail(input) {
      const failure = parseOrThrow(failureSchema, input.failure);
      return (await invoke(
        persistence,
        "fail_market_research_run",
        {
          p_organization_id: parseOrThrow(identifierSchema, input.organizationId),
          p_request_id: parseOrThrow(identifierSchema, input.requestId),
          p_claim_token: parseOrThrow(identifierSchema, input.claimToken),
          p_market_research_run_id: parseOrThrow(identifierSchema, input.runId),
          p_failure: failure,
        },
        runOutcomeSchema,
        "fail",
      )) as z.infer<typeof runOutcomeSchema>;
    },

    async appendEvent(input) {
      const event = parseOrThrow(appendEventSchema, input.event);
      return (await invoke(
        persistence,
        "append_market_evidence_claim_event",
        {
          p_organization_id: parseOrThrow(identifierSchema, input.organizationId),
          p_request_id: parseOrThrow(identifierSchema, input.requestId),
          p_claim_token: parseOrThrow(identifierSchema, input.claimToken),
          p_event_type: input.eventType,
          p_event: event,
        },
        appendOutcomeSchema,
        "append",
      )) as z.infer<typeof appendOutcomeSchema>;
    },

    async completePipeline(input) {
      const result = parseOrThrow(resultSchema, input.result);
      const coverage = parseOrThrow(pipelineCoverageSchema, input.coverage);
      return (await invoke(
        persistence,
        "complete_market_research_pipeline",
        {
          p_organization_id: parseOrThrow(identifierSchema, input.organizationId),
          p_pipeline_id: parseOrThrow(identifierSchema, input.pipelineId),
          p_request_id: parseOrThrow(identifierSchema, input.requestId),
          p_claim_token: parseOrThrow(identifierSchema, input.claimToken),
          p_market_research_run_id: parseOrThrow(identifierSchema, input.runId),
          p_result: result,
          p_coverage: coverage,
        },
        pipelineHandoffSchema,
        "completePipeline",
      )) as z.infer<typeof pipelineHandoffSchema>;
    },

    async completeSynthesisPipeline(input) {
      const result = parseOrThrow(synthesisFinalizeResultSchema, input.result);
      return (await invoke(
        persistence,
        "complete_market_synthesis_pipeline",
        {
          p_organization_id: parseOrThrow(identifierSchema, input.organizationId),
          p_request_id: parseOrThrow(identifierSchema, input.requestId),
          p_claim_token: parseOrThrow(identifierSchema, input.claimToken),
          p_synthesis_run_id: parseOrThrow(identifierSchema, input.runId),
          p_result: result,
        },
        synthesisFinalizeOutcomeSchema,
        "completeSynthesis",
      )) as z.infer<typeof synthesisFinalizeOutcomeSchema>;
    },

    async failSynthesisPipeline(input) {
      const failureCode = parseOrThrow(safeCodeSchema, input.failureCode);
      return (await invoke(
        persistence,
        "fail_market_synthesis_pipeline",
        {
          p_organization_id: parseOrThrow(identifierSchema, input.organizationId),
          p_request_id: parseOrThrow(identifierSchema, input.requestId),
          p_claim_token: parseOrThrow(identifierSchema, input.claimToken),
          p_synthesis_run_id: parseOrThrow(identifierSchema, input.runId),
          p_safe_failure_code: failureCode,
        },
        synthesisFailOutcomeSchema,
        "failSynthesis",
      )) as z.infer<typeof synthesisFailOutcomeSchema>;
    },
  };
}
