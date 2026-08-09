import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createSupabaseMemoryWorkerRepository } from "@/modules/memory/infrastructure/worker-repository";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const ITEM_ID = "44444444-4444-4444-8444-444444444444";
const REVISION = "2026-08-09T00:00:00.000Z";
const NOW = "2026-08-09T12:00:00.000Z";

describe("createSupabaseMemoryWorkerRepository", () => {
  it("uses revision and current eligibility predicates for a re-embedding reset", async () => {
    const query = {
      eq: vi.fn(),
      in: vi.fn(),
      is: vi.fn(),
      or: vi.fn(),
      select: vi.fn(),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    };
    for (const method of [query.eq, query.in, query.is, query.or, query.select]) {
      method.mockReturnValue(query);
    }
    const update = vi.fn(() => query);
    const repository = createSupabaseMemoryWorkerRepository({
      from: vi.fn(() => ({ update, select: query.select })),
      rpc: vi.fn(),
    } as never);

    await expect(
      repository.resetEmbedding({
        organizationId: ORGANIZATION_ID,
        itemId: ITEM_ID,
        expectedRevision: REVISION,
        now: NOW,
        embeddingUpdatedAt: null,
      } as never),
    ).resolves.toBe(false);

    expect(query.eq).toHaveBeenCalledWith("organization_id", ORGANIZATION_ID);
    expect(query.eq).toHaveBeenCalledWith("id", ITEM_ID);
    expect(query.eq).toHaveBeenCalledWith("updated_at", REVISION);
    expect(query.in).toHaveBeenCalledWith("embedding_status", ["ready", "failed"]);
    expect(query.in).toHaveBeenCalledWith("verification_state", ["unverified", "verified"]);
    expect(query.is).toHaveBeenCalledWith("superseded_by_id", null);
    expect(query.or).toHaveBeenCalledWith(`expires_at.is.null,expires_at.gte.${NOW}`);
    expect(query.or).toHaveBeenCalledWith(`effective_to.is.null,effective_to.gte.${NOW}`);
  });
});
