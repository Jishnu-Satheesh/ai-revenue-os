// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CreativeHistoryGrid } from "@/components/assets/creative-history-grid";
import type { CreativeHistoryItemView } from "@/components/assets/asset-query-options";

afterEach(cleanup);

function version(overrides: Partial<CreativeHistoryItemView["currentVersion"]> = {}) {
  return {
    versionId: "version-1",
    version: 1,
    state: "usable" as const,
    sourceKind: "stored_file" as const,
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
    ...overrides,
  };
}

function item(overrides: Partial<CreativeHistoryItemView> = {}): CreativeHistoryItemView {
  return {
    organizationId: "org-1",
    itemId: "item-1",
    label: "family-table-hero",
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
    currentVersion: version(),
    pendingVersion: null,
    versions: [version()],
    eligibility: "unreviewed",
    uploadState: "needs_review",
    ...overrides,
  };
}

describe("empty states", () => {
  it("renders the caller's empty state when there is nothing to show", () => {
    render(
      <CreativeHistoryGrid
        items={[]}
        onSelect={vi.fn()}
        onReloadPreviews={vi.fn()}
        timeZone="Asia/Dubai"
        emptyState={<p>No designs yet</p>}
      />,
    );

    expect(screen.getByText("No designs yet")).toBeTruthy();
  });
});

describe("a design's card", () => {
  it("shows its name, type, version, and unreviewed state", () => {
    render(
      <CreativeHistoryGrid
        items={[item()]}
        onSelect={vi.fn()}
        onReloadPreviews={vi.fn()}
        timeZone="Asia/Dubai"
        emptyState={null}
      />,
    );

    expect(screen.getByText("family-table-hero")).toBeTruthy();
    expect(screen.getByText(/poster.*v1/i)).toBeTruthy();
    expect(screen.getByText("Unreviewed")).toBeTruthy();
  });

  it("shows the real verdict once one exists", () => {
    render(
      <CreativeHistoryGrid
        items={[
          item({
            currentVersion: version({
              review: { verdict: "approved", reasonCodes: [], note: null, reviewedAt: "2026-09-02T00:00:00Z" },
            }),
          }),
        ]}
        onSelect={vi.fn()}
        onReloadPreviews={vi.fn()}
        timeZone="Asia/Dubai"
        emptyState={null}
      />,
    );

    expect(screen.getByText("Approved")).toBeTruthy();
  });

  it("calls onSelect with the exact design clicked", () => {
    const onSelect = vi.fn();
    render(
      <CreativeHistoryGrid
        items={[item()]}
        onSelect={onSelect}
        onReloadPreviews={vi.fn()}
        timeZone="Asia/Dubai"
        emptyState={null}
      />,
    );

    fireEvent.click(screen.getByText("family-table-hero"));

    expect(onSelect).toHaveBeenCalledWith("item-1");
  });

  it("shows a processing state, never a broken image, while nothing is usable yet", () => {
    render(
      <CreativeHistoryGrid
        items={[item({ currentVersion: null, uploadState: "reserved" })]}
        onSelect={vi.fn()}
        onReloadPreviews={vi.fn()}
        timeZone="Asia/Dubai"
        emptyState={null}
      />,
    );

    expect(screen.getByText("Uploading")).toBeTruthy();
  });

  it("names a missing preview honestly instead of an empty tile", () => {
    render(
      <CreativeHistoryGrid
        items={[item({ currentVersion: version({ previewUrl: null }) })]}
        onSelect={vi.fn()}
        onReloadPreviews={vi.fn()}
        timeZone="Asia/Dubai"
        emptyState={null}
      />,
    );

    expect(screen.getByText("No preview available")).toBeTruthy();
  });

  it("treats a failed image load as an expired signed preview, with a way to reload", () => {
    const onReloadPreviews = vi.fn();
    render(
      <CreativeHistoryGrid
        items={[item()]}
        onSelect={vi.fn()}
        onReloadPreviews={onReloadPreviews}
        timeZone="Asia/Dubai"
        emptyState={null}
      />,
    );

    fireEvent.error(screen.getByRole("img"));

    expect(screen.getByText("Preview expired")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /reload/i }));
    expect(onReloadPreviews).toHaveBeenCalled();
  });

  it("keeps a rejected design visible with its verdict, never removing it", () => {
    render(
      <CreativeHistoryGrid
        items={[
          item({
            currentVersion: version({
              review: { verdict: "rejected", reasonCodes: ["wrong_subject"], note: null, reviewedAt: "2026-09-02T00:00:00Z" },
            }),
          }),
        ]}
        onSelect={vi.fn()}
        onReloadPreviews={vi.fn()}
        timeZone="Asia/Dubai"
        emptyState={null}
      />,
    );

    expect(screen.getByText("family-table-hero")).toBeTruthy();
    expect(screen.getByText("Rejected")).toBeTruthy();
  });

  it("marks an archived design without hiding it", () => {
    render(
      <CreativeHistoryGrid
        items={[item({ archivedAt: "2026-09-05T00:00:00Z" })]}
        onSelect={vi.fn()}
        onReloadPreviews={vi.fn()}
        timeZone="Asia/Dubai"
        emptyState={null}
      />,
    );

    expect(screen.getByText("Archived")).toBeTruthy();
  });
});
