import { z } from "zod";
import { agentIntentSchema } from "@/domain/agent-router/intents";
import { questionnaireSpecSchema } from "@/domain/agent-router/contracts";

export const QUESTIONNAIRE_STATE_PREFIX = "[agent questionnaire v1]\n";
export const QUESTIONNAIRE_STATE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Prior validated watch inputs only. Consent is always requested again. */
export const watchContinuationAnswersSchema = z.object({
  frequency: z.enum(["daily", "weekly", "monthly"]).optional(),
  branch: z.string().trim().min(1).max(200).optional(),
  research_area: z.string().trim().min(1).max(160).optional(),
  competitors: z.string().trim().min(1).max(200).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  question: z.string().trim().min(1).max(2000).optional(),
}).strict();
const questionnairePayloadBaseSchema = z.object({
  organizationId: z.string().min(1).max(200),
  threadId: z.string().min(1).max(200),
  sourceMessageId: z.string().min(1).max(200),
  intent: agentIntentSchema,
  issuedAt: z.string().datetime({ offset: true }),
  spec: questionnaireSpecSchema,
  continuationAnswers: watchContinuationAnswersSchema.optional(),
  answerReceipt: z.object({
    messageId: z.string().min(1).max(200),
    bodyDigest: z.string().regex(/^[a-f0-9]{16}$/),
  }).strict().optional(),
}).strict();
function constrainWatchCarry(payload: z.infer<typeof questionnairePayloadBaseSchema>, ctx: z.RefinementCtx) {
  if (payload.continuationAnswers !== undefined && payload.intent !== "watch") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["continuationAnswers"],
      message: "Only watch scope cards can retain validated watch inputs." });
  }
}
export const questionnairePayloadSchema = questionnairePayloadBaseSchema.superRefine(constrainWatchCarry);
export const questionnaireStateSchema = questionnairePayloadBaseSchema.extend({
  signature: z.string().regex(/^[a-f0-9]{64}$/),
}).strict().superRefine(constrainWatchCarry);
export type QuestionnairePayload = z.infer<typeof questionnairePayloadSchema>;
export type QuestionnaireState = z.infer<typeof questionnaireStateSchema>;

/** A returned card names its exact question, even when its evidence digest is unchanged. */
export function bindQuestionnaireToMessage(spec: unknown, messageId: string) {
  const parsed = questionnaireSpecSchema.parse(spec);
  const source = z.string().regex(/^[a-z0-9_-]{1,80}$/).parse(messageId);
  const suffix = `:message:${source}`;
  return questionnaireSpecSchema.parse({
    ...parsed,
    resumeKey: `${parsed.resumeKey.slice(0, 160 - suffix.length)}${suffix}`,
  });
}

export function encodeQuestionnaireState(state: QuestionnaireState): string {
  const body = QUESTIONNAIRE_STATE_PREFIX + JSON.stringify(questionnaireStateSchema.parse(state));
  if (body.length > 20000) throw new Error("Questionnaire exceeds the message boundary.");
  return body;
}
export function parseQuestionnaireState(body: string | null): QuestionnaireState | null {
  if (!body?.startsWith(QUESTIONNAIRE_STATE_PREFIX) || body.length > 20000) return null;
  try {
    const parsed = questionnaireStateSchema.safeParse(JSON.parse(body.slice(QUESTIONNAIRE_STATE_PREFIX.length)));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

/** Rendering only. Mutations separately verify the server signature. */
export function pendingQuestionnaireFromMessages(messages: readonly {
  id: string; role: string; body: string | null;
}[]): QuestionnaireState | null {
  let latestUserId: string | null = null;
  let pending: QuestionnaireState | null = null;
  for (const message of messages) {
    if (message.role === "user") {
      latestUserId = message.id;
      pending = null;
    } else if (message.role === "system_note") {
      const saved = parseQuestionnaireState(message.body);
      if (saved && !saved.answerReceipt && saved.sourceMessageId === latestUserId) pending = saved;
    }
  }
  return pending;
}
