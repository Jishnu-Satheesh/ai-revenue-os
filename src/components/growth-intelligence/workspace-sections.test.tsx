// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { InsightsList } from "@/components/growth-intelligence/insights-list";
import { PriorityActions } from "@/components/growth-intelligence/priority-actions";
import type {
  DataGapCard,
  InsightCard,
  OpportunityCard,
  RecommendationCard,
} from "@/modules/growth-intelligence/application/read-model";

const ORGANIZATION = "10000000-0000-4000-8000-000000000001";
const CHANNEL = "61000000-0000-4000-8000-000000000061";

const base = {
  detail: "Detail.",
  generatedAt: "2026-09-01T08:00:00.000Z",
  evidenceWindow: { start: "2026-08-01", end: "2026-08-31" },
  marketObservedAt: null,
  decision: null,
  decidedAt: null,
  snoozedUntil: null,
  pinned: false,
  carriedOver: false,
  ageLabel: null,
  itemFingerprint: null,
} as const;

function opportunityCard(): OpportunityCard {
  return {
    ...base,
    id: "50000000-0000-4000-8000-000000000005",
    source: { kind: "opportunity", id: "50000000-0000-4000-8000-000000000005" },
    title: "Shift budget",
    actionKey: "campaign.meta_bundle_v1",
    status: "proposed",
    expiresAt: "2026-10-01T00:00:00.000Z",
    evidenceTier: "computed",
    impactLowMinor: 100_00,
    impactHighMinor: 400_00,
    expectedContributionMinor: 300_00,
    executionCostMinor: 50_00,
    currency: "AED",
    timeToImpactDays: 14,
    version: 1,
    draftRequest: null,
  };
}

function recommendationCard(): RecommendationCard {
  return {
    ...base,
    id: "60000000-0000-4000-8000-000000000006",
    source: { kind: "channel_recommendation", id: "60000000-0000-4000-8000-000000000006" },
    title: "Extend Friday hours",
    channelId: CHANNEL,
    branchId: null,
    myFeedback: null,
    supportedActions: [],
    limitations: [],
  };
}

function insightCard(): InsightCard {
  return {
    ...recommendationCard(),
    id: "70000000-0000-4000-8000-000000000007",
    source: { kind: "synthesized_item", id: "70000000-0000-4000-8000-000000000007" },
    title: "Rainy Thursdays spike delivery",
    channelId: null,
    supportGrade: "corroborated",
    freshness: "current",
    urgency: "high",
  };
}

function gapCard(): DataGapCard {
  return {
    ...recommendationCard(),
    id: "71000000-0000-4000-8000-000000000071",
    title: "August delivery costs never arrived",
    missingInput: "delivery costs",
    channelId: CHANNEL,
  };
}

const shared = { organizationId: ORGANIZATION, timeZone: "Asia/Dubai", canManage: true };

describe("workspace sections", () => {
  afterEach(() => cleanup());

  it("separates platform opportunities from operator recommendations", () => {
    render(
      <PriorityActions
        opportunities={[opportunityCard()]}
        recommendations={[recommendationCard()]}
        {...shared}
      />,
    );
    expect(screen.getByText("Platform opportunities")).toBeTruthy();
    expect(screen.getByText("Operator recommendations")).toBeTruthy();
    expect(screen.getByText(/Shift budget/)).toBeTruthy();
    expect(screen.getByText(/Extend Friday hours/)).toBeTruthy();
    // The full tab renders the same prototype card as the preview; Why this
    // waits inside the card expander.
    fireEvent.click(screen.getByRole("button", { name: "Read more" }));
    expect(screen.getByRole("button", { name: /Why this/ })).toBeTruthy();
  });

  it("matches the prototype preview: recommendations only, no opportunities lane", () => {
    render(
      <PriorityActions
        opportunities={[opportunityCard()]}
        recommendations={[recommendationCard()]}
        {...shared}
        hideHeading
      />,
    );
    expect(screen.queryByText("Platform opportunities")).toBeNull();
    expect(screen.queryByText(/No open platform opportunities/)).toBeNull();
    expect(screen.queryByText(/Shift budget/)).toBeNull();
    expect(screen.getByText(/Extend Friday hours/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Read more" }));
    expect(screen.getByRole("button", { name: /Why this/ })).toBeTruthy();
    cleanup();
    render(<PriorityActions opportunities={[]} recommendations={[]} {...shared} hideHeading />);
    expect(screen.getByText(/reviewed all current recommendations/)).toBeTruthy();
  });

  it("names empty lanes instead of leaving blank gaps", () => {
    render(<PriorityActions opportunities={[]} recommendations={[]} {...shared} />);
    expect(screen.getByText(/No open platform opportunities/)).toBeTruthy();
    expect(screen.getByText(/No operator recommendations/)).toBeTruthy();
    render(<InsightsList insights={[]} dataGaps={[]} organizationId={ORGANIZATION} timeZone="Asia/Dubai" />);
    expect(screen.getByText(/No insights for this month/)).toBeTruthy();
    expect(screen.getByText(/No missing evidence/)).toBeTruthy();
  });

  it("lists insight rows with evidence links and gaps in the improve rail", () => {
    render(
      <InsightsList
        insights={[insightCard()]}
        dataGaps={[gapCard()]}
        organizationId={ORGANIZATION}
        timeZone="Asia/Dubai"
      />,
    );
    expect(screen.getByText(/Rainy Thursdays/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /inspect evidence/i })).toHaveAttribute(
      "href",
      `/organizations/${ORGANIZATION}/channels`,
    );
    expect(screen.getByText("Improve the next report")).toBeTruthy();
    expect(screen.getByRole("link", { name: /august delivery costs/i })).toHaveAttribute(
      "href",
      `/organizations/${ORGANIZATION}/channels/${CHANNEL}`,
    );
    // A single gap needs no overflow drawer.
    expect(screen.queryByRole("button", { name: /review missing context/i })).toBeNull();
  });

  it("caps the improve rail at three items with the rest behind Review missing context", () => {
    const gaps = [0, 1, 2, 3].map((index) => ({
      ...gapCard(),
      id: `71000000-0000-4000-8000-00000000007${index}`,
      title: `Gap ${index}`,
    }));
    render(
      <InsightsList
        insights={[]}
        dataGaps={gaps}
        organizationId={ORGANIZATION}
        timeZone="Asia/Dubai"
      />,
    );
    expect(screen.getByText("Gap 0")).toBeTruthy();
    expect(screen.getByText("Gap 2")).toBeTruthy();
    expect(screen.queryByText("Gap 3")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /review missing context/i }));
    const drawer = screen.getByRole("dialog", { name: "Improve the next report" });
    expect(within(drawer).getByText("Gap 3")).toBeTruthy();
    expect(within(drawer).getByText("Business context")).toBeTruthy();
    // Footer Close is first; the sheet's corner X comes after the content.
    fireEvent.click(within(drawer).getAllByRole("button", { name: "Close" })[0]);
  });
});
