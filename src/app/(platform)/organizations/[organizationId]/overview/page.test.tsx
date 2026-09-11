// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getOrganizationContext: vi.fn(),
  getDigitalTwin: vi.fn(),
  loadOrganizationHome: vi.fn(),
  buildEconomicsView: vi.fn(),
  resolveWindow: vi.fn(),
  loadLedgerEntries: vi.fn(),
  loadCatalogCoverage: vi.fn(),
  buildDigitalTwinReadiness: vi.fn(),
  buildOverviewActionQueue: vi.fn(),
  buildOverviewComparison: vi.fn(),
  buildOverviewEconomics: vi.fn(),
  buildOverviewIntegration: vi.fn(),
  buildOverviewMoneyScale: vi.fn(),
  lastRouteLabel: null as null | Record<string, unknown>,
  lastHomeView: null as null | Record<string, unknown>,
  lastManagementProps: null as null | Record<string, unknown>,
}));

vi.mock("@/lib/api/organization-context", () => ({
  getOrganizationContext: mocks.getOrganizationContext,
}));

vi.mock("@/domain/organizations/repository", () => ({
  getDigitalTwin: mocks.getDigitalTwin,
}));

vi.mock("@/modules/organizations/infrastructure/home-loader", () => ({
  loadOrganizationHome: mocks.loadOrganizationHome,
}));

vi.mock("@/modules/economics/application/read-model", () => ({
  buildEconomicsView: mocks.buildEconomicsView,
  resolveWindow: mocks.resolveWindow,
}));

vi.mock("@/modules/economics/infrastructure/repository", () => ({
  loadLedgerEntries: mocks.loadLedgerEntries,
  loadCatalogCoverage: mocks.loadCatalogCoverage,
}));

vi.mock("@/modules/organizations/application/overview", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/modules/organizations/application/overview")>();
  return {
    ...actual,
    buildDigitalTwinReadiness: mocks.buildDigitalTwinReadiness,
    buildOverviewActionQueue: mocks.buildOverviewActionQueue,
    buildOverviewComparison: mocks.buildOverviewComparison,
    buildOverviewEconomics: mocks.buildOverviewEconomics,
    buildOverviewIntegration: mocks.buildOverviewIntegration,
    buildOverviewMoneyScale: mocks.buildOverviewMoneyScale,
  };
});

vi.mock("@/modules/integrations/application/feature-access", () => ({
  isIntegrationHubEnabled: vi.fn(() => false),
}));

vi.mock("@/modules/integrations/application/api-schemas", () => ({
  createIntegrationHubService: vi.fn(() => ({ getSnapshot: vi.fn() })),
}));

// The retired report stays mounted nowhere after this slice; stub it so the
// pre-rewrite page can still import while the new tests prove it is unused.
vi.mock("@/components/organizations/overview-report", () => ({
  OverviewReport: () => <div data-testid="retired-overview-report" />,
}));
vi.mock("@/components/layout/route-context", () => ({
  RegisterRouteLabel: (props: Record<string, unknown>) => {
    mocks.lastRouteLabel = props;
    return null;
  },
}));

vi.mock("@/components/organizations/home/organization-home", () => ({
  OrganizationHome: ({ view }: { view: Record<string, unknown> }) => {
    mocks.lastHomeView = view;
    return <div data-testid="organization-home">{String(view.name ?? "")}</div>;
  },
}));

vi.mock("@/components/organizations/digital-twin-workspace", () => ({
  OrganizationManagement: (props: Record<string, unknown>) => {
    mocks.lastManagementProps = props;
    return <div data-testid="organization-management" />;
  },
}));

import OverviewPage from "@/app/(platform)/organizations/[organizationId]/overview/page";
import { getOverviewPermissions } from "@/modules/organizations/application/overview";

const RESOLVED = "22222222-2222-4222-8222-222222222222";
const FORGED = "99999999-9999-4999-8999-999999999999";

function sessionSupabase() {
  return { storage: {} };
}

function snapshotFor(organizationId: string) {
  return {
    organization: {
      id: organizationId,
      name: "Al Noor Kitchen",
      default_timezone: "Asia/Dubai",
    },
    branches: [],
    profile: null,
    facts: [],
    goals: [],
    constraints: [],
    policies: [],
    auditEvents: [],
  };
}

function viewFor(organizationId: string, overrides: Record<string, unknown> = {}) {
  return {
    organizationId,
    name: "Al Noor Kitchen",
    description: null,
    status: "active",
    timeZone: "Asia/Dubai",
    currency: "AED",
    logo: null,
    locations: [],
    branchlessConfirmed: false,
    goals: [],
    focusGoalId: null,
    permissions: {
      canCreateCampaign: true,
      canEditCampaign: true,
      canReviewCampaign: true,
      canManageCore: true,
    },
    campaigns: { status: "ready", data: [], fetchedAt: "2026-09-11T00:00:00.000Z" },
    assets: { status: "ready", data: [], fetchedAt: "2026-09-11T00:00:00.000Z" },
    assetsPartial: false,
    attention: [],
    attentionIncomplete: false,
    destinations: [],
    activity: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lastRouteLabel = null;
  mocks.lastHomeView = null;
  mocks.lastManagementProps = null;
  const supabase = sessionSupabase();
  mocks.getOrganizationContext.mockResolvedValue({
    organizationId: RESOLVED,
    user: { id: "user-1" },
    membership: { role: "owner" },
    supabase,
  });
  mocks.getDigitalTwin.mockResolvedValue(snapshotFor(RESOLVED));
  mocks.loadOrganizationHome.mockResolvedValue(viewFor(RESOLVED));
});

