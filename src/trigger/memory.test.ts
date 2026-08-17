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
});
