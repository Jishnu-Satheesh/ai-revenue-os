import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("Business Memory Trigger registration", () => {
  it("keeps Trigger imports in registration and validates every payload before creating service dependencies", async () => {
    const trigger = await readFile(resolve(process.cwd(), "src/trigger/memory.ts"), "utf8");
    const runners = await Promise.all(
      ["embed-items.ts", "reembed-item.ts", "expire-items.ts"].map((file) =>
        readFile(resolve(process.cwd(), "src/workflows/memory", file), "utf8"),
      ),
    );

    expect(trigger).toContain('id: "memory.embed-items"');
    expect(trigger).toContain('id: "memory.reembed-item"');
    expect(trigger).toContain('id: "memory.expire-items"');
    expect(trigger.match(/tasks\.onCancel\(/g)).toHaveLength(1);
    expect(trigger).toContain(
      'parseMemoryTaskPayload("memory.embed-items", payload);\n    return runEmbedItems(payload, createWorkerDependencies(signal))',
    );
    expect(trigger).toContain(
      'parseMemoryTaskPayload("memory.reembed-item", payload);\n    return runReembedItem(payload, createWorkerDependencies(signal))',
    );
    expect(trigger).toContain(
      'parseMemoryTaskPayload("memory.expire-items", payload);\n    return runExpireItems(payload, createWorkerDependencies(signal))',
    );
    expect(trigger).toContain("signal,");
    expect(trigger).toContain("maxAttempts: 3");
    expect(trigger).toContain("maxDuration:");
    for (const runner of runners) expect(runner).not.toContain("@trigger.dev/sdk");
  });

  it("registers the capture pump on the planned crons with org-level concurrency 2", async () => {
    const trigger = await readFile(resolve(process.cwd(), "src/trigger/memory.ts"), "utf8");

    expect(trigger).toContain('id: "memory-capture.dispatch"');
    expect(trigger).toContain('id: "memory-capture.dispatch-org"');
    expect(trigger).toContain('id: "memory-capture.reconcile"');
    expect(trigger).toMatch(/schedules\.task\(\{[\s\S]*?cron: "\* \* \* \* \*"/);
    expect(trigger).toMatch(/schedules\.task\(\{[\s\S]*?cron: "\*\/15 \* \* \* \*"/);
    // A string cron runs in UTC by Trigger.dev contract; no timezone override
    // may drift the pump off the plan.
    for (const taskId of ["memory-capture.dispatch", "memory-capture.reconcile"]) {
      const body = trigger.slice(trigger.indexOf(`id: "${taskId}"`));
      expect(body.slice(0, 400)).not.toMatch(/timezone\s*:/);
    }
    // Queue-level concurrency: at most two organizations project at once.
    expect(trigger).toContain('name: "memory-capture"');
    expect(trigger).toContain("concurrencyLimit: 2");
    expect(trigger).toContain("queue: memoryCaptureQueue");
  });

  it("wires dispatch through the leased RPCs and reconcile through the cursor RPCs plus channel wrappers", async () => {
    const trigger = await readFile(resolve(process.cwd(), "src/trigger/memory.ts"), "utf8");
    // The leased claim/load/complete/fail names live behind the capture
    // repository: the schedule drives listDueOrganizations directly, the
    // per-org runner drives the rest.
    const runner = await readFile(
      resolve(process.cwd(), "src/workflows/memory/capture-dispatch.ts"),
      "utf8",
    );
    const repository = await readFile(
      resolve(process.cwd(), "src/modules/memory/infrastructure/capture-repository.ts"),
      "utf8",
    );

    expect(trigger).toContain("listDueOrganizations(");
    for (const method of [".claim({", ".load({", ".complete({", ".fail({"]) {
      expect(runner).toContain(method);
    }
    for (const rpc of [
      '"list_memory_capture_due_orgs"',
      '"claim_memory_capture_events"',
      '"load_memory_capture_event"',
      '"complete_memory_capture_event"',
      '"fail_memory_capture_event"',
    ]) {
      expect(repository).toContain(rpc);
    }
    for (const rpc of [
      '"update_memory_capture_cursor"',
      '"update_memory_reconcile_org_cursor"',
      '"reconcile_memory_channel_findings"',
      '"reconcile_memory_channel_recommendations"',
      '"reconcile_memory_channel_decision"',
    ]) {
      expect(trigger).toContain(rpc);
    }
    // No private-schema PostgREST calls: schema exposure is platform config
    // no migration controls, so the worker's only path is the public wrappers.
    expect(trigger).not.toContain(".schema(");
    // Enqueue answers convert through the shared pure helper, so the
    // uuid-returning decision wrapper can never be validated as an integer.
    expect(trigger).toContain("toEnqueuedCount(");
    // Fair org rotation: resume after the freshest rotation marker with
    // wrap-around, persisting each fully-reconciled org.
    expect(trigger).toContain("reconcile_org_cursor");
    expect(trigger).toContain("resumedAfter");
    // The per-org runner validates before the service client exists.
    expect(trigger).toContain("captureDispatchOrgPayloadSchema.parse(payload)");
    expect(trigger).toContain("createMemoryWorkerServiceClient()");
    expect(trigger).toContain("runCaptureDispatch(parsed,");
    expect(trigger).toContain("runCaptureReconcile(");
    // Channel only until later slices register more adapters.
    expect(trigger).toContain('"channel"');
    // Identifiers, counts, and safe codes only — never bodies.
    expect(trigger).toContain("memory.capture_dispatch_org_finished");
    expect(trigger).toContain("memory.capture_reconcile_finished");
    expect(trigger).not.toMatch(/projectionDocument|projection_document/);
  });

  it("keeps the capture runners free of the Trigger SDK", async () => {
    const runner = await readFile(
      resolve(process.cwd(), "src/workflows/memory/capture-dispatch.ts"),
      "utf8",
    );

    expect(runner).not.toContain("@trigger.dev/sdk");
    expect(runner).toContain("runCaptureDispatch");
    expect(runner).toContain("runCaptureReconcile");
  });
});
