import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("Campaign Decision Trigger registration", () => {
  it("registers one bounded schema task without activating a dispatcher", async () => {
    const source = await readFile(resolve(process.cwd(), "src/trigger/decisions.ts"), "utf8");

    expect(source).toContain("schemaTask({");
    expect(source).toContain('id: "decision.run-campaign-cycle"');
    expect(source).toContain('name: "decision-campaign-cycle"');
    expect(source).toContain("concurrencyLimit: 1");
    expect(source).toContain("maxAttempts: 3");
    expect(source).toContain("maxDuration: 300");
    expect(source).not.toContain("schedules.task");
    expect(source).not.toContain("triggerAndWait");
  });

  it("parses before privileged dependency construction in runs and cancellation", async () => {
    const source = await readFile(resolve(process.cwd(), "src/trigger/decisions.ts"), "utf8");

    expect(source.match(/tasks\.onCancel\(/g)).toHaveLength(1);
    expect(source).toMatch(
      /const parsed = parseCampaignDecisionCyclePayload\(payload\);\s+const dependencies = createDependencies\(signal\);/,
    );
    expect(source).toMatch(
      /const parsed = parseCampaignDecisionCyclePayload\(payload\);\s+const cycles = createCycleRepository\(\);/,
    );
    expect(source.indexOf("parseCampaignDecisionCyclePayload(payload)")).toBeLessThan(
      source.indexOf("createDecisionWorkerServiceClient()"),
    );
  });

  it("logs normalized identifiers only", async () => {
    const source = await readFile(resolve(process.cwd(), "src/trigger/decisions.ts"), "utf8");

    expect(source).toContain('logger.info("decision.campaign_cycle_finished"');
    expect(source).not.toContain("logger.info(payload");
    expect(source).not.toMatch(/logger\.(?:info|warn|error)\([^)]*evidence[\s\S]*/);
    expect(source).not.toMatch(/logger\.(?:info|warn|error)\([^)]*idempotencyKey[\s\S]*/);
  });
});
