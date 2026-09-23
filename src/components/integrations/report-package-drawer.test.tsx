// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import {
  ReportPackageDrawer,
  type DrawerFocus,
} from "@/components/integrations/report-package-drawer";
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

function contractVersionFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: CONTRACT_VERSION_ID,
    organization_id: ORGANIZATION_ID,
    report_contract_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    report_package_id: PACKAGE_ID,
    version: 1,
    schema_fingerprint: "e".repeat(64),
    parser_version: 1,
    fingerprint_version: 2,
    mapping_document: null,
    mapping_digest: "f".repeat(64),
    declared_currency: "AED",
    financial_sign_semantics: "signed",
    controls: [],
    unmapped_field_disposition: "refuse",
    proposal_source: "guided",
    provider_definition_key: null,
    created_by: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    correlation_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    created_at: "2026-02-01T00:00:00.000Z",
    ...overrides,
  };
}

function projectionVersionFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: PROJECTION_VERSION_ID,
    organization_id: ORGANIZATION_ID,
    report_contract_version_id: CONTRACT_VERSION_ID,
    version: 1,
    projection_document: null,
    projection_digest: "0".repeat(64),
    calculation_version: 1,
    proposal_source: "guided",
    provider_definition_key: null,
    created_by: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    correlation_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    created_at: "2026-02-02T00:00:00.000Z",
    ...overrides,
  };
}

function contractDecisionFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    organization_id: ORGANIZATION_ID,
    report_contract_version_id: CONTRACT_VERSION_ID,
    decision: "approved",
    mapping_digest: "f".repeat(64),
    reason: null,
    decided_by: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    correlation_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    created_at: "2026-02-03T00:00:00.000Z",
    ...overrides,
  };
}

function projectionDecisionFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    organization_id: ORGANIZATION_ID,
    report_projection_version_id: PROJECTION_VERSION_ID,
    decision: "approved",
    projection_digest: "0".repeat(64),
    reason: null,
    decided_by: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    correlation_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    created_at: "2026-02-04T00:00:00.000Z",
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
  focus?: DrawerFocus;
  canUpload?: boolean;
  canRetry?: boolean;
  canApproveContract?: boolean;
  fixedChannelId?: string;
  rejectionReason?: string;
  proposalPackageId?: string;
  projectionContractVersionId?: string;
}) {
  const callbacks = {
    onRetry: vi.fn(),
    onRetryValidation: vi.fn(),
    onRequestProjection: vi.fn(),
    onResolveOverlap: vi.fn(),
    onRejectionReasonChange: vi.fn(),
    onProposalPackageIdChange: vi.fn(),
    onMappingDone: vi.fn(),
    onProjectionContractVersionIdChange: vi.fn(),
    onDecideContract: vi.fn(),
    onDecideProjection: vi.fn(),
    onProposeProjection: vi.fn(),
    onClose: vi.fn(),
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = input.view ?? drawerView();
  render(
    <QueryClientProvider client={queryClient}>
      <ReportPackageDrawer
        packageId={input.packageId === undefined ? PACKAGE_ID : input.packageId}
        focus={input.focus ?? null}
        organizationId={ORGANIZATION_ID}
        timeZone="Asia/Dubai"
        view={view}
        packages={view.packages}
        fixedChannelId={input.fixedChannelId}
        canUpload={input.canUpload ?? true}
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
        rejectionReason={input.rejectionReason ?? ""}
        onRejectionReasonChange={callbacks.onRejectionReasonChange}
        proposalPackageId={input.proposalPackageId ?? ""}
        onProposalPackageIdChange={callbacks.onProposalPackageIdChange}
        onMappingDone={callbacks.onMappingDone}
        projectionContractVersionId={input.projectionContractVersionId ?? ""}
        onProjectionContractVersionIdChange={callbacks.onProjectionContractVersionIdChange}
        onDecideContract={callbacks.onDecideContract}
        decideContractPending={false}
        onDecideProjection={callbacks.onDecideProjection}
        decideProjectionPending={false}
        onProposeProjection={callbacks.onProposeProjection}
        proposeProjectionPending={false}
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

describe("ReportPackageDrawer mapping versions", () => {
  it("shows the open package's mapping block and hides other packages' versions", async () => {
    const view = drawerView({
      contractVersions: [
        contractVersionFixture(),
        contractVersionFixture({
          id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          report_package_id: "00000000-0000-4000-8000-000000000000",
          version: 7,
        }),
      ],
    });
    renderDrawer({ view });

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Mapping v1/)).toBeInTheDocument();
    expect(within(dialog).getByText("Awaiting approval")).toBeInTheDocument();
    expect(within(dialog).getByText(/Fingerprint e{12}/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/Mapping v7/)).not.toBeInTheDocument();
  });

  it("approves the exact contract with the version id", async () => {
    const view = drawerView({ contractVersions: [contractVersionFixture()] });
    const callbacks = renderDrawer({ view });

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Approve exact contract/i }));

    expect(callbacks.onDecideContract).toHaveBeenCalledWith({
      versionId: CONTRACT_VERSION_ID,
      decision: "approved",
    });
  });

  it("requires a reason before rejecting", async () => {
    const view = drawerView({ contractVersions: [contractVersionFixture()] });
    const callbacks = renderDrawer({ view });

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: /^Reject$/i })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Rejection reason for contract version 1/i), {
      target: { value: "columns do not match" },
    });

    expect(callbacks.onRejectionReasonChange).toHaveBeenCalledWith("columns do not match");
  });

  it("rejects with the version id once a reason is set", async () => {
    const view = drawerView({ contractVersions: [contractVersionFixture()] });
    const callbacks = renderDrawer({ view, rejectionReason: "columns do not match" });

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^Reject$/i }));

    expect(callbacks.onDecideContract).toHaveBeenCalledWith({
      versionId: CONTRACT_VERSION_ID,
      decision: "rejected",
    });
  });

  it("hides the decision buttons once the version is decided", async () => {
    const view = drawerView({
      contractVersions: [contractVersionFixture()],
      contractDecisions: [contractDecisionFixture()],
    });
    renderDrawer({ view });

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).queryByRole("button", { name: /Approve exact contract/i }),
    ).not.toBeInTheDocument();
    expect(within(dialog).getByText("Approved · validation next")).toBeInTheDocument();
  });

  it("lists uploads waiting to be mapped and reports the choice", async () => {
    const view = drawerView({
      packages: [packageFixture({ status: "awaiting_contract" })],
      projectionRuns: [],
      reconciliationGroups: [],
    });
    const callbacks = renderDrawer({ view });

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("combobox", { name: /which upload are you mapping/i }),
    );
    fireEvent.click(await screen.findByRole("option", { name: /Performance · 2026-01-01/i }));

    expect(callbacks.onProposalPackageIdChange).toHaveBeenCalledWith(PACKAGE_ID);
  });
});

