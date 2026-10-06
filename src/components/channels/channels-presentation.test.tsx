// @vitest-environment jsdom
/**
 * Task 1 — presentation-derivation contracts for the Channels landing.
 *
 * Fixtures use the integer minor-unit amounts from implementation plan §7.
 * Nothing here imports `.superdesign` fixtures into the test graph: every
 * record is built literally below, shaped like the current
 * `OrganizationChannelRow` / `ChannelsOverviewRow` types.
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChannelIcon } from "@/components/channels/channel-icons";
import {
  buildChannelsPortfolioPresentation,
  countChannelDirectoryFilters,
  formatChannelsWindowOption,
  labelForChannelCategory,
  parseChannelsDateRange,
  parseChannelsWindow,
  selectChannelDirectoryRows,
} from "@/components/channels/channels-presentation";
import type {
  ChannelsOverviewRow,
  ChannelsOverviewView,
  ChannelsOverviewWindow,
} from "@/modules/analysis/application/channels-overview";
import type { OrganizationChannelRow } from "@/modules/channels/application/ports";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "33333333-3333-4333-8333-333333333333";

const FEBRUARY_WINDOW: ChannelsOverviewWindow = {
  windowStart: "2026-02-01",
  windowEnd: "2026-02-28",
  grain: "month",
  label: "2026-02-01 to 2026-02-28",
  value: "2026-02-01..2026-02-28..month",
};

function overviewRow(
  idSuffix: string,
  displayName: string,
  status: string,
  band: ChannelsOverviewRow["band"],
): ChannelsOverviewRow {
  return {
    channelId: `22222222-2222-4222-8222-22222222${idSuffix}`,
    displayName,
    status,
    band,
    assessed: band.state === "complete",
  };
}

function overviewView(
  rows: readonly ChannelsOverviewRow[],
  totalPotentialMinorUnits = 12_000_000,
): ChannelsOverviewView {
  return {
    windows: [FEBRUARY_WINDOW],
    selectedWindow: FEBRUARY_WINDOW,
    // Deliberately the complete-only shared-model total: the presentation
    // must never read this as the all-reported sum.
    total: {
      potential: { minorUnits: totalPotentialMinorUnits, currency: "AED" },
      lost: { minorUnits: 600_000, currency: "AED" },
      earned: { minorUnits: 11_400_000, currency: "AED" },
    },
    coverage: {
      assessedCount: 2,
      channelCount: rows.length,
      revenueOnlyNames: ["Direct"],
      unassessedNames: ["In-store"],
    },
    refusalReason: null,
    rows,
  };
}

/** February §7 reference rows: A + B complete, Direct revenue-only, In-store refused. */
function februaryRows(): ChannelsOverviewRow[] {
  return [
    overviewRow("0001", "Delivery A", "active", {
      state: "complete",
      potential: { minorUnits: 8_000_000, currency: "AED" },
      lost: { minorUnits: 400_000, currency: "AED" },
      earned: { minorUnits: 7_600_000, currency: "AED" },
    }),
    overviewRow("0002", "Delivery B", "active", {
      state: "complete",
      potential: { minorUnits: 4_000_000, currency: "AED" },
      lost: { minorUnits: 200_000, currency: "AED" },
      earned: { minorUnits: 3_800_000, currency: "AED" },
    }),
    overviewRow("0003", "Direct", "active", {
      state: "revenue_only",
      potential: { minorUnits: 1_800_000, currency: "AED" },
      lost: null,
      earned: null,
    }),
    overviewRow("0004", "In-store", "active", {
      state: "refused",
      potential: null,
      lost: null,
      earned: null,
    }),
  ];
}

function channelRecord(
  idSuffix: string,
  displayName: string,
  overrides: Partial<OrganizationChannelRow> = {},
): OrganizationChannelRow {
  return {
    id: `22222222-2222-4222-8222-22222222${idSuffix}`,
    organization_id: ORGANIZATION_ID,
    key: displayName.toLowerCase().replace(/[^a-z0-9.-]+/g, "-"),
    display_name: displayName,
    category: "marketplace",
    template_key: null,
    status: "active",
    created_by: ACTOR_ID,
    archived_by: null,
    archived_at: null,
    created_at: "2026-08-20T00:00:00.000Z",
    updated_at: "2026-08-20T00:00:00.000Z",
    ...overrides,
  };
}

