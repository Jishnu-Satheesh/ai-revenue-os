// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

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
    itemFingerprint: null,
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
    myFeedback: null,
    supportedActions: [],
    limitations: [],
    itemFingerprint: null,
    ...overrides,
  };
}

describe("IntelligenceCard", () => {
  beforeEach(() => vi.stubGlobal("fetch", fetchMock));
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    fetchMock.mockClear();
    refresh.mockClear();
  });

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

  it("lets a viewer grade usefulness while keeping decision controls unavailable", () => {
    const { container } = render(
      <IntelligenceCard
        card={recommendationCard()}
        organizationId={ORGANIZATION}
        timeZone="Asia/Dubai"
        canManage={false}
      />,
    );
    expect(container.querySelector("button")).not.toBeNull();
    // Decision controls and the Why dialog wait inside the expander.
    fireEvent.click(screen.getByRole("button", { name: "Read more" }));
    expect(
      screen.getByRole("button", { name: "Helpful: Extend Friday hours" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Acknowledge: Extend Friday hours" })).toBeNull();
    // The channel path lives behind Why this, not as a card link, so the
    // preview matches the prototype without losing the repair route. Viewers
    // get viewing words, never an action they cannot complete.
    fireEvent.click(screen.getByRole("button", { name: /Why this/ }));
    expect(screen.getByRole("link", { name: /View in the channel workspace/i })).toHaveAttribute(
      "href",
      `/organizations/${ORGANIZATION}/channels/61000000-0000-4000-8000-000000000061`,
    );
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
      itemFingerprint: "a".repeat(64),
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

  it("records synthesized-item feedback through its own route", async () => {
    render(
      <IntelligenceCard
        card={recommendationCard({
          source: { kind: "synthesized_item", id: "70000000-0000-4000-8000-000000000007" },
          channelId: null,
          itemFingerprint: "a".repeat(64),
        })}
        organizationId={ORGANIZATION}
        timeZone="Asia/Dubai"
        canManage
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Read more" }));
    fireEvent.click(screen.getByRole("button", { name: /Not helpful/ }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(
      `/api/organizations/${ORGANIZATION}/growth-intelligence/items/70000000-0000-4000-8000-000000000007/feedback`,
    );
  });

  it("keeps the Channel Audit decision vocabulary visible on open recommendations", () => {
    render(
      <IntelligenceCard
        card={recommendationCard()}
        organizationId={ORGANIZATION}
        timeZone="Asia/Dubai"
        canManage
      />,
    );
    // The decision controls are icon-only and live inside the expander.
    fireEvent.click(screen.getByRole("button", { name: "Read more" }));
    for (const name of [
      "Acknowledge: Extend Friday hours",
      "Planned: Extend Friday hours",
      "Snooze: Extend Friday hours",
    ]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    expect(
      screen.getByRole("button", { name: "Helpful: Extend Friday hours" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Not helpful: Extend Friday hours" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Dismiss: Extend Friday hours" }),
    ).toBeTruthy();
  });

  it("matches the prototype card: tag plus scope, evidence plus Why this, no badge grid", () => {
    const channelNames = new Map([
      ["61000000-0000-4000-8000-000000000061", "Delivery A"],
    ]);
    render(
      <IntelligenceCard
        card={recommendationCard({
          limitations: ["Traffic evidence covers Delivery A only."],
          supportedActions: ["Check the cancellation reasons before changing availability."],
        })}
        organizationId={ORGANIZATION}
        timeZone="Asia/Dubai"
        canManage
        channelNames={channelNames}
      />,
    );
    expect(screen.getByText("Channel recommendation")).toBeTruthy();
    expect(screen.getByText("Delivery A")).toBeTruthy();
    // Limitation, evidence, and Why this wait inside the expander.
    fireEvent.click(screen.getByRole("button", { name: "Read more" }));
    expect(screen.getByText(/Traffic evidence covers Delivery A only/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Why this/ })).toBeTruthy();
    // Evidence names the stored window and generated date, never a mock
    // report name; the next step lives only in the dialog, not on the card.
    expect(screen.getByText(/1 Aug 2026 to 31 Aug 2026.*generated/)).toBeTruthy();
    expect(
      screen.queryByText(/Check the cancellation reasons before changing availability/),
    ).toBeNull();
    expect(screen.queryByText("Recommendation", { exact: true })).toBeNull();
    expect(screen.queryByText("Evidence window")).toBeNull();
    expect(screen.queryByText("Generated", { exact: true })).toBeNull();
  });

  it("falls back to Organization-wide when the recommendation has no single channel", () => {
    render(
      <IntelligenceCard
        card={recommendationCard({
          source: { kind: "synthesized_item", id: "70000000-0000-4000-8000-000000000007" },
          channelId: null,
          itemFingerprint: "a".repeat(64),
        })}
        organizationId={ORGANIZATION}
        timeZone="Asia/Dubai"
        canManage
      />,
    );
    expect(screen.getByText("Organization-wide")).toBeTruthy();
    expect(screen.queryByText("All channels", { exact: true })).toBeNull();
  });

  it("names the manager path as an answer and the viewer path as a view", () => {
    const { unmount } = render(
      <IntelligenceCard
        card={recommendationCard()}
        organizationId={ORGANIZATION}
        timeZone="Asia/Dubai"
        canManage
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Read more" }));
    fireEvent.click(screen.getByRole("button", { name: /Why this/ }));
    expect(screen.getByRole("link", { name: /Answer in the channel workspace/i })).toBeTruthy();
    cleanup();
    unmount();
    render(
      <IntelligenceCard
        card={recommendationCard()}
        organizationId={ORGANIZATION}
        timeZone="Asia/Dubai"
        canManage={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Read more" }));
    fireEvent.click(screen.getByRole("button", { name: /Why this/ }));
    expect(screen.getByRole("link", { name: /View in the channel workspace/i })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Answer in the channel workspace/i })).toBeNull();
  });

  it("resolves branch scope from loaded names and admits a missing channel name", () => {
    const channelNames = new Map([
      ["61000000-0000-4000-8000-000000000061", "Delivery A"],
    ]);
    const branchNames = new Map([["22000000-0000-4000-8000-000000000022", "Downtown"]]);
    const { unmount } = render(
      <IntelligenceCard
        card={recommendationCard({ branchId: "22000000-0000-4000-8000-000000000022" })}
        organizationId={ORGANIZATION}
        timeZone="Asia/Dubai"
        canManage
        channelNames={channelNames}
        branchNames={branchNames}
      />,
    );
    expect(screen.getByText(/Delivery A · Downtown/)).toBeTruthy();
    cleanup();
    unmount();
    render(
      <IntelligenceCard
        card={recommendationCard()}
        organizationId={ORGANIZATION}
        timeZone="Asia/Dubai"
        canManage
      />,
    );
    expect(screen.getByText("Channel details unavailable")).toBeTruthy();
  });

  it("hides decide buttons on a recorded answer while keeping votes", () => {
    render(
      <IntelligenceCard
        card={recommendationCard({
          decision: "planned",
          decidedAt: "2026-09-02T08:00:00.000Z",
        })}
        organizationId={ORGANIZATION}
        timeZone="Asia/Dubai"
        canManage
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Read more" }));
    expect(screen.queryByRole("button", { name: "Acknowledge: Extend Friday hours" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Planned: Extend Friday hours" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Snooze: Extend Friday hours" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Helpful: Extend Friday hours" }),
    ).toBeTruthy();
    expect(screen.getByText(/Marked planned/)).toBeTruthy();
  });

  it("states honest fallbacks for missing window and missing caveats", () => {
    render(
      <IntelligenceCard
        card={recommendationCard({ evidenceWindow: null })}
        organizationId={ORGANIZATION}
        timeZone="Asia/Dubai"
        canManage
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Read more" }));
    expect(screen.getByText(/No evidence window/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Why this/ }));
    expect(screen.getByText(/next step to investigate/)).toBeTruthy();
  });

  it("opens Why this with scope, evidence, limitation, and next steps", () => {
    render(
      <IntelligenceCard
        card={recommendationCard({
          limitations: ["Twenty of fifty-nine days carried evidence."],
          supportedActions: ["Mark unavailable items in the app before service"],
        })}
        organizationId={ORGANIZATION}
        timeZone="Asia/Dubai"
        canManage
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Read more" }));
    fireEvent.click(screen.getByRole("button", { name: /Why this/ }));
    const dialog = screen.getByRole("dialog", { name: "Why this recommendation?" });
    expect(dialog).toBeTruthy();
    // The limitation shows on the card and again inside the dialog; the next
    // step lives only in the dialog so the preview matches the prototype.
    expect(screen.getAllByText(/Twenty of fifty-nine days/).length).toBe(2);
    expect(
      screen.getByText(/Mark unavailable items in the app before service/),
    ).toBeTruthy();
    // Dialog names the honest scope and evidence, not mock report names.
    expect(dialog.textContent).toContain("Channel details unavailable");
    expect(dialog.textContent).toMatch(/1 Aug 2026 to 31 Aug 2026/);
  });
});

describe("IntelligenceCard research provenance", () => {
  afterEach(() => {
    cleanup();
  });

  it("labels market-research recommendations and links their exact outcomes", () => {
    const statusPath =
      "/api/organizations/10000000-0000-4000-8000-000000000001/market-profile/research/40000000-0000-4000-8000-000000000004";
    render(
      <IntelligenceCard
        card={recommendationCard({
          researchProvenance: {
            pipelineId: "40000000-0000-4000-8000-000000000004",
            branchId: "20000000-0000-4000-8000-00000000000a",
            stage: "ready",
            statusPath,
            supportingClaimIds: ["claim-1"],
          },
        })}
        organizationId={ORGANIZATION}
        timeZone="Asia/Dubai"
        canManage
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Read more" }));
    expect(screen.getByText("From market research")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /view supporting outcomes/i }).getAttribute("href"),
    ).toBe(statusPath);
  });

  it("leaves channel recommendations without provenance unmarked", () => {
    render(
      <IntelligenceCard
        card={recommendationCard()}
        organizationId={ORGANIZATION}
        timeZone="Asia/Dubai"
        canManage
      />,
    );
    expect(screen.queryByText("From market research")).toBeNull();
    expect(screen.queryByRole("link", { name: /view supporting outcomes/i })).toBeNull();
  });
});

describe("IntelligenceCard context provenance", () => {
  afterEach(() => {
    cleanup();
  });

  it("distinguishes research brief from synthesis context with degradation copy", () => {    render(
      <IntelligenceCard
        card={recommendationCard()}
        organizationId={ORGANIZATION}
        timeZone="Asia/Dubai"
        canManage
        contextProvenance={{
          briefManifestId: "50000000-0000-4000-8000-000000000005",
          briefStatus: "ready",
          synthesisManifestId: "60000000-0000-4000-8000-000000000006",
          synthesisStatus: "partial",
        }}
      />,
    );
    expect(screen.getByText("Research brief")).toBeTruthy();
    expect(screen.getByText("Synthesis context")).toBeTruthy();
    expect(screen.getByText(/cited refs only/i)).toBeTruthy();
  });
});

describe("IntelligenceCard compact shape", () => {
  beforeEach(() => vi.stubGlobal("fetch", fetchMock));
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    fetchMock.mockClear();
    refresh.mockClear();
  });

  it("stays compact by default: full title, clamped detail, Read more collapsed", () => {
    render(
      <IntelligenceCard
        card={recommendationCard({
          limitations: ["Traffic evidence covers Delivery A only."],
        })}
        organizationId={ORGANIZATION}
        timeZone="Asia/Dubai"
        canManage
      />,
    );
    // The title is never clamped; the detail previews at two lines.
    expect(screen.getByText("Extend Friday hours")).toBeTruthy();
    expect(
      screen.getByText("Friday evenings carry the week's strongest observed demand."),
    ).toBeTruthy();
    const trigger = screen.getByRole("button", { name: "Read more" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    // The rest waits inside the expander: limitation, evidence, Why this.
    // Decision and feedback controls stay in the always-visible footer.
    expect(screen.queryByText(/Traffic evidence covers Delivery A only/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Why this/ })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Helpful: Extend Friday hours" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Acknowledge: Extend Friday hours" }),
    ).toBeTruthy();
  });

  it("Read more toggles the full content and flips aria-expanded", async () => {
    render(
      <IntelligenceCard
        card={recommendationCard({
          limitations: ["Traffic evidence covers Delivery A only."],
        })}
        organizationId={ORGANIZATION}
        timeZone="Asia/Dubai"
        canManage
      />,
    );
    const trigger = screen.getByRole("button", { name: "Read more" });
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/Traffic evidence covers Delivery A only/)).toBeTruthy();
    expect(screen.getByText(/1 Aug 2026 to 31 Aug 2026.*generated/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Why this/ })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Acknowledge: Extend Friday hours" }),
    ).toBeTruthy();
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await waitFor(() =>
      expect(screen.queryByText(/Traffic evidence covers Delivery A only/)).toBeNull(),
    );
    expect(screen.queryByRole("button", { name: /Why this/ })).toBeNull();
  });

  it("stretches to its grid row so sibling cards equalize", () => {
    render(
      <IntelligenceCard
        card={recommendationCard()}
        organizationId={ORGANIZATION}
        timeZone="Asia/Dubai"
        canManage
      />,
    );
    expect(
      screen
        .getByTestId("intelligence-card-60000000-0000-4000-8000-000000000006")
        .classList.contains("h-full"),
    ).toBe(true);
  });

  it("records answers through the icon-only decision buttons", async () => {
    render(
      <IntelligenceCard
        card={recommendationCard()}
        organizationId={ORGANIZATION}
        timeZone="Asia/Dubai"
        canManage
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Read more" }));
    fireEvent.click(screen.getByRole("button", { name: "Acknowledge: Extend Friday hours" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(
      `/api/organizations/${ORGANIZATION}/channel-recommendations/60000000-0000-4000-8000-000000000006/decisions`,
    );
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))).toEqual({
      decision: "acknowledged",
    });

    fetchMock.mockClear();
    refresh.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Planned: Extend Friday hours" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))).toEqual({
      decision: "planned",
    });
  });

  it("opens the snooze dialog from the icon-only snooze button", () => {
    render(
      <IntelligenceCard
        card={recommendationCard()}
        organizationId={ORGANIZATION}
        timeZone="Asia/Dubai"
        canManage
      />,
    );
    // The footer is always visible; expanding first still works.
    fireEvent.click(screen.getByRole("button", { name: "Read more" }));
    fireEvent.click(screen.getByRole("button", { name: "Snooze: Extend Friday hours" }));
    expect(screen.getByRole("dialog", { name: "Snooze this item" })).toBeTruthy();
  });
});

describe("IntelligenceCard card refinements", () => {
  beforeEach(() => vi.stubGlobal("fetch", fetchMock));
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    fetchMock.mockClear();
    refresh.mockClear();
  });

  it("keeps the collapsed preview clamped to two lines", () => {
    render(
      <IntelligenceCard
        card={recommendationCard()}
        organizationId={ORGANIZATION}
        timeZone="Asia/Dubai"
        canManage
      />,
    );
    const preview = screen.getByText(
      "Friday evenings carry the week's strongest observed demand.",
    );
    expect(preview.classList.contains("line-clamp-2")).toBe(true);
  });

  it("shows the full detail in a fixed-height white quote box when expanded", () => {
    const detail =
      "Friday evenings carry the week's strongest observed demand across every channel we could measure, and the pattern holds for six weeks running.";
    render(
      <IntelligenceCard
        card={recommendationCard({ detail })}
        organizationId={ORGANIZATION}
        timeZone="Asia/Dubai"
        canManage
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Read more" }));
    const quote = screen.getByTestId(
      "intelligence-card-60000000-0000-4000-8000-000000000006-quote",
    );
    expect(quote.textContent).toContain(detail);
    // Fixed height regardless of content.
    expect(quote.classList.contains("h-28")).toBe(true);
    expect(quote.className).toContain("bg-white");
    expect(quote.className).toContain("overflow-hidden");
    // The scrollable copy inside hides its scrollbar but still scrolls.
    const scroller = quote.querySelector("blockquote");
    expect(scroller).not.toBeNull();
    expect(scroller?.className).toContain("overflow-y-auto");
    expect(scroller?.className).toContain("[scrollbar-width:none]");
    expect(scroller?.className).toContain("[&::-webkit-scrollbar]:hidden");
    // Italic, centered, comfortable padding, with a quote mark.
    expect(quote.textContent).toContain("\u201C");
    expect(quote.className).toContain("text-center");
    expect(scroller?.className).toContain("italic");
    expect(quote.className).toContain("px-5");
  });

  it("keeps the toggle inline in the description row with Show less on expand", () => {
    render(
      <IntelligenceCard
        card={recommendationCard()}
        organizationId={ORGANIZATION}
        timeZone="Asia/Dubai"
        canManage
      />,
    );
    const trigger = screen.getByRole("button", { name: "Read more" });
    const row = trigger.parentElement;
    expect(row?.className).toContain("flex");
    const preview = screen.getByText(
      "Friday evenings carry the week's strongest observed demand.",
    );
    expect(preview.className).toContain("flex-1");
    expect(trigger.className).toContain("shrink-0");
    fireEvent.click(trigger);
    expect(screen.getByRole("button", { name: "Show less" })).toBeTruthy();
  });

  it("renders the scope as a white primary-green chip", () => {
    const channelNames = new Map([
      ["61000000-0000-4000-8000-000000000061", "Delivery A"],
    ]);
    render(
      <IntelligenceCard
        card={recommendationCard()}
        organizationId={ORGANIZATION}
        timeZone="Asia/Dubai"
        canManage
        channelNames={channelNames}
      />,
    );
    const chip = screen.getByText("Delivery A");
    expect(chip.className).toContain("bg-white");
    expect(chip.className).toContain("text-primary");
    expect(chip.className).toContain("rounded-full");
    expect(chip.className).toContain("font-semibold");
  });

  it("keeps decision and feedback actions always visible in a pinned footer", () => {
    const { container } = render(
      <IntelligenceCard
        card={recommendationCard()}
        organizationId={ORGANIZATION}
        timeZone="Asia/Dubai"
        canManage
      />,
    );
    // No expander click: the footer is already there.
    expect(
      screen.getByRole("button", { name: "Acknowledge: Extend Friday hours" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Helpful: Extend Friday hours" }),
    ).toBeTruthy();
    const section = screen.getByTestId(
      "intelligence-card-60000000-0000-4000-8000-000000000006",
    );
    const footer = section.querySelector('[data-testid$="-actions-footer"]');
    expect(footer).not.toBeNull();
    expect(footer?.className).toContain("mt-auto");
    expect(container.querySelector(".border-t")).not.toBeNull();
  });
});
