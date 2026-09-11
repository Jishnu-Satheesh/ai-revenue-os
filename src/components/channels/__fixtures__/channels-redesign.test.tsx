// @vitest-environment jsdom
/**
 * TEST-ONLY verification for the Channels redesign (Spec 018, Task 8).
 *
 * Lives beside the fixtures it exercises; asserts nothing about production
 * behavior beyond what the carried Task 4–7 review notes require, and guards
 * the fixture boundary itself (no production module may import the
 * `__fixtures__` directory).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock("recharts", () => ({
  Bar: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Legend: () => null,
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

import { ChannelCoverageDialog } from "@/components/channels/channel-coverage-dialog";
import { ChannelLocationForm } from "@/components/channels/channel-mapping-forms";
import { ChannelManagementDialog } from "@/components/channels/channel-management-dialog";
import {
  buildChannelsPortfolioPresentation,
  selectChannelDirectoryRows,
} from "@/components/channels/channels-presentation";
import type { ChannelsLandingAnalysis } from "@/components/channels/channels-presentation";
import {
  ALIAS_DIRECT_PUNCTUATED,
  BRANCH_BARSHA,
  BRANCH_BARSHA_ID,
  BRANCH_DEIRA,
  BRANCH_DEIRA_ID,
  BRANCH_RETIRED,
  BRANCH_RETIRED_ID,
  CHANNEL_A,
  CHANNEL_B,
  CHANNEL_DIRECT,
  CHANNEL_ID_A,
  CHANNEL_ID_B,
  CHANNEL_ID_DIRECT,
  CHANNEL_ID_INSTORE,
  CHANNEL_ID_PREVIOUS,
  CHANNEL_INSTORE,
  LONG_CHANNEL_NAME,
  MAPPING_A_BARSHA,
  MAPPING_A_DEIRA,
  MAPPING_B_BARSHA,
  MAPPING_B_DEIRA,
  MAPPING_INSTORE_RETIRED,
  REDESIGN_ACTIVE_BRANCHES,
  REDESIGN_ALIASES,
  REDESIGN_BRANCHES,
  REDESIGN_CHANNELS,
  REDESIGN_EVIDENCE_WINDOWS,
  REDESIGN_MAPPINGS,
  REDESIGN_ORGANIZATION_ID,
  WINDOW_FEB,
  WINDOW_JAN,
  bandRecord,
  februaryBands,
  februaryBandsWithArchivedMoney,
  januaryBands,
  mixedCurrencyBands,
} from "@/components/channels/__fixtures__/channels-redesign";
import {
  buildChannelsOverviewView,
  type ChannelsOverviewView,
} from "@/modules/analysis/application/channels-overview";
import type { AnalysisGrain } from "@/domain/analysis/types";

afterEach(cleanup);

function viewFor(
  bands: ReturnType<typeof februaryBands>,
  selected: { windowStart: string; windowEnd: string; grain: AnalysisGrain },
): ChannelsOverviewView {
  return buildChannelsOverviewView({
    channels: REDESIGN_CHANNELS.map((channel) => ({
      id: channel.id,
      display_name: channel.display_name,
      status: channel.status,
    })),
    bands,
    evidenceWindows: REDESIGN_EVIDENCE_WINDOWS,
    selected,
  });
}

function ready(view: ChannelsOverviewView): ChannelsLandingAnalysis {
  return { state: "ready", view };
}

function queryWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("fixture boundary", () => {
  it("is imported by tests and the temporary harness only, never by production code", () => {
    const srcRoot = join(process.cwd(), "src");
    const offenders: string[] = [];
    const visit = (directory: string) => {
      for (const entry of readdirSync(directory)) {
        const path = join(directory, entry);
        const stat = statSync(path);
        if (stat.isDirectory()) {
          if (entry === "node_modules" || entry === "__fixtures__") continue;
          visit(path);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry) || /\.test\.[jt]sx?$/.test(entry)) continue;
        const content = readFileSync(path, "utf8");
        if (content.includes("__fixtures__/channels-redesign")) offenders.push(path);
      }
    };
    visit(join(srcRoot));
    // The temporary dev-only harness is the single sanctioned non-test
    // importer; it is deleted before the release build (Task 8 gates on its
    // absence). Anything else is a boundary violation.
    const allowed = ["design-review-channels"];
    const violations = offenders.filter((path) => !allowed.some((prefix) => path.includes(prefix)));
    expect(violations).toEqual([]);
  });
});

describe("§7 fixture honesty through the real overview builder", () => {
  it("reproduces the February expectations: 13.8M reported, 11.4M earned, 600k lost, 4/3/2/1/1", () => {
    const view = viewFor(februaryBands(), WINDOW_FEB);
    expect(view.selectedWindow?.value).toBe("2026-02-01..2026-02-28..month");
    expect(view.total.potential).toEqual({ minorUnits: 12_000_000, currency: "AED" });
    expect(view.coverage).toEqual({
      assessedCount: 2,
      channelCount: 5,
      revenueOnlyNames: ["Direct"],
      unassessedNames: ["In-store", "Previous"],
    });
    expect(view.refusalReason).toBeNull();

    const portfolio = buildChannelsPortfolioPresentation(view);
    expect(portfolio.reportedTotal).toEqual({ minorUnits: 13_800_000, currency: "AED" });
    expect(portfolio.earnedTotal).toEqual({ minorUnits: 11_400_000, currency: "AED" });
    expect(portfolio.lostTotal).toEqual({ minorUnits: 600_000, currency: "AED" });
    expect(portfolio.activeCount).toBe(4);
    expect(portfolio.reportedCount).toBe(3);
    expect(portfolio.completeCount).toBe(2);
    expect(portfolio.revenueOnlyCount).toBe(1);
    expect(portfolio.refusedCount).toBe(1);
    expect(portfolio.comparisonCurrency).toBe("AED");
  });

  it("reproduces the January expectations: 11.7M reported, 9.69M earned, 510k lost", () => {
    const view = viewFor(januaryBands(), WINDOW_JAN);
    const portfolio = buildChannelsPortfolioPresentation(view);
    expect(portfolio.reportedTotal).toEqual({ minorUnits: 11_700_000, currency: "AED" });
    expect(portfolio.earnedTotal).toEqual({ minorUnits: 9_690_000, currency: "AED" });
    expect(portfolio.lostTotal).toEqual({ minorUnits: 510_000, currency: "AED" });
    expect(portfolio.activeCount).toBe(4);
    expect(portfolio.reportedCount).toBe(3);
  });

  it("excludes nonzero archived money from every active sum, share input, and count", () => {
    const view = viewFor(februaryBandsWithArchivedMoney(), WINDOW_FEB);
    const archivedRow = view.rows.find((row) => row.channelId === CHANNEL_ID_PREVIOUS);
    expect(archivedRow?.band.potential).toEqual({ minorUnits: 5_000_000, currency: "AED" });

    const portfolio = buildChannelsPortfolioPresentation(view);
    expect(portfolio.reportedTotal).toEqual({ minorUnits: 13_800_000, currency: "AED" });
    expect(portfolio.earnedTotal).toEqual({ minorUnits: 11_400_000, currency: "AED" });
    expect(portfolio.activeCount).toBe(4);
    expect(portfolio.rows.map((row) => row.channelId)).not.toContain(CHANNEL_ID_PREVIOUS);
  });

  it("carries the §7 record shapes: five channels, three branches, five mappings, three aliases", () => {
    expect(REDESIGN_CHANNELS).toHaveLength(5);
    expect(REDESIGN_BRANCHES).toHaveLength(3);
    expect(REDESIGN_MAPPINGS).toHaveLength(5);
    expect(REDESIGN_ALIASES).toHaveLength(3);
    // Two active for A; one active + one inactive for B; ghost retired mapping
    // for In-store; none for Direct.
    expect(
      REDESIGN_MAPPINGS.filter(
        (entry) => entry.channel_id === CHANNEL_ID_A && entry.status === "active",
      ),
    ).toHaveLength(2);
    expect(
      REDESIGN_MAPPINGS.filter(
        (entry) => entry.channel_id === CHANNEL_ID_B && entry.status === "inactive",
      ),
    ).toHaveLength(1);
    expect(MAPPING_INSTORE_RETIRED.branch_id).toBe(BRANCH_RETIRED_ID);
    expect(BRANCH_RETIRED.is_active).toBe(false);
    expect(REDESIGN_ACTIVE_BRANCHES.map((entry) => entry.id)).not.toContain(BRANCH_RETIRED_ID);
    // Punctuation travels literally inside one alias.
    expect(ALIAS_DIRECT_PUNCTUATED.alias).toBe("Website orders; online, app");
    expect(LONG_CHANNEL_NAME).toHaveLength(160);
  });
});

describe("Task 4 Minor-2 carried cases: D02 scope line branches", () => {
  it("states Multiple currencies for a mixed-currency portfolio with the full date range", () => {
    const view = viewFor(mixedCurrencyBands(), WINDOW_FEB);
    const portfolio = buildChannelsPortfolioPresentation(view);
    expect(portfolio.comparisonCurrency).toBeNull();

    render(
      <ChannelCoverageDialog
        organizationId={REDESIGN_ORGANIZATION_ID}
        portfolio={portfolio}
        selectedWindow={view.selectedWindow}
        open
        onOpenChange={() => undefined}
      />,
    );
    expect(
      screen.getByText("1 February 2026 – 28 February 2026 · Reported scope · Multiple currencies"),
    ).toBeInTheDocument();
  });

  it("renders the bare Reported scope line when no window is selected", () => {
    const view = viewFor(februaryBands(), WINDOW_FEB);
    const portfolio = buildChannelsPortfolioPresentation(view);

    render(
      <ChannelCoverageDialog
        organizationId={REDESIGN_ORGANIZATION_ID}
        portfolio={portfolio}
        selectedWindow={null}
        open
        onOpenChange={() => undefined}
      />,
    );
    expect(screen.getByText("Reported scope · AED")).toBeInTheDocument();
    expect(screen.queryByText(/1 February 2026/)).toBeNull();
  });
});

describe("Task 5 carried notes: sort ties and search scope", () => {
  it("keeps unknown–unknown sort ties in deterministic snapshot order (harmless: placement rule holds)", () => {
    const view = viewFor(februaryBands(), WINDOW_FEB);
    // Two refused rows (In-store refused + archived Previous excluded): the
    // ascending sort must still put unknowns last, in snapshot order.
    const rows = selectChannelDirectoryRows({
      channels: [CHANNEL_A, CHANNEL_INSTORE, CHANNEL_B, CHANNEL_DIRECT],
      analysis: ready(view),
      query: "",
      filter: "active",
      sort: "ascending",
    });
    const names = rows.map((row) => row.display_name);
    // Known amounts ascend; the refused row stays last regardless of its name.
    expect(names[names.length - 1]).toBe("In-store");
    expect(names.slice(0, 3)).toEqual(["Direct", "Delivery B", "Delivery A"]);
  });

  it("matches the raw category value as a forgiving superset of the displayed label", () => {
    const view = viewFor(februaryBands(), WINDOW_FEB);
    const byLabel = selectChannelDirectoryRows({
      channels: REDESIGN_CHANNELS,
      analysis: ready(view),
      query: "Owned digital",
      filter: "active",
      sort: "descending",
    });
    const byRaw = selectChannelDirectoryRows({
      channels: REDESIGN_CHANNELS,
      analysis: ready(view),
      query: "owned_digital",
      filter: "active",
      sort: "descending",
    });
    expect(byLabel.map((row) => row.id)).toEqual([CHANNEL_ID_DIRECT]);
    // Superset, not divergence: the raw value resolves to the same channel.
    expect(byRaw.map((row) => row.id)).toEqual([CHANNEL_ID_DIRECT]);
  });
});

describe("Task 7 M3 carried note: location draft resync on snapshot refresh", () => {
  it("keeps the open draft while the saved list picks up the refreshed snapshot", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const first = render(
      <ChannelLocationForm
        organizationId={REDESIGN_ORGANIZATION_ID}
        channelId={CHANNEL_ID_A}
        branches={[BRANCH_BARSHA, BRANCH_DEIRA]}
        mappings={[MAPPING_A_BARSHA]}
        canMap
        onSaved={() => undefined}
      />,
      { wrapper: queryWrapper(client) },
    );
    // Draft derives from the first active branch with its stored dates.
    expect(first.getByDisplayValue("2026-01-01")).toBeInTheDocument();

    // Same channel, refreshed snapshot: Deira is now mapped server-side.
    const deiraMapping = {
      ...MAPPING_A_DEIRA,
      effective_from: "2026-03-01",
      effective_to: null as string | null,
    };
    first.rerender(
      <ChannelLocationForm
        organizationId={REDESIGN_ORGANIZATION_ID}
        channelId={CHANNEL_ID_A}
        branches={[BRANCH_BARSHA, BRANCH_DEIRA]}
        mappings={[MAPPING_A_BARSHA, deiraMapping]}
        canMap
        onSaved={() => undefined}
      />,
    );
    // Saved list reflects the refresh (read-only text, not inputs); the open
    // Barsha draft is untouched.
    expect(first.getByDisplayValue("2026-01-01")).toBeInTheDocument();
    expect(first.getByText("2026-03-01")).toBeInTheDocument();
  });
});

describe("Task 6 Minor-1 carried note (C54): edit-form label announcement", () => {
  it("records how the Category and Stable key controls announce without htmlFor linkage", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <ChannelManagementDialog
        organizationId={REDESIGN_ORGANIZATION_ID}
        channel={CHANNEL_A}
        open
        onOpenChange={() => undefined}
        branches={[BRANCH_BARSHA, BRANCH_DEIRA]}
        branchMappings={[MAPPING_A_BARSHA, MAPPING_A_DEIRA]}
        aliases={[]}
        canManage
        canMapBranches
        onSaved={() => undefined}
      />,
      { wrapper: queryWrapper(client) },
    );
    const dialog = screen.getByRole("dialog", { name: /Manage Delivery A/ });

    // Channel name keeps the exact htmlFor/id linkage (create-form parity).
    expect(within(dialog).getByRole("textbox", { name: "Channel name" })).toHaveAttribute(
      "id",
      expect.stringContaining("channel-identity-name-"),
    );

    // Category is a Radix Select trigger: its accessible name comes from the
    // selected value content, with the visible "Category" label adjacent in
    // reading order but not programmatically associated.
    const categoryTrigger = within(dialog).getByRole("combobox");
    expect(categoryTrigger).toHaveTextContent("Marketplace");

    // Stable key is read-only with its description; the visible label is
    // adjacent text rather than a programmatic association.
    const keyInput = within(dialog).getByDisplayValue("delivery-a");
    expect(keyInput).toHaveAttribute("readonly");
    expect(within(dialog).getByText("This identity is permanent.")).toBeInTheDocument();
  });
});

describe("fixture record spot checks", () => {
  it("keeps the Barsha/Deira outlet identities used by the mapping cases", () => {
    expect(BRANCH_BARSHA.id).toBe(BRANCH_BARSHA_ID);
    expect(BRANCH_DEIRA.id).toBe(BRANCH_DEIRA_ID);
    expect(MAPPING_A_BARSHA.branch_id).toBe(BRANCH_BARSHA_ID);
    expect(MAPPING_A_DEIRA.branch_id).toBe(BRANCH_DEIRA_ID);
    expect(MAPPING_B_BARSHA.status).toBe("active");
    expect(MAPPING_B_DEIRA.status).toBe("inactive");
    expect(CHANNEL_B.display_name).toBe("Delivery B");
    expect(CHANNEL_DIRECT.category).toBe("owned_digital");
    expect(bandRecord(CHANNEL_ID_INSTORE, {}).findings).toEqual([]);
  });
});
