import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { DomainError } from "@/lib/errors";
import type { Database } from "@/lib/supabase/database.types";

/**
 * How a member answers what the narrator said.
 *
 * The two member RPCs (`triage_channel_recommendation`,
 * `record_channel_recommendation_feedback`) are the only authenticated write
 * paths into the recommendation tables, and this layer is their only caller.
 * The client is the signed-in member's own session, so the definer functions'
 * actor, membership, and tenant checks all run for real -- a service role here
 * would turn every one of them off.
 */

export type RecommendationActorContext = {
  /** The signed-in member's own session client. Never the service role. */
  supabase: SupabaseClient<Database>;
  actorId: string;
};

const idsSchema = z.object({
  organizationId: z.string().uuid(),
  recommendationId: z.string().uuid(),
});

/**
 * One valid answer. A dismissal carries why; a snooze carries the future
 * horizon it hides until; nothing else may carry either, because storage
 * gives the columns nowhere to sit on any other row kind.
 */
const triageAnswerSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("acknowledged") }).strict(),
  z.object({ decision: z.literal("planned") }).strict(),
  z.object({ decision: z.literal("dismissed"), reason: z.string().min(3) }).strict(),
  z
    .object({
      decision: z.literal("snoozed"),
      snoozedUntil: z.string().datetime({ offset: true }),
    })
    .strict(),
]);

export type TriageAnswer = z.infer<typeof triageAnswerSchema>;

const feedbackVoteSchema = z
  .object({
    helpful: z.boolean(),
  })
  .strict();

/**
 * A Postgres refusal inside the definer functions becomes a stable domain
 * error, so the route layer never inspects driver internals and the same
 * refusal reads the same way on every path.
 */
function mapRpcError(error: { code: string | null; message: string }): DomainError {
  switch (error.code) {
    case "42501":
      return new DomainError(
        "AUTHORIZATION_ERROR",
        "You do not have permission to answer this recommendation.",
      );
    // A recommendation outside this tenant is refused exactly like one that
    // does not exist; saying which would describe the neighbours' narration.
    case "P0002":
      return new DomainError(
        "TENANT_SCOPE_ERROR",
        "This recommendation was not found. It may have been removed.",
      );
    default:
      return new DomainError(
        "INTEGRATION_ERROR",
        "Your answer could not be recorded. Try again in a moment.",
        error,
      );
  }
}

async function callRpc(
  outcome: PromiseLike<{ error: { code: string | null; message: string } | null }>,
): Promise<void> {
  const { error } = await outcome;
  if (error) throw mapRpcError(error);
}

export async function triageRecommendation(
  input: {
    organizationId: string;
    recommendationId: string;
    decision: TriageAnswer["decision"];
    /** Only read when the decision is `dismissed`; refused otherwise. */
    reason?: string;
    /** Only read when the decision is `snoozed`; refused otherwise. */
    snoozedUntil?: string;
  },
  actorContext: RecommendationActorContext,
): Promise<{ recommendationId: string }> {
  // The answer is validated on its own: a reason or horizon riding along on
  // an answer that cannot carry one is refused exactly like a missing one,
  // and the ids are checked separately so their presence cannot mask an
  // invalid answer.
  const answer =
    input.reason === undefined && input.snoozedUntil === undefined
      ? { decision: input.decision }
      : input.snoozedUntil === undefined
        ? { decision: input.decision, reason: input.reason }
        : input.reason === undefined
          ? { decision: input.decision, snoozedUntil: input.snoozedUntil }
          : { decision: input.decision, reason: input.reason, snoozedUntil: input.snoozedUntil };
  const valid = idsSchema.safeParse(input).success && triageAnswerSchema.safeParse(answer).success;
  if (!valid) {
    throw new DomainError(
      "VALIDATION_ERROR",
      input.decision === "dismissed"
        ? "A dismissal needs a short reason of at least three characters."
        : input.decision === "snoozed"
          ? "A snooze needs the future time it hides until."
          : "That answer is not one the platform can record.",
    );
  }

  await callRpc(
    actorContext.supabase.rpc("triage_channel_recommendation", {
      p_organization_id: input.organizationId,
      p_recommendation_id: input.recommendationId,
      p_decision: input.decision,
      p_dismissal_reason:
        input.decision === "dismissed" && typeof input.reason === "string"
          ? input.reason
          : null,
      p_actor_id: actorContext.actorId,
      p_snoozed_until:
        input.decision === "snoozed" && typeof input.snoozedUntil === "string"
          ? input.snoozedUntil
          : null,
    }),
  );

  return { recommendationId: input.recommendationId };
}

export async function recordFeedback(
  input: {
    organizationId: string;
    recommendationId: string;
    helpful: boolean;
  },
  actorContext: RecommendationActorContext,
): Promise<{ recommendationId: string }> {
  if (
    !idsSchema.safeParse(input).success ||
    !feedbackVoteSchema.safeParse({ helpful: input.helpful }).success
  ) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "A feedback vote is either helpful or not helpful.",
    );
  }

  await callRpc(
    actorContext.supabase.rpc("record_channel_recommendation_feedback", {
      p_organization_id: input.organizationId,
      p_recommendation_id: input.recommendationId,
      p_helpful: input.helpful,
      p_actor_id: actorContext.actorId,
    }),
  );

  return { recommendationId: input.recommendationId };
}