function deepFreeze(value: unknown): void {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const entry of Object.values(value)) deepFreeze(entry);
}

describe("buildChannelsPortfolioPresentation", () => {
  it("sums the February reference figures without reading view.total.potential", () => {
    const presentation = buildChannelsPortfolioPresentation(overviewView(februaryRows()));

    expect(presentation.reportedTotal).toEqual({ minorUnits: 13_800_000, currency: "AED" });
    expect(presentation.earnedTotal).toEqual({ minorUnits: 11_400_000, currency: "AED" });
    expect(presentation.lostTotal).toEqual({ minorUnits: 600_000, currency: "AED" });
    expect(presentation.activeCount).toBe(4);
    expect(presentation.reportedCount).toBe(3);
    expect(presentation.completeCount).toBe(2);
    expect(presentation.revenueOnlyCount).toBe(1);
    expect(presentation.refusedCount).toBe(1);
    expect(presentation.comparisonCurrency).toBe("AED");
    expect(presentation.comparisonReason).toBeNull();
    expect(presentation.earnedReason).toBeNull();
    expect(presentation.rows).toHaveLength(4);
  });

  it("excludes archived rows even when they carry nonzero money", () => {
    const archivedMoney = overviewRow("0005", "Previous", "archived", {
      state: "complete",
      potential: { minorUnits: 5_000_000, currency: "AED" },
      lost: { minorUnits: 500_000, currency: "AED" },
      earned: { minorUnits: 4_500_000, currency: "AED" },
    });
    const presentation = buildChannelsPortfolioPresentation(
      overviewView([...februaryRows(), archivedMoney]),
    );

    expect(presentation.reportedTotal).toEqual({ minorUnits: 13_800_000, currency: "AED" });
    expect(presentation.earnedTotal).toEqual({ minorUnits: 11_400_000, currency: "AED" });
    expect(presentation.lostTotal).toEqual({ minorUnits: 600_000, currency: "AED" });
    expect(presentation.activeCount).toBe(4);
    expect(presentation.rows.every((row) => row.status === "active")).toBe(true);
  });

  it("returns null totals with reasons when no active rows exist", () => {
    const presentation = buildChannelsPortfolioPresentation(overviewView([]));

    expect(presentation.reportedTotal).toBeNull();
    expect(presentation.earnedTotal).toBeNull();
    expect(presentation.lostTotal).toBeNull();
    expect(presentation.activeCount).toBe(0);
    expect(presentation.reportedCount).toBe(0);
    expect(presentation.comparisonCurrency).toBeNull();
    expect(presentation.comparisonReason).not.toBeNull();
    expect(presentation.earnedReason).not.toBeNull();
  });

  it("keeps a recorded zero as a genuine zero, with share unavailable", () => {
    const rows = [
      overviewRow("0001", "Delivery A", "active", {
        state: "complete",
        potential: { minorUnits: 0, currency: "AED" },
        lost: { minorUnits: 0, currency: "AED" },
        earned: { minorUnits: 0, currency: "AED" },
      }),
    ];
    const presentation = buildChannelsPortfolioPresentation(overviewView(rows));

    expect(presentation.reportedTotal).toEqual({ minorUnits: 0, currency: "AED" });
    expect(presentation.earnedTotal).toEqual({ minorUnits: 0, currency: "AED" });
    expect(presentation.reportedCount).toBe(1);
    expect(presentation.comparisonCurrency).toBe("AED");
    expect(presentation.comparisonReason).toMatch(/zero/i);
  });

  it("refuses every total when complete bands mix currencies", () => {
    const rows = [
      overviewRow("0001", "Delivery A", "active", {
        state: "complete",
        potential: { minorUnits: 8_000_000, currency: "AED" },
        lost: { minorUnits: 400_000, currency: "AED" },
        earned: { minorUnits: 7_600_000, currency: "AED" },
      }),
      overviewRow("0002", "Delivery B", "active", {
        state: "complete",
        potential: { minorUnits: 4_000_000, currency: "USD" },
        lost: { minorUnits: 200_000, currency: "USD" },
        earned: { minorUnits: 3_800_000, currency: "USD" },
      }),
    ];
    const presentation = buildChannelsPortfolioPresentation(overviewView(rows));

    expect(presentation.reportedTotal).toBeNull();
    expect(presentation.earnedTotal).toBeNull();
    expect(presentation.lostTotal).toBeNull();
    expect(presentation.comparisonCurrency).toBeNull();
    expect(presentation.comparisonReason).toMatch(/currenc/i);
    expect(presentation.earnedReason).toMatch(/currenc/i);
  });

  it("keeps the AED earned subtotal when only the revenue-only row is foreign", () => {
    const rows = [
      overviewRow("0001", "Delivery A", "active", {
        state: "complete",
        potential: { minorUnits: 8_000_000, currency: "AED" },
        lost: { minorUnits: 400_000, currency: "AED" },
        earned: { minorUnits: 7_600_000, currency: "AED" },
      }),
      overviewRow("0003", "Direct", "active", {
        state: "revenue_only",
        potential: { minorUnits: 1_800_000, currency: "USD" },
        lost: null,
        earned: null,
      }),
    ];
    const presentation = buildChannelsPortfolioPresentation(overviewView(rows));

    expect(presentation.reportedTotal).toBeNull();
    expect(presentation.comparisonCurrency).toBeNull();
    expect(presentation.comparisonReason).toMatch(/currenc/i);
    expect(presentation.earnedTotal).toEqual({ minorUnits: 7_600_000, currency: "AED" });
    expect(presentation.lostTotal).toEqual({ minorUnits: 400_000, currency: "AED" });
    expect(presentation.earnedReason).toBeNull();
  });

  it("refuses totals when a contributing figure has an empty currency", () => {
    const rows = [
      overviewRow("0001", "Delivery A", "active", {
        state: "complete",
        potential: { minorUnits: 8_000_000, currency: "" },
        lost: { minorUnits: 400_000, currency: "" },
        earned: { minorUnits: 7_600_000, currency: "" },
      }),
    ];
    const presentation = buildChannelsPortfolioPresentation(overviewView(rows));

    expect(presentation.reportedTotal).toBeNull();
    expect(presentation.earnedTotal).toBeNull();
    expect(presentation.comparisonCurrency).toBeNull();
    expect(presentation.comparisonReason).toMatch(/currency/i);
  });

  it("keeps negative adjustments signed and marks share unavailable", () => {
    const rows = [
      overviewRow("0001", "Delivery A", "active", {
        state: "complete",
        potential: { minorUnits: 8_000_000, currency: "AED" },
        lost: { minorUnits: 400_000, currency: "AED" },
        earned: { minorUnits: 7_600_000, currency: "AED" },
      }),
      overviewRow("0003", "Direct", "active", {
        state: "revenue_only",
        potential: { minorUnits: -500_000, currency: "AED" },
        lost: null,
        earned: null,
      }),
    ];
    const presentation = buildChannelsPortfolioPresentation(overviewView(rows));

    expect(presentation.reportedTotal).toEqual({ minorUnits: 7_500_000, currency: "AED" });
    expect(presentation.comparisonReason).toMatch(/signed/i);
  });

  it("refuses the aggregate instead of rounding an unsafe sum", () => {
    const rows = [
      overviewRow("0001", "Delivery A", "active", {
        state: "revenue_only",
        potential: { minorUnits: Number.MAX_SAFE_INTEGER, currency: "AED" },
        lost: null,
        earned: null,
      }),
      overviewRow("0003", "Direct", "active", {
        state: "revenue_only",
        potential: { minorUnits: 1, currency: "AED" },
        lost: null,
        earned: null,
      }),
    ];
    const presentation = buildChannelsPortfolioPresentation(overviewView(rows));

    expect(presentation.reportedTotal).toBeNull();
    expect(presentation.comparisonReason).toMatch(/safe/i);
  });

  it("sums non-decimal currencies in minor units without conversion", () => {
    const rows = [
      overviewRow("0001", "Tokyo", "active", {
        state: "revenue_only",
        potential: { minorUnits: 12_345, currency: "JPY" },
        lost: null,
        earned: null,
      }),
      overviewRow("0002", "Osaka", "active", {
        state: "revenue_only",
        potential: { minorUnits: 5_000, currency: "JPY" },
        lost: null,
        earned: null,
      }),
    ];
    const presentation = buildChannelsPortfolioPresentation(overviewView(rows, 0));

    expect(presentation.reportedTotal).toEqual({ minorUnits: 17_345, currency: "JPY" });
    expect(presentation.comparisonCurrency).toBe("JPY");
  });

  it("keeps three-exponent currencies exact in every total", () => {
    const rows = [
      overviewRow("0001", "Manama", "active", {
        state: "complete",
        potential: { minorUnits: 12_345, currency: "BHD" },
        lost: { minorUnits: 345, currency: "BHD" },
        earned: { minorUnits: 12_000, currency: "BHD" },
      }),
    ];
    const presentation = buildChannelsPortfolioPresentation(overviewView(rows, 12_345));

    expect(presentation.reportedTotal).toEqual({ minorUnits: 12_345, currency: "BHD" });
    expect(presentation.earnedTotal).toEqual({ minorUnits: 12_000, currency: "BHD" });
    expect(presentation.lostTotal).toEqual({ minorUnits: 345, currency: "BHD" });
  });

  it("reports null earned and lost when only revenue-only bands exist", () => {
    const rows = [
      overviewRow("0003", "Direct", "active", {
        state: "revenue_only",
        potential: { minorUnits: 1_800_000, currency: "AED" },
        lost: null,
        earned: null,
      }),
    ];
    const presentation = buildChannelsPortfolioPresentation(overviewView(rows, 0));

    expect(presentation.reportedTotal).toEqual({ minorUnits: 1_800_000, currency: "AED" });
    expect(presentation.earnedTotal).toBeNull();
    expect(presentation.lostTotal).toBeNull();
    expect(presentation.completeCount).toBe(0);
    expect(presentation.earnedReason).not.toBeNull();
  });

  it("never mutates the supplied view", () => {
    const view = overviewView(februaryRows());
    deepFreeze(view);

    expect(() => buildChannelsPortfolioPresentation(view)).not.toThrow();
    expect(view.rows).toHaveLength(4);
    expect(view.total.potential).toEqual({ minorUnits: 12_000_000, currency: "AED" });
  });
});

