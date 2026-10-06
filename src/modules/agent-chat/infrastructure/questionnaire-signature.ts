import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { DomainError } from "@/lib/errors";
import {
  questionnairePayloadSchema,
  questionnaireStateSchema,
  QUESTIONNAIRE_STATE_MAX_AGE_MS,
  type QuestionnairePayload,
  type QuestionnaireState,
} from "@/modules/agent-chat/application/questionnaire-state";

function signature(payload: QuestionnairePayload, secret: string): string {
  return createHmac("sha256", secret)
    .update("lunes:agent-questionnaire:v1\0")
    .update(JSON.stringify(questionnairePayloadSchema.parse(payload)))
    .digest("hex");
}
export function signQuestionnaire(payload: QuestionnairePayload): QuestionnaireState {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!secret) throw new DomainError("INTEGRATION_ERROR", "This action card is temporarily unavailable.");
  const parsed = questionnairePayloadSchema.parse(payload);
  return { ...parsed, signature: signature(parsed, secret) };
}
export function verifyQuestionnaire(
  state: unknown, organizationId: string, threadId: string, now: Date = new Date(),
): state is QuestionnaireState {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const parsed = questionnaireStateSchema.safeParse(state);
  if (!secret || !parsed.success) return false;
  if (parsed.data.organizationId !== organizationId || parsed.data.threadId !== threadId) return false;
  const age = now.getTime() - Date.parse(parsed.data.issuedAt);
  if (!Number.isFinite(age) || age < 0 || age >= QUESTIONNAIRE_STATE_MAX_AGE_MS) return false;
  const { signature: provided, ...payload } = parsed.data;
  return timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(signature(payload, secret), "hex"));
}
