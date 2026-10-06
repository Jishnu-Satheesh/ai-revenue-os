import { z } from "zod";
import {
  agentTurnEventTypeSchema,
  type AgentTurnEventType,
} from "@/domain/agent-router/turn-events";
export {
  agentTurnEventTypeSchema,
  type AgentTurnEventType,
} from "@/domain/agent-router/turn-events";

import { DomainError } from "@/lib/errors";

export const agentTurnObjectiveSchema = z.enum([
  "business_advice",
  "channel_assessment",
  "report_intake",
  "research",
  "other",
]);
export type AgentTurnObjective = z.infer<typeof agentTurnObjectiveSchema>;

export const agentTurnStatusSchema = z.enum([
  "queued",
  "running",
  "awaiting_user",
  "awaiting_approval",
  "completed",
  "failed",
  "cancelled",
]);
export type AgentTurnStatus = z.infer<typeof agentTurnStatusSchema>;

const uuid = z.string().uuid();
const keyed = z.string().trim().min(16).max(200);

const startInput = z
  .object({
    organizationId: uuid,
    actorId: uuid,
    threadId: uuid,
    userMessageId: uuid,
    idempotencyKey: keyed,
    objective: agentTurnObjectiveSchema,
  })
  .strict();

const answerInput = z
  .object({
    organizationId: uuid,
    actorId: uuid,
    turnId: uuid,
    challengeId: uuid,
    idempotencyKey: keyed,
    answers: z.record(z.string(), z.unknown()),
  })
  .strict();

const workerKey = z
  .object({
    organizationId: uuid,
    turnId: uuid,
    leaseToken: uuid,
  })
  .strict();
const workerTurn = workerKey.omit({ leaseToken: true });
const claimReceipt = z
  .object({
    turnId: uuid,
    status: z.literal("running"),
    leaseToken: uuid,
    attempt: z.number().int().positive().max(20),
  })
  .passthrough();
const heartbeatReceipt = z
  .object({
    turnId: uuid,
    status: z.literal("running"),
    leaseExpiresAt: z.string().datetime({ offset: true }),
  })
  .passthrough();
const actorRoleReceipt = z
  .object({
    turnId: uuid,
    actorId: uuid,
    role: z.enum(["viewer", "operator", "admin", "owner"]),
  })
  .passthrough();
const eventReceipt = z
  .object({
    eventId: uuid,
    seq: z.number().int().positive(),
    replayed: z.boolean(),
  })
  .passthrough();
const challengeReceipt = z
  .object({
    turnId: uuid,
    status: z.literal("awaiting_user"),
    challengeId: uuid,
  })
  .passthrough();
const approvalReceipt = z
  .object({
    turnId: uuid,
    status: z.literal("awaiting_approval"),
    packageId: uuid,
  })
  .passthrough();
const completedReceipt = z
  .object({
    turnId: uuid,
    status: z.literal("completed"),
    messageId: uuid,
    replayed: z.boolean(),
  })
  .passthrough();
const challengeField = z
  .object({
    key: z.string().regex(/^[a-z][A-Za-z0-9_]{0,60}$/),
    label: z.string().trim().min(1).max(120),
    kind: z.enum(["text", "date", "single_select", "multi_select", "confirm"]),
    required: z.boolean(),
    options: z
      .array(
        z
          .object({
            value: z.string().trim().min(1).max(120),
            label: z.string().trim().min(1).max(120),
          })
          .strict(),
      )
      .min(1)
      .max(12)
      .optional(),
    helpText: z.string().trim().max(280).optional(),
  })
  .strict();
export type AgentTurnChallengeField = z.infer<typeof challengeField>;

const rpcReceipt = z
  .object({
    turnId: uuid,
    status: agentTurnStatusSchema,
    replayed: z.boolean(),
  })
  .passthrough();

const challengeSchema = z
  .object({
    id: uuid,
    kind: z.string().min(1).max(60),
    fields: z.array(z.unknown()).max(20),
  })
  .passthrough();
const pendingApprovalSchema = z
  .object({
    kind: z.enum(["report_contract", "report_projection", "report_admission", "report_correction"]),
    packageId: uuid,
  })
  .strict();

