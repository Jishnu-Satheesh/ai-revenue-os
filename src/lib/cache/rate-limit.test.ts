import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({ limit: vi.fn() }));

vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: class {
    static slidingWindow = vi.fn(() => ({}));
    limit = mocks.limit;
  },
}));
vi.mock("@upstash/redis", () => ({ Redis: class {} }));

import { consumeAnalysisRunAllowance } from "@/lib/cache/rate-limit";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "token");
});

describe("the analysis run allowance", () => {
  it("allows a run inside the limit", async () => {
    mocks.limit.mockResolvedValue({ success: true });

    await expect(consumeAnalysisRunAllowance("org-1")).resolves.toBe(true);
  });

  it("refuses a run over the limit", async () => {
    mocks.limit.mockResolvedValue({ success: false });

    await expect(consumeAnalysisRunAllowance("org-1")).resolves.toBe(false);
  });

  it("counts each organization separately", async () => {
    mocks.limit.mockResolvedValue({ success: true });

    await consumeAnalysisRunAllowance("org-1");

    expect(mocks.limit).toHaveBeenCalledWith(expect.stringContaining("org-1"));
  });

  it("fails open when the limiter itself is unreachable", async () => {
    // An outage in the cost control must not become an outage in the product.
    // A client waiting on their numbers is a worse failure than an unmetered
    // run, and the Apply gate still bounds how fast runs can be asked for.
    mocks.limit.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(consumeAnalysisRunAllowance("org-1")).resolves.toBe(true);
  });

  it("fails open when the service is not configured", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");

    await expect(consumeAnalysisRunAllowance("org-1")).resolves.toBe(true);
    expect(mocks.limit).not.toHaveBeenCalled();
  });
});
