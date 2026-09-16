// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CampaignProposalSection } from "@/components/campaigns/campaign-proposal-card";
import { type CampaignProposalDocument } from "@/domain/campaigns/proposal";
import { proposalDigest } from "@/domain/campaigns/proposal-digest";
import {
  toProposalCard,
  type CampaignProposalCardView,
} from "@/modules/campaigns/application/proposal-read-model";

const ORGANIZATION = "11111111-1111-4111-8111-111111111111";
const MANIFEST = "33333333-3333-4333-8333-333333333333";
const PROPOSAL = "44444444-4444-4444-8444-444444444444";
const VERSION = "55555555-5555-4555-8555-555555555555";
const CAMPAIGN = "66666666-6666-4666-8666-666666666666";

afterEach(cleanup);

function document(overrides: Partial<CampaignProposalDocument> = {}): CampaignProposalDocument {
  return {
    schemaVersion: 1,
    title: "Weekday lunch footfall",
    businessProblem: "Weekday lunch covers are down against the same weeks last quarter.",
    objective: "acquisition",
    audience: "People working within a short walk.",
    offer: { kind: "no_offer" },
    channels: [
      { channelKey: "instagram", delivery: "organic" },
      { channelKey: "facebook", delivery: "organic" },
    ],
    deliverables: [{ format: "feed", language: "en", count: 3 }],
    timing: { startAt: "2026-09-20T00:00:00.000Z", endAt: null, timezone: "Asia/Dubai" },
    proposedMediaBudget: null,
    generationCostCeiling: { amountMinor: 8000, currency: "AED" },
    successPlan: {
      primaryMetricKey: "weekday_lunch_covers",
      baselineSource: "point_of_sale",
      baselineRevision: 4,
      baselineFrom: "2026-06-01T00:00:00.000Z",
      baselineTo: "2026-08-31T00:00:00.000Z",
      observationWindowDays: 28,
      reportingDelayDays: 2,
      settlementDelayDays: 7,
      measurementMethod: "pre_post_with_baseline",
      target: null,
      missingData: [],
    },
    pausePolicyRef: "default_pause_policy",
    evidence: [
      {
        kind: "business_memory_context",
        organizationId: ORGANIZATION,
        contextManifestId: MANIFEST,
        sourceRevision: 4,
        observedFrom: "2026-06-01T00:00:00.000Z",
        observedTo: "2026-08-31T00:00:00.000Z",
        supports: "internal_fact",
      },
    ],
    memoryContextManifestId: MANIFEST,
    assumptions: ["Lunch capacity is not the constraint."],
    limitations: [],
    readiness: { canPrepare: true, canLaunch: false, blockers: [] },
    ...overrides,
  };
}

function card(input: {
  state?: string;
  document?: CampaignProposalDocument;
  storedDocument?: unknown;
  currentVersionId?: string | null;
  linkedCampaignId?: string | null;
} = {}): CampaignProposalCardView {
  const stored = input.document ?? document();
  const currentVersionId = input.currentVersionId === undefined ? VERSION : input.currentVersionId;
  const built = toProposalCard({
    proposal: {
      id: PROPOSAL,
      sourceKind: "business_signal",
      sourceId: null,
      state: input.state ?? "ready_for_review",
      currentVersionId,
      linkedCampaignId: input.linkedCampaignId ?? null,
      snoozedUntil: null,
      createdAt: "2026-09-14T08:00:00.000Z",
      updatedAt: "2026-09-15T08:00:00.000Z",
    },
    version:
      currentVersionId === null
        ? null
        : {
            id: VERSION,
            proposalId: PROPOSAL,
            version: 2,
            document: input.storedDocument === undefined ? stored : input.storedDocument,
            digest: proposalDigest(stored),
            createdAt: "2026-09-15T07:00:00.000Z",
          },
    decisions: [],
  });
  if (built === null) throw new Error("The fixture did not build a card.");
  return built;
}

function renderSection(proposals: readonly CampaignProposalCardView[]) {
  render(
    <CampaignProposalSection
      proposals={proposals}
      organizationId={ORGANIZATION}
      timeZone="Asia/Dubai"
    />,
  );
}

describe("campaign-ready opportunities", () => {
  it("is named separately from ordinary recommendations", () => {
    renderSection([card()]);

    // A recommendation is advice someone acts on themselves; this is a request
    // to authorize preparing a campaign. They must not read as one queue.
    expect(
      screen.getByRole("region", { name: /campaign-ready opportunities/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/authorizes preparing the creative — never publishing it/i)).toBeInTheDocument();
  });

  it("says nothing is proposed rather than showing an empty space", () => {
    renderSection([]);

    expect(screen.getByText(/no campaign is being proposed right now/i)).toBeInTheDocument();
  });

  it("leads with the business problem and links to the decision", () => {
    renderSection([card()]);

    expect(screen.getByText(/weekday lunch covers are down/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /review and decide/i })).toHaveAttribute(
      "href",
      `/organizations/${ORGANIZATION}/campaign-proposals/${PROPOSAL}`,
    );
  });

  it("shows an organic campaign as having no media budget, not a zero one", () => {
    renderSection([card()]);

    expect(screen.getByText(/none — organic only/i)).toBeInTheDocument();
    expect(screen.getByText("AED 80.00 at most")).toBeInTheDocument();
  });

  it("reports a proposal still being researched as exactly that", () => {
    renderSection([card({ state: "researching", currentVersionId: null })]);

    // An empty card is not an error and must not read as one.
    expect(screen.getByText(/being researched/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing has been written yet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open proposal/i })).toBeInTheDocument();
  });

  it("shows no part of a document it cannot read", () => {
    renderSection([card({ storedDocument: { schemaVersion: 1, title: "Half" } })]);

    expect(screen.getByText(/cannot read, so it is not being shown/i)).toBeInTheDocument();
    expect(screen.queryByText(/weekday lunch covers are down/i)).not.toBeInTheDocument();
  });

  it("calls an approval what it is, and never just 'approved'", () => {
    renderSection([
      card({ state: "approved_for_preparation", linkedCampaignId: CAMPAIGN }),
    ]);

    expect(screen.getByText(/approved to prepare creative/i)).toBeInTheDocument();
    expect(screen.getByText(/publishing needs its own approval/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open the campaign this opened/i })).toHaveAttribute(
      "href",
      `/organizations/${ORGANIZATION}/campaigns/${CAMPAIGN}`,
    );
  });

  it("does not offer a campaign link when the approval opened none it can name", () => {
    renderSection([card({ state: "approved_for_preparation", linkedCampaignId: null })]);

    expect(screen.getByText(/cannot be linked from here/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /open the campaign/i })).not.toBeInTheDocument();
  });
});