describe("parseChannelsWindow", () => {
  it("parses the February month value", () => {
    expect(parseChannelsWindow("2026-02-01..2026-02-28..month")).toEqual({
      windowStart: "2026-02-01",
      windowEnd: "2026-02-28",
      grain: "month",
    });
  });

  it("parses a valid span value", () => {
    expect(parseChannelsWindow("2026-03-01..2026-03-31..span")).toEqual({
      windowStart: "2026-03-01",
      windowEnd: "2026-03-31",
      grain: "span",
    });
  });

  it("rejects an invalid date", () => {
    expect(parseChannelsWindow("2026-13-40..2026-02-28..month")).toBeNull();
    expect(parseChannelsWindow("2026-02-30..2026-02-28..month")).toBeNull();
    expect(parseChannelsWindow("not-a-date..2026-02-28..month")).toBeNull();
  });

  it("rejects reversed dates", () => {
    expect(parseChannelsWindow("2026-02-28..2026-02-01..month")).toBeNull();
  });

  it("rejects extra delimiter segments and empty segments", () => {
    expect(parseChannelsWindow("2026-02-01..2026-02-28..month..extra")).toBeNull();
    expect(parseChannelsWindow("..2026-02-28..month")).toBeNull();
    expect(parseChannelsWindow("2026-02-01....month")).toBeNull();
    expect(parseChannelsWindow(undefined)).toBeNull();
    expect(parseChannelsWindow("")).toBeNull();
  });

  it("rejects unknown grains", () => {
    expect(parseChannelsWindow("2026-02-01..2026-02-28..year")).toBeNull();
    expect(parseChannelsWindow("2026-02-01..2026-02-28..")).toBeNull();
  });
});

