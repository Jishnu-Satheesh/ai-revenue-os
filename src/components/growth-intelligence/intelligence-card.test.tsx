// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { IntelligenceCard } from "@/components/growth-intelligence/intelligence-card";
import type {
  DataGapCard,
  InsightCard,
  OpportunityCard,
  RecommendationCard,
} from "@/modules/growth-intelligence/application/read-model";

const ORGANIZATION = "10000000-0000-4000-8000-000000000001";

function opportunityCard(overrides: Partial<OpportunityCard> = {}): OpportunityCard {
  return {
    id: "50000000-0000-4000-8000-000000000005",
    source: { kind: "opportunity", id: "50000000-0000-4000-8000-000000000005" },
    title: "Shift budget to the winning channel",
    detail: "Move spend where the evidence already points.",
    generatedAt: "2026-09-01T07:00:00.000Z",
    evidenceWindow: null,
    marketObservedAt: null,
    decision: null,
    decidedAt: null,
    snoozedUntil: null,
    pinned: false,
    carriedOver: false,
    ageLabel: null,
    draftRequest: null,
    actionKey: "campaign.governed_draft_v1",
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
    ...overrides,
  };
}

function recommendationCard(overrides: Partial<RecommendationCard> = {}): RecommendationCard {
  return {
    id: "60000000-0000-4000-8000-000000000006",
    source: { kind: "channel_recommendation", id: "60000000-0000-4000-8000-000000000006" },
    title: "Extend Friday hours",
    detail: "Friday evenings carry the week's strongest observed demand.",
    generatedAt: "2026-09-01T08:00:00.000Z",
    evidenceWindow: { start: "2026-08-01", end: "2026-08-31" },
    marketObservedAt: null,
    decision: null,
    decidedAt: null,
    snoozedUntil: null,
    pinned: false,
    carriedOver: false,
    ageLabel: null,
    channelId: "61000000-0000-4000-8000-000000000061",
    branchId: null,
    ...overrides,
  };
}

describe("IntelligenceCard", () => {
  afterEach(() => cleanup());

  it("shows an opportunity range as a pair with its tier, never one number", () => {
    render(
      <IntelligenceCard
        card={opportunityCard()}
        organizationId={ORGANIZATION}
        timeZone="Asia/Dubai"
        canManage
      />,
    );
    expect(screen.getByText(/Shift budget to the winning channel/)).toBeTruthy();
    // The pair reads as an estimate; a lone headline figure would read as a promise.
    expect(screen.getByText(/100.*400|AED 100.*AED 400/)).toBeTruthy();
    expect(screen.getByText(/From your data/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("carries the draft action instead of any approval control", () => {
    render(
      <IntelligenceCard
        card={opportunityCard()}
        organizationId={ORGANIZATION}
        timeZone="Asia/Dubai"
        canManage
      />,
    );
    expect(screen.getByRole("button", { name: "Create governed draft" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("shows a standing snooze with its horizon on a recommendation", () => {
    render(
      <IntelligenceCard
        card={recommendationCard({
          decision: "snoozed",
          decidedAt: "2026-09-02T08:00:00.000Z",
          snoozedUntil: "2026-09-20T00:00:00.000Z",
        })}
        organizationId={ORGANIZATION}
        timeZone="Asia/Dubai"
        canManage
      />,
    );
    expect(screen.getByText(/Snoozed/)).toBeTruthy();
    const horizon = new Date("2026-09-20T00:00:00.000Z").toLocaleDateString("en-AE", {
      timeZone: "Asia/Dubai",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    expect(
      screen.getByText(new RegExp(horizon.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))),
    ).toBeTruthy();
  });

  it("sends a viewer to the owning surface with words, never a control", () => {
    const { container } = render(
      <IntelligenceCard
        card={recommendationCard()}
        organizationId={ORGANIZATION}
        timeZone="Asia/Dubai"
        canManage={false}
      />,
    );
    expect(container.querySelector("button")).toBeNull();
    expect(screen.getByRole("link", { name: /channel workspace/i })).toBeTruthy();
  });

  it("links a data gap to its repair surface with the missing input named", () => {
    const gap: DataGapCard = {
      ...recommendationCard(),
      source: { kind: "channel_recommendation", id: "60000000-0000-4000-8000-000000000006" },
      title: "August delivery costs never arrived",
      detail: "Margin cannot be proven without them.",
      missingInput: "delivery costs",
      channelId: "61000000-0000-4000-8000-000000000061",
    };
    render(
      <IntelligenceCard card={gap} organizationId={ORGANIZATION} timeZone="Asia/Dubai" canManage />,
    );
    expect(screen.getByText("delivery costs")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Repair in channels" })).toHaveAttribute(
      "href",
      `/organizations/${ORGANIZATION}/channels/61000000-0000-4000-8000-000000000061`,
    );
  });

  it("shows an insight grade without inventing a score", () => {
    const insight: InsightCard = {
      ...recommendationCard(),
      source: { kind: "synthesized_item", id: "70000000-0000-4000-8000-000000000007" },
      supportGrade: "corroborated",
      freshness: "current",
      urgency: "high",
    };
    render(
      <IntelligenceCard
        card={insight}
        organizationId={ORGANIZATION}
        timeZone="Asia/Dubai"
        canManage
      />,
    );
    expect(screen.getByText(/corroborated/i)).toBeTruthy();
    expect(screen.queryByText(/[0-9]+\/100|[0-9]+%/)).toBeNull();
  });
});
