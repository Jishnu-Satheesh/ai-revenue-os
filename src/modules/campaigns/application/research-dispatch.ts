import { z } from "zod";

import { DomainError } from "@/lib/errors";

/**
 * Asking for a piece of campaign research.
 *
 * Nothing did this. The admission function, the worker, its queue and its lease
 * sweep all existed, and no code ever asked them to start — so the whole
 * proposal pipeline sat idle behind a button nobody had built.
 *
 * Two steps, in this order, and the order is the safety case. The database
 * admits the run first: it binds the current policy version, checks the
 * allowance for one run and for the window, the pending cap and the cooldown,
 * and refuses by name when any of them stops it. Only then is a worker asked to
 * do the work. Dispatching first would mean a worker racing a decision about
 * whether it was allowed to exist.
 *
 * A dispatch that fails is reported as a failure to start. The run stays queued
 * and the lease sweep will offer it again, so the honest report is "it has not
 * started", never "nothing happened" and never silence.
 */

const uuidSchema = z.string().uuid();

export type ResearchRunAdmission = {
  runId: string;
  outcome: "saved" | "replayed";
};

/**
 * Everything the caller needs before it can ask, read from the binding policy.
 *
 * `evidenceMaxAgeDays` is carried rather than defaulted because it is a numeric
 * operating limit: the worker refuses to invent one, and so does this.
 */
export type ResearchAdmissionInput = {
  organizationId: string;
  triggerKind: "business_signal" | "scheduled" | "manual_request" | "next_test";
  budgetMinor: number;
  allowanceCurrency: string;
  requestDigest: string;
  idempotencyKey: string;
  sourceFingerprint: string | null;
  /** The staged question, stored on the run row — never in a worker payload. */
  researchQuestion: string | null;
  /** The policy version the caller believed was in force, when it read one. */
  knownPolicyVersion: number | null;
};

