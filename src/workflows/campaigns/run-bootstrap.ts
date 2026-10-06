import {
  CAMPAIGN_BOOTSTRAP_FAILURE_PREFIX,
  campaignReadinessBlocker,
  type CampaignReadinessBlocker,
} from "@/domain/campaigns/readiness";
import { ProviderContractVerificationError } from "@/modules/integrations/providers/meta/contract";

/**
 * The gap between "a worker was asked to do this" and "a worker started doing
 * it".
 *
 * Every campaign workflow claims its run as its first act, and from that point
 * on it owns the outcome: it has a claim token, a lease, and a failure handler
 * that records what went wrong. None of that exists yet while the worker is
 * still assembling the dependencies it will hand the workflow — a database
 * client, a model router, a provider contract. An exception there kills the
 * attempt with the run row untouched.
 *
 * That is finding F02. Trigger run `run_06g9cko3ehp1gemp1f1v6k6h01` has been
 * FAILED since 12 September; its domain run `d2682f4c-…` still reads `queued`,
 * `attempt = 0`, no lease, no failure code. The platform's own record says the
 * work is waiting to start. It is not waiting; it is dead, and the disagreement
 * is the whole defect. A client reading that row is shown a spinner forever.
 *
 * This module closes the gap. `build` is where dependencies are constructed and
 * `invoke` is where the workflow runs, and the split is load-bearing: a failure
 * in `build` is recorded here because nothing else can record it, and a failure
 * in `invoke` is left alone because the workflow holds the claim and recording
 * over it would fight the worker that owns the run.
 */

export type GenerationBootstrapOutcome =
  | { outcome: "recorded"; attempt: number }
  /** A live lease belongs to another worker. Nothing was written. */
  | { outcome: "already_claimed" }
  /** The run reached a terminal state while this attempt was failing. */
  | { outcome: "already_finished"; status: "succeeded" | "failed" | "cancelled" }
  /** The database could not be reached. The cause is still reported. */
  | { outcome: "unavailable" };

export type GenerationBootstrapRecorder = {
  failBootstrap(input: {
    organizationId: string;
    runId: string;
    taskId: string;
    /** Always prefixed. Never raw exception text: those carry connection strings. */
    failureCode: string;
  }): Promise<GenerationBootstrapOutcome>;
};

export class CampaignGenerationBootstrapError extends Error {
  readonly failureCode: string;
  readonly blocker: CampaignReadinessBlocker;
  /** True when repeating this attempt unchanged must fail the same way. */
  readonly deterministic: boolean;
  readonly recorded: GenerationBootstrapOutcome;
  readonly organizationId: string;
  readonly runId: string;

  constructor(input: {
    message: string;
    failureCode: string;
    blocker: CampaignReadinessBlocker;
    deterministic: boolean;
    recorded: GenerationBootstrapOutcome;
    organizationId: string;
    runId: string;
    cause: unknown;
  }) {
    super(input.message, { cause: input.cause });
    this.name = "CampaignGenerationBootstrapError";
    this.failureCode = input.failureCode;
    this.blocker = input.blocker;
    this.deterministic = input.deterministic;
    this.recorded = input.recorded;
    this.organizationId = input.organizationId;
    this.runId = input.runId;
  }
}

type Classification = {
  failureCode: string;
  blocker: CampaignReadinessBlocker;
  deterministic: boolean;
  /** Safe for a log line. Derived from the error's type, never its text. */
  safeSummary: string;
};

/**
 * What kind of failure this was, decided from the error's type.
 *
 * Deliberately not from its message. The one classification that matters —
 * "this will fail again identically, stop retrying" versus "this might have
 * been a bad moment, try once more" — decides whether the platform spends
 * money on a second attempt, and deciding it by matching words is a decision
 * that quietly inverts the first time somebody rewords an error.
 */
export function classifyBootstrapFailure(error: unknown): Classification {
  if (error instanceof ProviderContractVerificationError) {
    return {
      failureCode: `${CAMPAIGN_BOOTSTRAP_FAILURE_PREFIX}provider_contract_expired`,
      deterministic: true,
      safeSummary: `The verified provider contract for ${error.providerKey} is ${
        error.reason === "expired" ? "out of date" : "dated in the future"
      }.`,
      blocker: campaignReadinessBlocker({
        code: "provider_contract_expired",
        phase: "creative_preparation",
        actionKey: `${error.providerKey}.all_placements`,
        explanation:
          "Building this campaign could not start because our record of the publishing platform's current rules is out of date.",
        repair: { kind: "reverify_provider_contract", providerKey: error.providerKey },
        deterministic: true,
      }),
    };
  }

  return {
    failureCode: `${CAMPAIGN_BOOTSTRAP_FAILURE_PREFIX}worker_start_failed`,
    // Unknown is treated as transient on purpose. Declaring an unrecognised
    // fault permanent would strand recoverable work; one extra attempt is the
    // cheaper mistake.
    deterministic: false,
    safeSummary: "The worker could not assemble what it needed to start this run.",
    blocker: campaignReadinessBlocker({
      code: "generation_bootstrap_failed",
      phase: "creative_preparation",
      explanation: "The worker could not start this run.",
      repair: { kind: "retry_generation" },
      deterministic: false,
    }),
  };
}

export type GenerationBootstrapRun = {
  organizationId: string;
  campaignId: string;
  runId: string;
  correlationId: string;
  taskId: string;
};

/**
 * Builds the workflow's dependencies, and makes sure a failure to build them is
 * still a recorded outcome.
 *
 * `invoke` runs only if `build` returned. Everything `invoke` throws passes
 * through untouched — the workflow inside it has the claim.
 */
export async function withGenerationBootstrapRecovery<TDependencies, TResult>(input: {
  run: GenerationBootstrapRun;
  recorder: GenerationBootstrapRecorder;
  build: () => TDependencies | Promise<TDependencies>;
  invoke: (dependencies: TDependencies) => Promise<TResult>;
  /** Structured logging, injected so the workflow layer holds no logger. */
  log?: (event: string, fields: Record<string, unknown>) => void;
}): Promise<TResult> {
  let dependencies: TDependencies;

  try {
    dependencies = await input.build();
  } catch (error) {
    const classification = classifyBootstrapFailure(error);

    let recorded: GenerationBootstrapOutcome;
    try {
      recorded = await input.recorder.failBootstrap({
        organizationId: input.run.organizationId,
        runId: input.run.runId,
        taskId: input.run.taskId,
        failureCode: classification.failureCode,
      });
    } catch {
      // Swallowed on purpose, and only here. The cause below is the thing
      // worth reporting; replacing it with "the database was unreachable"
      // would hide why the run died behind why we failed to say so.
      recorded = { outcome: "unavailable" };
    }

    input.log?.("campaign.generation_bootstrap_failed", {
      organizationId: input.run.organizationId,
      campaignId: input.run.campaignId,
      runId: input.run.runId,
      correlationId: input.run.correlationId,
      taskId: input.run.taskId,
      failureCode: classification.failureCode,
      deterministic: classification.deterministic,
      recorded: recorded.outcome,
      summary: classification.safeSummary,
    });

    throw new CampaignGenerationBootstrapError({
      message: classification.safeSummary,
      failureCode: classification.failureCode,
      blocker: classification.blocker,
      deterministic: classification.deterministic,
      recorded,
      organizationId: input.run.organizationId,
      runId: input.run.runId,
      cause: error,
    });
  }

  return input.invoke(dependencies);
}
