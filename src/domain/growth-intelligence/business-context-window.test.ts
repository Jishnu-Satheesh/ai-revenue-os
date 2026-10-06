import { describe, expect, it } from "vitest";

import {
  buildBusinessContextEvidencePeriod,
  resolveBusinessContextWindow,
} from "@/domain/growth-intelligence/business-context-window";

describe("resolveBusinessContextWindow", () => {
  it("ends at the initiation day when evidence covers it", () => {
    const window = resolveBusinessContextWindow({
      initiationDay: "2026-09-22",
      coverage: [{ start: "2026-01-01", end: "2026-09-22" }],
    });
    expect(window?.to).toBe("2026-09-22");
  });

  it("spans up to 60 days back where evidence exists", () => {
    const window = resolveBusinessContextWindow({
      initiationDay: "2026-07-31",
      coverage: [{ start: "2026-01-01", end: "2026-07-31" }],
    });
    expect(window).toEqual({ from: "2026-06-02", to: "2026-07-31" });
  });

  it("reads the last available stretch, never a hardcoded range", () => {
    const window = resolveBusinessContextWindow({
      initiationDay: "2026-07-15",
      coverage: [
        { start: "2026-01-01", end: "2026-02-28" },
        { start: "2026-05-01", end: "2026-07-15" },
      ],
    });
    expect(window).toEqual({ from: "2026-05-17", to: "2026-07-15" });
  });

  it("shrinks to the available stretch when evidence is shorter than 60 days", () => {
    const window = resolveBusinessContextWindow({
      initiationDay: "2026-03-10",
      coverage: [{ start: "2026-02-01", end: "2026-03-10" }],
    });
    expect(window).toEqual({ from: "2026-02-01", to: "2026-03-10" });
  });

  it("shrinks to whatever exists when evidence is shorter than 30 days", () => {
    const window = resolveBusinessContextWindow({
      initiationDay: "2026-02-20",
      coverage: [{ start: "2026-02-01", end: "2026-02-20" }],
    });
    expect(window).toEqual({ from: "2026-02-01", to: "2026-02-20" });
  });

  it("clamps to the last available day when initiation runs past coverage", () => {
    const window = resolveBusinessContextWindow({
      initiationDay: "2026-09-22",
      coverage: [{ start: "2026-01-01", end: "2026-07-31" }],
    });
    expect(window).toEqual({ from: "2026-06-02", to: "2026-07-31" });
  });

  it("returns null when no evidence exists at or before initiation", () => {
    expect(
      resolveBusinessContextWindow({
        initiationDay: "2026-01-15",
        coverage: [{ start: "2026-03-01", end: "2026-07-31" }],
      }),
    ).toBeNull();
    expect(
      resolveBusinessContextWindow({ initiationDay: "2026-09-22", coverage: [] }),
    ).toBeNull();
  });

  it("builds a channel-reports evidence period for the brief", () => {
    expect(
      buildBusinessContextEvidencePeriod({ from: "2026-06-01", to: "2026-07-31" }),
    ).toEqual({
      label: "Channel reports · 2026-06-01–2026-07-31",
      startDate: "2026-06-01",
      endDate: "2026-07-31",
    });
  });
});
