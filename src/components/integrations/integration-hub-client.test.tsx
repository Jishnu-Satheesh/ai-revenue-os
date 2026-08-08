// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  pathname: "/organizations/11111111-1111-4111-8111-111111111111/integrations",
  getOrganizationContext: vi.fn(),
  assertIntegrationHubEnabled: vi.fn(),
  getOrganization: vi.fn(),
  createIntegrationHubService: vi.fn(),
  service: { getSnapshot: vi.fn(), getCatalog: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/api/organization-context", () => ({
  getOrganizationContext: mocks.getOrganizationContext,
}));
vi.mock("@/modules/integrations/application/feature-access", () => ({
  assertIntegrationHubEnabled: mocks.assertIntegrationHubEnabled,
}));
vi.mock("@/domain/organizations/repository", () => ({ getOrganization: mocks.getOrganization }));
vi.mock("@/modules/integrations/application/api-schemas", () => ({
  createIntegrationHubService: mocks.createIntegrationHubService,
}));

import IntegrationsPage from "@/app/(platform)/organizations/[organizationId]/integrations/page";
import { IntegrationHubClient } from "@/components/integrations/integration-hub-client";
import { integrationQueryKeys } from "@/components/integrations/query-options";
import { deriveRouteCrumbs, RouteBreadcrumb } from "@/components/layout/route-context";
import { DomainError } from "@/lib/errors";
import type { IntegrationHubSnapshot } from "@/modules/integrations/application/read-model";

const organizationId = "11111111-1111-4111-8111-111111111111";
const connectionId = "22222222-2222-4222-8222-222222222222";

function snapshot(): IntegrationHubSnapshot {
  return {
    summary: {
      totalConnections: 1,
      healthyConnections: 1,
      actionRequiredConnections: 0,
      dataSources: 0,
    },
    connections: [
      {
        id: connectionId,
        organization_id: organizationId,
        provider_key: "google_business_profile",
        adapter_version: "1",
        connection_mode: "fixture",
        status: "active",
        external_account_id: "locations/fixture-1",
        external_account_label: "Fixture Bakery — Central",
        granted_scopes: ["business.manage"],
        token_expires_at: null,
        last_tested_at: "2026-08-08T09:00:00.000Z",
        last_successful_sync_at: "2026-08-08T09:00:00.000Z",
        next_scheduled_sync_at: "2026-08-08T09:30:00.000Z",
        created_by: "user-1",
        created_at: "2026-08-01T09:00:00.000Z",
        updated_at: "2026-08-08T09:00:00.000Z",
        capabilities: [],
        mappings: [],
        latestHealth: null,
        health: {
          state: "healthy",
          reasonCode: "verified_recently",
          explanation: "Connected and recently verified.",
          lastTestedAt: "2026-08-08T09:00:00.000Z",
          lastSuccessfulSyncAt: "2026-08-08T09:00:00.000Z",
          evaluatedAt: "2026-08-08T09:05:00.000Z",
        },
      },
    ],
    dataSources: [],
    branches: [],
    recentActivity: [],
    serverTime: "2026-08-08T09:05:00.000Z",
  };
}

function renderClient(options: { fetchNeverResolves?: boolean } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <IntegrationHubClient
        organizationId={organizationId}
        organizationName="Fixture Bakery"
        role="operator"
        initialSnapshot={snapshot()}
        initialCatalog={[]}
        // A zero timestamp marks the server payload as stale so the client
        // performs the background refetch this test observes.
        initialDataUpdatedAt={options.fetchNeverResolves ? 0 : Date.now()}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // reset, not clear: a rejection stubbed by one case must not leak into the
  // next one's authorized happy path.
  vi.resetAllMocks();
  mocks.pathname = `/organizations/${organizationId}/integrations`;
  mocks.getOrganizationContext.mockResolvedValue({
    organizationId,
    user: { id: "user-1" },
    membership: { role: "operator" },
    supabase: {},
  });
  mocks.getOrganization.mockResolvedValue({ id: organizationId, name: "Fixture Bakery" });
  mocks.createIntegrationHubService.mockReturnValue(mocks.service);
  mocks.service.getSnapshot.mockResolvedValue(snapshot());
  mocks.service.getCatalog.mockResolvedValue([]);
});

afterEach(() => cleanup());