describe("parseChannelsDateRange", () => {
  it("parses a free from/to range for the picker", () => {
    expect(parseChannelsDateRange("2026-02-01", "2026-02-28")).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
  });

  it("rejects a free range with missing or malformed ends", () => {
    expect(parseChannelsDateRange(undefined, "2026-02-28")).toBeNull();
    expect(parseChannelsDateRange("2026-02-01", undefined)).toBeNull();
    expect(parseChannelsDateRange("2026-13-40", "2026-02-28")).toBeNull();
    expect(parseChannelsDateRange("2026-02-01", "not-a-date")).toBeNull();
  });

  it("rejects a free range that ends before it starts", () => {
    expect(parseChannelsDateRange("2026-02-28", "2026-02-01")).toBeNull();
  });
});

describe("formatChannelsWindowOption", () => {
  const january: ChannelsOverviewWindow = {
    windowStart: "2026-01-01",
    windowEnd: "2026-01-31",
    grain: "month",
    label: "2026-01-01 to 2026-01-31",
    value: "2026-01-01..2026-01-31..month",
  };
  const february: ChannelsOverviewWindow = {
    windowStart: "2026-02-01",
    windowEnd: "2026-02-28",
    grain: "month",
    label: "2026-02-01 to 2026-02-28",
    value: "2026-02-01..2026-02-28..month",
  };

  it("labels a true full calendar month with its month name", () => {
    expect(formatChannelsWindowOption(february, [january, february])).toBe("February 2026");
  });

  it("labels a Jan–Feb span as a full range, never as February alone", () => {
    const span: ChannelsOverviewWindow = {
      windowStart: "2026-01-01",
      windowEnd: "2026-02-28",
      grain: "day",
      label: "2026-01-01 to 2026-02-28",
      value: "2026-01-01..2026-02-28..day",
    };
    expect(formatChannelsWindowOption(span, [january, february, span])).toBe(
      "1 Jan 2026 – 28 Feb 2026",
    );
  });

  it("keeps two March windows distinct and preserves their values", () => {
    const marchMonth: ChannelsOverviewWindow = {
      windowStart: "2026-03-01",
      windowEnd: "2026-03-31",
      grain: "month",
      label: "2026-03-01 to 2026-03-31",
      value: "2026-03-01..2026-03-31..month",
    };
    const marchWeek: ChannelsOverviewWindow = {
      windowStart: "2026-03-02",
      windowEnd: "2026-03-08",
      grain: "week",
      label: "2026-03-02 to 2026-03-08",
      value: "2026-03-02..2026-03-08..week",
    };
    expect(formatChannelsWindowOption(marchMonth, [marchMonth, marchWeek])).toBe("March 2026");
    expect(formatChannelsWindowOption(marchWeek, [marchMonth, marchWeek])).toBe(
      "2 Mar 2026 – 8 Mar 2026",
    );
    expect(marchMonth.value).toBe("2026-03-01..2026-03-31..month");
    expect(marchWeek.value).toBe("2026-03-02..2026-03-08..week");
  });

  it("appends the grain when the same range exists at two grains", () => {
    const month: ChannelsOverviewWindow = {
      windowStart: "2026-03-01",
      windowEnd: "2026-03-31",
      grain: "month",
      label: "2026-03-01 to 2026-03-31",
      value: "2026-03-01..2026-03-31..month",
    };
    const span: ChannelsOverviewWindow = {
      windowStart: "2026-03-01",
      windowEnd: "2026-03-31",
      grain: "span",
      label: "2026-03-01 to 2026-03-31",
      value: "2026-03-01..2026-03-31..span",
    };
    const monthLabel = formatChannelsWindowOption(month, [month, span]);
    const spanLabel = formatChannelsWindowOption(span, [month, span]);
    expect(monthLabel).not.toBe(spanLabel);
    expect(monthLabel).toContain("month");
    expect(spanLabel).toContain("span");
  });
});

