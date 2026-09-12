// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const toastMocks = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMocks, Toaster: () => null }));

import {
  KnowledgeStateLabel,
  knowledgeStateFor,
  SourceCorrectionNote,
} from "@/components/memory/provenance-badges";
import { TimelineTab } from "@/components/memory/timeline-tab";
import { lessonReviewDetailFor } from "@/components/memory/review-tab";
import type { MemoryItemView } from "@/modules/memory/application/service";

function itemView(overrides: Partial<MemoryItemView> = {}): MemoryItemView {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    memoryType: "episode",
    title: "Supplier confirmed a delivery delay",
    body: "Called the supplier to confirm.",
    origin: "provider_imported",
    sourceTier: 2,
    sourceSystem: "google_business_profile",
    verificationState: "unverified",
    sensitivity: "internal",
    trustRank: 2,
    freshness: "fresh",
    observedAt: "2026-08-08T09:00:00.000Z",
    embeddingStatus: "ready",
    createdAt: "2026-08-08T09:00:00.000Z",
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("knowledgeStateFor", () => {
  it("reads a captured projection as recorded", () => {
    expect(
      knowledgeStateFor({
        memoryType: "episode",
        origin: "system_generated",
        verificationState: "unverified",
      }),
    ).toBe("recorded");
  });

  it("reads a model-proposed episode as suggested", () => {
    expect(
      knowledgeStateFor({
        memoryType: "episode",
        origin: "ai_proposed",
        verificationState: "unverified",
      }),
    ).toBe("suggested");
  });

  it("reads an operator decision as planned", () => {
    expect(
      knowledgeStateFor({
        memoryType: "decision",
        origin: "user_created",
        verificationState: "unverified",
      }),
    ).toBe("planned");
  });

  it("reads a settled outcome as measured", () => {
    expect(
      knowledgeStateFor({
        memoryType: "outcome",
        origin: "system_generated",
        verificationState: "verified",
      }),
    ).toBe("measured");
  });

  it("reads a verified lesson as reviewed and an unverified one as suggested", () => {
    expect(
      knowledgeStateFor({
        memoryType: "lesson",
        origin: "ai_proposed",
        verificationState: "verified",
      }),
    ).toBe("reviewed");
    expect(
      knowledgeStateFor({
        memoryType: "lesson",
        origin: "ai_proposed",
        verificationState: "unverified",
      }),
    ).toBe("suggested");
  });

  it("labels nothing for workspace content and pending proposals", () => {
    for (const memoryType of ["note", "document", "projected_fact", "fact_proposal"]) {
      expect(
        knowledgeStateFor({ memoryType, origin: "user_created", verificationState: "proposed" }),
      ).toBeNull();
    }
  });
});

describe("KnowledgeStateLabel", () => {
  it("renders each state in plain words", () => {
    const cases = [
      { memoryType: "episode", origin: "system_generated", verificationState: "x", label: "Recorded" },
      { memoryType: "episode", origin: "ai_proposed", verificationState: "x", label: "Suggested" },
      { memoryType: "decision", origin: "user_created", verificationState: "x", label: "Planned" },
      { memoryType: "outcome", origin: "system_generated", verificationState: "x", label: "Measured" },
      { memoryType: "lesson", origin: "ai_proposed", verificationState: "verified", label: "Reviewed" },
    ] as const;
    for (const entry of cases) {
      const { unmount } = render(
        <KnowledgeStateLabel
          memoryType={entry.memoryType}
          origin={entry.origin}
          verificationState={entry.verificationState}
        />,
      );
      expect(screen.getByText(entry.label)).toBeVisible();
      unmount();
    }
  });

  it("renders nothing for a manual note", () => {
    const { container } = render(
      <KnowledgeStateLabel memoryType="note" origin="user_created" verificationState="unverified" />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("SourceCorrectionNote", () => {
  it("points the correction at the owning source system and reference", () => {
    render(<SourceCorrectionNote sourceSystem="talabat_portal" sourceReference="run-611" />);
    expect(screen.getByText(/corrections happen at the source/i)).toBeVisible();
    expect(screen.getByText(/talabat_portal/)).toBeVisible();
    expect(screen.getByText(/run-611/)).toBeVisible();
  });

  it("renders nothing for a manual note with no source to point at", () => {
    const { container } = render(<SourceCorrectionNote />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("lessonReviewDetailFor", () => {
  it("returns no detail for a non-lesson", () => {
    expect(lessonReviewDetailFor(itemView())).toBeNull();
  });

  it("keeps the lesson inside its evidence and review date", () => {
    const detail = lessonReviewDetailFor(
      itemView({
        memoryType: "lesson",
        body: "Applies to weekday lunch only.",
        reviewDueAt: "2026-09-01T00:00:00.000Z",
      }),
    );
    expect(detail).not.toBeNull();
    expect(detail!.applicability).toBe("Applies to weekday lunch only.");
    expect(detail!.reviewDate).toBe("2026-09-01T00:00:00.000Z");
    expect(detail!.evidenceNote).toMatch(/inspect chain/i);
  });

  it("says so when applicability and review date were never recorded", () => {
    const detail = lessonReviewDetailFor(
      itemView({ memoryType: "lesson", body: undefined, reviewDueAt: undefined, observedAt: undefined }),
    );
    expect(detail!.applicability).toMatch(/not recorded/i);
    expect(detail!.reviewDate).toBeNull();
  });
});

describe("Timeline kind filter", () => {
  function renderTimeline() {
    vi.spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL) => {
      if (String(input).includes("/memory/timeline")) {
        return jsonResponse({
          items: [
            itemView(),
            itemView({
              id: "66666666-6666-4666-8666-666666666666",
              memoryType: "lesson",
              title: "Weekday lunch demand is understated",
              sourceSystem: "csv_import",
            }),
          ],
        });
      }
      return jsonResponse({ items: [] });
    }) as typeof fetch);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <TimelineTab
          organizationId="11111111-1111-4111-8111-111111111111"
          role="operator"
          ceiling="confidential"
          branches={[]}
        />
      </QueryClientProvider>,
    );
  }

  it("offers only the kinds the loaded rows actually carry", async () => {
    renderTimeline();
    expect(await screen.findByText("Supplier confirmed a delivery delay")).toBeVisible();
    expect(screen.getByRole("button", { name: /^episode$/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /^lesson$/i })).toBeVisible();
    expect(screen.queryByRole("button", { name: /^outcome$/i })).not.toBeInTheDocument();
  });

  it("hides on-screen rows of an unselected kind without refetching", async () => {
    renderTimeline();
    expect(await screen.findByText("Supplier confirmed a delivery delay")).toBeVisible();
    expect(screen.getByText("Weekday lunch demand is understated")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /^lesson$/i }));

    expect(screen.queryByText("Supplier confirmed a delivery delay")).not.toBeInTheDocument();
    expect(screen.getByText("Weekday lunch demand is understated")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /^lesson$/i }));
    expect(screen.getByText("Supplier confirmed a delivery delay")).toBeVisible();
  });

  it("shows each row with its state label and source correction", async () => {
    renderTimeline();
    expect(await screen.findByText("Supplier confirmed a delivery delay")).toBeVisible();
    expect(screen.getAllByText("Recorded").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Suggested").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/corrections happen at the source/i).length).toBe(2);
  });
});
