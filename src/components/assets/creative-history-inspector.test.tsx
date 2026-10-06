// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from "sonner";
import { CreativeHistoryInspector } from "@/components/assets/creative-history-inspector";
import type { CreativeHistoryItemView } from "@/components/assets/asset-query-options";

afterEach(cleanup);

const ORGANIZATION_ID = "44444444-4444-4444-8444-444444444444";
const ITEM_ID = "55555555-5555-4555-8555-555555555555";
const VERSION_ID = "66666666-6666-4666-8666-666666666666";

function baseItem(overrides: Partial<CreativeHistoryItemView> = {}): CreativeHistoryItemView {
  return {
    organizationId: ORGANIZATION_ID,
    itemId: ITEM_ID,
    label: "lunch-combo-v3",
    creativeType: "poster",
    sourceKind: "historical_upload",
    folderId: null,
    folderName: null,
    folderDefaultMetadata: null,
    confirmedMetadata: null,
    proposedMetadata: null,
    metadataConfirmed: false,
    rights: { status: "owned" },
    archivedAt: null,
    createdAt: "2026-09-01T00:00:00Z",
    currentVersion: {
      versionId: VERSION_ID,
      version: 1,
      state: "usable",
      sourceKind: "stored_file",
      sourcePosterRenderId: null,
      contentHash: "hash",
      mimeType: "image/png",
      byteSize: 100,
      widthPx: 800,
      heightPx: 600,
      finalizedAt: "2026-09-01T00:00:00Z",
      createdAt: "2026-09-01T00:00:00Z",
      review: null,
      previewUrl: "https://signed.example/preview.png",
    },
    pendingVersion: null,
    versions: [],
    eligibility: "unreviewed",
    uploadState: "needs_review",
    ...overrides,
  };
}

function mockFetch(item: CreativeHistoryItemView) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith("/intake")) {
      return new Response(
        JSON.stringify({
          intake: { bucket: "creative-assets", allowedMimeTypes: [], maxBytes: 0, minWidthPx: 0, minHeightPx: 0, maxWidthPx: 0, maxHeightPx: 0, clientValidationIsAdvisory: true },
          reviewReasons: [{ code: "wrong_subject", description: "Wrong subject" }],
        }),
        { status: 200 },
      );
    }
    if (url.includes(`/items/${ITEM_ID}/reviews`)) {
      return new Response(JSON.stringify({ reviewId: "review-1", verdict: "approved", reviewedAt: "2026-09-02T00:00:00Z" }), {
        status: 201,
      });
    }
    if (url.endsWith(`/items/${ITEM_ID}`)) {
      return new Response(JSON.stringify({ item }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: { code: "UNEXPECTED_ERROR", message: "unhandled" } }), { status: 500 });
  });
}

function renderInspector(props: {
  itemId: string | null;
  canReview: boolean;
  canManage: boolean;
  onClose?: () => void;
}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <CreativeHistoryInspector
        organizationId={ORGANIZATION_ID}
        itemId={props.itemId}
        onClose={props.onClose ?? vi.fn()}
        canReview={props.canReview}
        canManage={props.canManage}
        timeZone="Asia/Dubai"
      />
    </QueryClientProvider>,
  );
}

describe("review is gated on the review permission, at the control", () => {
  it("offers Approve/Reject to a reviewer", async () => {
    mockFetch(baseItem());
    renderInspector({ itemId: ITEM_ID, canReview: true, canManage: false });

    await waitFor(() => expect(screen.getByText("lunch-combo-v3")).toBeTruthy());
    expect(screen.getByRole("button", { name: /approve as reference/i })).toBeTruthy();
  });

  it("hides review controls entirely from a viewer", async () => {
    mockFetch(baseItem());
    renderInspector({ itemId: ITEM_ID, canReview: false, canManage: false });

    await waitFor(() => expect(screen.getByText("lunch-combo-v3")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /approve as reference/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /reject as reference/i })).toBeNull();
  });
});

describe("a rejection requires a reason", () => {
  it("refuses to submit with zero reasons chosen", async () => {
    const fetchSpy = mockFetch(baseItem());
    renderInspector({ itemId: ITEM_ID, canReview: true, canManage: false });

    await waitFor(() => expect(screen.getByText("lunch-combo-v3")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /reject as reference/i }));
    fireEvent.click(screen.getByRole("button", { name: /send rejection/i }));

    expect(screen.getByRole("alert")).toHaveTextContent(/choose at least one reason/i);
    expect(fetchSpy.mock.calls.some((call) => String(call[0]).includes("/reviews"))).toBe(false);
  });

  it("names the exact version on an approval, never the whole design", async () => {
    const fetchSpy = mockFetch(baseItem());
    renderInspector({ itemId: ITEM_ID, canReview: true, canManage: false });

    await waitFor(() => expect(screen.getByText("lunch-combo-v3")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /approve as reference/i }));

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const reviewCall = fetchSpy.mock.calls.find((call) => String(call[0]).includes("/reviews"));
    expect(reviewCall).toBeDefined();
    const body = JSON.parse((reviewCall![1] as RequestInit).body as string);
    expect(body).toMatchObject({ versionId: VERSION_ID, verdict: "approved", reasonCodes: [] });
  });
});

describe("archive is a management act", () => {
  it("does not offer Archive to a role that cannot manage the library", async () => {
    mockFetch(baseItem());
    renderInspector({ itemId: ITEM_ID, canReview: false, canManage: false });

    await waitFor(() => expect(screen.getByText("lunch-combo-v3")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /archive design/i })).toBeNull();
  });

  it("does not offer Archive again once a design is already archived", async () => {
    mockFetch(baseItem({ archivedAt: "2026-09-03T00:00:00Z" }));
    renderInspector({ itemId: ITEM_ID, canReview: false, canManage: true });

    await waitFor(() => expect(screen.getByText("lunch-combo-v3")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /archive design/i })).toBeNull();
  });
});

describe("a version still processing", () => {
  it("shows a processing state and a way to retry finalizing, for a manager", async () => {
    mockFetch(
      baseItem({
        currentVersion: null,
        uploadState: "reserved",
        pendingVersion: {
          versionId: VERSION_ID,
          version: 1,
          state: "reserved",
          sourceKind: "stored_file",
          sourcePosterRenderId: null,
          contentHash: null,
          mimeType: null,
          byteSize: null,
          widthPx: null,
          heightPx: null,
          finalizedAt: null,
          createdAt: "2026-09-01T00:00:00Z",
          review: null,
          previewUrl: null,
        },
      }),
    );
    renderInspector({ itemId: ITEM_ID, canReview: false, canManage: true });

    await waitFor(() => expect(screen.getByText("lunch-combo-v3")).toBeTruthy());
    expect(screen.getByText("Uploading")).toBeTruthy();
    expect(screen.getByRole("button", { name: /finish processing this file/i })).toBeTruthy();
  });
});
