import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));

vi.mock("@upstash/redis", () => ({
  Redis: class {
    get = mocks.get;
    set = mocks.set;
  },
}));

import { cacheGet, cacheSet } from "@/lib/cache/redis";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "token");
});

describe("a cache that cannot break the page", () => {
  it("returns what was stored", async () => {
    mocks.get.mockResolvedValue({ findings: [] });

    await expect(cacheGet("analysis:view:v1:org:run:digest")).resolves.toEqual({ findings: [] });
  });

  it("reports a miss as null", async () => {
    mocks.get.mockResolvedValue(null);

    await expect(cacheGet("k")).resolves.toBeNull();
  });

  it("reports an outage as a miss, not as an error", async () => {
    // The whole point of this module. An Upstash outage must degrade the page
    // to its ordinary database reads, never to an error screen.
    mocks.get.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(cacheGet("k")).resolves.toBeNull();
  });

  it("swallows a failed write", async () => {
    mocks.set.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(cacheSet("k", { a: 1 }, 60)).resolves.toBeUndefined();
  });

  it("passes the ttl through as seconds", async () => {
    mocks.set.mockResolvedValue("OK");

    await cacheSet("k", { a: 1 }, 60);

    expect(mocks.set).toHaveBeenCalledWith("k", { a: 1 }, { ex: 60 });
  });

  it("is a miss when the service is not configured at all", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");

    await expect(cacheGet("k")).resolves.toBeNull();
    expect(mocks.get).not.toHaveBeenCalled();
  });
});
