import { describe, expect, it, vi } from "vitest";

import { beginAgentAttachment, submitAgentAttachment } from "./report-intake-transport";

const identity = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  actorId: "22222222-2222-4222-8222-222222222222",
  turnId: "33333333-3333-4333-8333-333333333333",
};
const attachmentId = "44444444-4444-4444-8444-444444444444";

describe("agent report upload handoff", () => {
  it("returns a signed resumable staging upload only after an authorized intent", async () => {
    const sign = vi.fn(async () => ({ token: "private-token" }));
    const result = await beginAgentAttachment({
      ...identity, fileName: "sales.csv", mediaType: "text/csv", byteSize: 100,
      idempotencyKey: "attachment-upload-001",
    }, {
      createIntent: vi.fn(async () => ({
        attachmentId, storageBucketId: "agent-report-staging",
        storagePath: `${identity.organizationId}/${identity.turnId}/${attachmentId}`,
        expiresAt: "2026-10-01T12:00:00Z", replayed: false,
      })),
      sign,
    });
    expect(result.attachmentId).toBe(attachmentId);
    expect(result.upload.token).toBe("private-token");
    expect(sign).toHaveBeenCalledWith({
      bucket: "agent-report-staging",
      path: `${identity.organizationId}/${identity.turnId}/${attachmentId}`,
    });
  });

  it("persists declared scope before identifier-only dispatch", async () => {
    const order: string[] = [];
    const scope = {
      channelId: "55555555-5555-4555-8555-555555555555",
      branchId: "66666666-6666-4666-8666-666666666666",
      reportType: "Talabat sales", periodStart: "2026-09-01", periodEnd: "2026-09-30",
      currency: "AED",
    };
    await submitAgentAttachment({ ...identity, attachmentId, scope }, {
      declareScope: async () => { order.push("declared"); },
      dispatch: async (payload) => {
        order.push("dispatched");
        expect(payload).toEqual({ organizationId: identity.organizationId, turnId: identity.turnId, attachmentId });
      },
    });
    expect(order).toEqual(["declared", "dispatched"]);
  });
});
