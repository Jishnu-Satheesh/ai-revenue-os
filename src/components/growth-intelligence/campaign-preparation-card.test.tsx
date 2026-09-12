// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CampaignPreparationCard } from "@/components/growth-intelligence/campaign-preparation-card";
import type { OpportunityCard } from "@/modules/growth-intelligence/application/read-model";

const ORGANIZATION = "10000000-0000-4000-8000-000000000001";

function card(overrides: Partial<OpportunityCard> = {}): OpportunityCard {
  return {
    id: "50000000-0000-4000-8000-000000000005",
    source: { kind: "opportunity", id: "50000000-0000-4000-8000-000000000005" },
    title: "Introduce the updated lunch menu",
    detail: "Prepare a governed campaign draft.",
    generatedAt: "2026-03-01T08:00:00.000Z",
    evidenceWindow: null,
    marketObservedAt: null,
    decision: null,
    decidedAt: null,
    snoozedUntil: null,
    pinned: false,
    carriedOver: false,
    ageLabel: null,
    itemFingerprint: null,
    actionKey: "campaign.governed_draft_v1",
    status: "proposed",
    expiresAt: "2026-04-01T00:00:00.000Z",
    evidenceTier: "computed",
    impactLowMinor: 100_00,
    impactHighMinor: 400_00,
    expectedContributionMinor: 300_00,
    executionCostMinor: 50_00,
    currency: "AED",
    timeToImpactDays: 14,
    version: 1,
    draftRequest: null,
    ...overrides,
  };
}

describe("CampaignPreparationCard", () => {
  afterEach(() => cleanup());

  it("renders nothing when no opportunity carries a draft request", () => {
    const { container } = render(
      <CampaignPreparationCard
        opportunities={[card()]}
        organizationId={ORGANIZATION}
        timeZone="Asia/Dubai"
      />,
    );
    expect(container.textContent).toBe("");
  });

  it("explains a preparing draft and when its review link appears", () => {
    render(
      <CampaignPreparationCard
        opportunities={[
          card({
            draftRequest: {
              opportunityId: "50000000-0000-4000-8000-000000000005",
              status: "processing",
              campaignId: null,
              requestedAt: "2026-03-04T08:00:00.000Z",
              updatedAt: "2026-03-04T10:40:00.000Z",
            },
          }),
        ]}
        organizationId={ORGANIZATION}
        timeZone="Asia/Dubai"
      />,
    );
    expect(screen.getByText("Campaign preparation")).toBeTruthy();
    expect(screen.getByText("Preparing draft")).toBeTruthy();
    expect(screen.getByText(/review link will appear when it is ready/)).toBeTruthy();
  });

  it("links a ready draft to its real destination", () => {
    render(
      <CampaignPreparationCard
        opportunities={[
          card({
            draftRequest: {
              opportunityId: "50000000-0000-4000-8000-000000000005",
              status: "completed",
              campaignId: "40000000-0000-4000-8000-000000000004",
              requestedAt: "2026-03-04T08:00:00.000Z",
              updatedAt: "2026-03-04T10:40:00.000Z",
            },
          }),
        ]}
        organizationId={ORGANIZATION}
        timeZone="Asia/Dubai"
      />,
    );
    expect(screen.getByRole("link", { name: "Open draft" })).toHaveAttribute(
      "href",
      `/organizations/${ORGANIZATION}/campaigns/40000000-0000-4000-8000-000000000004`,
    );
  });

  it("names a retryable failure without claiming anything was created", () => {
    render(
      <CampaignPreparationCard
        opportunities={[
          card({
            draftRequest: {
              opportunityId: "50000000-0000-4000-8000-000000000005",
              status: "retryable_failed",
              campaignId: null,
              requestedAt: "2026-03-04T08:00:00.000Z",
              updatedAt: "2026-03-04T10:40:00.000Z",
            },
          }),
        ]}
        organizationId={ORGANIZATION}
        timeZone="Asia/Dubai"
      />,
    );
    expect(screen.getByText("Needs retry")).toBeTruthy();
    expect(screen.getByText(/nothing was created/)).toBeTruthy();
  });

  it("names terminal failures honestly", () => {
    render(
      <CampaignPreparationCard
        opportunities={[
          card({
            draftRequest: {
              opportunityId: "50000000-0000-4000-8000-000000000005",
              status: "permanent_failed",
              campaignId: null,
              requestedAt: "2026-03-04T08:00:00.000Z",
              updatedAt: "2026-03-04T10:40:00.000Z",
            },
          }),
        ]}
        organizationId={ORGANIZATION}
        timeZone="Asia/Dubai"
      />,
    );
    expect(screen.getByText("Could not prepare")).toBeTruthy();
  });

  it("never mislabels a completed draft with no stored link as a failure", () => {
    render(
      <CampaignPreparationCard
        opportunities={[
          card({
            draftRequest: {
              opportunityId: "50000000-0000-4000-8000-000000000005",
              status: "completed",
              campaignId: null,
              requestedAt: "2026-03-04T08:00:00.000Z",
              updatedAt: "2026-03-04T10:40:00.000Z",
            },
          }),
        ]}
        organizationId={ORGANIZATION}
        timeZone="Asia/Dubai"
      />,
    );
    expect(screen.getByText("Draft ready")).toBeTruthy();
    expect(screen.queryByText("Could not prepare")).toBeNull();
    expect(screen.getByText(/review link is unavailable/)).toBeTruthy();
  });

  it("names a cancelled request as cancelled", () => {
    render(
      <CampaignPreparationCard
        opportunities={[
          card({
            draftRequest: {
              opportunityId: "50000000-0000-4000-8000-000000000005",
              status: "cancelled",
              campaignId: null,
              requestedAt: "2026-03-04T08:00:00.000Z",
              updatedAt: "2026-03-04T10:40:00.000Z",
            },
          }),
        ]}
        organizationId={ORGANIZATION}
        timeZone="Asia/Dubai"
      />,
    );
    expect(screen.getByText("Cancelled")).toBeTruthy();
    expect(screen.getByText(/request was cancelled/)).toBeTruthy();
  });
});
