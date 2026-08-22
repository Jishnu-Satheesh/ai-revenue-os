// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  isEnabled: vi.fn(),
  loadReadiness: vi.fn(),
  createReadinessRepository: vi.fn(),
  getOrganizationContext: vi.fn(),
  getOrganization: vi.fn(),
  loadLedgerEntries: vi.fn(),
  loadCatalogCoverage: vi.fn(),
}));

vi.mock("@/modules/integrations/application/feature-access", () => ({
  isGovernedEconomicsReadinessEnabled: mocks.isEnabled,
}));
vi.mock("@/modules/economics/application/readiness-service", () => ({
  createEvidenceReadinessService: () => ({ loadReadiness: mocks.loadReadiness }),
}));
vi.mock("@/modules/economics/infrastructure/readiness-repository", () => ({
  createAuthenticatedEvidenceReadinessRepository: mocks.createReadinessRepository,
}));
vi.mock("@/lib/api/organization-context", () => ({
  getOrganizationContext: mocks.getOrganizationContext,
}));
vi.mock("@/domain/organizations/repository", () => ({ getOrganization: mocks.getOrganization }));
vi.mock("@/modules/economics/infrastructure/repository", () => ({
  loadLedgerEntries: mocks.loadLedgerEntries,
  loadCatalogCoverage: mocks.loadCatalogCoverage,
}));
vi.mock("@/components/layout/route-context", () => ({ RegisterRouteLabel: () => null }));
vi.mock("@/components/economics/channel-economics-panel", () => ({
  ChannelEconomicsPanel: () => <div>channel economics</div>,
}));

import ChannelEconomicsPage from "@/app/(platform)/organizations/[organizationId]/economics/page";

const ORGANIZATION = "44444444-4444-4444-8444-444444444444";

const readiness = {
  readModelVersion: 1,
  digest: "a".repeat(64),
  tuples: [],
  costCoverage: { outcome: "unchecked" as const },
  costSummary: "",
};

async function renderPage() {
  const element = await ChannelEconomicsPage({
    params: Promise.resolve({ organizationId: ORGANIZATION }),
    searchParams: Promise.resolve({}),
  });
  return render(element);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOrganizationContext.mockResolvedValue({
    supabase: {},
    user: { id: "user-1" },
    organizationId: ORGANIZATION,
    membership: { role: "owner" },
  });
  mocks.getOrganization.mockResolvedValue({
    name: "Pilot restaurant",
    default_timezone: "Asia/Dubai",
  });
  mocks.loadLedgerEntries.mockResolvedValue([]);
  mocks.loadCatalogCoverage.mockResolvedValue([]);
  mocks.loadReadiness.mockResolvedValue(readiness);
});

afterEach(() => cleanup());

describe("channel economics page", () => {
  it("renders the readiness panel for an enabled organization", async () => {
    mocks.isEnabled.mockReturnValue(true);

    await renderPage();

    expect(screen.getByText("Evidence readiness")).toBeInTheDocument();
    expect(mocks.loadReadiness).toHaveBeenCalledWith({
      organizationId: ORGANIZATION,
      role: "owner",
    });
  });

  it("omits the panel when the flag is off", async () => {
    mocks.isEnabled.mockReturnValue(false);

    await renderPage();

    expect(screen.queryByText("Evidence readiness")).not.toBeInTheDocument();
  });

  it("reads nothing at all when the flag is off", async () => {
    // Enforced in the loader, not in navigation. A disabled organization that
    // types the URL still costs no query and exposes no evidence.
    mocks.isEnabled.mockReturnValue(false);

    await renderPage();

    expect(mocks.loadReadiness).not.toHaveBeenCalled();
    expect(mocks.createReadinessRepository).not.toHaveBeenCalled();
  });

  it("still renders the existing economics view when the flag is off", async () => {
    mocks.isEnabled.mockReturnValue(false);

    await renderPage();

    expect(screen.getByText("channel economics")).toBeInTheDocument();
  });
});
