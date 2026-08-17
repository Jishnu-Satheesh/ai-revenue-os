import type { AiProvider, ModelRequest, ModelResponse } from "@/ai/types";

/**
 * Model telemetry for `context/17-observability-cost-governance.md`.
 *
 * Every model call carries the correlation identifiers that document requires,
 * and records tokens, cost, latency, and outcome. Cost is emitted in integer
 * minor units per the repository money convention; a provider that cannot
 * report cost emits `null` rather than a zero, because a missing measurement
 * and a free call are different facts.
 */
export type ModelCallRecord = {
  provider: string;
  model: string;
  organizationId: string;
  correlationId: string;
  workerId?: string;
  runId?: string;
  outcome: "succeeded" | "failed";
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostMinor: number | null;
  errorName?: string;
};

export type ModelTelemetrySink = {
  record(call: ModelCallRecord): void;
};

export type ModelTelemetryContext = {
  workerId?: string;
  runId?: string;
};

/**
 * Telemetry metadata for the Vercel AI SDK's `experimental_telemetry` option.
 * Attribute names mirror `ModelCallRecord` so a span and a record describe the
 * same call with the same keys.
 *
 * `recordInputs` and `recordOutputs` default to false: prompts carry business
 * context and may carry customer content, and AGENTS.md prohibits logging
 * unnecessary customer PII. A worker that needs payload capture must opt in
 * explicitly after a sensitivity review.
 */
export function modelTelemetryMetadata(
  request: Pick<ModelRequest, "organizationId" | "correlationId">,
  context: ModelTelemetryContext = {},
) {
  return {
    isEnabled: true,
    recordInputs: false,
    recordOutputs: false,
    functionId: context.workerId,
    metadata: {
      organizationId: request.organizationId,
      correlationId: request.correlationId,
      ...(context.workerId ? { workerId: context.workerId } : {}),
      ...(context.runId ? { runId: context.runId } : {}),
    },
  } as const;
}

/** Structured logging sink. Replace with an OTEL exporter when one is wired. */
export function createConsoleModelTelemetrySink(): ModelTelemetrySink {
  return {
    record(call) {
      console.info("ai.model_call", call);
    },
  };
}

/**
 * Wraps a provider so telemetry is emitted whether the call succeeds or throws.
 * A failed call is the one most worth measuring, so the sink runs before the
 * error is rethrown, and a sink failure never masks a provider result.
 */
export function withModelTelemetry(
  provider: AiProvider,
  sink: ModelTelemetrySink,
  context: ModelTelemetryContext = {},
  now: () => number = () => Date.now(),
): AiProvider {
  return {
    provider: provider.provider,
    async generate(request: ModelRequest): Promise<ModelResponse> {
      const startedAt = now();

      const emit = (
        outcome: ModelCallRecord["outcome"],
        response: ModelResponse | null,
        errorName?: string,
      ) => {
        try {
          sink.record({
            provider: provider.provider,
            model: response?.model ?? request.model,
            organizationId: request.organizationId,
            correlationId: request.correlationId,
            ...(context.workerId ? { workerId: context.workerId } : {}),
            ...(context.runId ? { runId: context.runId } : {}),
            outcome,
            durationMs: now() - startedAt,
            inputTokens: response?.usage?.inputTokens ?? null,
            outputTokens: response?.usage?.outputTokens ?? null,
            estimatedCostMinor: response?.usage?.estimatedCostMinor ?? null,
            ...(errorName ? { errorName } : {}),
          });
        } catch {
          // Telemetry is never allowed to change the outcome of a model call.
        }
      };

      try {
        const response = await provider.generate(request);
        emit("succeeded", response);
        return response;
      } catch (error) {
        emit("failed", null, error instanceof Error ? error.name : "UnknownError");
        throw error;
      }
    },
  };
}
