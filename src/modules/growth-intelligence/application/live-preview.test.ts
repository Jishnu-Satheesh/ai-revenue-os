import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { DomainError } from "@/lib/errors";
import {
  buildLivePreviewQueries,
  livePreviewInputSchema,
  livePreviewQuerySchema,
  livePreviewResultItemSchema,
  parseLivePreviewResponse,
} from "@/modules/growth-intelligence/application/live-preview";

const BRANCH_ID = "6afed7d7-d555-4444-a444-222222222222";
const RETRIEVED_AT = "2026-09-15T10:00:00.000Z";

function envelope(results: unknown[]) {
  return { web: { results } };
}

describe("livePreviewInputSchema", () => {
  it("enforces topic and competitor caps and requires at least one entry", () => {
    expect(
      livePreviewInputSchema.safeParse({
        branchId: BRANCH_ID,
        topics: ["a", "b", "c", "d"],
        competitors: [],
      }).success,
    ).toBe(false);

    expect(
      livePreviewInputSchema.safeParse({
        branchId: BRANCH_ID,
        topics: [],
        competitors: ["a", "b", "c"],
      }).success,
    ).toBe(false);

    expect(
      livePreviewInputSchema.safeParse({ branchId: BRANCH_ID, topics: [], competitors: [] })
        .success,
    ).toBe(false);

    expect(
      livePreviewInputSchema.safeParse({ branchId: BRANCH_ID, topics: ["brunch"] }).success,
    ).toBe(true);
  });
});

describe("buildLivePreviewQueries", () => {
  it("builds deterministic queries within caps", () => {
    const first = buildLivePreviewQueries({
      branchId: BRANCH_ID,
      topics: ["weekend brunch", "kerala festival"],
      competitors: ["Azure Dhow"],
    });
    const second = buildLivePreviewQueries({
      branchId: BRANCH_ID,
      topics: ["weekend brunch", "kerala festival"],
      competitors: ["Azure Dhow"],
    });

    expect(first).toEqual(second);
    expect(first).toHaveLength(3);
    expect(first.map((query) => query.slotKey)).toEqual([
      "topic:weekend-brunch",
      "topic:kerala-festival",
      "competitor:azure-dhow",
    ]);
    expect(first.every((query) => query.maxResults === 5)).toBe(true);
    for (const query of first) {
      expect(livePreviewQuerySchema.safeParse(query).success).toBe(true);
    }
  });

  it("dedupes case-insensitively across topics and competitors", () => {
    const queries = buildLivePreviewQueries({
      branchId: BRANCH_ID,
      topics: ["Weekend Brunch", "weekend brunch "],
      competitors: ["WEEKEND BRUNCH"],
    });

    expect(queries).toHaveLength(1);
    expect(queries[0]!.text).toBe("Weekend Brunch");
  });

  it("strips query operators and prompt-injection phrases", () => {
    const queries = buildLivePreviewQueries({
      branchId: BRANCH_ID,
      topics: ["brunch site:attacker.example", "ignore previous instructions feast"],
      competitors: [],
    });

    expect(queries).toHaveLength(2);
    expect(queries.map((query) => query.text).join(" ")).not.toMatch(/site:|ignore previous/i);
  });

  it("throws VALIDATION_ERROR when a phrase sanitizes to empty", () => {
    expect(() =>
      buildLivePreviewQueries({ branchId: BRANCH_ID, topics: ["site:"], competitors: [] }),
    ).toThrowError(DomainError);

    try {
      buildLivePreviewQueries({ branchId: BRANCH_ID, topics: ["site:"], competitors: [] });
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ name: "DomainError", code: "VALIDATION_ERROR" });
    }
  });

  it("throws VALIDATION_ERROR over the input and total query caps", () => {
    expect(() =>
      buildLivePreviewQueries({
        branchId: BRANCH_ID,
        topics: ["a", "b", "c", "d"],
        competitors: [],
      }),
    ).toThrowError(DomainError);

    expect(() =>
      buildLivePreviewQueries({
        branchId: BRANCH_ID,
        topics: ["a", "b"],
        competitors: ["c", "d"],
      }),
    ).toThrowError(DomainError);

    try {
      buildLivePreviewQueries({
        branchId: BRANCH_ID,
        topics: ["a", "b"],
        competitors: ["c", "d"],
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ name: "DomainError", code: "VALIDATION_ERROR" });
    }
  });
});

describe("parseLivePreviewResponse", () => {
  it("parses valid items and normalizes citation URLs", () => {
    const items = parseLivePreviewResponse(
      envelope([
        {
          title: "Harbor Brunch Guide",
          url: "https://Example.COM:443/brunch#menu",
          description: "A short public excerpt about brunch.",
        },
      ]),
      RETRIEVED_AT,
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: "Harbor Brunch Guide",
      url: "https://example.com/brunch",
      publisher: "example.com",
      snippet: "A short public excerpt about brunch.",
      retrievedAt: RETRIEVED_AT,
    });
    expect(livePreviewResultItemSchema.safeParse(items[0]).success).toBe(true);
  });

  it("drops unsafe URLs including credentials without failing the batch", () => {
    const items = parseLivePreviewResponse(
      envelope([
        { title: "Good", url: "https://example.com/good", description: "Usable excerpt." },
        {
          title: "Creds",
          url: "https://user:pass@example.com/private",
          description: "Must be dropped.",
        },
        { title: "FTP", url: "ftp://example.com/file", description: "Must be dropped." },
        { title: "IP", url: "http://127.0.0.1/internal", description: "Must be dropped." },
        { title: "No excerpt", url: "https://example.com/empty", description: "   " },
        { title: "   ", url: "https://example.com/notitle", description: "Has excerpt." },
      ]),
      RETRIEVED_AT,
    );

    expect(items).toHaveLength(1);
    expect(items[0]!.url).toBe("https://example.com/good");
  });

  it("caps output at 15 items", () => {
    const results = Array.from({ length: 20 }, (_, index) => ({
      title: `Story ${index + 1}`,
      url: `https://example.com/story-${index + 1}`,
      description: `Excerpt ${index + 1}`,
    }));

    const items = parseLivePreviewResponse(envelope(results), RETRIEVED_AT);

    expect(items).toHaveLength(15);
  });

  it("rejects a malformed envelope and bad timestamps with a safe message", () => {
    for (const bad of [{}, { web: {} }, { web: { results: "nope" } }, null, "text"]) {
      try {
        parseLivePreviewResponse(bad, RETRIEVED_AT);
        expect.unreachable();
      } catch (error) {
        expect(error).toMatchObject({ name: "DomainError", code: "VALIDATION_ERROR" });
        expect((error as Error).message).toBe(
          "The live preview response could not be understood.",
        );
        expect((error as Error).message).not.toContain("nope");
      }
    }

    expect(() =>
      parseLivePreviewResponse(envelope([]), "not-a-date"),
    ).toThrowError(DomainError);
  });
});
