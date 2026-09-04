// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastMocks = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("sonner", () => ({ toast: toastMocks }));

import { ReportPackageUpload } from "@/components/integrations/report-package-upload";
import type { ReportPackageSnapshot } from "@/modules/reports/application/ports";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const PACKAGE_ID = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "33333333-3333-4333-8333-333333333333";
const RECONCILIATION_ID = "44444444-4444-4444-8444-444444444444";
const CONTRACT_VERSION_ID = "55555555-5555-4555-8555-555555555555";
const PROJECTION_VERSION_ID = "66666666-6666-4666-8666-666666666666";

const snapshot = {
  packages: [
    {
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
      declared_content_type:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
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
    },
  ],
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
} as unknown as ReportPackageSnapshot;

function renderUpload() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ReportPackageUpload organizationId={ORGANIZATION_ID} role="owner" timeZone="Asia/Dubai" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("crypto", { ...globalThis.crypto, randomUUID: () => "fixed-operation-key" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ resolution: { outcome: "resolved" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify(snapshot), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ReportPackageUpload reconciliation actions", () => {
  it("shows one meaningful action before the compact projection summary and hides audit noise", async () => {
    renderUpload();

    const action = await screen.findByRole("region", { name: "Gross revenue overlap" });
    expect(within(action).getByText(/20 daily Gross revenue records/i)).toBeInTheDocument();
    expect(within(action).getByText(/source field/i)).toHaveTextContent("gross_sales");
    expect(within(action).getByText(/earlier Performance upload/i)).toBeInTheDocument();
    expect(within(action).getByText("1 Jan 2026 – 15 Feb 2026")).toBeInTheDocument();
    expect(within(action).getByRole("button", { name: /use this upload's revenue/i })).toBeEnabled();
    expect(within(action).getByRole("button", { name: /keep existing revenue/i })).toBeEnabled();

    const projectionSummary = screen.getByText(/653 records checked/i);
    expect(action.compareDocumentPosition(projectionSummary)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.queryByText(/non overlapping/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/matching record/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/evidence eeeee/i)).not.toBeInTheDocument();
  });

  it("sends one grouped decision through the atomic resolution route", async () => {
    renderUpload();
    const action = await screen.findByRole("region", { name: "Gross revenue overlap" });
    fireEvent.click(within(action).getByRole("button", { name: /use this upload's revenue/i }));

    await waitFor(() => {
      const fetchMock = vi.mocked(fetch);
      const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
      expect(post?.[0]).toBe(
        `/api/organizations/${ORGANIZATION_ID}/report-reconciliations/${RECONCILIATION_ID}/resolve-group`,
      );
      expect(JSON.parse(String(post?.[1]?.body))).toEqual({
        resolution: "accept_correction",
        idempotencyKey: "report-overlap-group-resolution:fixed-operation-key",
      });
    });
  });

  it("does not report success when another operator already chose the opposite field source", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          return new Response(JSON.stringify({ resolution: { outcome: "conflict" } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify(snapshot), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    renderUpload();
    const action = await screen.findByRole("region", { name: "Gross revenue overlap" });
    fireEvent.click(within(action).getByRole("button", { name: /keep existing revenue/i }));

    await waitFor(() =>
      expect(toastMocks.error).toHaveBeenCalledWith(
        "This field was already resolved differently. Refresh to see the recorded choice.",
      ),
    );
    expect(toastMocks.success).not.toHaveBeenCalled();
  });

  it("does not print a null record count while projection is still incomplete", async () => {
    const snapshotWithoutCount = {
      ...snapshot,
      projectionRuns: snapshot.projectionRuns.map((run) => ({ ...run, output_count: null })),
    } as unknown as ReportPackageSnapshot;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(snapshotWithoutCount), {
          status: 200,
          headers: { "content-type": "application/json" },
        })),
    );

    renderUpload();

    await screen.findByText(/Performance · 2026-01-01 to 2026-02-28/i);
    expect(document.body).not.toHaveTextContent("records checked");
  });
});

describe("ReportPackageUpload report type derivation", () => {
  const CHANNEL_ID = "99999999-9999-4999-8999-999999999999";
  const RECOGNISED_PACKAGE_ID = "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa";
  const RECOGNISED_CONTRACT_VERSION_ID = "bbbbbbbb-1111-4bbb-8bbb-bbbbbbbbbbbb";

  function packageFixture(overrides: Record<string, unknown> = {}) {
    return {
      id: RECOGNISED_PACKAGE_ID,
      organization_id: ORGANIZATION_ID,
      channel_id: CHANNEL_ID,
      branch_id: "88888888-8888-4888-8888-888888888888",
      report_type: "Marketplace performance",
      declared_period_start: "2026-01-01",
      declared_period_end: "2026-01-31",
      declared_currency: "AED",
      period_timezone: "Asia/Dubai",
      file_kind: "xlsx",
      original_filename: "performance.xlsx",
      declared_content_type:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      declared_content_length: 1_024,
      storage_bucket_id: "governed-report-packages",
      storage_path: `${ORGANIZATION_ID}/performance.xlsx`,
      storage_object_id: "99999999-9999-4999-8999-999999999998",
      storage_object_version: "1",
      content_sha256: "e".repeat(64),
      parser_version: 1,
      fingerprint_version: 2,
      schema_fingerprint: "f".repeat(64),
      status: "projected",
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

  function recognisedSnapshot(overrides: { decision?: "approved" | "rejected" } = {}) {
    return {
      packages: [packageFixture()],
      sheetManifests: [],
      contracts: [],
      contractVersions: [
        {
          id: RECOGNISED_CONTRACT_VERSION_ID,
          organization_id: ORGANIZATION_ID,
          report_package_id: RECOGNISED_PACKAGE_ID,
          provider_definition_key: "talabat.performance.daily",
          version: 1,
          schema_fingerprint: "c".repeat(64),
          mapping_digest: "d".repeat(64),
          mapping_document: null,
        },
      ],
      contractDecisions: [
        {
          report_contract_version_id: RECOGNISED_CONTRACT_VERSION_ID,
          decision: overrides.decision ?? "approved",
        },
      ],
      contractBindings: [],
      validationRuns: [],
      validationSheetResults: [],
      validationControlResults: [],
      projectionVersions: [],
      projectionDecisions: [],
      projectionBindings: [],
      projectionRuns: [],
      reconciliationGroups: [],
      channels: [{ id: CHANNEL_ID, display_name: "Talabat", key: "talabat", status: "active" }],
      branches: [],
    } as unknown as ReportPackageSnapshot;
  }

  function stubFetch(body: ReportPackageSnapshot) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
    );
  }

  it("replaces the free-text field with the channel's already-known report type", async () => {
    stubFetch(recognisedSnapshot());
    renderUpload();

    fireEvent.click(await screen.findByRole("combobox", { name: /business channel/i }));
    fireEvent.click(await screen.findByRole("option", { name: "Talabat" }));

    expect(await screen.findByText("Marketplace performance")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /^report type$/i })).not.toBeInTheDocument();
  });

  it("keeps the free-text field when the channel has no approved library mapping", async () => {
    stubFetch(recognisedSnapshot({ decision: "rejected" }));
    renderUpload();

    fireEvent.click(await screen.findByRole("combobox", { name: /business channel/i }));
    fireEvent.click(await screen.findByRole("option", { name: "Talabat" }));

    expect(await screen.findByRole("textbox", { name: /^report type$/i })).toBeInTheDocument();
  });

  it("disqualifies itself, falling back to free text, when the channel has ever carried more than one recognised family", async () => {
    const OTHER_PACKAGE_ID = "aaaaaaaa-2222-4aaa-8aaa-aaaaaaaaaaaa";
    const OTHER_CONTRACT_VERSION_ID = "bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb";
    const twoFamilySnapshot = recognisedSnapshot();
    // A second, later upload for the same channel that turned out to be a
    // *different* recognised family -- exactly the Keeta case the review
    // named: several definitions can match the same channel over time. If
    // the derivation blindly reused the first family's report type here, it
    // would mislabel this and every later upload of the second family, with
    // no way for an operator to correct a read-only field.
    (twoFamilySnapshot.packages as unknown[]).push(
      packageFixture({
        id: OTHER_PACKAGE_ID,
        report_type: "Delivery orders",
        declared_period_start: "2026-02-01",
        declared_period_end: "2026-02-28",
      }),
    );
    (twoFamilySnapshot.contractVersions as unknown[]).push({
      id: OTHER_CONTRACT_VERSION_ID,
      organization_id: ORGANIZATION_ID,
      report_package_id: OTHER_PACKAGE_ID,
      provider_definition_key: "keeta.orders.detail",
      version: 1,
      schema_fingerprint: "1".repeat(64),
      mapping_digest: "2".repeat(64),
      mapping_document: null,
    });
    (twoFamilySnapshot.contractDecisions as unknown[]).push({
      report_contract_version_id: OTHER_CONTRACT_VERSION_ID,
      decision: "approved",
    });
    stubFetch(twoFamilySnapshot);
    renderUpload();

    fireEvent.click(await screen.findByRole("combobox", { name: /business channel/i }));
    fireEvent.click(await screen.findByRole("option", { name: "Talabat" }));

    expect(await screen.findByRole("textbox", { name: /^report type$/i })).toBeInTheDocument();
    expect(screen.queryByText("Marketplace performance")).not.toBeInTheDocument();
    expect(screen.queryByText("Delivery orders")).not.toBeInTheDocument();
  });
});

describe("ReportPackageUpload reached by an operator", () => {
  const CHANNEL_ID = "cccccccc-9999-4ccc-8ccc-cccccccccccc";
  const AWAITING_PACKAGE_ID = "dddddddd-9999-4ddd-8ddd-dddddddddddd";

  function awaitingContractSnapshot() {
    return {
      packages: [
        {
          id: AWAITING_PACKAGE_ID,
          organization_id: ORGANIZATION_ID,
          channel_id: CHANNEL_ID,
          branch_id: "88888888-8888-4888-8888-888888888888",
          report_type: "Marketplace performance",
          declared_period_start: "2026-03-01",
          declared_period_end: "2026-03-31",
          declared_currency: "AED",
          period_timezone: "Asia/Dubai",
          file_kind: "xlsx",
          original_filename: "performance-march.xlsx",
          declared_content_type:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          declared_content_length: 1_024,
          storage_bucket_id: "governed-report-packages",
          storage_path: `${ORGANIZATION_ID}/performance-march.xlsx`,
          storage_object_id: "99999999-9999-4999-8999-999999999997",
          storage_object_version: "1",
          content_sha256: "1".repeat(64),
          parser_version: 1,
          fingerprint_version: 2,
          schema_fingerprint: "2".repeat(64),
          status: "awaiting_contract",
          safe_failure_code: null,
          safe_failure_at: null,
          upload_expires_at: "2026-03-01T01:00:00.000Z",
          uploaded_at: "2026-03-01T00:01:00.000Z",
          profiled_at: "2026-03-01T00:02:00.000Z",
          retained_until: "2027-03-01T00:00:00.000Z",
          created_by: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          correlation_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          created_at: "2026-03-01T00:00:00.000Z",
          updated_at: "2026-03-01T00:03:00.000Z",
        },
      ],
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
      projectionRuns: [],
      reconciliationGroups: [],
      channels: [{ id: CHANNEL_ID, display_name: "Noon", key: "noon", status: "active" }],
      branches: [],
    } as unknown as ReportPackageSnapshot;
  }

  function stubFetchWithRecognition(recognisedFamilies: unknown[]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("/recognised-families")) {
          return new Response(JSON.stringify({ sheets: [], recognisedFamilies }), {
            status: 200,
          });
        }
        return new Response(JSON.stringify(awaitingContractSnapshot()), { status: 200 });
      }),
    );
  }

  function renderAsOperator() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={queryClient}>
        <ReportPackageUpload organizationId={ORGANIZATION_ID} role="operator" timeZone="Asia/Dubai" />
      </QueryClientProvider>,
    );
  }

  it("lets an operator (report.upload, not report.contract_approve) select an upload and reach the admission screen's explanation for a recognised report", async () => {
    stubFetchWithRecognition([
      {
        key: "noon.sales.period",
        provider: "Noon",
        reportType: "sales_period_summary",
        summary: "Sales and successful orders for the whole reporting period, from Noon's sales export.",
        reads: ["revenue.gross", "transactions.count"],
        columns: ["sales", "successful_orders"],
      },
    ]);
    renderAsOperator();

    fireEvent.click(
      await screen.findByRole("combobox", { name: /which upload are you mapping/i }),
    );
    fireEvent.click(
      await screen.findByRole("option", { name: /marketplace performance · 2026-03-01/i }),
    );

    expect(
      await screen.findByText(/an owner or admin needs to approve it once/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /approve/i })).not.toBeInTheDocument();
    // Names the report even though the operator cannot act on it.
    expect(screen.getByText(/Noon · sales period summary/)).toBeInTheDocument();
  });

  it("tells an operator an owner or admin still needs to map an unrecognised upload, rather than showing the guided form", async () => {
    stubFetchWithRecognition([]);
    renderAsOperator();

    fireEvent.click(
      await screen.findByRole("combobox", { name: /which upload are you mapping/i }),
    );
    fireEvent.click(
      await screen.findByRole("option", { name: /marketplace performance · 2026-03-01/i }),
    );

    expect(
      await screen.findByText(/this upload still needs an owner or admin to say what its columns mean/i),
    ).toBeInTheDocument();
    // The guided mapping form (sheet/column questions) never renders for an
    // operator -- proposing a mapping requires report.contract_approve too,
    // so showing it here would just be refused on submit.
    expect(screen.queryByText(/tell us what these columns mean/i)).not.toBeInTheDocument();
  });
});
