// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const toastMocks = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMocks, Toaster: () => null }));

import { ActivityTab } from "@/components/integrations/activity-tab";
import { CatalogTab } from "@/components/integrations/catalog-tab";
import { DataSourcesTab } from "@/components/integrations/data-sources-tab";
import type { ProviderDefinition } from "@/domain/integrations/types";
import type { OrganizationRole } from "@/domain/organizations/types";
import type { IntegrationDataSourceRow } from "@/modules/integrations/application/ports";
import type { IntegrationHubSnapshot } from "@/modules/integrations/application/read-model";
import { googleBusinessProfileDefinition } from "@/modules/integrations/providers/google-business-profile/definition";

const organizationId = "11111111-1111-4111-8111-111111111111";
const dataSourceId = "22222222-2222-4222-8222-222222222222";

const pendingProvider: ProviderDefinition = {
  key: "meta_business",
  displayName: "Meta Business",
  adapterVersion: "1",
  rolloutState: "disabled",
  supportedCapabilities: ["read_reviews"],
  requiredScopes: ["pages_read_engagement"],
  syncIntervalMinutes: 60,
  staleAfterMinutes: 130,
  supportsWebhooks: false,
  supportsWrites: false,
};

function source(overrides: Partial<IntegrationDataSourceRow> = {}): IntegrationDataSourceRow {
  return {
    id: dataSourceId,
    organization_id: organizationId,
    source_type: "csv_import",
    name: "August revenue",
    branch_id: null,
    status: "ready",
    storage_path: `${organizationId}/${dataSourceId}/33333333-3333-4333-8333-333333333333/august.csv`,
    original_filename: "august.csv",
    media_type: "text/csv",
    size_bytes: 2048,
    schema_version: 1,
    column_mapping: { revenue: "revenue" },
    last_successful_import_at: null,
    created_by: "user-1",
    created_at: "2026-08-01T09:00:00.000Z",
    updated_at: "2026-08-08T09:00:00.000Z",
    ...overrides,
  };
}

function snapshot(overrides: Partial<IntegrationHubSnapshot> = {}): IntegrationHubSnapshot {
  return {
    summary: {
      totalConnections: 0,
      healthyConnections: 0,
      actionRequiredConnections: 0,
      dataSources: 1,
    },
    connections: [],
    dataSources: [source()],
    branches: [
      {
        id: "44444444-4444-4444-8444-444444444444",
        organization_id: organizationId,
        name: "Central",
      },
    ],
    recentActivity: [],
    serverTime: "2026-08-08T09:05:00.000Z",
    ...overrides,
  };
}

function wrap(children: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
}

function renderCatalog(role: OrganizationRole = "operator") {
  return wrap(
    <CatalogTab
      organizationId={organizationId}
      catalog={[googleBusinessProfileDefinition, pendingProvider]}
      connections={[]}
      role={role}
    />,
  );
}

function renderSources(
  options: { role?: OrganizationRole; snapshot?: IntegrationHubSnapshot } = {},
) {
  return wrap(
    <DataSourcesTab
      organizationId={organizationId}
      snapshot={options.snapshot ?? snapshot()}
      role={options.role ?? "operator"}
    />,
  );
}

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => cleanup());

describe("CatalogTab", () => {
  it("renders server registry definitions with rollout state and required access", () => {
    renderCatalog();

    expect(screen.getByText("Google Business Profile")).toBeInTheDocument();
    expect(screen.getByText("Fixture mode — Google API access pending.")).toBeInTheDocument();
    expect(screen.getAllByText(/Fixture/).length).toBeGreaterThan(0);
    expect(screen.getByText("Meta Business")).toBeInTheDocument();
    expect(screen.getByText(/Not available/i)).toBeInTheDocument();
    expect(screen.getByText(/pages_read_engagement/)).toBeInTheDocument();
    // V1 is read-only: no provider offers a write capability anywhere.
    expect(screen.getAllByText(/Read-only · no provider writes or webhooks/i).length).toBe(2);
    expect(screen.queryByRole("button", { name: /Sign in with Google/i })).not.toBeInTheDocument();
  });

  it("connects the fixture provider through an explicit confirmation", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ connection: { id: "connection-1" } }, 201));

    renderCatalog();
    fireEvent.click(screen.getByRole("button", { name: /Connect fixture/i }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/deterministic fixture/i)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /Create fixture connection/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      `/api/organizations/${organizationId}/integrations/connections/fixture`,
    );
  });

  it("offers a viewer no connect control", () => {
    renderCatalog("viewer");

    expect(screen.queryByRole("button", { name: /Connect fixture/i })).not.toBeInTheDocument();
    expect(screen.getByText("Google Business Profile")).toBeInTheDocument();
  });
});

