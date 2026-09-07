import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { trigger } = vi.hoisted(() => ({ trigger: vi.fn(async () => ({ id: "run_test" })) }));
vi.mock("@trigger.dev/sdk", () => ({ tasks: { trigger } }));
vi.mock("@/modules/integrations/application/feature-access", () => ({
  isGovernedChannelAnalysisEnabled: () => true,
}));

import { requestChannelRecommendations } from "@/modules/analysis/application/dispatch";

const ORGANIZATION = "00000000-0000-4000-8000-000000000001";
const CHANNEL = "00000000-0000-4000-8000-000000000002";
const RUN = "00000000-0000-4000-8000-000000000003";

beforeEach(() => {
  trigger.mockClear();
});

describe("requesting narration for a run that has none", () => {
  it("dispatches the recommendations task for that exact run", async () => {
    const dispatched = await requestChannelRecommendations({
      organizationId: ORGANIZATION,
      channelId: CHANNEL,
      analysisRunId: RUN,
      correlationId: "c1",
    });

    expect(dispatched).toBe(true);
    expect(trigger).toHaveBeenCalledTimes(1);
    const [taskId, payload] = trigger.mock.calls[0] as unknown as [
      string,
      { analysisRunId: string; channelId: string },
    ];
    expect(taskId).toBe("channel-recommendations.generate");
    expect(payload.analysisRunId).toBe(RUN);
    expect(payload.channelId).toBe(CHANNEL);
  });

  it("keys repeat presses on the run, so a double click does not queue duplicate narrations", async () => {
    await requestChannelRecommendations({
      organizationId: ORGANIZATION,
      channelId: CHANNEL,
      analysisRunId: RUN,
      correlationId: "c1",
    });
    await requestChannelRecommendations({
      organizationId: ORGANIZATION,
      channelId: CHANNEL,
      analysisRunId: RUN,
      correlationId: "c2",
    });

    const calls = trigger.mock.calls as unknown as Array<
      [string, unknown, { idempotencyKey: string; idempotencyKeyTTL: string }]
    >;
    const keys = calls.map((call) => call[2].idempotencyKey);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).toContain(RUN);
  });

  it("expires the key in minutes, so a refused narration can be asked for again", async () => {
    // Trigger clears the key of a run that failed, but a run the fence refused
    // returns `skipped` and succeeds -- and a successful run holds its key for
    // thirty days by default. Without a short TTL the button would report
    // success and do nothing for a month.
    await requestChannelRecommendations({
      organizationId: ORGANIZATION,
      channelId: CHANNEL,
      analysisRunId: RUN,
      correlationId: "c1",
    });

    const [, , options] = trigger.mock.calls[0] as unknown as [
      string,
      unknown,
      { idempotencyKeyTTL: string },
    ];
    expect(options.idempotencyKeyTTL).toBe("5m");
  });
});
