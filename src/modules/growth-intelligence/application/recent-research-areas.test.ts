import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  mergeRecentResearchAreas,
  readRecentResearchAreas,
  recordRecentResearchArea,
  toRecentResearchAreasResponse,
} from "@/modules/growth-intelligence/application/recent-research-areas";

const ORGANIZATION = "10000000-0000-4000-8000-000000000001";

function fakeCache(initial: string[] = []) {
  let stored: unknown = [...initial];
  return {
    get: vi.fn(async () => stored),
    set: vi.fn(async (...args: unknown[]) => {
      stored = args[1];
    }),
    read: () => stored as string[],
  };
}

type CacheDeps = Parameters<typeof readRecentResearchAreas>[1];

function depsFor(cache: ReturnType<typeof fakeCache>): CacheDeps {
  return cache as unknown as CacheDeps;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("mergeRecentResearchAreas", () => {
  it("returns most-recent-first capped at 10", () => {
    const existing = Array.from({ length: 10 }, (_, index) => `Area ${index + 1}`);
    expect(mergeRecentResearchAreas(existing, "Area 11")).toHaveLength(10);
    expect(mergeRecentResearchAreas(existing, "Area 11")[0]).toBe("Area 11");
  });

  it("de-duplicates case-insensitively moving the hit to the front", () => {
    expect(mergeRecentResearchAreas(["Deira", "Marina"], "  deira ")).toEqual([
      "deira",
      "Marina",
    ]);
  });
});

describe("recent research areas with faked Redis", () => {
  it("reads most-recent-first plus the single most recent", async () => {
    const cache = fakeCache(["Deira", "Marina"]);
    const response = await readRecentResearchAreas(ORGANIZATION, depsFor(cache));
    expect(response).toEqual({ areas: ["Deira", "Marina"], mostRecent: "Deira" });
  });

  it("records a new area to the front without duplicating", async () => {
    const cache = fakeCache(["Marina"]);
    const response = await recordRecentResearchArea(ORGANIZATION, "Deira", depsFor(cache));
    expect(response.areas[0]).toBe("Deira");
    expect(cache.set).toHaveBeenCalledOnce();
    const second = await recordRecentResearchArea(ORGANIZATION, "deira", depsFor(cache));
    expect(second.areas.filter((area) => area.toLowerCase() === "deira")).toHaveLength(1);
  });

  it("degrades to empty on a Redis outage instead of throwing", async () => {
    const failing = {
      get: vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
      set: vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    };
    const failingDeps = failing as unknown as CacheDeps;
    await expect(readRecentResearchAreas(ORGANIZATION, failingDeps)).resolves.toEqual({
      areas: [],
      mostRecent: null,
    });
    await expect(recordRecentResearchArea(ORGANIZATION, "Deira", failingDeps)).resolves.toEqual({
      areas: [],
      mostRecent: null,
    });
  });

  it("shapes the auto-populate response", () => {
    expect(toRecentResearchAreasResponse([])).toEqual({ areas: [], mostRecent: null });
    expect(toRecentResearchAreasResponse(["Deira", "Marina"]).mostRecent).toBe("Deira");
  });
});
