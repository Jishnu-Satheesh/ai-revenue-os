// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getOrganizationContext: vi.fn(),
  getOrganization: vi.fn(),
  loadEvidenceWindows: vi.fn(),
  loadChannelBandsForWindow: vi.fn(),
  loadAnalysedWindowKeys: vi.fn(),
  isEnabled: vi.fn(),
}));

vi.mock("@/lib/api/organization-context", () => ({
  getOrganizationContext: mocks.getOrganizationContext,
}));

vi.mock("@/domain/organizations/repository", () => ({
  getOrganization: mocks.getOrganization,
}));

vi.mock("@/modules/channels/infrastructure/repository", () => ({
  createAuthenticatedChannelRepository: () => ({}),
}));

vi.mock("@/modules/channels/application/service", () => ({
  createChannelService: () => ({
    listManagementSnapshot: async () => ({
      channels: [
        {
          id: "ch-1",
          display_name: "talabat",
          status: "active",
          key: "talabat",
          category: "marketplace",
          template_key: null,
        },
      ],
      branches: [],
      branchMappings: [],
      aliases: [],
    }),
  }),
}));

vi.mock("@/modules/analysis/infrastructure/read-repository", () => ({
  createAuthenticatedChannelAnalysisRepository: () => ({
    loadEvidenceWindows: mocks.loadEvidenceWindows,
    loadChannelBandsForWindow: mocks.loadChannelBandsForWindow,
    loadAnalysedWindowKeys: mocks.loadAnalysedWindowKeys,
  }),
}));

vi.mock("@/modules/integrations/application/feature-access", () => ({
  isGovernedChannelAnalysisEnabled: () => mocks.isEnabled(),
}));

vi.mock("@/components/layout/route-context", () => ({ RegisterRouteLabel: () => null }));
vi.mock("@/components/channels/channels-management", () => ({
  ChannelsManagement: ({ portfolio }: { portfolio?: ReactNode }) => (
    <div data-testid="management-shell">
      {portfolio ? <div data-testid="management-portfolio">{portfolio}</div> : null}
    </div>
  ),
}));
vi.mock("@/components/channels/channels-rollup", () => ({
  ChannelsRollup: () => <div>Portfolio outcome</div>,
}));

import ChannelsPage from "@/app/(platform)/organizations/[organizationId]/channels/page";

const ORGANIZATION = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOrganizationContext.mockResolvedValue({
    organizationId: ORGANIZATION,
    user: { id: "user-1" },
    membership: { role: "owner" },
    supabase: {},
  });
  mocks.getOrganization.mockResolvedValue({
    id: ORGANIZATION,
    name: "Al Noor Kitchen",
    default_timezone: "Asia/Dubai",
  });
  mocks.loadEvidenceWindows.mockResolvedValue([]);
  mocks.loadChannelBandsForWindow.mockResolvedValue([]);
  mocks.loadAnalysedWindowKeys.mockResolvedValue([]);
  mocks.isEnabled.mockReturnValue(true);
});

describe("ChannelsPage", () => {
  it("places the portfolio outcome inside the channels management shell", async () => {
    const page = await ChannelsPage({
      params: Promise.resolve({ organizationId: ORGANIZATION }),
      searchParams: Promise.resolve({}),
    });

    render(page);

    expect(screen.getByTestId("management-portfolio")).toHaveTextContent("Portfolio outcome");
  });

  it("does not read analysis at all when the slice is off for the organization", async () => {
    // The flag is enforced in the read, not in navigation, so a flag-off
    // organization pays for nothing and has nothing to leak through a
    // hand-typed URL.
    mocks.isEnabled.mockReturnValue(false);

    await ChannelsPage({
      params: Promise.resolve({ organizationId: ORGANIZATION }),
      searchParams: Promise.resolve({}),
    });

    expect(mocks.loadEvidenceWindows).not.toHaveBeenCalled();
    expect(mocks.loadChannelBandsForWindow).not.toHaveBeenCalled();
    expect(mocks.loadAnalysedWindowKeys).not.toHaveBeenCalled();
  });

  it("reads bands for exactly the window named in the query string", async () => {
    mocks.loadEvidenceWindows.mockResolvedValueOnce([
      {
        packageId: "pkg-1",
        channelId: "ch-1",
        branchId: null,
        windowStart: "2026-01-01",
        windowEnd: "2026-02-28",
        timeZone: "Asia/Dubai",
        grain: "day",
        governedRowCount: 20,
        sourceFilename: "Talabat.xlsx",
      },
    ]);

    await ChannelsPage({
      params: Promise.resolve({ organizationId: ORGANIZATION }),
      searchParams: Promise.resolve({ window: "2026-01-01..2026-02-28..day" }),
    });

    expect(mocks.loadChannelBandsForWindow).toHaveBeenCalledWith({
      organizationId: ORGANIZATION,
      windowStart: "2026-01-01",
      windowEnd: "2026-02-28",
      grain: "day",
    });
  });

  it("reads windows across every channel, not one channel", async () => {
    await ChannelsPage({
      params: Promise.resolve({ organizationId: ORGANIZATION }),
      searchParams: Promise.resolve({}),
    });

    expect(mocks.loadEvidenceWindows).toHaveBeenCalledWith({
      organizationId: ORGANIZATION,
      channelId: null,
      limit: 24,
    });
  });

  it("ignores a malformed window parameter rather than reading a nonsense window", async () => {
    mocks.loadEvidenceWindows.mockResolvedValueOnce([]);

    await ChannelsPage({
      params: Promise.resolve({ organizationId: ORGANIZATION }),
      searchParams: Promise.resolve({ window: "not-a-window" }),
    });

    // No declared windows and an unparseable parameter means there is nothing
    // to band, so no band read is made at all.
    expect(mocks.loadChannelBandsForWindow).not.toHaveBeenCalled();
  });
});