describe("selectChannelDirectoryRows", () => {
  const rows = februaryRows();
  const analysis = { state: "ready" as const, view: overviewView(rows) };
  const channels = [
    channelRecord("0001", "Delivery A"),
    channelRecord("0002", "Delivery B"),
    channelRecord("0003", "Direct", { category: "owned_digital" }),
    channelRecord("0004", "In-store", { category: "physical" }),
    channelRecord("0005", "Previous", { status: "archived" }),
  ];

  it("excludes archived records from the active filter", () => {
    const selected = selectChannelDirectoryRows({
      channels,
      analysis,
      query: "",
      filter: "active",
      sort: "descending",
    });
    expect(selected.map((channel) => channel.display_name)).toEqual([
      "Delivery A",
      "Delivery B",
      "Direct",
      "In-store",
    ]);
  });

  it("splits measured and needs-attention by band state", () => {
    const measured = selectChannelDirectoryRows({
      channels,
      analysis,
      query: "",
      filter: "measured",
      sort: "descending",
    });
    expect(measured.map((channel) => channel.display_name)).toEqual(["Delivery A", "Delivery B"]);

    const attention = selectChannelDirectoryRows({
      channels,
      analysis,
      query: "",
      filter: "attention",
      sort: "descending",
    });
    expect(attention.map((channel) => channel.display_name)).toEqual(["Direct", "In-store"]);
  });

  it("searches names case-insensitively and trims the query", () => {
    const selected = selectChannelDirectoryRows({
      channels,
      analysis,
      query: "  direct ",
      filter: "active",
      sort: "descending",
    });
    expect(selected.map((channel) => channel.display_name)).toEqual(["Direct"]);
  });

  it("sorts reported revenue descending with unknowns last", () => {
    const selected = selectChannelDirectoryRows({
      channels,
      analysis,
      query: "",
      filter: "active",
      sort: "descending",
    });
    // 8,000,000 then 4,000,000 then 1,800,000, refused last.
    expect(selected.map((channel) => channel.display_name)).toEqual([
      "Delivery A",
      "Delivery B",
      "Direct",
      "In-store",
    ]);
  });
});

