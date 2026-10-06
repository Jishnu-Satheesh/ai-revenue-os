import { describe, expect, it } from "vitest";

import { formatInstant, formatShortDate } from "@/components/organizations/home/home-dates";

const TIME_ZONE = "Asia/Dubai";

describe("home date shapes", () => {
  it("renders the short campaign-foot shape with no year or time", () => {
    // 2026-09-10T10:00Z is 10 Sep in Asia/Dubai; September also pins the
    // "Sept" -> "Sep" normalization shared with the long shape.
    expect(formatShortDate("2026-09-10T10:00:00.000Z", TIME_ZONE)).toBe("10 Sep");
    expect(formatShortDate("2026-09-01T10:00:00.000Z", TIME_ZONE)).toBe("1 Sep");
  });

  it("renders the long shape byte-identically to the previous four copies", () => {
    expect(formatInstant("2026-09-10T10:00:00.000Z", TIME_ZONE)).toBe(
      "10 Sep 2026 · 14:00, Asia/Dubai",
    );
    expect(formatInstant("2026-09-05T10:00:00.000Z", TIME_ZONE)).toBe(
      "5 Sep 2026 · 14:00, Asia/Dubai",
    );
  });
});
