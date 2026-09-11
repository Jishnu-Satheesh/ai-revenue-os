import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createContextRepository } from "@/modules/memory/infrastructure/context-repository";

const ORG = "11111111-1111-4111-8111-111111111111";
const RUN = "22222222-2222-4222-8222-222222222222";
const MANIFEST = "33333333-3333-4333-8333-333333333333";
const DIGEST = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function clientWith(handler: (name: string, args: Record<string, unknown>) => unknown) {
  return { rpc: vi.fn(async (name: string, args: Record<string, unknown>) => ({ data: handler(name, args), error: null })) };
}

const ENTRY = {
  sourceKind: "memory_item",
  sourceId: "44444444-4444-4444-8444-444444444444",
  summary: "A bounded safe summary.",
  priority: 0,
  optional: true,
  section: "observations",
  statementKind: "observation",
  trustRank: 2,
  freshness: "fresh",
  sensitivity: "internal",
} as const;

describe("createContextRepository", () => {
  it("prepares worker context through the fenced RPC without inventing shapes", async () => {
    const client = clientWith((name) => {
      if (name !== "prepare_memory_context") throw new Error(`unexpected ${name}`);
      return { manifestId: MANIFEST, contextDigest: DIGEST, status: "ready", selectedCount: 1, selectedBytes: 24 };
    });
    const repository = createContextRepository(client);

    const prepared = await repository.prepare({
      organizationId: ORG,
      purpose: "channel_advice",
      consumerKind: "analysis_run",
      consumerId: RUN,
      attemptKey: "attempt-1",
      correlationId: "55555555-5555-4555-8555-555555555555",
      policyVersion: "shared-context-v1",
      entries: [{ ...ENTRY }],
      retrievalLatencyMs: 40,
    });

    expect(prepared).toEqual({
      manifestId: MANIFEST,
      contextDigest: DIGEST,
      status: "ready",
      selectedCount: 1,
      selectedBytes: 24,
    });
    expect(client.rpc).toHaveBeenCalledWith(
      "prepare_memory_context",
      expect.objectContaining({ p_organization_id: ORG, p_consumer_kind: "analysis_run" }),
    );
  });

  it("refuses a malformed digest instead of persisting it", async () => {
    const repository = createContextRepository(
      clientWith(() => ({ manifestId: MANIFEST, contextDigest: "not-a-digest", status: "ready", selectedCount: 0, selectedBytes: 0 })),
    );
    await expect(
      repository.prepare({
        organizationId: ORG,
        purpose: "channel_advice",
        consumerKind: "analysis_run",
        consumerId: RUN,
        attemptKey: "attempt-1",
        correlationId: "55555555-5555-4555-8555-555555555555",
        policyVersion: "shared-context-v1",
        entries: [],
        retrievalLatencyMs: null,
      }),
    ).rejects.toThrow();
  });

  it("revalidates through the split worker and subject entry points", async () => {
    const seen: string[] = [];
    const repository = createContextRepository(
      clientWith((name) => {
        seen.push(name);
        return { manifestId: MANIFEST, status: "valid" };
      }),
    );
    expect(await repository.revalidate({ organizationId: ORG, manifestId: MANIFEST })).toEqual({
      manifestId: MANIFEST,
      status: "valid",
    });
    expect(await repository.revalidateForSubject({ organizationId: ORG, manifestId: MANIFEST })).toEqual({
      manifestId: MANIFEST,
      status: "valid",
    });
    expect(seen).toEqual(["revalidate_memory_context", "revalidate_subject_memory_context"]);
  });

  it("rejects an unknown revalidation status instead of defaulting", async () => {
    const repository = createContextRepository(clientWith(() => ({ manifestId: MANIFEST, status: "haunted" })));
    await expect(repository.revalidate({ organizationId: ORG, manifestId: MANIFEST })).rejects.toThrow();
  });

  it("consumes through the split entry points and erases by source identity", async () => {
    const seen: string[] = [];
    const repository = createContextRepository(
      clientWith((name) => {
        seen.push(name);
        if (name === "erase_memory_source_content") {
          return { sourceId: RUN, erasedEvents: 1, erasedItems: 1, erasedEntries: 2 };
        }
        return { manifestId: MANIFEST, state: "consumed" };
      }),
    );
    expect(
      await repository.consume({
        organizationId: ORG,
        manifestId: MANIFEST,
        providerName: "test-provider",
        modelId: "test-model",
        modelCalledAt: "2026-09-11T00:00:00.000Z",
      }),
    ).toEqual({ manifestId: MANIFEST, state: "consumed" });
    expect(
      await repository.consumeForSubject({
        organizationId: ORG,
        manifestId: MANIFEST,
        providerName: "test-provider",
        modelId: "test-model",
        modelCalledAt: "2026-09-11T00:00:00.000Z",
      }),
    ).toEqual({ manifestId: MANIFEST, state: "consumed" });
    expect(
      await repository.eraseSourceContent({
        organizationId: ORG,
        actorId: null,
        sourceKind: "channel_finding",
        sourceId: RUN,
        reason: "rights request",
      }),
    ).toEqual({ sourceId: RUN, erasedEvents: 1, erasedItems: 1, erasedEntries: 2 });
    expect(seen).toEqual([
      "consume_memory_context",
      "consume_subject_memory_context",
      "erase_memory_source_content",
    ]);
  });

  it("passes null entries through for the unavailable path", async () => {
    const client = clientWith((name, args) => {
      if (name !== "prepare_memory_context") throw new Error(`unexpected ${name}`);
      expect(args["p_entries"]).toBeNull();
      return { manifestId: MANIFEST, contextDigest: DIGEST, status: "unavailable", selectedCount: 0, selectedBytes: 0 };
    });
    const prepared = await createContextRepository(client).prepare({
      organizationId: ORG,
      purpose: "channel_advice",
      consumerKind: "analysis_run",
      consumerId: RUN,
      attemptKey: "attempt-1",
      correlationId: "55555555-5555-4555-8555-555555555555",
      policyVersion: "shared-context-v1",
      entries: null,
      retrievalLatencyMs: null,
    });
    expect(prepared.status).toBe("unavailable");
  });
});