describe("DataSourcesTab", () => {
  it("registers a manual source without a file", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ dataSource: source({ source_type: "manual" }) }, 201));

    renderSources();
    fireEvent.change(screen.getByLabelText(/Source name/i), {
      target: { value: "Weekly counter sales" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Register source/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe(`/api/organizations/${organizationId}/integrations/data-sources`);
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body).toMatchObject({ sourceType: "manual", name: "Weekly counter sales" });
    expect(String(body.idempotencyKey).length).toBeGreaterThanOrEqual(16);
  });

  it("rejects a non-CSV file before any request is made", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    renderSources();
    fireEvent.click(screen.getByRole("radio", { name: /CSV upload/i }));
    const input = screen.getByLabelText(/CSV file/i);
    fireEvent.change(input, {
      target: { files: [new File(["a,b"], "notes.txt", { type: "text/plain" })] },
    });

    expect(await screen.findByText(/Only .csv files are supported/i)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a CSV over 10 MiB before any request is made", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const oversized = new File(["x"], "big.csv", { type: "text/csv" });
    Object.defineProperty(oversized, "size", { value: 10 * 1024 * 1024 + 1 });

    renderSources();
    fireEvent.click(screen.getByRole("radio", { name: /CSV upload/i }));
    fireEvent.change(screen.getByLabelText(/CSV file/i), { target: { files: [oversized] } });

    expect(await screen.findByText(/no larger than 10 MiB/i)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("requires at least one mapped column before uploading a CSV", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    renderSources();
    fireEvent.click(screen.getByRole("radio", { name: /CSV upload/i }));
    fireEvent.change(screen.getByLabelText(/Source name/i), { target: { value: "August CSV" } });
    fireEvent.change(screen.getByLabelText(/CSV file/i), {
      target: {
        files: [new File(["date,revenue\n2026-08-01,12"], "august.csv", { type: "text/csv" })],
      },
    });

    await screen.findByText(/date/);
    for (const checkbox of screen.getAllByRole("checkbox")) {
      if ((checkbox as HTMLInputElement).getAttribute("aria-checked") === "true") {
        fireEvent.click(checkbox);
      }
    }
    fireEvent.click(screen.getByRole("button", { name: /Upload CSV source/i }));

    expect(await screen.findByText(/Map at least one CSV column/i)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never renders a raw CSV cell value in a validation message", async () => {
    renderSources();
    fireEvent.click(screen.getByRole("radio", { name: /CSV upload/i }));
    fireEvent.change(screen.getByLabelText(/CSV file/i), {
      target: {
        files: [new File(["date,date\n2026-08-01,12"], "dupes.csv", { type: "text/csv" })],
      },
    });

    expect(await screen.findByText(/unique, non-empty columns/i)).toBeInTheDocument();
    expect(screen.queryByText(/2026-08-01/)).not.toBeInTheDocument();
  });

  it("queues an import and reports only what the server accepted", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ runId: "run-3", status: "queued" }, 202));

    renderSources();
    fireEvent.click(screen.getByRole("button", { name: /^Import$/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      `/api/organizations/${organizationId}/integrations/data-sources/${dataSourceId}/import`,
    );
    expect(await screen.findByText(/Import queued/i)).toBeInTheDocument();
    expect(screen.queryByText(/Import succeeded/i)).not.toBeInTheDocument();
  });

  it("shows partial and failed run outcomes with a retry action", () => {
    renderSources({
      snapshot: snapshot({
        dataSources: [source({ status: "failed" })],
        recentActivity: [
          {
            kind: "ingestion_run",
            id: "run-4",
            occurredAt: "2026-08-08T09:04:00.000Z",
            correlationId: "correlation-4",
            status: "partially_succeeded",
            sourceId: dataSourceId,
          },
        ],
      }),
    });

    expect(screen.getByText(/Partially succeeded/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Retry import/i })).toBeInTheDocument();
  });

  it("archives a source without deleting its history", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ dataSource: source({ status: "archived" }) }));

    renderSources();
    fireEvent.click(screen.getByRole("button", { name: /^Archive$/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe(
      `/api/organizations/${organizationId}/integrations/data-sources/${dataSourceId}`,
    );
    expect((init as RequestInit).method).toBe("PATCH");
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({ status: "archived" });
  });

  it("blocks importing an archived source and hides operator controls from a viewer", () => {
    const { unmount } = renderSources({
      snapshot: snapshot({ dataSources: [source({ status: "archived" })] }),
    });
    expect(screen.queryByRole("button", { name: /^Import$/i })).not.toBeInTheDocument();
    expect(screen.getAllByText(/Archived/i).length).toBeGreaterThan(0);
    unmount();

    renderSources({ role: "viewer" });
    expect(screen.queryByRole("button", { name: /^Import$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Register source/i })).not.toBeInTheDocument();
    expect(screen.getByText("August revenue")).toBeInTheDocument();
  });

  it("shows an empty state when no sources exist", () => {
    renderSources({ snapshot: snapshot({ dataSources: [] }) });

    expect(screen.getByText(/No data sources yet/i)).toBeInTheDocument();
  });
});

describe("ActivityTab", () => {
  it("lists events newest first with safe status text and correlation identifiers", () => {
    wrap(
      <ActivityTab
        activity={[
          {
            kind: "ingestion_run",
            id: "run-5",
            occurredAt: "2026-08-08T09:04:00.000Z",
            correlationId: "correlation-5",
            status: "failed",
            sourceId: dataSourceId,
          },
          {
            kind: "health_check",
            id: "health-1",
            occurredAt: "2026-08-08T08:00:00.000Z",
            correlationId: "correlation-1",
            outcome: "passed",
            connectionId: "connection-1",
          },
        ]}
        isRefreshing={false}
      />,
    );

    const entries = within(screen.getByRole("list", { name: /activity/i })).getAllByRole(
      "listitem",
    );
    expect(entries).toHaveLength(2);
    expect(entries[0]).toHaveTextContent(/Failed/);
    expect(entries[0]).toHaveTextContent("correlation-5");
    expect(entries[1]).toHaveTextContent(/Health check passed/i);
  });

  it("shows an empty state and a background-refetch indicator", () => {
    const { rerender } = wrap(<ActivityTab activity={[]} isRefreshing={false} />);
    expect(screen.getByText(/No integration activity yet/i)).toBeInTheDocument();

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ActivityTab activity={[]} isRefreshing />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("status", { name: /refreshing activity/i })).toBeInTheDocument();
  });
});
