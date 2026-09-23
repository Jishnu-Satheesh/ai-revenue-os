// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastMocks = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("sonner", () => ({ toast: toastMocks }));

// Slice 3 mirrors the drawer in `?package=` + `?focus=`. The params object is
// replaced per test before render; push/replace stay plain spies because the
// sync effect only acts when the params it reads actually moved.
const navigationMocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  params: new URLSearchParams(),
  pathname: "/organizations/11111111-1111-4111-8111-111111111111/integrations",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigationMocks.push, replace: navigationMocks.replace }),
  useSearchParams: () => navigationMocks.params,
  usePathname: () => navigationMocks.pathname,
}));

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

// Slice 1 moved the per-package detail behind a queue row click. The shared
// fixture package is always the Performance upload, so one helper opens it.
async function openDetailsDrawer() {
  fireEvent.click(await screen.findByRole("button", { name: /Open details for Performance/i }));
  await screen.findByRole("dialog");
}

beforeEach(() => {
  vi.clearAllMocks();
  navigationMocks.params = new URLSearchParams();
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
    await openDetailsDrawer();

    const action = await screen.findByRole("region", { name: "Gross revenue overlap" });
    expect(within(action).getByText(/20 daily Gross revenue records/i)).toBeInTheDocument();
    expect(within(action).getByText(/source field/i)).toHaveTextContent("gross_sales");
    expect(within(action).getByText(/earlier Performance upload/i)).toBeInTheDocument();
    expect(within(action).getByText("1 Jan 2026 – 15 Feb 2026")).toBeInTheDocument();
    expect(
      within(action).getByRole("button", { name: /use this upload's revenue/i }),
    ).toBeEnabled();
    expect(within(action).getByRole("button", { name: /keep existing revenue/i })).toBeEnabled();

    const projectionSummary = screen.getByText(/653 records checked/i);
    expect(action.compareDocumentPosition(projectionSummary)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.queryByText(/non overlapping/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/matching record/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/evidence eeeee/i)).not.toBeInTheDocument();
  });

  it("sends one grouped decision through the atomic resolution route", async () => {
    renderUpload();
    await openDetailsDrawer();
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
    await openDetailsDrawer();
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
      vi.fn(
        async () =>
          new Response(JSON.stringify(snapshotWithoutCount), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    renderUpload();

    await screen.findByText(/Performance · 2026-01-01 to 2026-02-28/i);
    expect(document.body).not.toHaveTextContent("records checked");
  });
});

describe("ReportPackageUpload categorical refusal declaration", () => {
  const FAILURE_DETAIL =
    "ReportCategoricalValueNotDeclared: CATEGORICAL_VALUE_NOT_DECLARED: cancel_reason: CLOSED is not a declared value (2026-03-04, 2026-03-11)";

  function failedSnapshot(detail: string) {
    return {
      ...snapshot,
      packages: snapshot.packages.map((pkg) => ({ ...pkg, status: "projection_failed" })),
      projectionRuns: snapshot.projectionRuns.map((run) => ({
        ...run,
        status: "failed",
        failure_detail: detail,
      })),
      reconciliationGroups: [],
    } as unknown as ReportPackageSnapshot;
  }

  function stubSnapshot(body: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          return new Response(JSON.stringify({ reportProjectionVersion: { id: "new-version" } }), {
            status: 201,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
  }

  function renderUploadAs(role: "owner" | "operator") {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={queryClient}>
        <ReportPackageUpload organizationId={ORGANIZATION_ID} role={role} timeZone="Asia/Dubai" />
      </QueryClientProvider>,
    );
  }

  it("names the refused label and offers to declare it", async () => {
    stubSnapshot(failedSnapshot(FAILURE_DETAIL));
    renderUploadAs("owner");

    await openDetailsDrawer();
    const button = await screen.findByRole("button", {
      name: /Declare "CLOSED" as a value we count/i,
    });
    expect(button).toBeEnabled();
    expect(screen.getByText(/which is not a declared cancel reason value/i)).toBeInTheDocument();
  });

  it("declares through the new route and points at the approval control", async () => {
    stubSnapshot(failedSnapshot(FAILURE_DETAIL));
    renderUploadAs("owner");

    await openDetailsDrawer();
    fireEvent.click(
      await screen.findByRole("button", { name: /Declare "CLOSED" as a value we count/i }),
    );

    await waitFor(() => {
      const fetchMock = vi.mocked(fetch);
      const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
      expect(post?.[0]).toBe(
        `/api/organizations/${ORGANIZATION_ID}/report-projections/${PROJECTION_VERSION_ID}/declarations`,
      );
      expect(JSON.parse(String(post?.[1]?.body))).toEqual({
        outputKey: "cancel_reason",
        value: "CLOSED",
      });
    });
    await waitFor(() =>
      expect(toastMocks.success).toHaveBeenCalledWith(
        "Label proposed into the figures. Approve the new version below, then retry the projection.",
      ),
    );
  });

  it("tells an operator who must act instead of offering a button that would be refused", async () => {
    stubSnapshot(failedSnapshot(FAILURE_DETAIL));
    renderUploadAs("operator");

    await openDetailsDrawer();
    await screen.findByText(/An owner or admin declares it once/i);
    expect(
      screen.queryByRole("button", { name: /Declare "CLOSED" as a value we count/i }),
    ).not.toBeInTheDocument();
  });

  it("leaves any other failure exactly as it was, with no declare button", async () => {
    stubSnapshot(failedSnapshot("ReportProjectionFailure: INVALID_LOCAL_DATE"));
    renderUploadAs("owner");

    await openDetailsDrawer();
    await screen.findByText(/Why it stopped:/i);
    expect(screen.queryByRole("button", { name: /Declare "/i })).not.toBeInTheDocument();
  });

  it("explains rather than dead-ends when the refusal names provider prose, not a code", async () => {
    // The refusal carries the provider's text as written -- lowercase, spaced
    // prose is the routine case, not the exception. The Zod boundary and the
    // database guard both require a short uppercase code, so offering the
    // Declare button here would only replace a nameless refusal with a named
    // dead end.
    const proseDetail =
      "ReportCategoricalValueNotDeclared: CATEGORICAL_VALUE_NOT_DECLARED: cancel_reason: closed because the shop shut is not a declared value (2026-03-04)";
    stubSnapshot(failedSnapshot(proseDetail));
    renderUploadAs("owner");

    await openDetailsDrawer();
    await screen.findByText(/written as the provider.s own prose/i);
    expect(screen.queryByRole("button", { name: /Declare "/i })).not.toBeInTheDocument();
  });

  it("explains rather than dead-ends when the refusal's label was truncated", async () => {
    const truncatedValue = `${"A".repeat(64)}…`;
    const truncatedDetail = `ReportCategoricalValueNotDeclared: CATEGORICAL_VALUE_NOT_DECLARED: cancel_reason: ${truncatedValue} is not a declared value (2026-03-04)`;
    stubSnapshot(failedSnapshot(truncatedDetail));
    renderUploadAs("owner");

    await openDetailsDrawer();
    await screen.findByText(/cut off before it reached the platform/i);
    expect(screen.queryByRole("button", { name: /Declare "/i })).not.toBeInTheDocument();
  });

  it("points at retry rather than a dead end for the pre-Task-4 bare refusal", async () => {
    // Nostaza's March package on staging reads exactly this string: recorded
    // before this failure learned to name its label.
    stubSnapshot(failedSnapshot("ReportProjectionError: CATEGORICAL_VALUE_NOT_DECLARED"));
    renderUploadAs("owner");

    await openDetailsDrawer();
    await screen.findByText(/This refusal predates the detail the platform now records/i);
    expect(screen.queryByRole("button", { name: /Declare "/i })).not.toBeInTheDocument();
  });
});

describe("ReportPackageUpload fixed channel", () => {
  const FIXED_CHANNEL_ID = "77777777-7777-4777-8777-777777777777";
  const OTHER_CHANNEL_ID = "99999999-9999-4999-8999-999999999999";

  function fixedSnapshot() {
    return {
      ...snapshot,
      packages: [
        ...snapshot.packages,
        {
          ...snapshot.packages[0],
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          channel_id: OTHER_CHANNEL_ID,
          report_type: "Somebody else's settlement",
        },
      ],
      channels: [{ id: FIXED_CHANNEL_ID, display_name: "Talabat", key: "talabat" }],
    } as unknown as ReportPackageSnapshot;
  }

  function renderFixed() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={queryClient}>
        <ReportPackageUpload
          organizationId={ORGANIZATION_ID}
          role="owner"
          timeZone="Asia/Dubai"
          fixedChannelId={FIXED_CHANNEL_ID}
        />
      </QueryClientProvider>,
    );
  }

  function stubSnapshot(body: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
    );
  }

  it("names the fixed channel read-only instead of offering the select", async () => {
    stubSnapshot(fixedSnapshot());
    renderFixed();

    // The channel name arrives with the snapshot, so reaching it proves the
    // query settled before asserting on the form.
    await screen.findByText("Talabat");
    expect(screen.queryByRole("combobox", { name: /business channel/i })).not.toBeInTheDocument();
  });

  it("renders the read-only channel name at the standard control height", async () => {
    stubSnapshot(fixedSnapshot());
    renderFixed();

    const box = await screen.findByText("Talabat");
    expect(box.className).toMatch(/h-8/);
    expect(box.className).toMatch(/w-full/);
  });

  it("lists only this channel's uploads", async () => {
    stubSnapshot(fixedSnapshot());
    renderFixed();

    await screen.findByText(/Performance · 2026-01-01 to 2026-02-28/i);
    expect(screen.queryByText(/Somebody else's settlement/i)).not.toBeInTheDocument();
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
      declared_content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
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

  /**
   * The gap the disqualification above cannot close on its own.
   *
   * It only notices a second family once that family has already been
   * uploaded and approved. The upload that *introduces* it arrives while the
   * channel still agrees on one family, so the field is read-only and names
   * the wrong report -- and being read-only, an operator cannot say so. A
   * channel that carries several of a provider's exports has to be able to
   * declare the second one the first time it is sent.
   */
  it("lets an operator declare a different report when the channel's known one is not what they are sending", async () => {
    stubFetch(recognisedSnapshot());
    renderUpload();

    fireEvent.click(await screen.findByRole("combobox", { name: /business channel/i }));
    fireEvent.click(await screen.findByRole("option", { name: "Talabat" }));

    expect(await screen.findByText("Marketplace performance")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /different report/i }));

    const field = await screen.findByRole("textbox", { name: /^report type$/i });
    expect(field).toHaveValue("");
    expect(screen.queryByText("Marketplace performance")).not.toBeInTheDocument();
  });

  it("goes back to the channel's known report type, so the reuse key is never retyped by accident", async () => {
    stubFetch(recognisedSnapshot());
    renderUpload();

    fireEvent.click(await screen.findByRole("combobox", { name: /business channel/i }));
    fireEvent.click(await screen.findByRole("option", { name: "Talabat" }));
    fireEvent.click(await screen.findByRole("button", { name: /different report/i }));
    fireEvent.click(await screen.findByRole("button", { name: /known report/i }));

    expect(await screen.findByText("Marketplace performance")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /^report type$/i })).not.toBeInTheDocument();
  });

  it("renders the known report type at the standard control height", async () => {
    stubFetch(recognisedSnapshot());
    renderUpload();

    fireEvent.click(await screen.findByRole("combobox", { name: /business channel/i }));
    fireEvent.click(await screen.findByRole("option", { name: "Talabat" }));

    await screen.findByText("Marketplace performance");
    const box = document.getElementById("report-type");
    expect(box?.className).toMatch(/h-8/);
    expect(box?.className).toMatch(/w-full/);
  });

  it("moves the known-report note below the fields in italic and keeps the green link under report type", async () => {
    stubFetch(recognisedSnapshot());
    renderUpload();

    fireEvent.click(await screen.findByRole("combobox", { name: /business channel/i }));
    fireEvent.click(await screen.findByRole("option", { name: "Talabat" }));

    await screen.findByText("Marketplace performance");
    const note = screen.getByText(/already reads a known report/);
    expect(note.tagName).toBe("P");
    expect(note.className).toMatch(/italic/);
    expect(note.className).toMatch(/lg:col-span-6/);
    expect(note.textContent?.startsWith("*")).toBe(true);
    // A direct child of the form grid, i.e. its own full-width row below the
    // fields rather than a paragraph inside the report-type cell.
    expect(note.parentElement?.tagName).toBe("FORM");
    const group = document.getElementById("report-period-start")?.closest('[role="group"]');
    expect(group).not.toBeNull();
    expect(note.compareDocumentPosition(group as Node) & Node.DOCUMENT_POSITION_PRECEDING).toBe(
      Node.DOCUMENT_POSITION_PRECEDING,
    );
    // The green link stays where it was, under the report type, and the note
    // carries no link text of its own.
    expect(screen.getByRole("button", { name: /different report/i })).toBeInTheDocument();
    expect(note.textContent).not.toMatch(/different report/i);
  });

  it("hides the asterisk note while overriding and brings it back with the known type", async () => {
    stubFetch(recognisedSnapshot());
    renderUpload();

    fireEvent.click(await screen.findByRole("combobox", { name: /business channel/i }));
    fireEvent.click(await screen.findByRole("option", { name: "Talabat" }));
    expect(await screen.findByText(/already reads a known report/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /different report/i }));
    expect(screen.queryByText(/already reads a known report/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /known report/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /known report/i }));
    expect(await screen.findByText(/already reads a known report/)).toBeInTheDocument();
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
        <ReportPackageUpload
          organizationId={ORGANIZATION_ID}
          role="operator"
          timeZone="Asia/Dubai"
        />
      </QueryClientProvider>,
    );
  }

  it("lets an operator (report.upload, not report.contract_approve) select an upload and reach the admission screen's explanation for a recognised report", async () => {
    stubFetchWithRecognition([
      {
        key: "noon.sales.period",
        provider: "Noon",
        reportType: "sales_period_summary",
        summary:
          "Sales and successful orders for the whole reporting period, from Noon's sales export.",
        reads: ["revenue.gross", "transactions.count"],
        columns: ["sales", "successful_orders"],
      },
    ]);
    renderAsOperator();

    // Slice 2 moved the mapping box into the drawer; the package row opens it.
    fireEvent.click(
      await screen.findByRole("button", { name: /Open details for Marketplace performance/i }),
    );

    fireEvent.click(await screen.findByRole("combobox", { name: /which upload are you mapping/i }));
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

    // Slice 2 moved the mapping box into the drawer; the package row opens it.
    fireEvent.click(
      await screen.findByRole("button", { name: /Open details for Marketplace performance/i }),
    );

    fireEvent.click(await screen.findByRole("combobox", { name: /which upload are you mapping/i }));
    fireEvent.click(
      await screen.findByRole("option", { name: /marketplace performance · 2026-03-01/i }),
    );

    expect(
      await screen.findByText(
        /this upload still needs an owner or admin to say what its columns mean/i,
      ),
    ).toBeInTheDocument();
    // The guided mapping form (sheet/column questions) never renders for an
    // operator -- proposing a mapping requires report.contract_approve too,
    // so showing it here would just be refused on submit.
    expect(screen.queryByText(/tell us what these columns mean/i)).not.toBeInTheDocument();
  });
});

describe("ReportPackageUpload validation warnings", () => {
  const VALIDATION_RUN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const VALIDATION_CONTRACT_VERSION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  function validationSnapshot(withContract: boolean) {
    return {
      packages: [
        {
          ...snapshot.packages[0],
          status: "partially_validated",
        },
      ],
      sheetManifests: [],
      contracts: [],
      contractVersions: withContract
        ? [
            {
              id: VALIDATION_CONTRACT_VERSION_ID,
              organization_id: ORGANIZATION_ID,
              report_contract_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
              report_package_id: PACKAGE_ID,
              version: 1,
              schema_fingerprint: "e".repeat(64),
              parser_version: 1,
              fingerprint_version: 2,
              mapping_document: {
                currency: "AED",
                outletGrain: "branch",
                unmappedFieldDisposition: "reviewed_ignore",
                sheets: [
                  {
                    normalizedSheetName: "performance",
                    headerRow: 1,
                    dataStartRow: 2,
                    allowFormula: false,
                    allowMergedCells: false,
                    fields: [
                      {
                        canonicalField: "gross_sales",
                        sourceHeader: "gross_sales",
                        parser: "money",
                        financialSign: "positive",
                        required: true,
                      },
                      {
                        canonicalField: "note",
                        sourceHeader: "note",
                        parser: "text",
                        required: false,
                      },
                    ],
                  },
                ],
              },
              mapping_digest: "f".repeat(64),
              declared_currency: "AED",
              financial_sign_semantics: null,
              controls: null,
              unmapped_field_disposition: "reviewed_ignore",
              proposal_source: "human",
              provider_definition_key: null,
              created_by: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              correlation_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              created_at: "2026-01-01T00:00:00.000Z",
            },
          ]
        : [],
      contractDecisions: [],
      contractBindings: [],
      validationRuns: [
        {
          id: VALIDATION_RUN_ID,
          organization_id: ORGANIZATION_ID,
          report_package_id: PACKAGE_ID,
          report_contract_version_id: VALIDATION_CONTRACT_VERSION_ID,
          report_contract_binding_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          validator_version: 1,
          input_digest: "1".repeat(64),
          result_digest: null,
          status: "partially_validated",
          quality_state: "complete",
          completeness_state: "partial",
          error_codes: [],
          warning_codes: ["OPTIONAL_FIELD_MISSING"],
          correlation_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          started_at: "2026-01-01T00:03:00.000Z",
          completed_at: "2026-01-01T00:04:00.000Z",
          created_at: "2026-01-01T00:04:00.000Z",
        },
      ],
      validationSheetResults: [
        {
          id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          organization_id: ORGANIZATION_ID,
          validation_run_id: VALIDATION_RUN_ID,
          normalized_sheet_name: "performance",
          required: true,
          outcome: "warning",
          row_count: 10,
          populated_cell_count: 20,
          parsed_field_success_count: 18,
          parsed_field_failure_count: 0,
          error_codes: [],
          warning_codes: ["OPTIONAL_FIELD_MISSING"],
          created_at: "2026-01-01T00:04:00.000Z",
        },
      ],
      validationControlResults: [],
      projectionVersions: [],
      projectionDecisions: [],
      projectionBindings: [],
      projectionRuns: [],
      reconciliationGroups: [],
      channels: [],
      branches: [],
    } as unknown as ReportPackageSnapshot;
  }

  function stubValidationSnapshot(body: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
    );
  }

  it("names the optional field from the approved contract in one compact warning row", async () => {
    stubValidationSnapshot(validationSnapshot(true));
    renderUpload();

    // Optional field identity comes from the already-loaded approved
    // contract only -- never invented.
    await openDetailsDrawer();
    const fieldNode = await screen.findByText(/note \(note\)/);
    expect(fieldNode).toBeInTheDocument();

    // Compact single-row layout: title, code, field names and next step
    // share one <p>, instead of three stacked <p>s per code.
    const row = fieldNode.closest("p");
    expect(row).not.toBeNull();
    expect(row?.textContent).toMatch(/OPTIONAL_FIELD_MISSING/);
    expect(row?.textContent).toMatch(/Review the warning/);
    expect(screen.queryByText(/An optional field was not present/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Next step:/)).not.toBeInTheDocument();

    // Warning box keeps shadcn Alert with the shared warning treatment.
    const title = screen.getByText("Validation warnings");
    const alert = title.closest('div[role="alert"]');
    expect(alert?.className).toMatch(/border-warning/);
    expect(alert?.className).toMatch(/bg-warning/);
    expect(alert?.querySelector("svg")).not.toBeNull();

    // Sheet summary rows stay.
    expect(screen.getByText(/Sheet performance · warning/)).toBeInTheDocument();
  });

  it("falls back to the sheet name when the contract is unavailable", async () => {
    stubValidationSnapshot(validationSnapshot(false));
    renderUpload();

    await openDetailsDrawer();
    await screen.findByText("Validation warnings");
    expect(screen.getAllByText(/Sheet performance/).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/note \(note\)/)).not.toBeInTheDocument();
  });
});

describe("ReportPackageUpload governed form", () => {
  function renderForm(options: { defaultCurrency?: string } = {}) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={queryClient}>
        <ReportPackageUpload
          organizationId={ORGANIZATION_ID}
          role="owner"
          timeZone="Asia/Dubai"
          defaultCurrency={options.defaultCurrency}
        />
      </QueryClientProvider>,
    );
  }

  it("renders the file dropzone as a full-width dashed row", async () => {
    renderForm();

    await screen.findByRole("button", { name: /upload report/i });
    const label = screen.getByText(/drag files here/i).closest("label");
    expect(label).not.toBeNull();
    expect(label?.className).toMatch(/border-dashed/);
    expect(screen.getByText(/choose file/i)).toBeInTheDocument();
    // Second row of the six-column grid: label plus hidden input share one
    // full-width cell.
    expect(label?.parentElement?.className).toMatch(/lg:col-span-6/);
    expect(document.getElementById("report-file")?.getAttribute("type")).toBe("file");
  });

  it("groups start and end date pickers under one renamed label", async () => {
    renderForm();

    await screen.findByRole("button", { name: /upload report/i });
    expect(screen.getByText("Start & end date")).toBeInTheDocument();
    expect(screen.queryByText(/^Period$/)).not.toBeInTheDocument();
    const start = screen.getByRole("button", { name: /pick start date/i });
    const end = screen.getByRole("button", { name: /pick end date/i });
    expect(start.getAttribute("id")).toBe("report-period-start");
    expect(end.getAttribute("id")).toBe("report-period-end");
    const group = start.closest('[role="group"]');
    expect(group).not.toBeNull();
    expect(group?.getAttribute("aria-labelledby")).toBe("report-period-label");
    expect(end.closest('[role="group"]')).toBe(group);
  });

  it("renders every field control at the same height and full column width", async () => {
    renderForm();

    await screen.findByRole("button", { name: /upload report/i });
    const branch = screen.getByRole("combobox", { name: /branch \/ outlet/i });
    expect(branch.className).toMatch(/w-full/);
    const currency = screen.getByRole("combobox", { name: /declared currency/i });
    expect(currency.className).toMatch(/w-full/);
    for (const name of [/pick start date/i, /pick end date/i]) {
      const picker = screen.getByRole("button", { name });
      expect(picker.className).toMatch(/h-8/);
      expect(picker.className).toMatch(/w-full/);
    }
  });

  it("picks both dates from the calendar popups and keeps the end on or after the start", async () => {
    renderForm();

    await screen.findByRole("button", { name: /upload report/i });
    const enabledDays = () =>
      Array.from(document.querySelectorAll("button[data-day]:not([disabled])"));

    const startButton = screen.getByRole("button", { name: /pick start date/i });
    fireEvent.click(startButton);
    const startChoices = enabledDays();
    expect(startChoices.length).toBeGreaterThan(1);
    const startDay = (startChoices[0] as HTMLElement).dataset.day as string;
    fireEvent.click(startChoices[0]);
    // The open popup must close before the end popup opens, or day queries
    // would hit two calendars at once. The trigger node stays the same
    // element across the text update, so the held reference still works.
    fireEvent.click(startButton);
    expect(document.querySelector("button[data-day]")).toBeNull();
    expect(startButton.textContent).not.toMatch(/pick start date/i);
    expect(startButton.textContent).toMatch(/\d{4}/);

    const endButton = screen.getByRole("button", { name: /pick end date/i });
    fireEvent.click(endButton);
    const sameDay = document.querySelector(`button[data-day="${startDay}"]`);
    expect(sameDay).not.toBeNull();
    expect(sameDay?.hasAttribute("disabled")).toBe(false);
    for (const day of Array.from(document.querySelectorAll("button[data-day]"))) {
      if (((day as HTMLElement).dataset.day as string) < startDay) {
        expect(day.hasAttribute("disabled")).toBe(true);
      }
    }
    const endChoices = enabledDays();
    fireEvent.click(endChoices[endChoices.length - 1]);
    fireEvent.click(endButton);
    expect(document.querySelector("button[data-day]")).toBeNull();
    expect(endButton.textContent).not.toMatch(/pick end date/i);
  });

  it("clears the end date when the start moves past it, so an inverted range cannot be sent", async () => {
    renderForm();

    await screen.findByRole("button", { name: /upload report/i });
    const enabledDays = () =>
      Array.from(document.querySelectorAll("button[data-day]:not([disabled])"));

    const startButton = screen.getByRole("button", { name: /pick start date/i });
    fireEvent.click(startButton);
    const firstRound = enabledDays();
    const earlyDay = (firstRound[2] as HTMLElement).dataset.day as string;
    fireEvent.click(firstRound[2]);
    fireEvent.click(startButton);

    const endButton = screen.getByRole("button", { name: /pick end date/i });
    fireEvent.click(endButton);
    const endRound = enabledDays();
    const laterChoice = endRound.find(
      (day) => ((day as HTMLElement).dataset.day as string) > earlyDay,
    );
    expect(laterChoice).toBeDefined();
    const laterDay = (laterChoice as HTMLElement).dataset.day as string;
    fireEvent.click(laterChoice!);
    fireEvent.click(endButton);
    expect(endButton.textContent).not.toMatch(/pick end date/i);

    fireEvent.click(startButton);
    const lastRound = enabledDays();
    // laterDay sits near the top of the visible month by construction, so a
    // day past the current end always exists with no month navigation.
    const beyondEnd = lastRound.find(
      (day) => ((day as HTMLElement).dataset.day as string) > laterDay,
    );
    expect(beyondEnd).toBeDefined();
    fireEvent.click(beyondEnd!);
    expect(await screen.findByRole("button", { name: /pick end date/i })).toBeInTheDocument();
  });

  it("defaults the currency select to the passed defaultCurrency", async () => {
    renderForm({ defaultCurrency: "AED" });

    const trigger = await screen.findByRole("combobox", { name: /declared currency/i });
    fireEvent.click(trigger);
    const option = await screen.findByRole("option", { name: /^AED/ });
    expect(option).toHaveAttribute("aria-selected", "true");
  });

  it("takes a dropped file and names it with its size", async () => {
    renderForm();

    await screen.findByRole("button", { name: /upload report/i });
    const cell = screen.getByText(/drag files here/i).closest("label")?.parentElement;
    expect(cell).not.toBeNull();
    fireEvent.drop(cell!, {
      dataTransfer: { files: [new File(["a,b"], "settlement.csv", { type: "text/csv" })] },
    });
    expect(await screen.findByText(/settlement\.csv/)).toBeInTheDocument();
  });
});

describe("ReportPackageUpload explainer popover", () => {
  it("moves the file-journey bullets behind a How it works trigger by the card title", async () => {
    renderUpload();

    const trigger = await screen.findByRole("button", { name: "How it works" });
    expect(trigger.closest('[data-slot="card-title"]')).not.toBeNull();
    expect(screen.queryByText("What happens to your file")).not.toBeInTheDocument();

    fireEvent.click(trigger);

    const bullets = await screen.findAllByRole("listitem");
    expect(bullets).toHaveLength(4);
    expect(
      screen.getByText(/stays in private storage.*nobody outside your organization/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/column headings only.*never at a customer/i)).toBeInTheDocument();
    expect(screen.getByText(/approves twice before any figure is recorded/i)).toBeInTheDocument();
    expect(screen.getByText(/rows have to add up to it/i)).toBeInTheDocument();
    expect(screen.queryByText("What happens to your file")).not.toBeInTheDocument();
  });
});

describe("ReportPackageUpload deep-linking", () => {
  function stubSnapshot(body: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
    );
  }

  function undecidedContractSnapshot(packageId: string) {
    return {
      ...snapshot,
      contractVersions: [
        {
          id: CONTRACT_VERSION_ID,
          organization_id: ORGANIZATION_ID,
          report_package_id: packageId,
          version: 1,
          schema_fingerprint: "e".repeat(64),
          mapping_digest: "f".repeat(64),
          mapping_document: null,
          provider_definition_key: null,
          created_at: "2026-02-01T00:00:00.000Z",
        },
      ],
      contractDecisions: [],
    } as unknown as ReportPackageSnapshot;
  }

  it("pushes the package id without focus when a package row opens the drawer", async () => {
    stubSnapshot(undecidedContractSnapshot(PACKAGE_ID));
    renderUpload();

    fireEvent.click(await screen.findByRole("button", { name: /Open details for Performance/i }));

    expect(navigationMocks.push).toHaveBeenCalledTimes(1);
    const packageUrl = navigationMocks.push.mock.calls[0][0] as string;
    expect(packageUrl).toContain(`package=${PACKAGE_ID}`);
    expect(packageUrl).not.toContain("focus=");
  });

  it("pushes the package id with focus=mapping for a mapping decision row", async () => {
    stubSnapshot(undecidedContractSnapshot(PACKAGE_ID));
    renderUpload();

    fireEvent.click(await screen.findByRole("button", { name: /Review mapping v1 for/i }));

    expect(navigationMocks.push).toHaveBeenCalledTimes(1);
    const decisionUrl = navigationMocks.push.mock.calls[0][0] as string;
    expect(decisionUrl).toContain(`package=${PACKAGE_ID}`);
    expect(decisionUrl).toContain("focus=mapping");
  });

  it("opens the drawer on the linked package and lands on the figures anchor", async () => {
    navigationMocks.params = new URLSearchParams(`package=${PACKAGE_ID}&focus=figures`);
    renderUpload();

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Performance · 2026-01-01 to 2026-02-28")).toBeInTheDocument();
    expect(document.getElementById("drawer-figures")).not.toBeNull();
  });

  it("ignores an unknown package id and renders the page normally", async () => {
    navigationMocks.params = new URLSearchParams("package=00000000-0000-4000-8000-000000000000");
    renderUpload();

    await screen.findByText(/Performance · 2026-01-01 to 2026-02-28/i);
    expect(screen.getByText("Governed reports")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("clears the params when the drawer closes", async () => {
    renderUpload();
    await openDetailsDrawer();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(navigationMocks.replace).toHaveBeenCalledTimes(1);
    const cleared = navigationMocks.replace.mock.calls[0][0] as string;
    expect(cleared).toBe(navigationMocks.pathname);
    expect(cleared).not.toContain("package=");
    expect(cleared).not.toContain("focus=");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("preselects the mapping box when a mapping decision opens an awaiting-contract package", async () => {
    const awaitingId = "dddddddd-9999-4ddd-8ddd-dddddddddddd";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("/recognised-families")) {
          return new Response(JSON.stringify({ sheets: [], recognisedFamilies: [] }), {
            status: 200,
          });
        }
        return new Response(
          JSON.stringify({
            ...undecidedContractSnapshot(awaitingId),
            packages: [
              {
                ...snapshot.packages[0],
                id: awaitingId,
                report_type: "Marketplace performance",
                declared_period_start: "2026-03-01",
                declared_period_end: "2026-03-31",
                status: "awaiting_contract",
              },
            ],
            projectionRuns: [],
            reconciliationGroups: [],
          }),
          { status: 200 },
        );
      }),
    );
    renderUpload();

    fireEvent.click(await screen.findByRole("button", { name: "Review" }));
    await screen.findByRole("dialog");
    const combo = await screen.findByRole("combobox", { name: /which upload are you mapping/i });
    expect(combo).toHaveTextContent(/Marketplace performance/);
  });
});
