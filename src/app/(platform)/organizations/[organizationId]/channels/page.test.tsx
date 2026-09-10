// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { ChannelAnalysisReadError } = vi.hoisted(() => {
  class ChannelAnalysisReadError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.name = "ChannelAnalysisReadError";
      this.code = code;
    }
  }
  return { ChannelAnalysisReadError };
});

const mocks = vi.hoisted(() => ({
  getOrganizationContext: vi.fn(),
  getOrganization: vi.fn(),
  listManagementSnapshot: vi.fn(),
  loadEvidenceWindows: vi.fn(),
  loadChannelBandsForWindow: vi.fn(),
  loadAnalysedWindowKeys: vi.fn(),
  isEnabled: vi.fn(),
  loggerWarn: vi.fn(),
  lastManagementProps: null as null | Record<string, unknown>,
}));

vi.mock("@/lib/api/organization-context", () => ({
  getOrganizationContext: mocks.getOrganizationContext,
}));

vi.mock("@/domain/organizations/repository", () => ({
  getOrganization: mocks.getOrganization,
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: mocks.loggerWarn, error: vi.fn() },
}));

vi.mock("@/modules/channels/infrastructure/repository", () => ({
  createAuthenticatedChannelRepository: () => ({}),
}));

vi.mock("@/modules/channels/application/service", () => ({
  createChannelService: () => ({
    listManagementSnapshot: (...args: unknown[]) => mocks.listManagementSnapshot(...args),
  }),
}));

vi.mock("@/modules/analysis/infrastructure/read-repository", () => ({
  ChannelAnalysisReadError,
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
  ChannelsManagement: (props: Record<string, unknown>) => {
    mocks.lastManagementProps = props;
    const analysis = props.analysis as
      | { state: "disabled" | "unavailable" }
      | { state: "ready"; view: { selectedWindow: unknown } };
    return (
      <div
        data-testid="management-shell"
        data-analysis-state={analysis.state}
        data-selected-window={
          analysis.state === "ready" ? JSON.stringify(analysis.view.selectedWindow) : ""
        }
        data-channel-count={(props.channels as unknown[]).length}
      />
    );
  },
}));
vi.mock("@/components/channels/channels-rollup", () => ({
  ChannelsRollup: () => <div>Portfolio outcome</div>,
}));

import ChannelsPage from "@/app/(platform)/organizations/[organizationId]/channels/page";

const ORGANIZATION = "44444444-4444-4444-8444-444444444444";

const febEvidence = {
  packageId: "pkg-feb",
  channelId: "ch-1",
  branchId: null,
  windowStart: "2026-02-01",
  windowEnd: "2026-02-28",
  timeZone: "Asia/Dubai",
  grain: "month",
  governedRowCount: 20,
  sourceFilename: "Feb.xlsx",
};

const janEvidence = {
  packageId: "pkg-jan",
  channelId: "ch-1",
  branchId: null,
  windowStart: "2026-01-01",
  windowEnd: "2026-01-31",
  timeZone: "Asia/Dubai",
  grain: "month",
  governedRowCount: 20,
  sourceFilename: "Jan.xlsx",
};

const febKey = { windowStart: "2026-02-01", windowEnd: "2026-02-28", grain: "month" };

const spanEvidence = {
  packageId: "pkg-span",
  channelId: "ch-1",
  branchId: null,
  windowStart: "2026-01-01",
  windowEnd: "2026-02-28",
  timeZone: "Asia/Dubai",
  grain: "span",
  governedRowCount: 40,
  sourceFilename: "Q1.xlsx",
};

const spanKey = { windowStart: "2026-01-01", windowEnd: "2026-02-28", grain: "span" };