afterEach(() => cleanup());

describe("OverviewPage (organization home)", () => {
  it("uses the resolved context ID, never the requested param", async () => {
    const page = await OverviewPage({
      params: Promise.resolve({ organizationId: FORGED }),
    });

    render(page);

    // The forged ID in the URL must not reach any read or label.
    expect(mocks.getDigitalTwin).toHaveBeenCalledTimes(1);
    expect(mocks.getDigitalTwin.mock.calls[0]?.[1]).toBe(RESOLVED);
    expect(mocks.loadOrganizationHome).toHaveBeenCalledTimes(1);
    expect(mocks.loadOrganizationHome.mock.calls[0]?.[0]).toMatchObject({
      organizationId: RESOLVED,
    });
    expect(mocks.lastRouteLabel).toMatchObject({
      segment: RESOLVED,
      label: "Al Noor Kitchen",
    });
    expect(mocks.lastHomeView).toMatchObject({ organizationId: RESOLVED });
    expect(screen.getByTestId("organization-home")).toBeInTheDocument();
  });

  it("passes the session client through every read without replacement", async () => {
    const supabase = sessionSupabase();
    mocks.getOrganizationContext.mockResolvedValue({
      organizationId: RESOLVED,
      user: { id: "user-1" },
      membership: { role: "owner" },
      supabase,
    });

    render(await OverviewPage({ params: Promise.resolve({ organizationId: RESOLVED }) }));

    expect(mocks.getDigitalTwin.mock.calls[0]?.[0]).toBe(supabase);
    expect(mocks.loadOrganizationHome.mock.calls[0]?.[0]).toMatchObject({
      supabase,
      role: "owner",
    });
    expect(
      (mocks.loadOrganizationHome.mock.calls[0]?.[0] as { supabase: unknown }).supabase,
    ).toBe(supabase);
    expect(mocks.loadOrganizationHome.mock.calls[0]?.[0]).toMatchObject({
      correlationId: expect.any(String),
      now: expect.any(String),
    });
  });

  it("still renders the home when an optional source settled as failed", async () => {
    mocks.loadOrganizationHome.mockResolvedValue(
      viewFor(RESOLVED, {
        campaigns: { status: "failed", code: "HOME_READ_FAILED" },
        assetsPartial: true,
      }),
    );

    render(await OverviewPage({ params: Promise.resolve({ organizationId: RESOLVED }) }));

    expect(screen.getByTestId("organization-home")).toBeInTheDocument();
    expect(mocks.lastHomeView).toMatchObject({
      campaigns: { status: "failed", code: "HOME_READ_FAILED" },
      assetsPartial: true,
    });
    expect(screen.getByTestId("organization-management")).toBeInTheDocument();
  });

  it("keeps the original management role props exactly", async () => {
    render(await OverviewPage({ params: Promise.resolve({ organizationId: RESOLVED }) }));

    const snapshot = await mocks.getDigitalTwin.mock.results[0]?.value;
    expect(mocks.lastManagementProps?.organizationId).toBe(RESOLVED);
    expect(mocks.lastManagementProps?.snapshot).toBe(snapshot);
    expect(mocks.lastManagementProps?.permissions).toEqual(getOverviewPermissions("owner"));
  });

  it("keeps the original management role props exactly for a viewer", async () => {
    mocks.getOrganizationContext.mockResolvedValue({
      organizationId: RESOLVED,
      user: { id: "user-9" },
      membership: { role: "viewer" },
      supabase: sessionSupabase(),
    });

    render(await OverviewPage({ params: Promise.resolve({ organizationId: RESOLVED }) }));

    expect(mocks.lastManagementProps?.organizationId).toBe(RESOLVED);
    expect(mocks.lastManagementProps?.permissions).toEqual(getOverviewPermissions("viewer"));
    expect(mocks.lastManagementProps?.permissions).toMatchObject({ canManageCore: false });
  });

  it("never invokes the retired 30d finance and action-queue work", async () => {
    render(await OverviewPage({ params: Promise.resolve({ organizationId: RESOLVED }) }));

    expect(mocks.loadLedgerEntries).not.toHaveBeenCalled();
    expect(mocks.loadCatalogCoverage).not.toHaveBeenCalled();
    expect(mocks.buildEconomicsView).not.toHaveBeenCalled();
    expect(mocks.resolveWindow).not.toHaveBeenCalled();
    expect(mocks.buildOverviewEconomics).not.toHaveBeenCalled();
    expect(mocks.buildOverviewComparison).not.toHaveBeenCalled();
    expect(mocks.buildOverviewMoneyScale).not.toHaveBeenCalled();
    expect(mocks.buildOverviewIntegration).not.toHaveBeenCalled();
    expect(mocks.buildOverviewActionQueue).not.toHaveBeenCalled();
    expect(mocks.buildDigitalTwinReadiness).not.toHaveBeenCalled();
  });
});
