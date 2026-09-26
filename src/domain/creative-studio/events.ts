/**
 * The Studio run state machine and the events that move it.
 *
 * `editing` and `admitting` are ephemeral UI states before a persisted run
 * exists. Everything else is a persisted, provider-independent state with a
 * fixed transition graph: the database enforces the same graph, so a worker
 * and a reconnecting browser can never disagree about what happens next.
 */

export const STUDIO_EPHEMERAL_STATES = ["editing", "admitting"] as const;

export const STUDIO_PERSISTED_RUN_STATES = [
  "queued",
  "preparing",
  "generating",
  "previewing",
  "validating",
  "ready",
  "failed",
  "cancel_requested",
  "cancelled",
  "outcome_unknown",
] as const;
export type StudioRunState = (typeof STUDIO_PERSISTED_RUN_STATES)[number];

export const STUDIO_RUN_EVENTS = [
  "studio.run.accepted",
  "studio.run.references_prepared",
  "studio.run.generation_started",
  "studio.run.preview_available",
  "studio.run.output_validated",
  "studio.run.completed",
  "studio.run.failed",
  "studio.run.cancel_requested",
  "studio.run.cancelled",
  "studio.run.outcome_unknown",
  "studio.campaign_link_created",
  "studio.campaign_link_blocked",
  "studio.campaign_link_resolved",
] as const;
export type StudioRunEvent = (typeof STUDIO_RUN_EVENTS)[number];

/**
 * Allowed transitions. `null` is no run yet: only acceptance creates one.
 * Campaign-link events record attachment after completion and never move a
 * run's own state. Cancellation is a request until the worker confirms the
 * real outcome — including a completion that beat the cancellation.
 */
const TRANSITIONS: Readonly<Record<StudioRunEvent, Readonly<Record<string, StudioRunState>>>> = {
  "studio.run.accepted": { "": "queued" },
  "studio.run.references_prepared": { queued: "preparing" },
  "studio.run.generation_started": { preparing: "generating" },
  "studio.run.preview_available": { generating: "previewing", previewing: "previewing" },
  "studio.run.output_validated": { generating: "validating", previewing: "validating" },
  "studio.run.completed": {
    validating: "ready",
    cancel_requested: "ready",
    outcome_unknown: "ready",
  },
  "studio.run.failed": {
    queued: "failed",
    preparing: "failed",
    generating: "failed",
    previewing: "failed",
    validating: "failed",
    cancel_requested: "failed",
  },
  "studio.run.cancel_requested": {
    queued: "cancel_requested",
    preparing: "cancel_requested",
    generating: "cancel_requested",
    previewing: "cancel_requested",
    validating: "cancel_requested",
  },
  "studio.run.cancelled": { cancel_requested: "cancelled" },
  "studio.run.outcome_unknown": {
    preparing: "outcome_unknown",
    generating: "outcome_unknown",
    previewing: "outcome_unknown",
    validating: "outcome_unknown",
    cancel_requested: "outcome_unknown",
  },
  "studio.campaign_link_created": { ready: "ready" },
  "studio.campaign_link_blocked": { ready: "ready" },
  "studio.campaign_link_resolved": { ready: "ready" },
};

export class StudioRunTransitionError extends Error {
  readonly from: string;
  readonly event: StudioRunEvent;
  constructor(from: string, event: StudioRunEvent) {
    super(`Studio run in ${from} refuses ${event}: the state machine has no such transition.`);
    this.name = "StudioRunTransitionError";
    this.from = from;
    this.event = event;
  }
}

/** Moves a run along the fixed graph, or throws StudioRunTransitionError. */
export function transitionRunState(
  current: StudioRunState | null,
  event: StudioRunEvent,
): StudioRunState {
  const next = TRANSITIONS[event][current ?? ""];
  if (!next) throw new StudioRunTransitionError(current ?? "absent", event);
  return next;
}

export function isTerminalRunState(state: StudioRunState): boolean {
  return (
    state === "ready" ||
    state === "failed" ||
    state === "cancelled" ||
    state === "outcome_unknown"
  );
}

export const STUDIO_SAFE_FAILURE_CODES = [
  "policy_refused",
  "generation_disabled",
  "reference_revoked",
  "unsupported_ratio",
  "unsupported_format",
  "upload_failed",
  "provider_refused",
  "provider_failed",
  "invalid_final_bytes",
  "stream_lost",
  "context_expired",
  "model_unavailable",
  "stale_parent",
  "link_failed",
  "access_revoked",
  "cancelled",
] as const;
export type StudioSafeFailureCode = (typeof STUDIO_SAFE_FAILURE_CODES)[number];

const SAFE_FAILURE_MESSAGES: Readonly<Record<StudioSafeFailureCode, string>> = {
  policy_refused: "Generation is not covered by the current Studio policy.",
  generation_disabled: "Studio generation is disabled for this organization.",
  reference_revoked: "A selected reference was revoked before dispatch.",
  unsupported_ratio: "This format is not qualified for the selected profile.",
  unsupported_format: "This file type is not accepted for Studio references.",
  upload_failed: "An upload did not finalize. Nothing was sent to the provider.",
  provider_refused: "The provider declined this request. Nothing was spent.",
  provider_failed: "The provider failed this run. The reservation is intact.",
  invalid_final_bytes: "The provider returned bytes that failed validation.",
  stream_lost: "The preview stream disconnected. The run continues server-side.",
  context_expired: "The original editing context is unavailable.",
  model_unavailable: "The pinned model is unavailable.",
  stale_parent: "The parent changed while this edit was prepared.",
  link_failed: "The poster is saved; attaching it to the campaign failed.",
  access_revoked: "Access changed while this run was active.",
  cancelled: "The run was cancelled at the operator's request.",
};

export type StudioSafeFailure = { readonly code: StudioSafeFailureCode; readonly message: string };

/**
 * The only failure shape the browser ever sees: a code and a static message.
 * Prompts, copy, bytes, signed URLs and continuation tokens stay
 * server-private by construction — there is no field that could carry them.
 */
export function toSafeFailure(code: StudioSafeFailureCode): StudioSafeFailure {
  return { code, message: SAFE_FAILURE_MESSAGES[code] };
}
