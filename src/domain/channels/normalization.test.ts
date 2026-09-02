import { describe, expect, it } from "vitest";

import { normalizeChannelAlias, normalizeChannelKey } from "@/domain/channels/normalization";

describe("normalizeChannelAlias", () => {
  it("normalizes Unicode, casing, and incidental whitespace without removing punctuation", () => {
    expect(normalizeChannelAlias("  Smile   (Easy Eats)  ")).toBe("smile (easy eats)");
    expect(normalizeChannelAlias("نُون\u00A0فود")).toBe("نُون فود");
  });

  it("does not guess that semantically distinct labels are aliases", () => {
    expect(normalizeChannelAlias("Smile Easy Eats")).not.toBe(
      normalizeChannelAlias("Smile (Easy Eats)"),
    );
  });
});

describe("normalizeChannelKey", () => {
  it("accepts a stable lower-case identifier and rejects display labels", () => {
    expect(normalizeChannelKey("  talabat.ae-1  ")).toBe("talabat.ae-1");
    expect(() => normalizeChannelKey("Smile (Easy Eats)")).toThrow("CHANNEL_KEY_INVALID");
  });
});
