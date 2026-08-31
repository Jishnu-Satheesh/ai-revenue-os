import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { ORGANIZATION, CHANNEL } from "@/domain/analysis/test-fixtures";
import {
  channelRecommendationsTaskSchema,
  runChannelRecommendations,
} from "@/workflows/analysis/run-channel-recommendations";

const RUN = "00000000-0000-4000-8000-0000000000c1";
const CORRELATION = "00000000-0000-4000-8000-0000000000d1";

const validPayload = {
  organizationId: ORGANIZATION,
  channelId: CHANNEL,
  analysisRunId: RUN,
  correlationId: CORRELATION,
};

describe("channel recommendations payload schema", () => {
  it("parses a well-formed payload untouched", () => {
    expect(channelRecommendationsTaskSchema.parse(validPayload)).toEqual(validPayload);
  });

  it("accepts a null channel id: the run's own scope is authoritative", () => {
    const parsed = channelRecommendationsTaskSchema.parse({ ...validPayload, channelId: null });
    expect(parsed.channelId).toBeNull();
  });

  it("rejects a non-uuid identifier", () => {
    const result = channelRecommendationsTaskSchema.safeParse({
      ...validPayload,
      analysisRunId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing correlation id", () => {
    const partial = {
      organizationId: validPayload.organizationId,
      channelId: validPayload.channelId,
      analysisRunId: validPayload.analysisRunId,
    };
    expect(channelRecommendationsTaskSchema.safeParse(partial).success).toBe(false);
  });

  it("rejects an unknown extra field", () => {
    expect(
      channelRecommendationsTaskSchema.safeParse({ ...validPayload, windowStart: "2026-01-01" })
        .success,
    ).toBe(false);
  });
});

describe("channel recommendations Trigger registration", () => {
  // Registration is asserted against source rather than a live worker: the
  // task list only syncs on `dev`/`deploy`, which this suite never starts.
  it("registers one generate schemaTask wired onto the fenced RPCs", async () => {
    const source = await readFile(resolve(process.cwd(), "src/trigger/recommendations.ts"), "utf8");

    expect(source).toContain('id: "channel-recommendations.generate"');
    expect(source).toContain("schemaTask({");
    expect(source).toContain("channelRecommendationsTaskSchema");
    for (const rpc of [
      '"claim_channel_recommendations"',
      '"complete_channel_recommendations"',
      '"fail_channel_recommendations"',
    ]) {
      expect(source).toContain(rpc);
    }
    // Exact fence arguments, verified against migration 20260824110000 and its
    // 20260824150000 repair.
    for (const arg of [
      "p_correlation_id",
      "p_claim_token",
      "p_provider",
      "p_model_id",
      "p_prompt_version",
      "p_prompt_digest",
      "p_output_digest",
      "p_result_digest",
      "p_recommendations",
      "p_failure_code",
    ]) {
      expect(source).toContain(arg);
    }
    // The findings read stays inside one run's scope in one tenant.
    expect(source).toContain('.eq("organization_id"');
    expect(source).toContain('.eq("analysis_run_id"');
  });

  it("registers the evaluate schedule at exactly the planned cron, UTC", async () => {
    const source = await readFile(resolve(process.cwd(), "src/trigger/recommendations.ts"), "utf8");

    expect(source).toContain('id: "channel-recommendations.evaluate"');
    expect(source).toMatch(/schedules\.task\(\{[\s\S]*?cron: "0 3 \*\/2 \* \*"/);
    // A string cron runs in UTC by Trigger.dev contract; no timezone override
    // may drift the judge off the plan's Global Constraints.
    expect(source).not.toContain("timezone:");
  });

  it("lets Postgres anti-join the bounded judge cursor and logs refused ids", async () => {
    const source = await readFile(resolve(process.cwd(), "src/trigger/recommendations.ts"), "utf8");

    expect(source).toContain("channel_recommendation_evaluations!left()");
    expect(source).toContain('.is("channel_recommendation_evaluations.recommendation_id", null)');
    expect(source).toContain('logger.warn("channel_recommendations.evaluation_refused"');
    expect(source).not.toContain('.select("recommendation_id")');
  });

  it("chains the narrator only behind a completed detector run, without failing it", async () => {
    const source = await readFile(resolve(process.cwd(), "src/trigger/analysis.ts"), "utf8");

    expect(source).toContain("import type { channelRecommendationsTask }");
    expect(source).toContain(
      'tasks.trigger<typeof channelRecommendationsTask>("channel-recommendations.generate"',
    );
    const chain = source.slice(
      source.indexOf('if (result.outcome === "completed")'),
      source.indexOf("channel_analysis.run_completed"),
    );
    expect(chain).toContain("try");
    expect(chain).toContain('logger.warn("channel_recommendations.dispatch_failed"');
    expect(chain).not.toContain("throw");
  });
});

describe("a failed narration must not report success", () => {
  // Staging run run_06g4ea6s6md5t1i1eu3eeqle01 recorded
  // MODEL_PROVIDER_UNAVAILABLE in the fence and still finished COMPLETED on
  // the dashboard, because the task returned normally. The task's own
  // maxAttempts never fired and the outage looked green.
  it("throws on a failed outcome so Trigger marks the run failed and retries", async () => {
    const source = await readFile(resolve(process.cwd(), "src/trigger/recommendations.ts"), "utf8");

    const body = source.slice(source.indexOf("channel_recommendations.run_completed"));
    expect(body).toContain('result.outcome === "failed"');
    expect(body).toMatch(/throw new/);
  });

  it("logs the fence's failure code, so the reason is legible without a database read", async () => {
    const source = await readFile(resolve(process.cwd(), "src/trigger/recommendations.ts"), "utf8");

    expect(source).toContain("failureCode: result.failureCode");
  });
});

describe("task bodies stay thin", () => {
  it("delegates everything to the workflow module, which owns the behaviour tests", async () => {
    const source = await readFile(resolve(process.cwd(), "src/trigger/recommendations.ts"), "utf8");

    expect(source).toContain("runChannelRecommendations(payload");
    // The workflow itself decides what a failure means; the trigger file adds
    // transport only. Its own logic tests live beside it.
    expect(typeof runChannelRecommendations).toBe("function");
  });
});