export type ResearchAdmissionPersistence = {
  rpc(
    name: "request_campaign_research_run",
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
};

/**
 * Why a request was refused, in the database's own vocabulary.
 *
 * Mapped by the exception name the migration raises, never by message text: a
 * message is for a person and may be reworded, a name is a contract. Anything
 * unrecognised becomes `unavailable` rather than being guessed at — reporting a
 * refusal we do not understand as a specific business outcome would be a lie
 * with a confident tone.
 */
export type ResearchAdmissionRefusal =
  | "forbidden"
  | "needs_setup"
  | "stale_policy"
  | "currency_mismatch"
  | "allowance_exceeded"
  | "pending_limit"
  | "cooldown"
  | "invalid"
  | "unavailable";

export type ResearchRequestOutcome =
  | { status: "started"; runId: string; outcome: "saved" | "replayed" }
  | { status: "not_started"; runId: string; reason: "dispatch_failed" }
  | { status: "refused"; refusal: ResearchAdmissionRefusal };

export function admissionRefusal(error: {
  code?: string;
  message?: string;
}): ResearchAdmissionRefusal {
  const message = error.message ?? "";

  if (message.includes("campaign_research_forbidden")) return "forbidden";
  if (message.includes("campaign_research_needs_setup")) return "needs_setup";
  if (message.includes("campaign_research_stale_policy")) return "stale_policy";
  if (message.includes("campaign_research_currency_mismatch")) return "currency_mismatch";
  if (message.includes("campaign_research_allowance_exceeded")) return "allowance_exceeded";
  if (message.includes("campaign_research_pending_limit")) return "pending_limit";
  if (message.includes("campaign_research_cooldown")) return "cooldown";
  if (message.includes("campaign_research_invalid")) return "invalid";

  return error.code === "42501" ? "forbidden" : "unavailable";
}

/**
 * The words a person reads when their request is refused.
 *
 * Each one names the limit that stopped them, because "could not start
 * research" tells somebody nothing about whether to wait, to raise a budget, or
 * to ask an owner. No sentence here states a figure: the limits are the
 * organization's own configuration, and quoting one from here would risk
 * quoting a stale copy.
 */
export function refusalMessage(refusal: ResearchAdmissionRefusal): string {
  switch (refusal) {
    case "forbidden":
      return "You cannot spend this organization's research allowance. Ask an owner or an admin.";
    case "needs_setup":
      return "Research is not switched on for this organization yet. An owner or admin can set it up in Research settings.";
    case "stale_policy":
      return "The research settings changed while you were reading them. Nothing was started — reload and try again.";
    case "currency_mismatch":
      return "This request is in a different currency from the research allowance, so it was not started.";
    case "allowance_exceeded":
      return "This would cost more than the research allowance permits, either for one piece of research or for this window. Nothing was started and nothing was spent.";
    case "pending_limit":
      return "There are already as many proposals waiting as the settings allow. Decide on one of them first.";
    case "cooldown":
      return "Research ran recently, and the settings ask for a gap between runs. Nothing was started.";
    case "invalid":
      return "That request was not something research could act on. Nothing was started.";
    case "unavailable":
      return "Research could not be started just now. Nothing was spent — try again.";
  }
}

const admissionResultSchema = z.object({
  run_id: uuidSchema,
  outcome: z.string(),
});

/**
 * Admits a run against the binding policy. Returns the run, or throws the
 * refusal as a typed value the caller maps to a response.
 */
export async function admitResearchRun(
  client: ResearchAdmissionPersistence,
  input: ResearchAdmissionInput,
): Promise<ResearchRunAdmission> {
  const { data, error } = await client.rpc("request_campaign_research_run", {
    target_organization_id: input.organizationId,
    input_run: {
      trigger_kind: input.triggerKind,
      budget_minor: input.budgetMinor,
      allowance_currency: input.allowanceCurrency,
      request_digest: input.requestDigest,
      idempotency_key: input.idempotencyKey,
      source_fingerprint: input.sourceFingerprint,
      research_question: input.researchQuestion,
      known_policy_version: input.knownPolicyVersion,
    },
  });
  if (error) throw admissionRefusal(error);

  const parsed = admissionResultSchema.safeParse(data);
  if (!parsed.success) {
    // A shape nothing validated must not be reported as a started run: the
    // caller would tell a person research is under way on the strength of it.
    throw "unavailable" satisfies ResearchAdmissionRefusal;
  }

  return {
    runId: parsed.data.run_id,
    outcome: parsed.data.outcome === "replayed" ? "replayed" : "saved",
  };
}

export function isAdmissionRefusal(error: unknown): error is ResearchAdmissionRefusal {
  return (
    typeof error === "string" &&
    [
      "forbidden",
      "needs_setup",
      "stale_policy",
      "currency_mismatch",
      "allowance_exceeded",
      "pending_limit",
      "cooldown",
      "invalid",
      "unavailable",
    ].includes(error)
  );
}

export type ResearchWorkerDispatch = (input: {
  organizationId: string;
  runId: string;
  correlationId: string;
  evidenceMaxAgeDays: number;
  /**
   * The admitting policy's own currency. The dispatcher pairs it with the
   * platform-configured preparation figure, so the worker's purse is always
   * the dispatch figure in the policy currency — never a number any caller
   * chose.
   */
  allowanceCurrency: string;
}) => Promise<boolean>;

/**
 * What a manual request is asking, in the button's own words.
 *
 * A run without a staged question plans from nothing, and the worker fails it
 * rather than inventing what the requester never asked. A button press has no
 * typed question, but it is not question-less either: "Ask for a campaign"
 * documents itself as asking the platform to work out what campaign to run
 * next. Staging that sentence is transcription, not invention — it claims no
 * business fact and sets no numeric limit, so D06 is not engaged.
 */
export const MANUAL_RESEARCH_QUESTION = "What campaign should we run next?";

/**
 * Admit, then dispatch.
 *
 * A replayed admission still dispatches. The worker's own claim is what stops a
 * second delivery doing the work twice — `claim_campaign_research_run` takes
 * only queued rows — so re-asking is safe, while not re-asking would strand a
 * run whose first dispatch was lost.
 */
export async function requestCampaignResearch(
  client: ResearchAdmissionPersistence,
  dispatch: ResearchWorkerDispatch,
  input: ResearchAdmissionInput & { correlationId: string; evidenceMaxAgeDays: number },
): Promise<ResearchRequestOutcome> {
  let admitted: ResearchRunAdmission;
  try {
    admitted = await admitResearchRun(client, {
      ...input,
      // A manual press carries no typed question. Stage the standing one
      // rather than admitting a run the worker can only fail: without it
      // every "Ask for a campaign" plans from nothing and dies as
      // question_missing. Anything explicitly asked passes through untouched,
      // and other trigger kinds keep staging their own questions.
      researchQuestion:
        input.researchQuestion ??
        (input.triggerKind === "manual_request" ? MANUAL_RESEARCH_QUESTION : null),
    });
  } catch (error) {
    if (isAdmissionRefusal(error)) return { status: "refused", refusal: error };
    throw error;
  }

  const started = await dispatch({
    organizationId: input.organizationId,
    runId: admitted.runId,
    correlationId: input.correlationId,
    evidenceMaxAgeDays: input.evidenceMaxAgeDays,
    allowanceCurrency: input.allowanceCurrency,
  });

  // The run is admitted either way. Saying "started" when no worker was asked
  // would leave a person watching for a proposal that nothing is writing.
  return started
    ? { status: "started", runId: admitted.runId, outcome: admitted.outcome }
    : { status: "not_started", runId: admitted.runId, reason: "dispatch_failed" };
}

/** A refusal as the typed error a route already knows how to answer. */
export function refusalToDomainError(refusal: ResearchAdmissionRefusal): DomainError {
  const message = refusalMessage(refusal);
  switch (refusal) {
    case "forbidden":
      return new DomainError("AUTHORIZATION_ERROR", message);
    case "needs_setup":
      return new DomainError("FEATURE_NOT_AVAILABLE", message);
    case "invalid":
    case "currency_mismatch":
      return new DomainError("VALIDATION_ERROR", message);
    case "stale_policy":
    case "allowance_exceeded":
    case "pending_limit":
    case "cooldown":
      // Business prerequisites, not faults. Nothing was spent and nothing is
      // wrong with the request itself.
      return new DomainError("WORKFLOW_ERROR", message);
    case "unavailable":
      return new DomainError("INTEGRATION_ERROR", message);
  }
}
