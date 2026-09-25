import { z } from "zod";

/**
 * Agent router intents (spec section 8).
 *
 * Five intents, platform-core and industry-neutral. The model only proposes;
 * the deterministic mapping below (intent to executor lane and to the
 * permission it requires) is what actually gates, never prompt text.
 */
export const agentIntentSchema = z.enum([
  "answer_memory",
  "research_once",
  "watch",
  "campaign_advice",
  "profile_scope_change",
]);
export type AgentIntent = z.infer<typeof agentIntentSchema>;

export const routerConfidenceSchema = z.enum(["high", "medium", "low"]);
export type RouterConfidence = z.infer<typeof routerConfidenceSchema>;

/** Closed missing-field vocabulary (spec section 8). Capped at 3 per route. */
export const missingFieldSchema = z.enum([
  "frequency",
  "branch",
  "research_area",
  "competitors",
  "end_date",
  "evidence_window",
]);
export type MissingField = z.infer<typeof missingFieldSchema>;

export const MAX_MISSING_FIELDS = 3;

/**
 * Message text cap. Deliberately identical to the Task 1 `agent_messages`
 * body cap (1-20000 chars): the router accepts exactly what the thread
 * store can persist, so a routed message can never be un-storable.
 */
export const ROUTER_MESSAGE_MAX_CHARS = 20_000;

/**
 * Deterministic intent to executor-lane mapping. Task 3+ dispatches on
 * this, never on prompt wording. The router itself never executes.
 */
export const INTENT_EXECUTOR = {
  answer_memory: "memory_answer",
  research_once: "research_lane",
  watch: "watch_lane",
  campaign_advice: "campaign_lane",
  profile_scope_change: "profile_lane",
} as const satisfies Record<AgentIntent, string>;
export type IntentExecutor = (typeof INTENT_EXECUTOR)[AgentIntent];

/**
 * Deterministic permission gate per intent. `answer_memory` is open to any
 * org member (viewer read-only answers, no actions). Everything else needs
 * a manage/create grant; without it the service falls back to
 * `answer_memory` with a safe reason code.
 */
export const INTENT_REQUIRED_PERMISSION = {
  research_once: "growth_intelligence.manage",
  watch: "growth_intelligence.manage",
  campaign_advice: "campaign.create",
  profile_scope_change: "growth_intelligence.manage",
} as const satisfies Record<Exclude<AgentIntent, "answer_memory">, string>;

/** Safe reason code emitted when the gate above denies an intent. */
export const INTENT_DENIED_REASON = {
  research_once: "RESEARCH_REQUIRES_MANAGE",
  watch: "WATCH_REQUIRES_MANAGE",
  campaign_advice: "CAMPAIGN_REQUIRES_CREATE",
  profile_scope_change: "PROFILE_REQUIRES_MANAGE",
} as const satisfies Record<Exclude<AgentIntent, "answer_memory">, string>;