const turnRow = z
  .object({
    id: uuid,
    organization_id: uuid,
    thread_id: uuid,
    user_message_id: uuid,
    requested_by: uuid,
    objective: agentTurnObjectiveSchema,
    status: agentTurnStatusSchema,
    pending_challenge: challengeSchema.nullable(),
    pending_approval: pendingApprovalSchema.nullable(),
    challenge_answers: z.record(z.string(), z.unknown()).nullable(),
    answered_challenge_kind: z.enum(["metadata", "correction", "scope"]).nullable(),
    final_message_id: uuid.nullable(),
    failure_code: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .passthrough();

const eventRow = z
  .object({
    id: uuid,
    turn_id: uuid,
    seq: z.number().int().positive(),
    event_type: agentTurnEventTypeSchema,
    payload: z.record(z.string(), z.unknown()),
    occurred_at: z.string(),
  })
  .passthrough();

const attachmentRow = z
  .object({
    id: uuid,
    turn_id: uuid,
    status: z.string(),
    file_name: z.string(),
    media_type: z.string(),
    byte_size: z.number().int().nonnegative(),
    sha256_digest: z.string().nullable(),
    package_id: uuid.nullable(),
    upload_expires_at: z.string(),
  })
  .passthrough();

export type AgentTurnView = {
  id: string;
  threadId: string;
  userMessageId: string;
  requestedBy: string;
  objective: AgentTurnObjective;
  status: AgentTurnStatus;
  pendingChallenge: z.infer<typeof challengeSchema> | null;
  pendingApproval: z.infer<typeof pendingApprovalSchema> | null;
  challengeAnswers: Record<string, unknown> | null;
  answeredChallengeKind: "metadata" | "correction" | "scope" | null;
  finalMessageId: string | null;
  failureCode: string | null;
  createdAt: string;
  updatedAt: string;
};
export type AgentTurnEvent = {
  id: string;
  turnId: string;
  seq: number;
  type: AgentTurnEventType;
  payload: Record<string, unknown>;
  occurredAt: string;
};
export type AgentAttachmentView = {
  id: string;
  turnId: string;
  status: string;
  fileName: string;
  mediaType: string;
  byteSize: number;
  sha256Digest: string | null;
  packageId: string | null;
  expiresAt: string;
};

type Query = PromiseLike<{ data: unknown; error: unknown }> & {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  gt(column: string, value: number): Query;
  order(column: string, options?: { ascending?: boolean }): Query;
  limit(count: number): Query;
};

export type AgentTurnPersistence = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  from?: (table: string) => Query;
};

function throwRead(error: unknown): never {
  if (error) throw new DomainError("DOMAIN_ERROR", "This agent turn could not be loaded.");
  throw new DomainError("DOMAIN_ERROR", "This agent turn is invalid.");
}

function mutationError(error: unknown): never {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" &&
          error !== null &&
          "message" in error &&
          typeof error.message === "string"
        ? error.message
        : String(error);
  const reasonCode = message.match(
    /\bagent_(?:turn|challenge|attachment|approval|event)_[a-z_]+\b/,
  )?.[0];
  const details = reasonCode ? { reasonCode } : undefined;
  if (message.includes("forbidden") || message.includes("revoked")) {
    throw new DomainError("AUTHORIZATION_ERROR", "You cannot change this agent turn.", details);
  }
  if (message.includes("not_found")) {
    throw new DomainError("TENANT_SCOPE_ERROR", "This agent turn was not found.", details);
  }
  if (
    message.includes("conflict") ||
    message.includes("stale") ||
    message.includes("attempts_exhausted")
  ) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "This agent turn changed. Refresh it and try again.",
      details,
    );
  }
  throw new DomainError("DOMAIN_ERROR", "This agent turn could not be saved.", details);
}

async function callParsed<S extends z.ZodTypeAny>(
  persistence: AgentTurnPersistence,
  name: string,
  args: Record<string, unknown>,
  schema: S,
): Promise<z.output<S>> {
  const result = await persistence.rpc(name, args);
  if (result.error) mutationError(result.error);
  const parsed = schema.safeParse(result.data);
  if (!parsed.success) mutationError("invalid_response");
  return parsed.data;
}

function callReceipt(
  persistence: AgentTurnPersistence,
  name: string,
  args: Record<string, unknown>,
) {
  return callParsed(persistence, name, args, rpcReceipt);
}

