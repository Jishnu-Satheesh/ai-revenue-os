import { describe, expect, it } from "vitest";

import { parseWorkspaceMonth, previousMonth } from "@/components/growth-intelligence/query-options";

describe("parseWorkspaceMonth", () => {
  it("accepts a canonical month and passes through an absent one", () => {
    expect(parseWorkspaceMonth("2026-09")).toBe("2026-09");
    expect(parseWorkspaceMonth(undefined)).toBeNull();
  });

  it("refuses non-months so navigation can never relabel an evidence period", () => {
    for (const value of ["2026-13", "09-2026", "september", "2026-9", ""]) {
      expect(parseWorkspaceMonth(value)).toBeNull();
    }
  });

  it("steps one month back across year boundaries", () => {
    expect(previousMonth("2026-09")).toBe("2026-08");
    expect(previousMonth("2026-01")).toBe("2025-12");
  });
});

import {
  RESEARCH_ACTIVE_POLL_MS,
  RESEARCH_ERROR_BACKOFF_MS,
  isActivePipelineStage,
  parseResearchBranch,
  researchQueryKey,
  summarizeServiceArea,
} from "@/components/growth-intelligence/query-options";

describe("research observation helpers", () => {
  it("parses only canonical branch UUIDs so reads never guess a branch", () => {
    const branch = "20000000-0000-4000-8000-00000000000a";
    expect(parseResearchBranch(branch)).toBe(branch);
    for (const value of [undefined, null, "", "downtown", "123"]) {
      expect(parseResearchBranch(value)).toBeNull();
    }
  });

  it("keeps organization, branch and pipeline in the observer key", () => {
    expect(researchQueryKey("org-1", "branch-1")).toEqual([
      "growth-intelligence",
      "research",
      "org-1",
      "branch-1",
    ]);
    expect(researchQueryKey("org-1", "branch-1", "pipe-1")).toContain("pipe-1");
    expect(researchQueryKey("org-1", "branch-1")).not.toEqual(
      researchQueryKey("org-1", "branch-2"),
    );
  });

  it("polls active stages and settles terminal ones", () => {
    for (const stage of ["queued", "researching", "preparing_insights"]) {
      expect(isActivePipelineStage(stage)).toBe(true);
    }
    for (const stage of [
      "ready",
      "partial",
      "no_findings",
      "research_failed",
      "synthesis_failed",
      "cancelled",
    ]) {
      expect(isActivePipelineStage(stage)).toBe(false);
    }
    expect(RESEARCH_ACTIVE_POLL_MS).toBe(5_000);
    expect(RESEARCH_ERROR_BACKOFF_MS).toBe(30_000);
  });

  it("summarizes branch service areas without breaking on odd shapes", () => {
    expect(summarizeServiceArea("Downtown Dubai")).toBe("Downtown Dubai");
    expect(summarizeServiceArea({ city: "Dubai", areas: ["Marina", "Downtown"] })).toBe(
      "Dubai · Marina · Downtown",
    );
    expect(summarizeServiceArea(["Marina", 42, " "])).toBe("Marina");
    for (const value of [null, undefined, 42, {}, { city: "" }, "  "]) {
      expect(summarizeServiceArea(value)).toBeNull();
    }
  });
});
