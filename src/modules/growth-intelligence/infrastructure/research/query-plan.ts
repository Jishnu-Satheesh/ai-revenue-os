import { z } from "zod";

import {
  approvedResearchScopeSchema,
  researchRequestSchema,
  type ApprovedResearchScope,
} from "@/modules/growth-intelligence/infrastructure/research/ports";
import { RESEARCH_BUDGET_LIMITS } from "@/domain/growth-intelligence/research-pipeline";
export { approvedResearchScopeSchema } from "@/modules/growth-intelligence/infrastructure/research/ports";

export type ResearchQueryKind = "official_identity" | "market_context" | "topic_monitoring";

/**
 * One planned search slot with complete input coverage: exactly one
 * `local_market` slot, one `topic` slot per approved topic, and one
 * `competitor` slot per competitor lead. Every slot carries the coverage
 * manifest key the retrieval result must report against.
 */
export type ResearchQuerySlot = {
  slotKey: string;
  kind: "local_market" | "topic" | "competitor";
  text: string;
  maxResults: number;
};

export type ResearchQuery = {
  kind: ResearchQueryKind;
  text: string;
  maxResults: number;
};

const queryPlanInputSchema = researchRequestSchema.pick({
  scope: true,
  maxQueries: true,
  maxResultsPerQuery: true,
});

const querySlotsInputSchema = z.object({
  scope: approvedResearchScopeSchema,
  maxResultsPerQuery: z.number().int().min(1).max(10),
});

const QUERY_OPERATOR = /\b(?:site|inurl|filetype|cache|related|link)\s*:/gi;
const PROMPT_INJECTION =
  /\b(?:ignore|disregard|forget|override)\b[\s\S]{0,80}\b(?:instruction|instructions|previous|system)\b/gi;

function safePhrase(value: string): string {
  const clean = value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(PROMPT_INJECTION, " ")
    .replace(QUERY_OPERATOR, " ")
    .replace(/[^\p{L}\p{N}\s&'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  return clean.slice(0, 160);
}

function quote(value: string): string {
  return `"${safePhrase(value).replace(/"/g, "")}"`;
}

function slotKeySegment(value: string): string {
  const segment = safePhrase(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return segment.length > 0 ? segment : "input";
}

/**
 * Deterministic full-coverage plan: one business/local-market slot, then one
 * slot per topic in scope order, then one slot per competitor lead in scope
 * order. Competitor website and location hint are query context only. The
 * schema caps (20 topics, 5 leads) keep the plan at or under the 26 primary
 * searches; anything more fails closed instead of silently trimming input.
 */
export function buildResearchQuerySlots(input: {
  scope: ApprovedResearchScope;
  maxResultsPerQuery?: number;
}): ResearchQuerySlot[] {
  const bounded = querySlotsInputSchema.parse({
    scope: input.scope,
    maxResultsPerQuery: input.maxResultsPerQuery ?? RESEARCH_BUDGET_LIMITS.maxResultsPerQuery,
  });
  const location = `${quote(bounded.scope.city)} ${bounded.scope.countryCode}`;
  const niche = quote(bounded.scope.niches[0]!);
  const slots: ResearchQuerySlot[] = [
    {
      slotKey: "local_market",
      kind: "local_market",
      text: `${quote(bounded.scope.publicBusinessName)} ${location} ${niche}`,
      maxResults: bounded.maxResultsPerQuery,
    },
  ];
  for (const topic of bounded.scope.topics) {
    slots.push({
      slotKey: `topic:${slotKeySegment(topic)}`,
      kind: "topic",
      text: `${quote(topic)} ${niche} ${location}`,
      maxResults: bounded.maxResultsPerQuery,
    });
  }
  for (const competitor of bounded.scope.competitors) {
    const context = [competitor.locationHint ? safePhrase(competitor.locationHint) : ""]
      .filter((part) => part.length > 0)
      .join(" ");
    slots.push({
      slotKey: `competitor:${slotKeySegment(competitor.name)}`,
      kind: "competitor",
      text: [quote(competitor.name), niche, location, context].filter(Boolean).join(" "),
      maxResults: bounded.maxResultsPerQuery,
    });
  }
  if (slots.length > RESEARCH_BUDGET_LIMITS.maxPrimarySearches) {
    throw new Error("The research query plan exceeds the primary search ceiling.");
  }
  const keys = slots.map((slot) => slot.slotKey);
  if (new Set(keys).size !== keys.length) {
    throw new Error("The research query plan must key every slot uniquely.");
  }
  return slots;
}

/**
 * Legacy bounded wrapper for the trigger/workflow path (Task 8 rewires it
 * onto slots): the first maxQueries full-coverage slots, mapped onto the
 * historic query shape. Full coverage lives in buildResearchQuerySlots.
 */
export function buildResearchQueryPlan(input: {
  scope: ApprovedResearchScope;
  maxQueries: number;
  maxResultsPerQuery: number;
}): ResearchQuery[] {
  const bounded = queryPlanInputSchema.parse(input);
  const kinds: ResearchQueryKind[] = ["official_identity", "market_context", "topic_monitoring"];
  return buildResearchQuerySlots({
    scope: bounded.scope,
    maxResultsPerQuery: bounded.maxResultsPerQuery,
  })
    .slice(0, bounded.maxQueries)
    .map((slot, index) => ({
      kind: kinds[Math.min(index, kinds.length - 1)]!,
      text: slot.text,
      maxResults: slot.maxResults,
    }));
}