describe("integration hub query keys", () => {
  it("scopes every key under the organization's integrations namespace", () => {
    const prefix = ["organizations", organizationId, "integrations"];

    expect(integrationQueryKeys.root(organizationId)).toEqual(prefix);
    for (const key of [
      integrationQueryKeys.snapshot(organizationId),
      integrationQueryKeys.catalog(organizationId),
      integrationQueryKeys.connections(organizationId),
      integrationQueryKeys.connection(organizationId, connectionId),
      integrationQueryKeys.connectionHealth(organizationId, connectionId),
      integrationQueryKeys.dataSources(organizationId),
      integrationQueryKeys.activity(organizationId),
    ]) {
      expect(key.slice(0, 3)).toEqual(prefix);
      expect(key.length).toBeGreaterThan(3);
    }
  });
});

describe("IntegrationHubClient", () => {
  it("defaults to Connections and exposes four keyboard-reachable tabs", async () => {
    renderClient();

    const tabs = within(screen.getByRole("tablist")).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Connections",
      "Catalog",
      "Data sources",
      "Activity",
    ]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    for (const tab of tabs) expect(tab).toBeEnabled();

    // Radix keeps one tab in the tab order and moves between the rest with the
    // arrow keys, so keyboard reach is proven by the roving focus below.
    tabs[0].focus();
    for (const [index, tab] of tabs.slice(1).entries()) {
      fireEvent.keyDown(tabs[index], { key: "ArrowRight" });
      await waitFor(() => expect(tab).toHaveFocus());
      expect(tab).toHaveAttribute("aria-selected", "true");
      expect(tabs[index]).toHaveAttribute("aria-selected", "false");
    }
  });

  it("keeps the server snapshot on screen during a background refetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise(() => {
          // Never resolves: the query stays in a background-fetching state.
        }),
    );
    try {
      renderClient({ fetchNeverResolves: true });

      expect(await screen.findByRole("status", { name: /refreshing/i })).toBeInTheDocument();
      expect(screen.getAllByText("Fixture Bakery — Central").length).toBeGreaterThan(0);
      expect(screen.queryByTestId("integration-hub-skeleton")).not.toBeInTheDocument();
      await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
      expect(fetchSpy.mock.calls[0]?.[0]).toBe(`/api/organizations/${organizationId}/integrations`);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe("Integration Hub server boundary", () => {
  it("refuses an organization outside the rollout allowlist", async () => {
    mocks.assertIntegrationHubEnabled.mockImplementation(() => {
      throw new DomainError("FEATURE_NOT_AVAILABLE", "Integration Hub is not available.");
    });

    await expect(
      IntegrationsPage({ params: Promise.resolve({ organizationId }) }),
    ).rejects.toMatchObject({ code: "FEATURE_NOT_AVAILABLE" });
    expect(mocks.service.getSnapshot).not.toHaveBeenCalled();
  });

  it("refuses an organization the caller does not belong to", async () => {
    mocks.getOrganizationContext.mockRejectedValue(
      new DomainError("TENANT_SCOPE_ERROR", "You do not have access to this organization."),
    );

    await expect(
      IntegrationsPage({ params: Promise.resolve({ organizationId }) }),
    ).rejects.toMatchObject({ code: "TENANT_SCOPE_ERROR" });
    expect(mocks.assertIntegrationHubEnabled).not.toHaveBeenCalled();
    expect(mocks.service.getSnapshot).not.toHaveBeenCalled();
  });

  it("renders the authorized workspace from the server-read snapshot", async () => {
    const page = await IntegrationsPage({ params: Promise.resolve({ organizationId }) });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}>{page}</QueryClientProvider>);

    expect(mocks.assertIntegrationHubEnabled).toHaveBeenCalledWith(organizationId);
    expect(screen.getByRole("heading", { name: "Integrations", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Connections" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});

describe("route-aware app chrome", () => {
  it("derives the location from the pathname instead of a hardcoded Overview label", () => {
    expect(deriveRouteCrumbs("/overview").at(-1)?.label).toBe("Overview");
    expect(
      deriveRouteCrumbs(`/organizations/${organizationId}/integrations`).map(
        (crumb) => crumb.label,
      ),
    ).toEqual(["Organization", "Integrations"]);
    expect(
      deriveRouteCrumbs(`/organizations/${organizationId}/onboarding`, {
        [organizationId]: "Fixture Bakery",
      }).map((crumb) => crumb.label),
    ).toEqual(["Fixture Bakery", "Guided onboarding"]);
  });

  it("marks only the current location as the breadcrumb page", () => {
    render(<RouteBreadcrumb labels={{ [organizationId]: "Fixture Bakery" }} />);

    const breadcrumb = screen.getByRole("navigation", { name: "breadcrumb" });
    expect(within(breadcrumb).getByText("Fixture Bakery")).toBeInTheDocument();
    const current = within(breadcrumb).getByText("Integrations");
    expect(current).toHaveAttribute("aria-current", "page");
    expect(within(breadcrumb).queryByText("Overview")).not.toBeInTheDocument();
  });
});
