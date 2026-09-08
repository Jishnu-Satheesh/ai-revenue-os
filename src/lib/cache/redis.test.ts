import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));

vi.mock("@upstash/redis", () => ({
  Redis: class {
    get = mocks.get;
    set = mocks.set;
  },
}));

import { cacheGet, cacheSet } from "@/lib/cache/redis";

const schema = z.object({ findings: z.array(z.object({ id: z.string() })) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "token");
});

describe("a cache that cannot break the page", () => {
  it("returns what was stored", async () => {
    mocks.get.mockResolvedValue({ findings: [] });

    await expect(cacheGet("analysis:view:v1:org:run:digest", schema)).resolves.toEqual({
      findings: [],
    });
  });

  it("reports a miss as null", async () => {
    mocks.get.mockResolvedValue(null);

    await expect(cacheGet("k", schema)).resolves.toBeNull();
  });

  it("reports an outage as a miss, not as an error", async () => {
    // The whole point of this module. An Upstash outage must degrade the page
    // to its ordinary database reads, never to an error screen.
    mocks.get.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(cacheGet("k", schema)).resolves.toBeNull();
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

    await expect(cacheGet("k", schema)).resolves.toBeNull();
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it("reports a wrong-shape hit as a miss, not as a throw", async () => {
    // The installed Upstash client swallows its own JSON.parse failure and
    // hands back the raw stored value rather than throwing, so a corrupt or
    // stale-shape entry looks like an ordinary hit until it is validated.
    mocks.get.mockResolvedValue({ findings: "not-an-array" });

    await expect(cacheGet("k", schema)).resolves.toBeNull();
  });

  it("reports a non-JSON hit as a miss", async () => {
    // What the client hands back verbatim when its own parse fails.
    mocks.get.mockResolvedValue("not valid json {{{");

    await expect(cacheGet("k", schema)).resolves.toBeNull();
  });

  it("returns a schema-valid hit as-is", async () => {
    const value = { findings: [{ id: "f-1" }] };
    mocks.get.mockResolvedValue(value);

    await expect(cacheGet("k", schema)).resolves.toEqual(value);
  });
});
