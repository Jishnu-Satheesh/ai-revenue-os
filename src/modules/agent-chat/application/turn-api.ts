import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { hasOrganizationPermission } from "@/domain/access/permissions";
import { routerProposalSchema } from "@/domain/agent-router/contracts";
import type { OrganizationRole } from "@/domain/organizations/types";
import { DomainError } from "@/lib/errors";
import type { Database } from "@/lib/supabase/database.types";
import type { AgentTurnPersistence } from "@/modules/agent-chat/infrastructure/turn-repository";
import type { LightModelPort } from "@/modules/agent-router/infrastructure/light-model-provider";

export const turnStartBodySchema = z
  .object({
    messageId: z.string().uuid(),
    idempotencyKey: z.string().trim().min(16).max(200),
    hasAttachment: z.boolean().optional(),
  })
  .strict();

/** The browser supplies a file hint; the stored message owns classification. */
export async function classifyGovernedTurn(
  input: {
    question: string;
    page: string;
    contextDigest: string;
    role: OrganizationRole;
    hasAttachment?: boolean;
    knownChannelLabels?: readonly string[];
    correlationId?: string;
  },
  model: LightModelPort,
): Promise<"business_advice" | "channel_assessment" | "report_intake" | null> {
  if (input.hasAttachment) {
    if (!hasOrganizationPermission(input.role, "report.upload")) {
      throw new DomainError(
        "AUTHORIZATION_ERROR",
        "You cannot upload a report in this organization.",
      );
    }
    return "report_intake";
  }
  // A clear request for business advice remains useful during router outages.
  // This read-only lane cannot initiate uploads, analysis, or public research.
  const question = z.string().trim().min(1).max(20000).parse(input.question);
  if (
    /\b(?:improve|grow|increase|boost)\b/i.test(question) &&
    /\b(?:business|revenue|profit|sales)\b/i.test(question) &&
    /\b(?:month|advice|ideas|recommendations)\b/i.test(question) &&
    hasOrganizationPermission(input.role, "channel.read")
  )
    return "business_advice";
  const normalized = (text: string) =>
    ` ${text
      .normalize("NFKC")
      .toLocaleLowerCase("en")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()} `;
  if (
    hasOrganizationPermission(input.role, "channel.read") &&
    /\b(?:how|assess|evaluate|analy[sz]e|review)\b/i.test(question) &&
    /\b(?:doing|performance|performing|sales|revenue|profit|orders)\b/i.test(question) &&
    (input.knownChannelLabels ?? [])
      .slice(0, 300)
      .some((label) => label.trim().length > 1 && normalized(question).includes(normalized(label)))
  )
    return "channel_assessment";
  let proposal;
  try {
    proposal = routerProposalSchema.parse(
      await model.propose({
        text: question,
        page: input.page,
        contextDigest: input.contextDigest,
        activeWatchCount: 0,
        correlationId: input.correlationId,
      }),
    );
  } catch {
    return null;
  }
  if (proposal.confidence === "low") return null;
  if (
    (proposal.intent === "business_advice" || proposal.intent === "channel_assessment") &&
    hasOrganizationPermission(input.role, "channel.read")
  )
    return proposal.intent;
  // Text alone does not create an upload or alter a package.
  return null;
}

export const turnChallengeAnswerBodySchema = z
  .object({
    challengeId: z.string().uuid(),
    idempotencyKey: z.string().trim().min(16).max(200),
    answers: z.record(z.string(), z.unknown()),
  })
  .strict();

export const turnRouteParamsSchema = z
  .object({
    organizationId: z.string().uuid(),
    threadId: z.string().uuid(),
    turnId: z.string().uuid(),
  })
  .strict();

export function turnPersistenceFor(supabase: SupabaseClient<Database>): AgentTurnPersistence {
  return {
    rpc: (name, args) =>
      (
        supabase.rpc as unknown as (
          rpcName: string,
          rpcArgs: Record<string, unknown>,
        ) => Promise<{ data: unknown; error: unknown }>
      )(name, args),
    from: (table) =>
      supabase.from(table as "agent_turns") as unknown as NonNullable<
        AgentTurnPersistence["from"]
      > extends (table: string) => infer Q
        ? Q
        : never,
  };
}
