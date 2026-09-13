import { describe, expect, it, vi } from "vitest";

import {
  createDeliverableRepository,
  deliverableFailure,
  type DeliverablePersistence,
} from "@/modules/campaigns/infrastructure/deliverable-repository";

const ORGANIZATION = "11111111-1111-4111-8111-111111111111";

describe("reading a database refusal", () => {
  it("names each refusal the migration raises", () => {
    expect(deliverableFailure({ message: "campaign_deliverable_superseded" })).toEqual({
      kind: "superseded",
    });
    expect(deliverableFailure({ message: "campaign_deliverable_content_changed" })).toEqual({
      kind: "content_changed",
    });
    expect(deliverableFailure({ message: "campaign_deliverable_forbidden" })).toEqual({
      kind: "forbidden",
    });
  });

  it("falls back to SQLSTATE when the message says nothing recognisable", () => {
    expect(deliverableFailure({ code: "42501", message: "boom" })).toEqual({ kind: "forbidden" });
    expect(deliverableFailure({ code: "23505", message: "boom" })).toEqual({ kind: "conflict" });
  });

  it("reports an unknown refusal as unavailable rather than guessing", () => {
    expect(deliverableFailure({ code: "XX000", message: "new" })).toEqual({ kind: "unavailable" });
  });
});

describe("the review call", () => {
  it("sends no actor, so a forged reviewer has nowhere to land", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { review_id: "r", outcome: "saved" },
      error: null,
    });
    const repository = createDeliverableRepository({
      rpc,
      from: vi.fn(),
    } as unknown as DeliverablePersistence);

    await repository.reviewVersion({
      organizationId: ORGANIZATION,
      payload: { deliverable_version_id: "v", content_hash: "a".repeat(64), decision: "approved" },
    });

    const sent = JSON.stringify(rpc.mock.calls[0]?.[1]);
    expect(sent).not.toContain("actor");
  });

  it("throws the mapped failure instead of returning a half-result", async () => {
    const repository = createDeliverableRepository({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: "22023", message: "campaign_deliverable_content_changed" },
      }),
      from: vi.fn(),
    } as unknown as DeliverablePersistence);

    await expect(
      repository.reviewVersion({
        organizationId: ORGANIZATION,
        payload: { deliverable_version_id: "v" },
      }),
    ).rejects.toEqual({ kind: "content_changed" });
  });
});
