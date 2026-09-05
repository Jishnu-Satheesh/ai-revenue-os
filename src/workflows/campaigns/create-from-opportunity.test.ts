import { describe, expect, it, vi } from "vitest";

import {
  createFromOpportunity,
  type DraftRequestClaim,
} from "@/workflows/campaigns/create-from-opportunity";

const input = {
  organizationId: "10000000-0000-4000-8000-000000000001",
  requestId: "20000000-0000-4000-8000-000000000002",
  claimToken: "30000000-0000-4000-8000-000000000003",
  idempotencyKey: "draft-worker-idempotency-0001",
  leaseSeconds: 300,
  correlationId: "60000000-0000-4000-8000-000000000006",
};

function drafts(overrides: Partial<DraftRequestClaim> = {}): DraftRequestClaim & {
  claim: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  fail: ReturnType<typeof vi.fn>;
} {
  const ports = {
    claim: vi.fn(async () => ({ status: "processing" })),
    create: vi.fn(async () => ({
      campaignId: "40000000-0000-4000-8000-000000000004",
      sourceSnapshotId: "50000000-0000-4000-8000-000000000005",
      status: "created",
    })),
    fail: vi.fn(async () => ({ status: "retryable_failed" })),
    ...overrides,
  } as unknown as DraftRequestClaim & {
    claim: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    fail: ReturnType<typeof vi.fn>;
  };
  return ports;
}

describe("createFromOpportunity", () => {
  it("claims, freezes, and returns the created draft linkage", async () => {
    const ports = drafts();

    const outcome = await createFromOpportunity(ports, input);

    expect(outcome).toEqual({
      outcome: "created",
      campaignId: "40000000-0000-4000-8000-000000000004",
      sourceSnapshotId: "50000000-0000-4000-8000-000000000005",
    });
    expect(ports.claim).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: input.requestId, claimToken: input.claimToken }),
    );
  });

  it("stands down silently when another worker holds the claim", async () => {
    const ports = drafts({ claim: vi.fn(async () => Promise.reject(new Error("taken"))) });

    const outcome = await createFromOpportunity(ports, input);

    expect(outcome).toEqual({ outcome: "claim_conflict" });
    expect(ports.create).not.toHaveBeenCalled();
    expect(ports.fail).not.toHaveBeenCalled();
  });

  it("marks changed prerequisites permanently failed, never retried", async () => {
    const ports = drafts({
      create: vi.fn(async () => Promise.reject({ code: "22023", message: "moved" })),
    });

    const outcome = await createFromOpportunity(ports, input);

    expect(outcome).toEqual({
      outcome: "failed",
      retryable: false,
      failureCode: "stale_prerequisite",
    });
    expect(ports.fail).toHaveBeenCalledWith(expect.objectContaining({ retryable: false }));
  });

  it("marks transport failures retryable and replays exact redeliveries", async () => {
    const ports = drafts({
      create: vi.fn(async () => Promise.reject(new Error("connection reset"))),
    });

    const outcome = await createFromOpportunity(ports, input);
    expect(outcome).toEqual({
      outcome: "failed",
      retryable: true,
      failureCode: "worker_error",
    });

    const replayPorts = drafts({
      create: vi.fn(async () => ({
        campaignId: "40000000-0000-4000-8000-000000000004",
        sourceSnapshotId: "50000000-0000-4000-8000-000000000005",
        status: "replayed",
      })),
    });
    const replay = await createFromOpportunity(replayPorts, input);
    expect(replay.outcome).toBe("replayed");
    expect(replayPorts.fail).not.toHaveBeenCalled();
  });

  it("refuses a malformed payload before touching any port", async () => {
    const ports = drafts();

    await expect(
      createFromOpportunity(ports, { ...input, idempotencyKey: "short" }),
    ).rejects.toThrow();
    expect(ports.claim).not.toHaveBeenCalled();
  });
});
