import {
  researchRequestSchema,
  type ApprovedResearchScope,
} from "@/modules/growth-intelligence/infrastructure/research/ports";
export { approvedResearchScopeSchema } from "@/modules/growth-intelligence/infrastructure/research/ports";

export type ResearchQueryKind = "official_identity" | "market_context" | "topic_monitoring";

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
  return `\"${safePhrase(value).replace(/\"/g, "")}\"`;
}

export function buildResearchQueryPlan(input: {
  scope: ApprovedResearchScope;
  maxQueries: number;
  maxResultsPerQuery: number;
}): ResearchQuery[] {
  const bounded = queryPlanInputSchema.parse(input);
  const business = quote(bounded.scope.publicBusinessName);
  const niche = quote(bounded.scope.niches[0]!);
  const topic = quote(bounded.scope.topics[0]!);
  const location = `${quote(bounded.scope.city)} ${bounded.scope.countryCode}`;
  const candidates: ResearchQuery[] = [
    {
      kind: "official_identity",
      text: `${business} ${location} official`,
      maxResults: bounded.maxResultsPerQuery,
    },
    {
      kind: "market_context",
      text: `${niche} ${location} market`,
      maxResults: bounded.maxResultsPerQuery,
    },
    {
      kind: "topic_monitoring",
      text: `${topic} ${niche} ${location}`,
      maxResults: bounded.maxResultsPerQuery,
    },
  ];

  return candidates.slice(0, bounded.maxQueries);
}
