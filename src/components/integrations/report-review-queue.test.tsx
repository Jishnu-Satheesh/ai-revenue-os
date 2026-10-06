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

function queueView(
  packages: unknown[],
  projectionRuns: unknown[] = [],
  lists: {
    contractVersions?: unknown[];
    contractDecisions?: unknown[];
    projectionVersions?: unknown[];
    projectionDecisions?: unknown[];
    validationRuns?: unknown[];
    reconciliationGroups?: unknown[];
  } = {},
) {
  return {
    packages,
    sheetManifests: [],
    contracts: [],
    contractVersions: lists.contractVersions ?? [],
    contractDecisions: lists.contractDecisions ?? [],
    contractBindings: [],
    validationRuns: lists.validationRuns ?? [],
    validationSheetResults: [],
    validationControlResults: [],
    projectionVersions: lists.projectionVersions ?? [],
    projectionDecisions: lists.projectionDecisions ?? [],
    projectionBindings: [],
    projectionRuns,
    reconciliationGroups: lists.reconciliationGroups ?? [],
    channels: [],
    branches: [],
  } as unknown as ReportPackageSnapshot;
}

function renderQueue(input: {
  packages: unknown[];
  view?: ReportPackageSnapshot;
  fixedChannelId?: string;
  canRetry?: boolean;
  lists?: {
    contractVersions?: unknown[];
    contractDecisions?: unknown[];
    projectionVersions?: unknown[];
    projectionDecisions?: unknown[];
    validationRuns?: unknown[];
    reconciliationGroups?: unknown[];
  };
}) {
  const callbacks = {
    onRetry: vi.fn(),
    onRetryValidation: vi.fn(),
    onRequestProjection: vi.fn(),
    onOpen: vi.fn(),
  };
  const view = input.view ?? queueView(input.packages, [], input.lists ?? {});
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

  it("names the reason and the age on one compact line", () => {
    renderQueue({
      packages: [packageFixture({ status: "awaiting_contract" })],
    });

    // Slice 3: the reason replaces the state label in the sub-line; the
    // badge keeps the state label.
    expect(screen.getByText(/Needs column mapping/)).toBeInTheDocument();
    expect(screen.getByText(/ago/)).toBeInTheDocument();
    expect(screen.getByText("Profiled · awaiting contract")).toBeInTheDocument();
  });

  it("opens the drawer with the row's package id and its mapping focus", () => {
    const callbacks = renderQueue({
      packages: [packageFixture({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" })],
    });

    fireEvent.click(screen.getByRole("button", { name: /Open details for Performance/i }));

    expect(callbacks.onOpen).toHaveBeenCalledWith(
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      "mapping",
    );
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

    // Slice 3: the sub-line carries the reason, the badge the state label.
    expect(screen.getByText("Validation needs attention")).toBeInTheDocument();
    expect(screen.getByText(/Validation failed: 0 error\(s\)/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Retry validation/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open details for/i })).toBeInTheDocument();
  });
});

describe("ReportReviewQueue decision rows", () => {
  const PACKAGE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const CONTRACT_VERSION_ID = "55555555-5555-4555-8555-555555555555";
  const PROJECTION_VERSION_ID = "66666666-6666-4666-8666-666666666666";

  function versionLists(
    overrides: {
      contractVersions?: unknown[];
      contractDecisions?: unknown[];
      projectionVersions?: unknown[];
      projectionDecisions?: unknown[];
    } = {},
  ) {
    return {
      contractVersions: [
        {
          id: CONTRACT_VERSION_ID,
          report_package_id: PACKAGE_ID,
          version: 1,
          created_at: "2026-02-01T00:00:00.000Z",
        },
      ],
      contractDecisions: [],
      projectionVersions: [],
      projectionDecisions: [],
      ...overrides,
    };
  }

  it("reviews an undecided mapping with the package id and mapping focus", () => {
    const callbacks = renderQueue({
      packages: [packageFixture({ id: PACKAGE_ID })],
      lists: versionLists(),
    });

    expect(screen.getByText(/Mapping v1 awaiting approval/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review" }));

    expect(callbacks.onOpen).toHaveBeenCalledWith(PACKAGE_ID, "mapping");
  });

  it("reviews undecided figures with the package id and figures focus", () => {
    const callbacks = renderQueue({
      packages: [packageFixture({ id: PACKAGE_ID })],
      lists: versionLists({
        contractDecisions: [
          { report_contract_version_id: CONTRACT_VERSION_ID, decision: "approved" },
        ],
        projectionVersions: [
          {
            id: PROJECTION_VERSION_ID,
            report_contract_version_id: CONTRACT_VERSION_ID,
            version: 1,
            created_at: "2026-02-02T00:00:00.000Z",
          },
        ],
      }),
    });

    expect(screen.getByText(/Figures v1 awaiting approval/)).toBeInTheDocument();
    expect(screen.queryByText(/Mapping v1 awaiting approval/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review" }));

    expect(callbacks.onOpen).toHaveBeenCalledWith(PACKAGE_ID, "figures");
  });

  it("shows no decision rows once every version is decided", () => {
    renderQueue({
      packages: [packageFixture({ id: PACKAGE_ID })],
      lists: versionLists({
        contractDecisions: [
          { report_contract_version_id: CONTRACT_VERSION_ID, decision: "approved" },
        ],
        projectionVersions: [
          {
            id: PROJECTION_VERSION_ID,
            report_contract_version_id: CONTRACT_VERSION_ID,
            version: 1,
            created_at: "2026-02-02T00:00:00.000Z",
          },
        ],
        projectionDecisions: [
          { report_projection_version_id: PROJECTION_VERSION_ID, decision: "rejected" },
        ],
      }),
    });

    expect(screen.queryByRole("button", { name: "Review" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Awaiting approval/)).not.toBeInTheDocument();
  });

  it("shows no decision rows for versions outside this view", () => {
    renderQueue({
      packages: [packageFixture({ id: PACKAGE_ID })],
      lists: versionLists({
        contractVersions: [
          {
            id: CONTRACT_VERSION_ID,
            report_package_id: "00000000-0000-4000-8000-000000000000",
            version: 1,
            created_at: "2026-02-01T00:00:00.000Z",
          },
        ],
        projectionVersions: [
          {
            id: PROJECTION_VERSION_ID,
            report_contract_version_id: "00000000-0000-4000-8000-000000000000",
            version: 1,
            created_at: "2026-02-02T00:00:00.000Z",
          },
        ],
      }),
    });

    expect(screen.queryByRole("button", { name: "Review" })).not.toBeInTheDocument();
  });
});

describe("ReportReviewQueue tiers", () => {
  it("renders one package per tier in T1 to T4 order", () => {
    // The Tier-2 package is still profiling, so it sits in the
    // in-progress strip (no row of its own) while its undecided mapping
    // version renders the Tier-2 decision row.
    const tierTwoPackageId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    renderQueue({
      packages: [
        packageFixture({
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          report_type: "Validated report",
          status: "validated",
        }),
        packageFixture({
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          report_type: "Mapping report",
          status: "awaiting_contract",
        }),
        packageFixture({
          id: tierTwoPackageId,
          report_type: "Decision report",
          status: "profiling",
        }),
        packageFixture({
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          report_type: "Failure report",
          status: "validation_failed",
        }),
      ],
      lists: {
        contractVersions: [
          {
            id: "55555555-5555-4555-8555-555555555555",
            report_package_id: tierTwoPackageId,
            version: 1,
            created_at: "2026-02-01T00:00:00.000Z",
          },
        ],
      },
    });

    const rows = screen.getAllByRole("button", {
      name: /^(Open details for|Review mapping v)/,
    });
    expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual([
      "Open details for Failure report · 2026-01-01 to 2026-02-28",
      "Review mapping v1 for Decision report · 2026-01-01 to 2026-02-28",
      "Open details for Mapping report · 2026-01-01 to 2026-02-28",
      "Open details for Validated report · 2026-01-01 to 2026-02-28",
    ]);
  });

  it("states each tier's reason in the row's own words", () => {
    const failedValidationId = "11111111-0000-4000-8000-000000000000";
    const overlapId = "22222222-0000-4000-8000-000000000000";
    renderQueue({
      packages: [
        packageFixture({ id: failedValidationId, status: "validation_failed" }),
        packageFixture({
          id: "33333333-0000-4000-8000-000000000000",
          status: "awaiting_contract",
        }),
        packageFixture({
          id: "44444444-0000-4000-8000-000000000000",
          status: "validated",
        }),
        packageFixture({ id: overlapId, status: "reconciliation_required" }),
        packageFixture({
          id: "55555555-0000-4000-8000-000000000000",
          status: "awaiting_projection",
        }),
      ],
      lists: {
        validationRuns: [
          {
            report_package_id: failedValidationId,
            error_codes: ["REQUIRED_FIELD_MISSING", "OPTIONAL_FIELD_MISSING"],
          },
        ],
        reconciliationGroups: [
          { report_package_id: overlapId, affected_record_count: 20 },
          { report_package_id: overlapId, affected_record_count: 5 },
        ],
      },
    });

    expect(screen.getByText(/Validation failed: 2 error\(s\)/)).toBeInTheDocument();
    expect(screen.getByText(/Needs column mapping/)).toBeInTheDocument();
    expect(screen.getByText(/Validated — project the figures/)).toBeInTheDocument();
    expect(screen.getByText(/25 records need review/)).toBeInTheDocument();
    expect(screen.getByText(/Projection starts when the rollout is enabled/)).toBeInTheDocument();
  });
});

describe("ReportReviewQueue strips", () => {
  it("keeps settled packages in the collapsed strip, never as queue rows", () => {
    renderQueue({
      packages: [packageFixture({ status: "projected" })],
    });

    expect(screen.getByRole("button", { name: "Settled · 1" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open details for/ })).not.toBeInTheDocument();
    expect(screen.queryByText("No governed report packages yet.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Settled · 1" }));

    expect(
      screen.getByRole("button", {
        name: "Open details for Performance, 2026-01-01 to 2026-02-28",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Performance")).toBeInTheDocument();
    expect(screen.getByText("Projected · exact-range evidence ready")).toBeInTheDocument();
    expect(screen.getByText("2026-01-01 to 2026-02-28")).toBeInTheDocument();
  });

  it("renders in-progress uploads as slim rows with no buttons", () => {
    renderQueue({
      packages: [packageFixture({ status: "profiling" })],
    });

    expect(screen.getByText("Performance · 2026-01-01 to 2026-02-28")).toBeInTheDocument();
    expect(screen.getByText("Checking structure")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