describe("ReportPackageDrawer figures versions", () => {
  it("shows the open package's figures block and hides other packages' versions", async () => {
    const view = drawerView({
      contractVersions: [contractVersionFixture()],
      projectionVersions: [
        projectionVersionFixture(),
        projectionVersionFixture({
          id: "ffffffff-0000-4000-8000-000000000000",
          report_contract_version_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          version: 9,
        }),
      ],
    });
    renderDrawer({ view });

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Figures v1/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Declaration digest 0{12}/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/Figures v9/)).not.toBeInTheDocument();
  });

  it("approves figures with the version id", async () => {
    const view = drawerView({
      contractVersions: [contractVersionFixture()],
      projectionVersions: [projectionVersionFixture()],
    });
    const callbacks = renderDrawer({ view });

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Approve these figures/i }));

    expect(callbacks.onDecideProjection).toHaveBeenCalledWith({
      versionId: PROJECTION_VERSION_ID,
      decision: "approved",
    });
  });

  it("hides the decision buttons once the figures are decided", async () => {
    const view = drawerView({
      contractVersions: [contractVersionFixture()],
      projectionVersions: [projectionVersionFixture()],
      projectionDecisions: [projectionDecisionFixture()],
    });
    renderDrawer({ view });

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).queryByRole("button", { name: /Approve these figures/i }),
    ).not.toBeInTheDocument();
    expect(within(dialog).getByText("Approved")).toBeInTheDocument();
  });

  it("proposes figures from the selected approved mapping", async () => {
    const view = drawerView({
      contractVersions: [contractVersionFixture()],
      contractDecisions: [contractDecisionFixture()],
      projectionVersions: [],
      projectionRuns: [],
      reconciliationGroups: [],
    });
    const callbacks = renderDrawer({ view, projectionContractVersionId: CONTRACT_VERSION_ID });

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Propose the figures to read/i }));

    expect(callbacks.onProposeProjection).toHaveBeenCalledWith(CONTRACT_VERSION_ID);
  });

  it("refuses a second live declaration for one mapping", async () => {
    const view = drawerView({
      contractVersions: [contractVersionFixture()],
      contractDecisions: [contractDecisionFixture()],
      projectionVersions: [projectionVersionFixture()],
      projectionRuns: [],
      reconciliationGroups: [],
    });
    renderDrawer({ view, projectionContractVersionId: CONTRACT_VERSION_ID });

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/already has a set of figures above/i)).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: /Propose the figures to read/i }),
    ).toBeDisabled();
  });

  it("scopes the approved-mapping selector to the open package", async () => {
    const view = drawerView({
      contractVersions: [
        contractVersionFixture(),
        contractVersionFixture({
          id: "aaaaaaaa-0000-4000-8000-000000000000",
          report_package_id: "00000000-0000-4000-8000-000000000000",
          version: 2,
        }),
      ],
      contractDecisions: [
        contractDecisionFixture(),
        contractDecisionFixture({
          id: "bbbbbbbb-0000-4000-8000-000000000000",
          report_contract_version_id: "aaaaaaaa-0000-4000-8000-000000000000",
        }),
      ],
      projectionVersions: [],
      projectionRuns: [],
      reconciliationGroups: [],
    });
    renderDrawer({ view });

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("combobox", { name: /approved mapping/i }));

    expect(await screen.findByRole("option", { name: /Mapping v1/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Mapping v2/ })).not.toBeInTheDocument();
  });
});

describe("ReportPackageDrawer focus", () => {
  it("lands on the mapping block when opened with mapping focus", async () => {
    const scrollIntoView = vi.fn();
    const prototype = window.HTMLElement.prototype as unknown as Record<string, unknown>;
    prototype.scrollIntoView = scrollIntoView;
    try {
      renderDrawer({ focus: "mapping" });

      await screen.findByRole("dialog");
      expect(document.getElementById("drawer-mapping")).not.toBeNull();
      expect(document.getElementById("drawer-figures")).not.toBeNull();
      expect(scrollIntoView).toHaveBeenCalled();
    } finally {
      delete prototype.scrollIntoView;
    }
  });

  it("opens at the top without throwing when the anchor is absent", async () => {
    renderDrawer({ focus: "validation" });

    const dialog = await screen.findByRole("dialog");
    expect(document.getElementById("drawer-validation")).toBeNull();
    expect(dialog).toBeInTheDocument();
  });
});

describe("ReportPackageDrawer role gating", () => {
  it("shows reasons without decision buttons when the role cannot approve", async () => {
    const view = drawerView({
      contractVersions: [contractVersionFixture()],
      projectionVersions: [projectionVersionFixture()],
    });
    renderDrawer({ view, canApproveContract: false });

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Mapping v1/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Figures v1/)).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: /Approve exact contract/i }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: /Approve these figures/i }),
    ).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /^Reject$/i })).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: /Propose the figures/i }),
    ).not.toBeInTheDocument();
  });
});