function reader(persistence: AgentTurnPersistence) {
  if (!persistence.from) throwRead(null);
  return persistence.from;
}

function mapTurn(row: z.infer<typeof turnRow>): AgentTurnView {
  return {
    id: row.id,
    threadId: row.thread_id,
    userMessageId: row.user_message_id,
    requestedBy: row.requested_by,
    objective: row.objective,
    status: row.status,
    pendingChallenge: row.pending_challenge,
    pendingApproval: row.pending_approval,
    challengeAnswers: row.challenge_answers,
    answeredChallengeKind: row.answered_challenge_kind,
    finalMessageId: row.final_message_id,
    failureCode: row.failure_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEvent(row: z.infer<typeof eventRow>): AgentTurnEvent {
  return {
    id: row.id,
    turnId: row.turn_id,
    seq: row.seq,
    type: row.event_type,
    payload: row.payload,
    occurredAt: row.occurred_at,
  };
}

export function createAgentTurnRepository(persistence: AgentTurnPersistence) {
  return {
    async claim(input: z.input<typeof workerKey>) {
      const value = workerKey.parse(input);
      return callParsed(
        persistence,
        "claim_agent_turn",
        {
          p_organization_id: value.organizationId,
          p_turn_id: value.turnId,
          p_lease_token: value.leaseToken,
        },
        claimReceipt,
      );
    },

    async heartbeat(input: z.input<typeof workerKey>) {
      const value = workerKey.parse(input);
      return callParsed(
        persistence,
        "heartbeat_agent_turn",
        {
          p_organization_id: value.organizationId,
          p_turn_id: value.turnId,
          p_lease_token: value.leaseToken,
        },
        heartbeatReceipt,
      );
    },

    async getActorRole(input: z.input<typeof workerKey>) {
      const value = workerKey.parse(input);
      return callParsed(
        persistence,
        "get_agent_turn_actor_role",
        {
          p_organization_id: value.organizationId,
          p_turn_id: value.turnId,
          p_lease_token: value.leaseToken,
        },
        actorRoleReceipt,
      );
    },

    async appendEvent(
      input: z.input<typeof workerKey> & {
        eventKey: string;
        eventType: z.input<typeof agentTurnEventTypeSchema>;
        payload: Record<string, unknown>;
      },
    ) {
      const value = workerKey
        .extend({
          eventKey: z.string().trim().min(1).max(200),
          eventType: agentTurnEventTypeSchema,
          payload: z.record(z.string(), z.unknown()),
        })
        .strict()
        .parse(input);
      return callParsed(
        persistence,
        "append_agent_turn_event",
        {
          p_organization_id: value.organizationId,
          p_turn_id: value.turnId,
          p_lease_token: value.leaseToken,
          p_event_key: value.eventKey,
          p_event_type: value.eventType,
          p_payload: value.payload,
        },
        eventReceipt,
      );
    },

    async setChallenge(
      input: z.input<typeof workerKey> & {
        kind: "metadata" | "correction" | "scope";
        fields: AgentTurnChallengeField[];
      },
    ) {
      const value = workerKey
        .extend({
          kind: z.enum(["metadata", "correction", "scope"]),
          fields: z.array(challengeField).min(1).max(8),
        })
        .strict()
        .parse(input);
      return callParsed(
        persistence,
        "set_agent_turn_challenge",
        {
          p_organization_id: value.organizationId,
          p_turn_id: value.turnId,
          p_lease_token: value.leaseToken,
          p_kind: value.kind,
          p_fields: value.fields,
        },
        challengeReceipt,
      );
    },

    async setApproval(
      input: z.input<typeof workerKey> & {
        kind: "report_contract" | "report_projection" | "report_admission" | "report_correction";
        packageId: string;
      },
    ) {
      const value = workerKey
        .extend({
          kind: z.enum([
            "report_contract",
            "report_projection",
            "report_admission",
            "report_correction",
          ]),
          packageId: uuid,
        })
        .strict()
        .parse(input);
      return callParsed(
        persistence,
        "set_agent_turn_approval",
        {
          p_organization_id: value.organizationId,
          p_turn_id: value.turnId,
          p_lease_token: value.leaseToken,
          p_kind: value.kind,
          p_package_id: value.packageId,
        },
        approvalReceipt,
      );
    },

    async resumeApproval(input: z.input<typeof workerTurn> & { packageId: string }) {
      const value = workerTurn.extend({ packageId: uuid }).strict().parse(input);
      return callReceipt(persistence, "resume_agent_turn_approval", {
        p_organization_id: value.organizationId,
        p_turn_id: value.turnId,
        p_package_id: value.packageId,
      });
    },

    async complete(input: z.input<typeof workerKey> & { answerBody: string }) {
      const value = workerKey
        .extend({ answerBody: z.string().trim().min(1).max(20000) })
        .strict()
        .parse(input);
      return callParsed(
        persistence,
        "complete_agent_turn",
        {
          p_organization_id: value.organizationId,
          p_turn_id: value.turnId,
          p_lease_token: value.leaseToken,
          p_answer_body: value.answerBody,
        },
        completedReceipt,
      );
    },

    async fail(input: z.input<typeof workerKey> & { failureCode: string }) {
      const value = workerKey
        .extend({ failureCode: z.string().regex(/^[A-Z_]{3,60}$/) })
        .strict()
        .parse(input);
      return callReceipt(persistence, "fail_agent_turn", {
        p_organization_id: value.organizationId,
        p_turn_id: value.turnId,
        p_lease_token: value.leaseToken,
        p_failure_code: value.failureCode,
      });
    },
    async releaseForRetry(input: z.input<typeof workerKey>) {
      const value = workerKey.parse(input);
      return callReceipt(persistence, "release_agent_turn_for_retry", {
        p_organization_id: value.organizationId,
        p_turn_id: value.turnId,
        p_lease_token: value.leaseToken,
      });
    },
    async cancelRevoked(input: z.input<typeof workerTurn>) {
      const value = workerTurn.parse(input);
      return callReceipt(persistence, "cancel_revoked_agent_turn", {
        p_organization_id: value.organizationId,
        p_turn_id: value.turnId,
      });
    },
    async failExhausted(input: z.input<typeof workerTurn>) {
      const value = workerTurn.parse(input);
      return callReceipt(persistence, "fail_exhausted_agent_turn", {
        p_organization_id: value.organizationId,
        p_turn_id: value.turnId,
      });
    },
    async start(input: z.input<typeof startInput>) {
      const value = startInput.parse(input);
      return callReceipt(persistence, "create_agent_turn", {
        p_organization_id: value.organizationId,
        p_actor_id: value.actorId,
        p_thread_id: value.threadId,
        p_user_message_id: value.userMessageId,
        p_idempotency_key: value.idempotencyKey,
        p_objective: value.objective,
      });
    },

    async answerChallenge(input: z.input<typeof answerInput>) {
      const value = answerInput.parse(input);
      return callReceipt(persistence, "answer_agent_turn_challenge", {
        p_organization_id: value.organizationId,
        p_actor_id: value.actorId,
        p_turn_id: value.turnId,
        p_challenge_id: value.challengeId,
        p_idempotency_key: value.idempotencyKey,
        p_answers: value.answers,
      });
    },

    async getTurn(
      organizationId: string,
      threadId: string,
      turnId: string,
    ): Promise<AgentTurnView | null> {
      const from = reader(persistence);
      const result = await from("agent_turns")
        .select(
          "id,organization_id,thread_id,user_message_id,requested_by,objective,status,pending_challenge,pending_approval,challenge_answers,answered_challenge_kind,final_message_id,failure_code,created_at,updated_at",
        )
        .eq("organization_id", uuid.parse(organizationId))
        .eq("thread_id", uuid.parse(threadId))
        .eq("id", uuid.parse(turnId))
        .limit(1);
      if (result.error) throwRead(result.error);
      if (!Array.isArray(result.data)) throwRead(null);
      if (result.data.length === 0) return null;
      const parsed = turnRow.safeParse(result.data[0]);
      if (!parsed.success) throwRead(null);
      return mapTurn(parsed.data);
    },

    async getTurnByMessage(
      organizationId: string,
      threadId: string,
      userMessageId: string,
    ): Promise<AgentTurnView | null> {
      const result = await reader(persistence)("agent_turns")
        .select(
          "id,organization_id,thread_id,user_message_id,requested_by,objective,status,pending_challenge,pending_approval,challenge_answers,answered_challenge_kind,final_message_id,failure_code,created_at,updated_at",
        )
        .eq("organization_id", uuid.parse(organizationId))
        .eq("thread_id", uuid.parse(threadId))
        .eq("user_message_id", uuid.parse(userMessageId))
        .limit(1);
      if (result.error || !Array.isArray(result.data)) throwRead(result.error);
      if (result.data.length === 0) return null;
      const parsed = turnRow.safeParse(result.data[0]);
      if (!parsed.success) throwRead(null);
      return mapTurn(parsed.data);
    },

    /**
     * Recent turns for one thread, newest first, so reopening restores
     * pending questions, attachments, and the final answer. Pinned to the
     * caller's organization; RLS owns isolation underneath.
     */
    async listTurns(
      organizationId: string,
      threadId: string,
      limit = 20,
    ): Promise<AgentTurnView[]> {
      const from = reader(persistence);
      const result = await from("agent_turns")
        .select(
          "id,organization_id,thread_id,user_message_id,requested_by,objective,status,pending_challenge,pending_approval,challenge_answers,answered_challenge_kind,final_message_id,failure_code,created_at,updated_at",
        )
        .eq("organization_id", uuid.parse(organizationId))
        .eq("thread_id", uuid.parse(threadId))
        .order("created_at", { ascending: false })
        .limit(z.number().int().min(1).max(50).parse(limit));
      if (result.error || !Array.isArray(result.data)) throwRead(result.error);
      return result.data.map((item) => {
        const parsed = turnRow.safeParse(item);
        if (!parsed.success) throwRead(null);
        return mapTurn(parsed.data);
      });
    },

    /** One turn by id, pinned to the caller's organization. Null when foreign. */
    async getTurnById(organizationId: string, turnId: string): Promise<AgentTurnView | null> {
      const from = reader(persistence);
      const result = await from("agent_turns")
        .select(
          "id,organization_id,thread_id,user_message_id,requested_by,objective,status,pending_challenge,pending_approval,challenge_answers,answered_challenge_kind,final_message_id,failure_code,created_at,updated_at",
        )
        .eq("organization_id", uuid.parse(organizationId))
        .eq("id", uuid.parse(turnId))
        .limit(1);
      if (result.error) throwRead(result.error);
      if (!Array.isArray(result.data)) throwRead(null);
      if (result.data.length === 0) return null;
      const parsed = turnRow.safeParse(result.data[0]);
      if (!parsed.success) throwRead(null);
      return mapTurn(parsed.data);
    },

    async listEvents(
      organizationId: string,
      turnId: string,
      afterSeq = 0,
    ): Promise<AgentTurnEvent[]> {
      const from = reader(persistence);
      const result = await from("agent_turn_events")
        .select("id,turn_id,seq,event_type,payload,occurred_at")
        .eq("organization_id", uuid.parse(organizationId))
        .eq("turn_id", uuid.parse(turnId))
        .gt("seq", z.number().int().min(0).parse(afterSeq))
        .order("seq", { ascending: true })
        .limit(100);
      if (result.error || !Array.isArray(result.data)) throwRead(result.error);
      return result.data.map((item) => {
        const parsed = eventRow.safeParse(item);
        if (!parsed.success) throwRead(null);
        return mapEvent(parsed.data);
      });
    },

    async listAttachments(organizationId: string, turnId: string): Promise<AgentAttachmentView[]> {
      const from = reader(persistence);
      const result = await from("agent_attachments")
        .select(
          "id,turn_id,status,file_name,media_type,byte_size,sha256_digest,package_id,upload_expires_at",
        )
        .eq("organization_id", uuid.parse(organizationId))
        .eq("turn_id", uuid.parse(turnId))
        .order("created_at", { ascending: true })
        .limit(1);
      if (result.error || !Array.isArray(result.data)) throwRead(result.error);
      return result.data.map((item) => {
        const parsed = attachmentRow.safeParse(item);
        if (!parsed.success) throwRead(null);
        return {
          id: parsed.data.id,
          turnId: parsed.data.turn_id,
          status: parsed.data.status,
          fileName: parsed.data.file_name,
          mediaType: parsed.data.media_type,
          byteSize: parsed.data.byte_size,
          sha256Digest: parsed.data.sha256_digest,
          packageId: parsed.data.package_id,
          expiresAt: parsed.data.upload_expires_at,
        };
      });
    },
  };
}
