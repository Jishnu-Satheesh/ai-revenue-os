import { describe, expect, it } from "vitest";

import { deriveFreshness, isRetrievableByDefault } from "@/domain/memory/freshness";

const now = new Date("2026-08-09T12:00:00.000Z");
const past = "2026-08-08T12:00:00.000Z";
const future = "2026-09-09T12:00:00.000Z";

describe("deriveFreshness", () => {
  it("reports expiry before supersession", () => {
    expect(
      deriveFreshness({
        now,
        expiresAt: past,
        supersededById: "11111111-1111-4111-8111-111111111111",
      }),
    ).toBe("expired");
  });

  it("treats a past effective_to as expired", () => {
    expect(deriveFreshness({ now, effectiveTo: past })).toBe("expired");
  });

  it("reports supersession before staleness", () => {
    expect(
      deriveFreshness({
        now,
        supersededById: "11111111-1111-4111-8111-111111111111",
        reviewDueAt: past,
      }),
    ).toBe("superseded");
  });

  it("reports stale once the review date has passed", () => {
    expect(deriveFreshness({ now, reviewDueAt: past })).toBe("stale");
  });

  it("reports aging inside the seven-day review window", () => {
    expect(deriveFreshness({ now, reviewDueAt: "2026-08-14T12:00:00.000Z" })).toBe("aging");
  });

  it("treats the seven-day boundary as aging rather than fresh", () => {
    expect(deriveFreshness({ now, reviewDueAt: "2026-08-16T12:00:00.000Z" })).toBe("aging");
  });

  it("reports fresh beyond the review window", () => {
    expect(deriveFreshness({ now, reviewDueAt: "2026-08-16T12:00:00.001Z" })).toBe("fresh");
  });

  it("reports fresh when nothing bounds the item", () => {
    expect(deriveFreshness({ now })).toBe("fresh");
    expect(deriveFreshness({ now, effectiveTo: future, expiresAt: future })).toBe("fresh");
  });

  it("ignores an unparseable timestamp rather than treating it as expired", () => {
    expect(deriveFreshness({ now, expiresAt: "not-a-date" })).toBe("fresh");
  });
});

describe("isRetrievableByDefault", () => {
  it("excludes expired, superseded, and rejected items", () => {
    expect(isRetrievableByDefault({ freshness: "expired", verificationState: "verified" })).toBe(
      false,
    );
    expect(isRetrievableByDefault({ freshness: "superseded", verificationState: "verified" })).toBe(
      false,
    );
    expect(isRetrievableByDefault({ freshness: "fresh", verificationState: "rejected" })).toBe(
      false,
    );
  });

  it("excludes proposed items until a human confirms them", () => {
    expect(isRetrievableByDefault({ freshness: "fresh", verificationState: "proposed" })).toBe(
      false,
    );
  });

  it("includes stale and aging items so history stays visible", () => {
    expect(isRetrievableByDefault({ freshness: "stale", verificationState: "unverified" })).toBe(
      true,
    );
    expect(isRetrievableByDefault({ freshness: "aging", verificationState: "verified" })).toBe(
      true,
    );
  });
});
