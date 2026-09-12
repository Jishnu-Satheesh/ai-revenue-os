// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  ContextUsedDrawer,
  contextUsedQueryOptions,
  toContextUsedData,
  type ContextManifestPayload,
  type ContextUsedData,
} from "@/components/memory/context-used";

const organizationId = "11111111-1111-4111-8111-111111111111";

function payload(): ContextManifestPayload {
  return {
    manifest: {
      id: "44444444-4444-4444-8444-444444444444",
      status: "ready",
      policyVersion: "shared-context-v1",
      selectedCount: 2,
      asOf: "2026-09-11T00:00:00.000Z",
    },
    entries: [
      {
        contextRef: "ctx-0001",
        title: "Friday plan",
        summary: "Check capacity before the mall event.",
        sourceKind: "memory_item",
        sourceId: "55555555-5555-4555-8555-555555555555",
        observedAt: "2026-09-10T00:00:00.000Z",
      },
      {
        contextRef: "ctx-0002",
        title: "Dinner mix",
        summary: "Families fill the early tables.",
        sourceKind: "business_fact",
        sourceId: "66666666-6666-4666-8666-666666666666",
        observedAt: null,
      },
    ],
  };
}

function openDrawer(data: ContextUsedData | null) {
  render(
    <ContextUsedDrawer
      organizationId={organizationId}
      recommendationHeadline="Widen the promise window"
      data={data}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /context used/i }));
}

afterEach(cleanup);

describe("ContextUsedDrawer", () => {
  it("shows provided-vs-cited and shared-with-Google labels per entry", () => {
    openDrawer(
      toContextUsedData(payload(), {
        shareMode: "grounded_share",
        providedRefs: ["ctx-0001", "ctx-0002"],
        citedRefs: ["ctx-0001"],
      }),
    );

    expect(screen.getAllByText("Provided to AI")).toHaveLength(2);
    expect(screen.getAllByText("Shared with Google")).toHaveLength(3);
    expect(screen.getByText("Cited in answer")).toBeDefined();
    expect(screen.getByText("Friday plan")).toBeDefined();
    expect(screen.getByText(/memory note/i)).toBeDefined();
    expect(screen.getAllByRole("link", { name: /open in business memory/i })).toHaveLength(2);
  });

  it("labels everything internal-only without claiming sharing", () => {
    openDrawer(
      toContextUsedData(payload(), {
        shareMode: "internal_only",
        providedRefs: ["ctx-0001"],
        citedRefs: [],
      }),
    );

    expect(screen.getAllByText("Internal only")).toHaveLength(3);
    expect(screen.queryByText("Shared with Google")).toBeNull();
    expect(screen.getByText(/nothing left this organization/i)).toBeDefined();
  });

  it("renders the unavailable degraded state when memory failed", () => {
    openDrawer({
      shareMode: "internal_only",
      manifestId: "44444444-4444-4444-8444-444444444444",
      manifestStatus: "unavailable",
      entries: [],
    });

    expect(
      screen.getByText(/business memory was unavailable when this answer was written/i),
    ).toBeDefined();
    expect(screen.queryByText("Friday plan")).toBeNull();
  });

  it("renders empty-pack copy when nothing qualified", () => {
    openDrawer({
      shareMode: "grounded_share",
      manifestId: "44444444-4444-4444-8444-444444444444",
      manifestStatus: "empty",
      entries: [],
    });

    expect(screen.getByText(/no business memory entries qualified/i)).toBeDefined();
  });

  it("never claims an entry caused the advice", () => {
    openDrawer(
      toContextUsedData(payload(), {
        shareMode: "grounded_share",
        providedRefs: ["ctx-0001"],
        citedRefs: ["ctx-0001"],
      }),
    );

    expect(screen.getByText(/entries never replace cited findings/i)).toBeDefined();
    for (const banned of ["caused", "influenced", "because of this entry", "proves"]) {
      expect(screen.queryByText(new RegExp(banned, "i"))).toBeNull();
    }
  });
});

describe("contextUsedQueryOptions", () => {
  it("keys reads by organization and manifest, and stays disabled without one", () => {
    const enabled = contextUsedQueryOptions({ organizationId, manifestId: "manifest-1" });
    const disabled = contextUsedQueryOptions({ organizationId, manifestId: null });

    expect(enabled.queryKey.slice(0, 3)).toEqual(["organizations", organizationId, "memory"]);
    expect(enabled.queryKey).toContain("manifest-1");
    expect(enabled.enabled).toBe(true);
    expect(disabled.enabled).toBe(false);
  });

  it("maps a payload without provenance to provided entries with no citations", () => {
    const data = toContextUsedData(payload(), null);

    expect(data?.shareMode).toBe("internal_only");
    expect(data?.entries).toHaveLength(2);
    expect(data?.entries.every((entry) => entry.providedToAi)).toBe(true);
    expect(data?.entries.some((entry) => entry.citedInAnswer)).toBe(false);
    expect(data?.entries.every((entry) => !entry.sharedWithGoogle)).toBe(true);
  });
});