describe("countChannelDirectoryFilters", () => {
  const rows = februaryRows();
  const analysis = { state: "ready" as const, view: overviewView(rows) };
  const channels = [
    channelRecord("0001", "Delivery A"),
    channelRecord("0002", "Delivery B"),
    channelRecord("0003", "Direct", { category: "owned_digital" }),
    channelRecord("0004", "In-store", { category: "physical" }),
    channelRecord("0005", "Previous", { status: "archived" }),
  ];

  it("counts every state before search, with attention covering revenue-only and refused", () => {
    expect(countChannelDirectoryFilters({ channels, analysis })).toEqual({
      active: 4,
      measured: 2,
      attention: 2,
      archived: 1,
    });
  });

  it("counts zero evidence states without a ready view instead of failing every channel", () => {
    expect(countChannelDirectoryFilters({ channels, analysis: { state: "disabled" } })).toEqual({
      active: 4,
      measured: 0,
      attention: 0,
      archived: 1,
    });
    expect(countChannelDirectoryFilters({ channels, analysis: { state: "unavailable" } })).toEqual({
      active: 4,
      measured: 0,
      attention: 0,
      archived: 1,
    });
  });
});

describe("labelForChannelCategory", () => {
  it("returns the exact V09 display strings", () => {
    expect(labelForChannelCategory("marketplace")).toBe("Marketplace");
    expect(labelForChannelCategory("owned_digital")).toBe("Owned digital");
    expect(labelForChannelCategory("physical")).toBe("Physical");
    expect(labelForChannelCategory("reseller")).toBe("Reseller");
    expect(labelForChannelCategory("other")).toBe("Other");
  });

  it("searches the displayed label with its space, not only the raw value", () => {
    const rows = februaryRows();
    const analysis = { state: "ready" as const, view: overviewView(rows) };
    const channels = [
      channelRecord("0001", "Delivery A"),
      channelRecord("0003", "Direct", { category: "owned_digital" }),
    ];
    const selected = selectChannelDirectoryRows({
      channels,
      analysis,
      query: "owned digital",
      filter: "active",
      sort: "descending",
    });
    expect(selected.map((channel) => channel.display_name)).toEqual(["Direct"]);
  });
});

describe("ChannelIcon", () => {
  it("renders decorative vector icons with the recorded geometry", () => {
    const { container, rerender } = render(<ChannelIcon name="plus" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.innerHTML).toContain("M12 5v14M5 12h14");

    rerender(<ChannelIcon name="calendar" />);
    expect(container.querySelector("svg")?.innerHTML).toContain('width="18"');
  });
});
