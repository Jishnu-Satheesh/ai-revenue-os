// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

    fireEvent.click(screen.getByRole("button", { name: "Read more" }));
    expect(screen.getByText(/none — organic only/i)).toBeInTheDocument();
    expect(screen.getByText("AED 80.00 at most")).toBeInTheDocument();
  });

  it("reports a proposal still being researched as exactly that", () => {
    renderSection([card({ state: "researching", currentVersionId: null })]);

    // An empty card is not an error and must not read as one.
    expect(screen.getByText(/being researched/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Read more" }));
    expect(screen.getByText(/nothing has been written yet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open proposal/i })).toBeInTheDocument();
  });

  it("shows no part of a document it cannot read", () => {
    renderSection([card({ storedDocument: { schemaVersion: 1, title: "Half" } })]);

    fireEvent.click(screen.getByRole("button", { name: "Read more" }));
    expect(screen.getByText(/cannot read, so it is not being shown/i)).toBeInTheDocument();
    expect(screen.queryByText(/weekday lunch covers are down/i)).not.toBeInTheDocument();
  });

  it("calls an approval what it is, and never just 'approved'", () => {
    renderSection([
      card({ state: "approved_for_preparation", linkedCampaignId: CAMPAIGN }),
    ]);

    expect(screen.getByText(/approved to prepare creative/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Read more" }));
    expect(screen.getByText(/publishing needs its own approval/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open the campaign this opened/i })).toHaveAttribute(
      "href",
      `/organizations/${ORGANIZATION}/campaigns/${CAMPAIGN}`,
    );
  });

  it("does not offer a campaign link when the approval opened none it can name", () => {
    renderSection([card({ state: "approved_for_preparation", linkedCampaignId: null })]);

    fireEvent.click(screen.getByRole("button", { name: "Read more" }));
    expect(screen.getByText(/cannot be linked from here/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /open the campaign/i })).not.toBeInTheDocument();
  });

  it("stays compact by default: type line, full title, clamped problem, Read more collapsed", () => {
    renderSection([card()]);

    expect(screen.getByText("Campaign opportunity")).toBeInTheDocument();
    expect(screen.getByText("Weekday lunch footfall")).toBeInTheDocument();
    expect(screen.getByText(/weekday lunch covers are down/i)).toBeInTheDocument();
    // The decision foot never collapses, so the answer is always one tap away.
    expect(screen.getByRole("link", { name: /review and decide/i })).toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: "Read more" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    // The state sentence and the channels/budget/cost grid wait inside.
    expect(screen.queryByText(/someone needs to read this and decide/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/none — organic only/i)).not.toBeInTheDocument();
  });

  it("Read more reveals the state sentence and the meta grid", () => {
    renderSection([card()]);

    const trigger = screen.getByRole("button", { name: "Read more" });
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/someone needs to read this and decide/i)).toBeInTheDocument();
    expect(screen.getByText(/none — organic only/i)).toBeInTheDocument();
    expect(screen.getByText("AED 80.00 at most")).toBeInTheDocument();
  });

  it("stretches to its grid row so sibling cards equalize", () => {
    renderSection([card()]);

    expect(
      screen.getByTestId(`proposal-card-${PROPOSAL}`).classList.contains("h-full"),
    ).toBe(true);
  });
});

describe("campaign proposal card refinements", () => {
  it("keeps the collapsed preview clamped to two lines", () => {
    renderSection([card()]);

    const preview = screen.getByText(/weekday lunch covers are down/i);
    expect(preview.classList.contains("line-clamp-2")).toBe(true);
  });

  it("shows the full business problem in a fixed-height white quote box when expanded", () => {
    renderSection([card()]);

    fireEvent.click(screen.getByRole("button", { name: "Read more" }));
    const quote = screen.getByTestId(`proposal-card-${PROPOSAL}-quote`);
    expect(quote.textContent).toContain(
      "Weekday lunch covers are down against the same weeks last quarter.",
    );
    expect(quote.classList.contains("h-28")).toBe(true);
    expect(quote.className).toContain("bg-white");
    expect(quote.className).toContain("overflow-hidden");
    const scroller = quote.querySelector("blockquote");
    expect(scroller).not.toBeNull();
    expect(scroller?.className).toContain("overflow-y-auto");
    expect(scroller?.className).toContain("[scrollbar-width:none]");
    expect(scroller?.className).toContain("[&::-webkit-scrollbar]:hidden");
    expect(quote.textContent).toContain("\u201C");
    expect(quote.className).toContain("text-center");
    expect(scroller?.className).toContain("italic");
    expect(quote.className).toContain("px-5");
  });

  it("keeps the toggle inline in the description row with Show less on expand", () => {
    renderSection([card()]);

    const trigger = screen.getByRole("button", { name: "Read more" });
    const row = trigger.parentElement;
    expect(row?.className).toContain("flex");
    const preview = screen.getByText(/weekday lunch covers are down/i);
    expect(preview.className).toContain("flex-1");
    expect(trigger.className).toContain("shrink-0");
    fireEvent.click(trigger);
    expect(screen.getByRole("button", { name: "Show less" })).toBeTruthy();
  });

  it("renders the state label as a white primary-green chip", () => {
    renderSection([card()]);

    const chip = screen.getByText("Ready for your decision");
    expect(chip.className).toContain("bg-white");
    expect(chip.className).toContain("text-primary");
    expect(chip.className).toContain("rounded-full");
    expect(chip.className).toContain("font-semibold");
  });

  it("gives the state sentence the shared footnote treatment with an Info icon", () => {
    renderSection([card()]);

    fireEvent.click(screen.getByRole("button", { name: "Read more" }));
    const note = screen.getByText(/someone needs to read this and decide/i);
    const footnote = note.closest("p");
    expect(footnote?.className).toContain("text-xs");
    expect(footnote?.className).toContain("leading-relaxed");
    expect(footnote?.className).toContain("text-muted-foreground");
    expect(footnote?.querySelector("svg")).not.toBeNull();
  });

  it("keeps the Updated plus Review/Open footer outside the expander", () => {
    renderSection([card()]);

    // The decision foot never collapses, so the answer is always one tap away.
    expect(screen.getByRole("link", { name: /review and decide/i })).toBeInTheDocument();
    const section = screen.getByTestId(`proposal-card-${PROPOSAL}`);
    const footer = section.querySelector('[data-testid$="-footer"]');
    expect(footer).not.toBeNull();
    expect(footer?.className).toContain("mt-auto");
    expect(section.querySelector(".border-t")).not.toBeNull();
  });
});
