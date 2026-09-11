import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createCaptureRepository } from "@/modules/memory/infrastructure/capture-repository";

const ORG = "00000000-0000-4000-8000-000000000001";
const CAPTURE = "00000000-0000-4000-8000-000000000002";
const TOKEN = "00000000-0000-4000-8000-000000000003";

function clientWith(
  handler: (name: string) => { data: unknown; error: { code?: string } | null },
) {
  return {
    rpc: vi.fn(async (name: string) => handler(name)),
  };
}

describe("createCaptureRepository", () => {
  it("claims bounded identifiers through the leased RPC", async () => {
    const client = clientWith((name) =>
      name === "claim_memory_capture_events"
        ? { data: { captureIds: [CAPTURE] }, error: null }
        : { data: null, error: { code: "XXXX" } },
    );
    const repository = createCaptureRepository(client);

    const ids = await repository.claim({
      organizationId: ORG,
      claimToken: TOKEN,
      limit: 25,
      leaseSeconds: 120,
    });

    expect(ids).toEqual([CAPTURE]);
    expect(client.rpc).toHaveBeenCalledWith("claim_memory_capture_events", {
      p_organization_id: ORG,
      p_claim_token: TOKEN,
      p_limit: 25,
      p_lease_seconds: 120,
    });
  });

  it("returns completed and replayed projections without inventing items", async () => {
    const repository = createCaptureRepository(
      clientWith(() => ({
        data: { status: "completed", captureId: CAPTURE, projectedItemId: "item-1" },
        error: null,
      })),
    );

    expect(
      await repository.complete({ organizationId: ORG, captureId: CAPTURE, claimToken: TOKEN }),
    ).toEqual({ status: "completed", captureId: CAPTURE, projectedItemId: "item-1" });

    const replayed = createCaptureRepository(
      clientWith(() => ({
        data: { status: "replayed", captureId: CAPTURE, projectedItemId: "item-1" },
        error: null,
      })),
    );
    expect(
      await replayed.complete({ organizationId: ORG, captureId: CAPTURE, claimToken: TOKEN }),
    ).toEqual({ status: "replayed", captureId: CAPTURE, projectedItemId: "item-1" });
  });

  it("refuses malformed answers instead of defaulting", async () => {
    const repository = createCaptureRepository(clientWith(() => ({ data: null, error: null })));

    await expect(
      repository.complete({ organizationId: ORG, captureId: CAPTURE, claimToken: TOKEN }),
    ).rejects.toThrow();
    await expect(
      repository.fail({
        organizationId: ORG,
        captureId: CAPTURE,
        claimToken: TOKEN,
        safeCode: "TRANSIENT_DB",
      }),
    ).rejects.toThrow();
  });

  it("surfaces provider errors as domain errors", async () => {
    const repository = createCaptureRepository(
      clientWith(() => ({ data: null, error: { code: "42501" } })),
    );

    await expect(repository.listDueOrganizations(100)).rejects.toThrow();
  });

  it("retries only to pending and rejects anything else", async () => {
    const pending = createCaptureRepository(
      clientWith(() => ({ data: { captureId: CAPTURE, status: "pending" }, error: null })),
    );
    await expect(
      pending.retry({ organizationId: ORG, actorId: ORG, captureId: CAPTURE, correlationId: ORG }),
    ).resolves.toEqual({ captureId: CAPTURE, status: "pending" });

    const refused = createCaptureRepository(
      clientWith(() => ({ data: { captureId: CAPTURE, status: "completed" }, error: null })),
    );
    await expect(
      refused.retry({ organizationId: ORG, actorId: ORG, captureId: CAPTURE, correlationId: ORG }),
    ).rejects.toThrow();
  });
});
