// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: toastMocks, Toaster: () => null }));

import { ConnectionsTab } from "@/components/integrations/connections-tab";
import { googleBusinessProfileDefinition } from "@/modules/integrations/providers/google-business-profile/definition";
import type { IntegrationHubSnapshot } from "@/modules/integrations/application/read-model";
import type { OrganizationRole } from "@/domain/organizations/types";

const organizationId = "11111111-1111-4111-8111-111111111111";
const connectionId = "22222222-2222-4222-8222-222222222222";
const branchId = "33333333-3333-4333-8333-333333333333";

type Connection = IntegrationHubSnapshot["connections"][number];

function connection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: connectionId,
    organization_id: organizationId,
    provider_key: "google_business_profile",
    adapter_version: "1",
    connection_mode: "fixture",
    status: "active",
    external_account_id: "locations/fixture-1",
    external_account_label: "Fixture Bakery — Central",
    granted_scopes: [],
    token_expires_at: null,
    last_tested_at: "2026-08-08T09:00:00.000Z",
    last_successful_sync_at: "2026-08-08T09:00:00.000Z",
    next_scheduled_sync_at: "2026-08-08T09:30:00.000Z",
    created_by: "user-1",
    created_at: "2026-08-01T09:00:00.000Z",
    updated_at: "2026-08-08T09:00:00.000Z",
    capabilities: [
      {
        id: "grant-1",
        organization_id: organizationId,
        connection_id: connectionId,
        capability_key: "read_google_business_profile",
        maturity: "read-only",
        availability: "available",
        reason_codes: [],
        derived_from_adapter_version: "1",
        created_at: "2026-08-01T09:00:00.000Z",
        updated_at: "2026-08-08T09:00:00.000Z",
      },
    ],
    mappings: [
      {
        id: "mapping-1",
        organization_id: organizationId,
        connection_id: connectionId,
        external_resource_id: "locations/fixture-1",
        external_resource_label: "Central kitchen",
        branch_id: null,
        status: "unmapped",
        created_by: "user-1",
        created_at: "2026-08-01T09:00:00.000Z",
        updated_at: "2026-08-08T09:00:00.000Z",
      },
    ],
    latestHealth: null,
    health: {
      state: "healthy",
      reasonCode: "verified_recently",
      explanation: "Connected and recently verified.",
      lastTestedAt: "2026-08-08T09:00:00.000Z",
      lastSuccessfulSyncAt: "2026-08-08T09:00:00.000Z",
      evaluatedAt: "2026-08-08T09:05:00.000Z",
    },
    ...overrides,
  };
}

function snapshot(connections: Connection[] = [connection()]): IntegrationHubSnapshot {
  return {
    summary: {
      totalConnections: connections.length,
      healthyConnections: connections.filter((row) => row.health.state === "healthy").length,
      actionRequiredConnections: connections.filter((row) =>
        ["degraded", "stale", "revoked"].includes(row.health.state),
      ).length,
      dataSources: 0,
    },
    connections,
    dataSources: [],
    branches: [{ id: branchId, organization_id: organizationId, name: "Central kitchen" }],
    recentActivity: [],
    serverTime: "2026-08-08T09:05:00.000Z",
  };
}

function renderTab(
  options: {
    snapshot?: IntegrationHubSnapshot;
    role?: OrganizationRole;
  } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <ConnectionsTab
        organizationId={organizationId}
        snapshot={options.snapshot ?? snapshot()}
        catalog={[googleBusinessProfileDefinition]}
        role={options.role ?? "operator"}
      />
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status < 400,
    status,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => cleanup());

