import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({
  env: { CAMPAIGN_GENERATION_COST_CEILING_MINOR: undefined },
}));

const triggerMock = vi.fn();
vi.mock("@trigger.dev/sdk", () => ({ tasks: { trigger: triggerMock } }));

import {
  createTriggerGenerationDispatcher,
  enqueueAndDispatchRevision,
  generationCostCeilingMinor,
} from "@/modules/campaigns/infrastructure/generation-dispatch";
import type { CampaignRunDispatcher } from "@/modules/campaigns/infrastructure/run-repository";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN_ID = "c1000000-0000-4000-8000-000000000001";
const SNAPSHOT_ID = "a1000000-0000-4000-8000-000000000001";
const RUN_ID = "e1000000-0000-4000-8000-000000000001";
const CORRELATION_ID = "f1000000-0000-4000-8000-000000000001";
const VERSION_ID = "d1000000-0000-4000-8000-000000000001";
const DIGEST = "a".repeat(64);

const enqueue = vi.fn();
const runs = { enqueue } as unknown as CampaignRunDispatcher;

beforeEach(() => {
  enqueue.mockReset();
  triggerMock.mockReset();
  enqueue.mockResolvedValue({ runId: RUN_ID, replayed: false });
  triggerMock.mockResolvedValue({ id: "run_worker_1" });
});

function generationInput() {
  return {
    organizationId: ORGANIZATION_ID,
    campaignId: CAMPAIGN_ID,
    sourceSnapshotId: SNAPSHOT_ID,
    idempotencyKey: "key-12345678",
    correlationId: CORRELATION_ID,
  };
}

describe("an enqueued run is actually handed to a worker", () => {
  it("records the run and then dispatches the task that performs it", async () => {
    await createTriggerGenerationDispatcher(runs).enqueueGeneration(generationInput());

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(triggerMock).toHaveBeenCalledTimes(1);
    const [taskId, payload] = triggerMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(taskId).toBe("campaign.generate-bundle");
    expect(payload).toMatchObject({
      organizationId: ORGANIZATION_ID,
      campaignId: CAMPAIGN_ID,
      runId: RUN_ID,
      correlationId: CORRELATION_ID,
    });
  });

  it("dispatches the run id the database issued, not one invented here", async () => {
    enqueue.mockResolvedValue({ runId: "b2000000-0000-4000-8000-000000000002", replayed: false });

    await createTriggerGenerationDispatcher(runs).enqueueGeneration(generationInput());

    const [, payload] = triggerMock.mock.calls[0] as [string, { runId: string }];
    expect(payload.runId).toBe("b2000000-0000-4000-8000-000000000002");
  });

  it("bounds what one attempt may spend before the worker starts", async () => {
    await createTriggerGenerationDispatcher(runs).enqueueGeneration(generationInput());

    const [, payload] = triggerMock.mock.calls[0] as [string, { costCeilingMinor: number }];
    expect(payload.costCeilingMinor).toBeGreaterThan(0);
  });

  it("carries an idempotency key so a retried request is not two runs", async () => {
    await createTriggerGenerationDispatcher(runs).enqueueGeneration(generationInput());

    const [, , options] = triggerMock.mock.calls[0] as [
      string,
      unknown,
      { idempotencyKey: string },
    ];
    expect(options.idempotencyKey).toBe("key-12345678");
  });

  it("still dispatches a replay, because a stranded run is worse than a duplicate", async () => {
    enqueue.mockResolvedValue({ runId: RUN_ID, replayed: true });

    const result =
      await createTriggerGenerationDispatcher(runs).enqueueGeneration(generationInput());

    expect(result).toMatchObject({ replayed: true });
    expect(triggerMock).toHaveBeenCalledTimes(1);
  });

  it("reports a failed dispatch instead of leaving the run queued forever", async () => {
    triggerMock.mockRejectedValue(new Error("trigger unreachable"));

    await expect(
      createTriggerGenerationDispatcher(runs).enqueueGeneration(generationInput()),
    ).rejects.toThrow(/Generation could not be started/);
  });

  it("never dispatches when the run could not be recorded", async () => {
    enqueue.mockRejectedValue(new Error("database refused"));

    await expect(
      createTriggerGenerationDispatcher(runs).enqueueGeneration(generationInput()),
    ).rejects.toThrow();
    expect(triggerMock).not.toHaveBeenCalled();
  });
});

describe("a revision dispatch pins the version it was written against", () => {
  it("sends the base version and digest to the worker", async () => {
    await enqueueAndDispatchRevision(runs, {
      organizationId: ORGANIZATION_ID,
      campaignId: CAMPAIGN_ID,
      sourceSnapshotId: SNAPSHOT_ID,
      kind: "revise",
      idempotencyKey: "key-12345678",
      correlationId: CORRELATION_ID,
      baseVersionId: VERSION_ID,
      baseDigest: DIGEST,
    });

    const [taskId, payload] = triggerMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(taskId).toBe("campaign.revise-bundle");
    expect(payload).toMatchObject({ baseVersionId: VERSION_ID, baseDigest: DIGEST });
  });

  it("does not put the operator's words in the task payload", async () => {
    await enqueueAndDispatchRevision(runs, {
      organizationId: ORGANIZATION_ID,
      campaignId: CAMPAIGN_ID,
      sourceSnapshotId: SNAPSHOT_ID,
      kind: "revise",
      idempotencyKey: "key-12345678",
      correlationId: CORRELATION_ID,
      baseVersionId: VERSION_ID,
      baseDigest: DIGEST,
      operatorPrompt: "Drop the discount language.",
      patchScope: "copy",
    });

    // The prompt is business content and stays on the run row, which the worker
    // reads. A payload is kept in logs and shown in a dashboard.
    const [, payload] = triggerMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(JSON.stringify(payload)).not.toContain("discount language");
  });
});

describe("the spend ceiling refuses a nonsense configuration", () => {
  it("falls back to a low default when unset", () => {
    expect(generationCostCeilingMinor(undefined)).toBeGreaterThan(0);
  });

  it("accepts a configured integer", () => {
    expect(generationCostCeilingMinor("2500")).toBe(2500);
  });

  it.each(["0", "-1", "abc", "1e9", "10000001"])("refuses %s rather than guessing", (value) => {
    expect(() => generationCostCeilingMinor(value)).toThrow(/positive integer/);
  });
});
