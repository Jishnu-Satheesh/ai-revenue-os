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

import { consumeLeadAllowances, hashLeadEmail } from "@/app/api/public/leads/rate-limit";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "token");
  vi.stubEnv("LEADS_EMAIL_HASH_KEY", "test-hash-key");
});

describe("consumeLeadAllowances", () => {
  it("allows a signup inside both limits", async () => {
    mocks.limit.mockResolvedValue({ success: true });

    await expect(
      consumeLeadAllowances({ ip: "203.0.113.7", email: "amina@example.com" }),
    ).resolves.toEqual({ allowed: true });
  });

  it("refuses a signup over either limit", async () => {
    mocks.limit.mockResolvedValue({ success: false });

    await expect(
      consumeLeadAllowances({ ip: "203.0.113.7", email: "amina@example.com" }),
    ).resolves.toEqual({ allowed: false, reason: "limited" });
  });

  it("keys the email bucket by HMAC, never the raw address", async () => {
    mocks.limit.mockResolvedValue({ success: true });

    await consumeLeadAllowances({ ip: "203.0.113.7", email: "amina@example.com" });

    const keys = mocks.limit.mock.calls.map((call) => String(call[0]));
    expect(keys).toHaveLength(2);
    expect(keys).toContain("203.0.113.7");
    const emailKey = keys.find((key) => key !== "203.0.113.7") ?? "";
    expect(emailKey).toMatch(/^[0-9a-f]{64}$/);
    expect(emailKey).not.toContain("amina");
    expect(emailKey).toBe(hashLeadEmail("amina@example.com", "test-hash-key"));
  });

  it("fails closed when the limiter itself is unreachable", async () => {
    // An anonymous form with no limiter is a free bulk-insert API. A 503
    // during a Redis outage is honest where silent ingestion is not.
    mocks.limit.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      consumeLeadAllowances({ ip: "203.0.113.7", email: "amina@example.com" }),
    ).resolves.toEqual({ allowed: false, reason: "unavailable" });
  });

  it("fails closed when Redis is not configured", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");

    await expect(
      consumeLeadAllowances({ ip: "203.0.113.7", email: "amina@example.com" }),
    ).resolves.toEqual({ allowed: false, reason: "unavailable" });
    expect(mocks.limit).not.toHaveBeenCalled();
  });

  it("fails closed when the email hash key is missing", async () => {
    vi.stubEnv("LEADS_EMAIL_HASH_KEY", "");

    await expect(
      consumeLeadAllowances({ ip: "203.0.113.7", email: "amina@example.com" }),
    ).resolves.toEqual({ allowed: false, reason: "unavailable" });
    expect(mocks.limit).not.toHaveBeenCalled();
  });
});

describe("hashLeadEmail", () => {
  it("is deterministic for one key and distinct across keys", () => {
    expect(hashLeadEmail("amina@example.com", "key-one")).toBe(
      hashLeadEmail("amina@example.com", "key-one"),
    );
    expect(hashLeadEmail("amina@example.com", "key-one")).not.toBe(
      hashLeadEmail("amina@example.com", "key-two"),
    );
  });
});
