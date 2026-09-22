// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { ReportPackageDrawer } from "@/components/integrations/report-package-drawer";
import type { ReportPackageSnapshot } from "@/modules/reports/application/ports";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const PACKAGE_ID = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "33333333-3333-4333-8333-333333333333";
const RECONCILIATION_ID = "44444444-4444-4444-8444-444444444444";
const CONTRACT_VERSION_ID = "55555555-5555-4555-8555-555555555555";
const PROJECTION_VERSION_ID = "66666666-6666-4666-8666-666666666666";

function packageFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: PACKAGE_ID,
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
    status: "reconciliation_required",
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

function drawerView(overrides: Record<string, unknown> = {}) {
  return {
    packages: [packageFixture()],
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
    projectionRuns: [
      {
        id: RUN_ID,
        organization_id: ORGANIZATION_ID,
        report_package_id: PACKAGE_ID,
        report_contract_version_id: CONTRACT_VERSION_ID,
        report_contract_binding_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        report_projection_version_id: PROJECTION_VERSION_ID,
        report_projection_binding_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        validation_run_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        calculation_version: 1,
        input_digest: "c".repeat(64),
        result_digest: "d".repeat(64),
        status: "projected",
        quality_state: "complete",
        completeness_state: "partial",
        output_count: 653,
        absent_row_count: 468,
        error_codes: [],
        warning_codes: [],
        correlation_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        started_at: "2026-03-01T00:00:00.000Z",
        completed_at: "2026-03-01T00:01:00.000Z",
        created_at: "2026-03-01T00:00:00.000Z",
      },
    ],
    reconciliationGroups: [
      {
        representative_reconciliation_id: RECONCILIATION_ID,
        organization_id: ORGANIZATION_ID,
        report_package_id: PACKAGE_ID,
        projection_run_id: RUN_ID,
        projection_output_key: "gross_revenue",
        projection_target: "period_grain",
        metric_key: "revenue.gross",
        normalized_sheet_name: "performance",
        canonical_field: "gross_sales",
        source_header: "gross_sales",
        affected_record_count: 20,
        matching_record_count: 20,
        affected_dates: ["2026-01-01", "2026-01-02", "2026-02-15"],
        affected_dates_truncated: false,
        first_period: "2026-01-01",
        last_period: "2026-02-15",
        prior_upload_count: 1,
        prior_report_type: "Performance",
        prior_period_start: "2026-01-01",
        prior_period_end: "2026-02-28",
      },
    ],
    channels: [],
    branches: [],
    ...overrides,
  } as unknown as ReportPackageSnapshot;
}

function renderDrawer(input: {
  view?: ReportPackageSnapshot;
  packageId?: string | null;
  canRetry?: boolean;
  canApproveContract?: boolean;
}) {
  const callbacks = {
    onRetry: vi.fn(),
    onRetryValidation: vi.fn(),
    onRequestProjection: vi.fn(),
    onResolveOverlap: vi.fn(),
    onClose: vi.fn(),
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ReportPackageDrawer
        packageId={input.packageId === undefined ? PACKAGE_ID : input.packageId}
        organizationId={ORGANIZATION_ID}
        timeZone="Asia/Dubai"
        view={input.view ?? drawerView()}
        canRetry={input.canRetry ?? true}
        canApproveContract={input.canApproveContract ?? true}
        onRetry={callbacks.onRetry}
        retryPending={false}
        onRetryValidation={callbacks.onRetryValidation}
        retryValidationPending={false}
        onRequestProjection={callbacks.onRequestProjection}
        requestProjectionPending={false}
        onResolveOverlap={callbacks.onResolveOverlap}
        resolveOverlapPending={false}
        onClose={callbacks.onClose}
      />
    </QueryClientProvider>,
  );
  return callbacks;
}

afterEach(() => {
  cleanup();
});

describe("ReportPackageDrawer open state", () => {
  it("renders no dialog without a selected package", () => {
    renderDrawer({ packageId: null });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("stays closed for an unknown package id", () => {
    renderDrawer({ packageId: "00000000-0000-4000-8000-000000000000" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes through the dismiss button", async () => {
    const callbacks = renderDrawer({});

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /close/i }));

    expect(callbacks.onClose).toHaveBeenCalledTimes(1);
  });
});

describe("ReportPackageDrawer detail", () => {
  it("titles the drawer with the package and its retained currency line", async () => {
    renderDrawer({});

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Performance · 2026-01-01 to 2026-02-28")).toBeInTheDocument();
    expect(within(dialog).getByText(/XLSX · AED · retained until/)).toBeInTheDocument();
    expect(within(dialog).getByText("Overlap requires review")).toBeInTheDocument();
  });

  it("keeps the reconciliation action and the projection summary together", async () => {
    renderDrawer({});

    const dialog = await screen.findByRole("dialog");
    const action = within(dialog).getByRole("region", { name: "Gross revenue overlap" });
    expect(within(action).getByText(/20 daily Gross revenue records/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/653 records checked/i)).toBeInTheDocument();
  });

  it("retries a failed upload with the package id", async () => {
    const view = drawerView({
      packages: [packageFixture({ status: "failed" })],
      projectionRuns: [],
      reconciliationGroups: [],
    });
    const callbacks = renderDrawer({ view });

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^Retry$/i }));

    expect(callbacks.onRetry).toHaveBeenCalledWith(PACKAGE_ID);
  });

  it("projects validated figures safely", async () => {
    const view = drawerView({
      packages: [packageFixture({ status: "validated" })],
      projectionRuns: [],
      reconciliationGroups: [],
    });
    const callbacks = renderDrawer({ view });

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Project safely/i }));

    expect(callbacks.onRequestProjection).toHaveBeenCalledWith(PACKAGE_ID);
  });
});
