import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { trigger } = vi.hoisted(() => ({ trigger: vi.fn(async () => ({ id: "run_test" })) }));
vi.mock("@trigger.dev/sdk", () => ({ tasks: { trigger } }));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { wakeBranchResearchDispatch } from "@/modules/growth-intelligence/application/dispatch";
import { logger } from "@/lib/logger";

const ORGANIZATION = "20000000-0000-4000-8000-000000000002";
const CORRELATION = "30000000-0000-4000-8000-000000000003";

beforeEach(() => {
  trigger.mockClear();
  vi.clearAllMocks();
});

describe("wakeBranchResearchDispatch", () => {
  it("wakes the dispatcher with a per-start key, so a bare operator start does not wait for the next report", async () => {
    await wakeBranchResearchDispatch({ organizationId: ORGANIZATION, correlationId: CORRELATION });

    expect(trigger).toHaveBeenCalledWith(
      "growth-intelligence.dispatch-due",
      { correlationId: CORRELATION },
      { idempotencyKey: `growth-intelligence:branch-wake:${CORRELATION}` },
    );
  });

  it("logs a lost wake instead of throwing it", async () => {
    trigger.mockRejectedValueOnce(new Error("transport down"));

    await expect(
      wakeBranchResearchDispatch({ organizationId: ORGANIZATION, correlationId: CORRELATION }),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      "growth_intelligence.branch_dispatch_wake_failed",
      expect.objectContaining({ organizationId: ORGANIZATION, correlationId: CORRELATION }),
    );
  });
});