function pageProps(window?: string) {
  return {
    params: Promise.resolve({ organizationId: ORGANIZATION }),
    searchParams: Promise.resolve(window === undefined ? {} : { window }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lastManagementProps = null;
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
  mocks.listManagementSnapshot.mockResolvedValue({
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
  });
  mocks.loadEvidenceWindows.mockResolvedValue([]);
  mocks.loadChannelBandsForWindow.mockResolvedValue([]);
  mocks.loadAnalysedWindowKeys.mockResolvedValue([]);
  mocks.isEnabled.mockReturnValue(true);
});

afterEach(() => cleanup());

describe("ChannelsPage", () => {
  it("passes one coherent analysis state instead of legacy portfolio props", async () => {
    const page = await ChannelsPage(pageProps());

    render(page);

    expect(screen.getByTestId("management-shell")).toHaveAttribute("data-analysis-state", "ready");
    expect(mocks.lastManagementProps).toMatchObject({ canManage: true });
    expect(mocks.lastManagementProps).toHaveProperty("analysis");
    expect(mocks.lastManagementProps).not.toHaveProperty("portfolio");
    expect(mocks.lastManagementProps).not.toHaveProperty("workspaceEnabled");
    expect(mocks.lastManagementProps).not.toHaveProperty("analysisRows");
  });

  it("does not read analysis at all when the slice is off for the organization", async () => {
    // The flag is enforced in the read, not in navigation, so a flag-off
    // organization pays for nothing and has nothing to leak through a
    // hand-typed URL.
    mocks.isEnabled.mockReturnValue(false);

    const page = await ChannelsPage(pageProps());
    render(page);

    expect(mocks.loadEvidenceWindows).not.toHaveBeenCalled();
    expect(mocks.loadChannelBandsForWindow).not.toHaveBeenCalled();
    expect(mocks.loadAnalysedWindowKeys).not.toHaveBeenCalled();
    expect(screen.getByTestId("management-shell")).toHaveAttribute(
      "data-analysis-state",
      "disabled",
    );
  });

  it("reads bands for exactly the window named in the query string", async () => {
    mocks.loadEvidenceWindows.mockResolvedValueOnce([febEvidence]);

    await ChannelsPage(pageProps("2026-02-01..2026-02-28..month"));

    expect(mocks.loadChannelBandsForWindow).toHaveBeenCalledWith({
      organizationId: ORGANIZATION,
      windowStart: "2026-02-01",
      windowEnd: "2026-02-28",
      grain: "month",
    });
  });

  it("accepts a declared span window from the query string", async () => {
    // The old route parser only knew day/week/month, so a span option from
    // the selector silently reverted to a default. The shared exact-window
    // parser knows span, and the page uses it.
    mocks.loadEvidenceWindows.mockResolvedValueOnce([spanEvidence, febEvidence]);
    mocks.loadAnalysedWindowKeys.mockResolvedValueOnce([spanKey]);

    await ChannelsPage(pageProps("2026-01-01..2026-02-28..span"));

    expect(mocks.loadChannelBandsForWindow).toHaveBeenCalledWith({
      organizationId: ORGANIZATION,
      windowStart: "2026-01-01",
      windowEnd: "2026-02-28",
      grain: "span",
    });
  });

  it.each([
    ["a malformed value", "not-a-window"],
    ["a reversed range", "2026-02-28..2026-02-01..day"],
    ["a truncated value", "2026-02-01..2026-02-28"],
  ])("falls back to the existing default selection for %s", async (_label, value) => {
    mocks.loadEvidenceWindows.mockResolvedValueOnce([janEvidence, febEvidence]);
    mocks.loadAnalysedWindowKeys.mockResolvedValueOnce([febKey]);

    const page = await ChannelsPage(pageProps(value));
    render(page);

    // The default resolver picks the newest analysed window: February.
    expect(mocks.loadChannelBandsForWindow).toHaveBeenCalledWith({
      organizationId: ORGANIZATION,
      windowStart: "2026-02-01",
      windowEnd: "2026-02-28",
      grain: "month",
    });
    expect(screen.getByTestId("management-shell")).toHaveAttribute("data-analysis-state", "ready");
  });

  it("leaves a valid-but-unknown window explicitly unresolved", async () => {
    mocks.loadEvidenceWindows.mockResolvedValueOnce([febEvidence]);
    mocks.loadAnalysedWindowKeys.mockResolvedValueOnce([febKey]);

    const page = await ChannelsPage(pageProps("2026-05-01..2026-05-31..month"));
    render(page);

    // The URL parses, so the default resolver must not run: bands are read
    // for the requested May window, and the view carries no selected window
    // so the landing suppresses figures instead of showing February's.
    expect(mocks.loadChannelBandsForWindow).toHaveBeenCalledWith({
      organizationId: ORGANIZATION,
      windowStart: "2026-05-01",
      windowEnd: "2026-05-31",
      grain: "month",
    });
    const shell = screen.getByTestId("management-shell");
    expect(shell).toHaveAttribute("data-analysis-state", "ready");
    expect(shell).toHaveAttribute("data-selected-window", "null");
  });

  it("routes a known analysis read failure to unavailable and keeps the directory", async () => {
    mocks.loadEvidenceWindows.mockRejectedValueOnce(
      new ChannelAnalysisReadError("VALUE_NOT_EXACT"),
    );

    const page = await ChannelsPage(pageProps());
    render(page);

    const shell = screen.getByTestId("management-shell");
    expect(shell).toHaveAttribute("data-analysis-state", "unavailable");
    expect(shell).toHaveAttribute("data-channel-count", "1");
    expect(mocks.loggerWarn).toHaveBeenCalledWith("channels_overview.read_failed", {
      organizationId: ORGANIZATION,
      errorCode: "VALUE_NOT_EXACT",
    });
  });

  it("bounds the logged read code so tenant text cannot reach the log", async () => {
    mocks.loadEvidenceWindows.mockRejectedValueOnce(
      new ChannelAnalysisReadError("oops\nINJECTED CODE"),
    );

    await ChannelsPage(pageProps());

    expect(mocks.loggerWarn).toHaveBeenCalledWith("channels_overview.read_failed", {
      organizationId: ORGANIZATION,
      errorCode: "unknown",
    });
  });

  it("does not swallow an unexpected analysis failure into an empty success", async () => {
    mocks.loadEvidenceWindows.mockRejectedValueOnce(new Error("analysis exploded"));

    await expect(ChannelsPage(pageProps())).rejects.toThrow("analysis exploded");
  });

  it("does not swallow an organization context failure into an empty success", async () => {
    mocks.getOrganizationContext.mockRejectedValueOnce(new Error("boom"));

    await expect(ChannelsPage(pageProps())).rejects.toThrow("boom");
  });

  it("does not swallow a management snapshot failure into an empty success", async () => {
    mocks.listManagementSnapshot.mockRejectedValueOnce(new Error("snapshot down"));

    await expect(ChannelsPage(pageProps())).rejects.toThrow("snapshot down");
  });

  it("reads windows across every channel, not one channel", async () => {
    await ChannelsPage(pageProps());

    expect(mocks.loadEvidenceWindows).toHaveBeenCalledWith({
      organizationId: ORGANIZATION,
      channelId: null,
      limit: 24,
    });
  });

  it("ignores a malformed window parameter rather than reading a nonsense window", async () => {
    mocks.loadEvidenceWindows.mockResolvedValueOnce([]);

    await ChannelsPage(pageProps("not-a-window"));

    // No declared windows and an unparseable parameter means there is nothing
    // to band, so no band read is made at all.
    expect(mocks.loadChannelBandsForWindow).not.toHaveBeenCalled();
  });
});
