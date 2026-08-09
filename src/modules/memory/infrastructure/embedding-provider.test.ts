import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: {} }));

import { createEmbeddingProvider } from "@/modules/memory/infrastructure/embedding-provider";

describe("createEmbeddingProvider", () => {
  it("aborts an in-flight request when the worker cancellation signal aborts", async () => {
    const controller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    const fetchImplementation = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;
      return new Response(
        JSON.stringify({ data: [{ index: 0, embedding: Array.from({ length: 1536 }, () => 0) }] }),
        { status: 200 },
      );
    });
    const provider = createEmbeddingProvider({
      apiKey: "test-key",
      fetchImplementation,
    });

    await provider?.embed({
      organizationId: "11111111-1111-4111-8111-111111111111",
      correlationId: "22222222-2222-4222-8222-222222222222",
      texts: ["embedding input"],
      signal: controller.signal,
    } as never);
    controller.abort();

    expect(requestSignal?.aborted).toBe(true);
  });
});
