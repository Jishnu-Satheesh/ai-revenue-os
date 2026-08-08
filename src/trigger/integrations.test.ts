import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("Integration Trigger cancellation registration", () => {
  it("registers one global cancellation hook and routes only known task IDs", async () => {
    const source = await readFile(resolve(process.cwd(), "src/trigger/integrations.ts"), "utf8");
    expect(source.match(/tasks\.onCancel\(/g)).toHaveLength(1);
    expect(source).toContain("const cancellationParsers");
    expect(source).toContain("if (!parsePayload) return;");
    expect(source).not.toContain("tasks.onCancel(taskId");
  });
});