describe("ConnectionsTab health-first surface", () => {
  it("leads with operational health, action required, and freshness", () => {
    renderTab({
      snapshot: snapshot([
        connection(),
        connection({
          id: "44444444-4444-4444-8444-444444444444",
          external_account_label: "Fixture Bakery — Harbour",
          health: {
            state: "stale",
            reasonCode: "sync_stale",
            explanation: "Successful synchronization is outside its freshness target.",
            lastTestedAt: "2026-08-08T06:00:00.000Z",
            lastSuccessfulSyncAt: "2026-08-08T06:00:00.000Z",
            evaluatedAt: "2026-08-08T09:05:00.000Z",
          },
        }),
      ]),
    });

    const summary = screen.getByRole("region", { name: /operational health/i });
    expect(within(summary).getByText(/1 of 2 connections healthy/i)).toBeInTheDocument();
    expect(within(summary).getByText(/1 connection needs attention/i)).toBeInTheDocument();
    expect(within(summary).getByText(/next scheduled sync/i)).toBeInTheDocument();
    // Action-required leads the summary rather than provider promotion.
    expect(within(summary).getByRole("alert")).toHaveTextContent(/Fixture Bakery — Harbour/);
  });

  it("shows an empty state when the organization has no connections", () => {
    renderTab({ snapshot: snapshot([]) });

    expect(screen.getByText(/No connections yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Test connection$/i })).not.toBeInTheDocument();
  });

  it.each([
    ["pending", "Pending", "Connection testing has not yet passed."],
    ["degraded", "Degraded", "The latest connection check reported a recoverable problem."],
    ["stale", "Stale", "Successful synchronization is outside its freshness target."],
    ["revoked", "Revoked", "Connection use is disabled."],
  ])("states %s without relying on colour", (state, label, explanation) => {
    renderTab({
      snapshot: snapshot([
        connection({
          status: state === "revoked" ? "revoked" : "active",
          health: {
            state: state as Connection["health"]["state"],
            reasonCode: "test",
            explanation,
            evaluatedAt: "2026-08-08T09:05:00.000Z",
          },
        }),
      ]),
    });

    const status = screen.getAllByTestId("connection-health-status")[0];
    expect(status).toHaveTextContent(label);
    // Text plus an icon carry the meaning; no state is signalled by colour alone.
    expect(status.querySelector("svg")).not.toBeNull();
    expect(screen.getAllByText(explanation).length).toBeGreaterThan(0);
  });

  it("shows the exact fixture copy for the fixture provider", () => {
    renderTab();

    expect(screen.getAllByText("Fixture mode — Google API access pending.").length).toBeGreaterThan(
      0,
    );
  });

  it("reports queued work instead of claiming success", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ runId: "run-1", status: "queued" }, 202));

    renderTab();
    fireEvent.click(screen.getByRole("button", { name: /^Test connection$/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      `/api/organizations/${organizationId}/integrations/connections/${connectionId}/test`,
    );
    expect(await screen.findByText(/Test queued/i)).toBeInTheDocument();
    expect(screen.queryByText(/Test succeeded/i)).not.toBeInTheDocument();
    expect(toastMocks.success).not.toHaveBeenCalled();
    expect(toastMocks.info).toHaveBeenCalled();
  });

  it("surfaces a recoverable sync failure without inventing success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "PROVIDER_UNAVAILABLE",
            message: "The provider is temporarily unavailable.",
            retryable: true,
          },
        },
        503,
      ),
    );

    renderTab();
    fireEvent.click(screen.getByRole("button", { name: /^Sync now$/i }));

    await waitFor(() => expect(toastMocks.error).toHaveBeenCalled());
    expect(await screen.findByText(/temporarily unavailable/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Sync now$/i })).toBeEnabled();
  });

  it("shows the latest run's partial outcome from refetched worker state", () => {
    renderTab({
      snapshot: {
        ...snapshot(),
        recentActivity: [
          {
            kind: "ingestion_run",
            id: "run-9",
            occurredAt: "2026-08-08T09:04:00.000Z",
            correlationId: "correlation-9",
            status: "partially_succeeded",
            sourceId: connectionId,
          },
        ],
      },
    });

    expect(screen.getByText(/Partially succeeded/i)).toBeInTheDocument();
  });

  it("hides every mutating control from a viewer", () => {
    renderTab({ role: "viewer" });

    expect(screen.queryByRole("button", { name: /^Test connection$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Sync now$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Disconnect$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Save mappings/i })).not.toBeInTheDocument();
    expect(screen.getAllByText("Fixture Bakery — Central").length).toBeGreaterThan(0);
  });

  it("requires a branch for a mapped resource and moves focus to the error summary", async () => {
    const base = connection();
    renderTab({
      snapshot: snapshot([
        connection({
          // A resource can arrive already mapped with no branch when the branch
          // it referenced was removed; saving must not silently accept it.
          mappings: [{ ...base.mappings[0], status: "mapped", branch_id: null }],
        }),
      ]),
    });

    fireEvent.click(screen.getByRole("button", { name: /Save mappings/i }));

    const errorSummary = await screen.findByRole("alert", { name: /mapping/i });
    await waitFor(() => expect(errorSummary).toHaveFocus());
    expect(errorSummary).toHaveTextContent(/branch/i);
  });

  it("only enables disconnect after the exact account name is typed", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ runId: "run-2", status: "queued" }, 202));

    renderTab();
    fireEvent.click(screen.getByRole("button", { name: /^Disconnect$/i }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/history is retained/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/cleanup/i)).toBeInTheDocument();
    const confirm = within(dialog).getByRole("button", { name: /Disconnect integration/i });
    expect(confirm).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText(/account name/i), {
      target: { value: "Fixture Bakery" },
    });
    expect(confirm).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText(/account name/i), {
      target: { value: "Fixture Bakery — Central" },
    });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      `/api/organizations/${organizationId}/integrations/connections/${connectionId}`,
    );
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({ method: "DELETE" });
  });
});
