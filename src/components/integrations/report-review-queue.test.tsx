// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ReportReviewQueue } from "@/components/integrations/report-review-queue";
import type { ReportPackageSnapshot } from "@/modules/reports/application/ports";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";

function packageFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    organization_id: ORGANIZATION_ID,
    channel_id: "77777777-7777-4777-8777-777777777777",
    branch_id: "88888888-8888-4888-8888-888888888888",
    report_type: "Performance",
    declared_period_start: "2026-01-01",
    declared_period_end: "2026-02-28",
    declared_currency: "AED",
    period_timezone: "Asia/Dubai",
    file_kind: "xlsx",
    original_filename: "performance.xlsx",
    declared_content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    declared_content_length: 1_024,
    storage_bucket_id: "governed-report-packages",
    storage_path: `${ORGANIZATION_ID}/performance.xlsx`,
    storage_object_id: "99999999-9999-4999-8999-999999999999",
    storage_object_version: "1",
    content_sha256: "a".repeat(64),
    parser_version: 1,
    fingerprint_version: 2,
    schema_fingerprint: "b".repeat(64),
    status: "awaiting_contract",
    safe_failure_code: null,
    safe_failure_at: null,
    upload_expires_at: "2026-01-01T01:00:00.000Z",
    uploaded_at: "2026-01-01T00:01:00.000Z",
    profiled_at: "2026-01-01T00:02:00.000Z",
    retained_until: "2027-01-01T00:00:00.000Z",
    created_by: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    correlation_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:03:00.000Z",
    ...overrides,
  };
}

function queueView(packages: unknown[], projectionRuns: unknown[] = []) {
  return {
    packages,
    sheetManifests: [],
    contracts: [],
    contractVersions: [],
    contractDecisions: [],
    contractBindings: [],
    validationRuns: [],
    validationSheetResults: [],
    validationControlResults: [],
    projectionVersions: [],
    projectionDecisions: [],
    projectionBindings: [],
    projectionRuns,
    reconciliationGroups: [],
    channels: [],
    branches: [],
  } as unknown as ReportPackageSnapshot;
}

function renderQueue(input: {
  packages: unknown[];
  view?: ReportPackageSnapshot;
  fixedChannelId?: string;
  canRetry?: boolean;
}) {
  const callbacks = {
    onRetry: vi.fn(),
    onRetryValidation: vi.fn(),
    onRequestProjection: vi.fn(),
    onOpen: vi.fn(),
  };
  const view = input.view ?? queueView(input.packages);
  render(
    <ReportReviewQueue
      packages={view.packages}
      view={view}
      fixedChannelId={input.fixedChannelId}
      canRetry={input.canRetry ?? true}
      onRetry={callbacks.onRetry}
      retryPending={false}
      onRetryValidation={callbacks.onRetryValidation}
      retryValidationPending={false}
      onRequestProjection={callbacks.onRequestProjection}
      requestProjectionPending={false}
      onOpen={callbacks.onOpen}
    />,
  );
  return callbacks;
}

afterEach(() => {
  cleanup();
});

describe("ReportReviewQueue headings", () => {
  it("keeps the channel-page heading variant", () => {
    renderQueue({ packages: [], fixedChannelId: "channel-id" });

    expect(screen.getByText("1 · This channel's uploads")).toBeInTheDocument();
  });

  it("keeps the integrations-view heading variant", () => {
    renderQueue({ packages: [] });

    expect(screen.getByText("1 · Recent uploads")).toBeInTheDocument();
  });

  it("keeps the empty-state copy", () => {
    renderQueue({ packages: [] });

    expect(screen.getByText("No governed report packages yet.")).toBeInTheDocument();
  });
});

describe("ReportReviewQueue rows", () => {
  it("lists the oldest upload first", () => {
    const packages = [
      packageFixture({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        report_type: "Newest",
        created_at: "2026-03-01T00:00:00.000Z",
      }),
      packageFixture({
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        report_type: "Oldest",
        created_at: "2026-01-01T00:00:00.000Z",
      }),
      packageFixture({
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        report_type: "Middle",
        created_at: "2026-02-01T00:00:00.000Z",
      }),
    ];
    renderQueue({ packages });

    const rows = screen.getAllByRole("button", { name: /Open details for/ });
    expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual([
      expect.stringContaining("Oldest"),
      expect.stringContaining("Middle"),
      expect.stringContaining("Newest"),
    ]);
  });

  it("names the state and the age on one compact line", () => {
    renderQueue({
      packages: [packageFixture({ status: "awaiting_contract" })],
    });

    // The badge and the reason line carry the same state label.
    expect(screen.getAllByText(/Profiled · awaiting contract/)).toHaveLength(2);
    expect(screen.getByText(/ago/)).toBeInTheDocument();
  });

  it("opens the drawer with the row's package id", () => {
    const callbacks = renderQueue({
      packages: [packageFixture({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" })],
    });

    fireEvent.click(screen.getByRole("button", { name: /Open details for Performance/i }));

    expect(callbacks.onOpen).toHaveBeenCalledWith("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
  });
});

describe("ReportReviewQueue actions", () => {
  it("retries a failed upload with the package id", () => {
    const callbacks = renderQueue({
      packages: [
        packageFixture({
          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          status: "failed",
        }),
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: /^Retry$/i }));

    expect(callbacks.onRetry).toHaveBeenCalledWith("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
  });

  it("offers no retry when the failed upload never reached storage", () => {
    renderQueue({
      packages: [packageFixture({ status: "failed", storage_object_id: null })],
    });

    expect(screen.queryByRole("button", { name: /^Retry$/i })).not.toBeInTheDocument();
  });

  it("starts validation for an approved contract", () => {
    const callbacks = renderQueue({
      packages: [
        packageFixture({
          id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          status: "awaiting_validation",
        }),
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: /Start validation/i }));

    expect(callbacks.onRetryValidation).toHaveBeenCalledWith(
      "ffffffff-ffff-4fff-8fff-ffffffffffff",
    );
  });

  it("retries a failed validation", () => {
    const callbacks = renderQueue({
      packages: [
        packageFixture({
          id: "11111111-2222-4333-8444-555555555555",
          status: "validation_failed",
        }),
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: /Retry validation/i }));

    expect(callbacks.onRetryValidation).toHaveBeenCalledWith(
      "11111111-2222-4333-8444-555555555555",
    );
  });

  it("projects validated figures safely", () => {
    const callbacks = renderQueue({
      packages: [
        packageFixture({
          id: "22222222-3333-4444-8555-666666666666",
          status: "validated",
        }),
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: /Project safely/i }));

    expect(callbacks.onRequestProjection).toHaveBeenCalledWith(
      "22222222-3333-4444-8555-666666666666",
    );
  });

  it("retries a failed projection", () => {
    const callbacks = renderQueue({
      packages: [
        packageFixture({
          id: "33333333-4444-4555-8666-777777777777",
          status: "projection_failed",
        }),
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: /Retry projection/i }));

    expect(callbacks.onRequestProjection).toHaveBeenCalledWith(
      "33333333-4444-4555-8666-777777777777",
    );
  });

  it("shows reasons without buttons when the role cannot retry", () => {
    renderQueue({
      packages: [packageFixture({ status: "validation_failed" })],
      canRetry: false,
    });

    expect(screen.getAllByText(/Validation needs attention/)).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Retry validation/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open details for/i })).toBeInTheDocument();
  });
});
