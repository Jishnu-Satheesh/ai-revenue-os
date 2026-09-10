// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { DataGaps } from "@/components/growth-intelligence/data-gaps";
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
  });

  it("names empty lanes instead of leaving blank gaps", () => {
    render(<PriorityActions opportunities={[]} recommendations={[]} {...shared} />);
    expect(screen.getByText(/No open platform opportunities/)).toBeTruthy();
    expect(screen.getByText(/No operator recommendations/)).toBeTruthy();
    render(<InsightsList insights={[]} {...shared} />);
    expect(screen.getByText(/No insights for this month/)).toBeTruthy();
    render(<DataGaps dataGaps={[]} {...shared} />);
    expect(screen.getByText(/No missing evidence/)).toBeTruthy();
  });

  it("lists insights and data gaps with their repair paths", () => {
    render(<InsightsList insights={[insightCard()]} {...shared} />);
    expect(screen.getByText(/Rainy Thursdays/)).toBeTruthy();
    cleanup();
    render(<DataGaps dataGaps={[gapCard()]} {...shared} />);
    expect(screen.getByRole("link", { name: "Repair in channels" })).toHaveAttribute(
      "href",
      `/organizations/${ORGANIZATION}/channels/${CHANNEL}`,
    );
  });
});
