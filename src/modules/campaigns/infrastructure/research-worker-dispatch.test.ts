import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({
  env: { CAMPAIGN_GENERATION_COST_CEILING_MINOR: undefined },
}));

const { triggerMock } = vi.hoisted(() => ({ triggerMock: vi.fn() }));
vi.mock("@trigger.dev/sdk", () => ({ tasks: { trigger: triggerMock } }));

import { dispatchResearchWorker } from "@/modules/campaigns/infrastructure/research-worker-dispatch";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "e1000000-0000-4000-8000-000000000001";
const CORRELATION_ID = "f1000000-0000-4000-8000-000000000001";

beforeEach(() => {
  triggerMock.mockReset();
  triggerMock.mockResolvedValue({ id: "run_worker_1" });
});

describe("handing an admitted research run to a worker", () => {
  it("pairs the platform preparation figure with the policy currency", async () => {
    const started = await dispatchResearchWorker({
      organizationId: ORGANIZATION_ID,
      runId: RUN_ID,
      correlationId: CORRELATION_ID,
      evidenceMaxAgeDays: 30,
      allowanceCurrency: "AED",
    });

    expect(started).toBe(true);
    expect(triggerMock).toHaveBeenCalledTimes(1);
    const [taskId, payload, options] = triggerMock.mock.calls[0] as [
      string,
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(taskId).toBe("campaign.research-proposal");
    // The default dispatch figure (no env override in this test) in the
    // admitting policy's currency: the purse the planner must copy exactly.
    expect(payload).toMatchObject({
      organizationId: ORGANIZATION_ID,
      runId: RUN_ID,
      correlationId: CORRELATION_ID,
      evidenceMaxAgeDays: 30,
      preparationAllowance: { amountMinor: 500, currency: "AED" },
    });
    expect(options).toMatchObject({ idempotencyKey: `campaign-research:${RUN_ID}` });
  });

  it("reports a dispatch that never landed as not started", async () => {
    triggerMock.mockRejectedValueOnce(new Error("queue down"));

    const started = await dispatchResearchWorker({
      organizationId: ORGANIZATION_ID,
      runId: RUN_ID,
      correlationId: CORRELATION_ID,
      evidenceMaxAgeDays: 30,
      allowanceCurrency: "AED",
    });

    // The run stays queued and the lease sweep offers it again; the caller
    // reports "not started yet", never silence.
    expect(started).toBe(false);
  });
});
