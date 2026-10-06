import { z } from "zod";

/**
 * The bounded Studio preparation policy: what an organization explicitly
 * allows Studio generation to cost, and how reservations account for it.
 *
 * Versions are immutable and every ceiling is explicit — there are no
 * defaults to discover, because a default allowance is spending nobody
 * approved. An unknown actual cost stays null, never zero: zero would claim
 * a paid run was free.
 */

export const studioGenerationPolicySchema = z.strictObject({
  version: z.number().int().positive(),
  enabled: z.boolean(),
  currency: z.string().trim().length(3).regex(/^[A-Z]{3}$/),
  perRunCeilingMinor: z.number().int().nonnegative(),
  windowCeilingMinor: z.number().int().nonnegative(),
  windowSeconds: z.number().int().positive(),
  maxPending: z.number().int().positive(),
  maxAttempts: z.number().int().positive(),
});
export type StudioGenerationPolicy = z.infer<typeof studioGenerationPolicySchema>;

export type ReservationRefusalCode =
  | "generation_disabled"
  | "per_run_ceiling_exceeded"
  | "window_ceiling_exceeded"
  | "too_many_pending_runs"
  | "attempt_limit_exceeded";

/** Reserves the estimated cost, or refuses with the ceiling that said no. */
export function reserveStudioRun(input: {
  readonly policy: StudioGenerationPolicy;
  readonly estimatedCostMinor: number;
  readonly spentInWindowMinor: number;
  readonly pendingCount: number;
  readonly attempt: number;
}):
  | { readonly reserved: true; readonly reservationMinor: number }
  | { readonly reserved: false; readonly code: ReservationRefusalCode; readonly detail: string } {
  if (!input.policy.enabled) {
    return {
      reserved: false,
      code: "generation_disabled",
      detail: "Studio generation is disabled under the current policy version.",
    };
  }
  if (input.estimatedCostMinor > input.policy.perRunCeilingMinor) {
    return {
      reserved: false,
      code: "per_run_ceiling_exceeded",
      detail: `This run needs about ${input.estimatedCostMinor} minor units; the per-run ceiling is ${input.policy.perRunCeilingMinor}.`,
    };
  }
  if (input.spentInWindowMinor + input.estimatedCostMinor > input.policy.windowCeilingMinor) {
    return {
      reserved: false,
      code: "window_ceiling_exceeded",
      detail: `This run would take window spend to ${input.spentInWindowMinor + input.estimatedCostMinor} minor units against a ceiling of ${input.policy.windowCeilingMinor}.`,
    };
  }
  if (input.pendingCount >= input.policy.maxPending) {
    return {
      reserved: false,
      code: "too_many_pending_runs",
      detail: `There are already ${input.pendingCount} pending runs; the policy allows ${input.policy.maxPending}.`,
    };
  }
  if (input.attempt > input.policy.maxAttempts) {
    return {
      reserved: false,
      code: "attempt_limit_exceeded",
      detail: `Attempt ${input.attempt} passes the policy limit of ${input.policy.maxAttempts}.`,
    };
  }
  return { reserved: true, reservationMinor: input.estimatedCostMinor };
}

/**
 * Settles a run's cost. A null actual cost means the provider outcome is
 * unknown — the reservation is retained and reconciliation stays open,
 * rather than writing zero and pretending a paid run was free.
 */
export function recordRunCost(input: {
  readonly reservationMinor: number;
  readonly actualCostMinor: number | null;
}): { readonly recognizedMinor: number | null; readonly needsReconciliation: boolean } {
  if (input.actualCostMinor === null) {
    return { recognizedMinor: null, needsReconciliation: true };
  }
  return { recognizedMinor: input.actualCostMinor, needsReconciliation: false };
}
