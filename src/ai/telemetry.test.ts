import { describe, expect, it, vi } from "vitest";

import {
  createConsoleModelTelemetrySink,
  modelTelemetryMetadata,
  withModelTelemetry,
  type ModelCallRecord,
  type ModelTelemetrySink,
} from "@/ai/telemetry";
import type { AiProvider, ModelRequest } from "@/ai/types";

const request: ModelRequest = {
  model: "test-model",
  prompt: "prompt",
  organizationId: "org-1",
  correlationId: "correlation-1",
};

function createSink(): ModelTelemetrySink & { records: ModelCallRecord[] } {
  const records: ModelCallRecord[] = [];
  return { records, record: (call) => void records.push(call) };
}

function createProvider(generate: AiProvider["generate"]): AiProvider {
  return { provider: "openai", generate };
}

describe("modelTelemetryMetadata", () => {
  it("carries the correlation identifiers and never records payloads by default", () => {
    const metadata = modelTelemetryMetadata(request, { workerId: "worker-1", runId: "run-1" });

    expect(metadata.isEnabled).toBe(true);
    expect(metadata.recordInputs).toBe(false);
    expect(metadata.recordOutputs).toBe(false);
    expect(metadata.functionId).toBe("worker-1");
    expect(metadata.metadata).toEqual({
      organizationId: "org-1",
      correlationId: "correlation-1",
      workerId: "worker-1",
      runId: "run-1",
    });
  });

  it("omits absent context rather than emitting undefined attributes", () => {
    expect(modelTelemetryMetadata(request).metadata).toEqual({
      organizationId: "org-1",
      correlationId: "correlation-1",
    });
  });
});

describe("withModelTelemetry", () => {
  it("records usage, cost, and duration for a successful call", async () => {
    const sink = createSink();
    let clock = 1_000;
    const provider = withModelTelemetry(
      createProvider(async () => ({
        provider: "openai",
        model: "resolved-model",
        text: "ok",
        usage: { inputTokens: 11, outputTokens: 7, estimatedCostMinor: 3 },
      })),
      sink,
      { workerId: "worker-1", runId: "run-1" },
      () => (clock += 250) - 250,
    );

    await expect(provider.generate(request)).resolves.toMatchObject({ text: "ok" });

    expect(sink.records).toHaveLength(1);
    expect(sink.records[0]).toMatchObject({
      provider: "openai",
      model: "resolved-model",
      organizationId: "org-1",
      correlationId: "correlation-1",
      workerId: "worker-1",
      runId: "run-1",
      outcome: "succeeded",
      inputTokens: 11,
      outputTokens: 7,
      estimatedCostMinor: 3,
    });
    expect(sink.records[0].durationMs).toBeGreaterThan(0);
  });

  it("reports missing usage as null rather than zero", async () => {
    const sink = createSink();
    const provider = withModelTelemetry(
      createProvider(async () => ({ provider: "openai", model: "m", text: "ok" })),
      sink,
    );

    await provider.generate(request);

    expect(sink.records[0]).toMatchObject({
      inputTokens: null,
      outputTokens: null,
      estimatedCostMinor: null,
    });
  });

  it("records a failed call and rethrows the original error", async () => {
    const sink = createSink();
    const failure = new TypeError("provider exploded");
    const provider = withModelTelemetry(
      createProvider(async () => {
        throw failure;
      }),
      sink,
    );

    await expect(provider.generate(request)).rejects.toBe(failure);

    expect(sink.records[0]).toMatchObject({
      outcome: "failed",
      errorName: "TypeError",
      model: "test-model",
    });
  });

  it("never lets a failing sink change the outcome of a call", async () => {
    const throwingSink: ModelTelemetrySink = {
      record: () => {
        throw new Error("sink is down");
      },
    };
    const provider = withModelTelemetry(
      createProvider(async () => ({ provider: "openai", model: "m", text: "ok" })),
      throwingSink,
    );

    await expect(provider.generate(request)).resolves.toMatchObject({ text: "ok" });
  });
});

describe("createConsoleModelTelemetrySink", () => {
  it("writes one structured record per call", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    createConsoleModelTelemetrySink().record({
      provider: "openai",
      model: "m",
      organizationId: "org-1",
      correlationId: "correlation-1",
      outcome: "succeeded",
      durationMs: 5,
      inputTokens: 1,
      outputTokens: 2,
      estimatedCostMinor: null,
    });

    expect(info).toHaveBeenCalledWith("ai.model_call", expect.objectContaining({ model: "m" }));
    info.mockRestore();
  });
});
