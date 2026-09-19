import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { trigger } = vi.hoisted(() => ({ trigger: vi.fn() }));

vi.mock("@trigger.dev/sdk", () => ({ tasks: { trigger } }));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { dispatchGrowthBuildNow } from "@/modules/organizations/infrastructure/growth-publication-dispatch";

const INPUT = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  snapshotDate: "2026-09-19",
  timeZone: "Asia/Dubai",
  gates: { growth: true, campaigns: false },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("dispatchGrowthBuildNow", () => {
  it("triggers the nightly build task with the nightly idempotency key", async () => {
    trigger.mockResolvedValue({ id: "run_1" });
    await expect(dispatchGrowthBuildNow(INPUT)).resolves.toBe(true);
    expect(trigger).toHaveBeenCalledTimes(1);
    const [taskId, payload, options] = trigger.mock.calls[0] as [
      string,
      Record<string, unknown>,
      { idempotencyKey: string },
    ];
    expect(taskId).toBe("revenue-snapshots.build-org");
    expect(payload).toMatchObject({
      organizationId: INPUT.organizationId,
      snapshotDate: INPUT.snapshotDate,
      timeZone: INPUT.timeZone,
      gates: INPUT.gates,
    });
    expect(typeof payload.correlationId).toBe("string");
    // Same key the hourly dispatcher uses: a manual run and the scheduled
    // run collapse instead of queueing twice.
    expect(options.idempotencyKey).toBe(
      `revenue-snapshot:${INPUT.organizationId}:${INPUT.snapshotDate}`,
    );
  });

  it("returns false without throwing when the worker cannot be reached", async () => {
    trigger.mockRejectedValue(new Error("offline"));
    await expect(dispatchGrowthBuildNow(INPUT)).resolves.toBe(false);
  });
});
