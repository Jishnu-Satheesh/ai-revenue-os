import { z } from "zod";

import type { QuestionnaireSpec } from "@/domain/agent-router/contracts";
import type {
  AgentAttachmentView,
  AgentTurnEvent,
  AgentTurnView,
} from "@/modules/agent-chat/infrastructure/turn-repository";
import { agentTurnEventTypeSchema } from "@/domain/agent-router/turn-events";

const uuid = z.string().uuid();
const field = z.object({
  key: z.string().regex(/^[a-z][A-Za-z0-9_]{0,60}$/),
  label: z.string().trim().min(1).max(120),
  kind: z.enum(["text", "date", "single_select", "multi_select", "confirm"]),
  required: z.boolean(),
  options: z
    .array(z.object({ value: z.string().min(1).max(120), label: z.string().min(1).max(120) }))
    .max(12)
    .optional(),
  helpText: z.string().max(280).optional(),
});

const turn = z
  .object({
    id: uuid,
    threadId: uuid,
    userMessageId: uuid,
    requestedBy: uuid,
    objective: z.enum([
      "business_advice",
      "channel_assessment",
      "report_intake",
      "research",
      "other",
    ]),
    status: z.enum([
      "queued",
      "running",
      "awaiting_user",
      "awaiting_approval",
      "completed",
      "failed",
      "cancelled",
    ]),
    pendingChallenge: z
      .object({ id: uuid, kind: z.string(), fields: z.array(field).min(1).max(8) })
      .nullable(),
    pendingApproval: z
      .object({
        kind: z.enum([
          "report_contract",
          "report_projection",
          "report_admission",
          "report_correction",
        ]),
        packageId: uuid,
      })
      .nullable()
      .optional(),
    finalMessageId: uuid.nullable(),
    failureCode: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .passthrough();
const event = z.object({
  id: uuid,
  turnId: uuid,
  seq: z.number().int().positive(),
  type: agentTurnEventTypeSchema,
  payload: z.record(z.string(), z.unknown()),
  occurredAt: z.string(),
});
const attachment = z.object({
  id: uuid,
  turnId: uuid,
  status: z.string(),
  fileName: z.string(),
  mediaType: z.string(),
  byteSize: z.number().int().nonnegative(),
  sha256Digest: z.string().nullable(),
  packageId: uuid.nullable(),
  expiresAt: z.string(),
});

export type AgentTurnBundle = {
  turn: AgentTurnView;
  events: AgentTurnEvent[];
  attachments: AgentAttachmentView[];
};

export const governedStartSchema = z.discriminatedUnion("handled", [
  z.object({ handled: z.literal(false) }).passthrough(),
  z
    .object({
      handled: z.literal(true),
      turn,
      thread: z.object({
        id: uuid,
        organizationId: uuid,
        title: z.string(),
        mode: z.enum(["quick", "deepthink"]),
        status: z.enum(["open", "awaiting_user", "running", "completed", "cancelled"]),
        linkedResearchProjectId: uuid.nullable(),
        linkedRequestId: uuid.nullable(),
        linkedDraftRequestId: uuid.nullable(),
        linkedCampaignId: uuid.nullable(),
        createdAt: z.string(),
        updatedAt: z.string(),
      }),
    })
    .passthrough(),
]);

export function parseAgentTurnBundles(value: unknown): AgentTurnBundle[] {
  const parsed = z
    .object({
      turns: z
        .array(z.object({ turn, events: z.array(event), attachments: z.array(attachment) }))
        .max(50),
    })
    .parse(value);
  return parsed.turns.map((bundle) => ({ ...bundle, turn: bundle.turn as AgentTurnView }));
}

/** Keep already-seen actions through an older response; sequence owns order. */
export function mergeAgentTurnBundles(
  previous: readonly AgentTurnBundle[],
  incoming: readonly AgentTurnBundle[],
): AgentTurnBundle[] {
  const merged = new Map(previous.map((bundle) => [bundle.turn.id, bundle]));
  for (const bundle of incoming) {
    const prior = merged.get(bundle.turn.id);
    const events = new Map((prior?.events ?? []).map((item) => [item.id, item]));
    for (const item of bundle.events) events.set(item.id, item);
    const current = prior && prior.turn.updatedAt > bundle.turn.updatedAt ? prior : bundle;
    merged.set(bundle.turn.id, {
      ...current,
      events: [...events.values()].sort((a, b) => a.seq - b.seq),
    });
  }
  return [...merged.values()].sort((a, b) => a.turn.createdAt.localeCompare(b.turn.createdAt));
}

export function agentTurnIsTerminal(value: Pick<AgentTurnView, "status">): boolean {
  return ["completed", "failed", "cancelled"].includes(value.status);
}

/** A local presentation spec; only the challenge id and answers are sent. */
export function questionnaireForAgentTurn(value: AgentTurnView): QuestionnaireSpec | null {
  if (!value.pendingChallenge || value.status !== "awaiting_user") return null;
  const parsed = z.array(field).min(1).max(8).safeParse(value.pendingChallenge.fields);
  if (!parsed.success) return null;
  return {
    kind: "missing_fields",
    resumeKey: `turn:${value.pendingChallenge.id}`,
    title:
      value.pendingChallenge.kind === "correction"
        ? "Confirm this report correction"
        : "A few details to continue",
    items: parsed.data,
  };
}
