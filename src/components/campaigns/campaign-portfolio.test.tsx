// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { campaignListPhase } from "@/domain/campaigns/phase";

import { CampaignPortfolio } from "@/components/campaigns/campaign-portfolio";
import type { CampaignListItem } from "@/modules/campaigns/application/studio-view";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(cleanup);

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";

function item(overrides: Partial<CampaignListItem> = {}): CampaignListItem {
  return {
    id: "c1000000-0000-4000-8000-000000000001",
    title: "Weekday evening demand lift",
    state: "ready_for_review",
    sourceKind: "decision_opportunity",
    sourceLabel: "Decision Engine opportunity",
    updatedAt: "2026-08-15T09:30:00.000Z",
    awaitingFirstVersion: false,
    openable: true,
    generation: { status: "settled", detail: null, nextAction: null, retryable: false, blocker: null, missingDetails: [] },
    version: 2,
    objective: "Raise incremental gross profit on weekday evenings",
    channels: ["instagram", "meta_ads"],
    spendCeiling: { amountMinor: 45_000, currency: "AED" },
    bundleVersionId: "d1000000-0000-4000-8000-000000000001",
    phase: campaignListPhase({
      state: "ready_for_review",
      hasVersion: true,
      approvalStatus: "none",
      settledAt: null,
    }),
    ...overrides,
  };
}

/**
 * The campaign cards only.
 *
 * The "Needs your attention" strip is also a list, so an unscoped listitem
 * query would match its rows too — and those rows are deliberately a capped
 * preview, not the campaign set.
 */
function cardsOnly(): HTMLElement[] {
  return within(screen.getByRole("list", { name: "Campaigns" })).getAllByRole("listitem");
}

function renderPortfolio(
  campaigns: readonly CampaignListItem[],
  previewUrls: Readonly<Record<string, string>> = {},
) {
  return render(
    <CampaignPortfolio
      organizationId={ORGANIZATION_ID}
      campaigns={campaigns}
      previewUrls={previewUrls}
      timeZone="Asia/Dubai"
    />,
  );
}

describe("the portfolio offers both entry points as equals", () => {
  it("links to a manual brief and to the opportunity list", () => {
    renderPortfolio([item()]);

    expect(screen.getByRole("link", { name: /request a campaign/i })).toHaveAttribute(
      "href",
      `/organizations/${ORGANIZATION_ID}/campaigns/new`,
    );
    expect(screen.getByRole("link", { name: /asset library/i })).toHaveAttribute(
      "href",
      `/organizations/${ORGANIZATION_ID}/assets`,
    );
    expect(screen.getByRole("link", { name: /review campaign recommendations/i })).toHaveAttribute(
      "href",
      `/organizations/${ORGANIZATION_ID}/growth-intelligence`,
    );
  });

  it("keeps both entries scoped to this organization", () => {
    renderPortfolio([item()]);

    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("href")).toContain(`/organizations/${ORGANIZATION_ID}/`);
    }
  });
});

describe("the portfolio states only what the campaign has produced", () => {
  it("shows the objective and the fact that matters at this phase", () => {
    renderPortfolio([item()]);
    const card = within(cardsOnly()[0]!);

    expect(card.getByText(/raise incremental gross profit/i)).toBeInTheDocument();
    // A proposal's number is its proposed budget, labelled as proposed.
    expect(card.getByText(/proposed budget AED\s?450\.00/i)).toBeInTheDocument();
  });

  it("never shows a proposed budget as though it were spend", () => {
    renderPortfolio([
      item({
        phase: campaignListPhase({
          state: "completed",
          hasVersion: true,
          approvalStatus: "live",
          settledAt: "2026-09-01T00:00:00.000Z",
        }),
      }),
    ]);

    expect(screen.queryByText(/proposed budget/i)).not.toBeInTheDocument();
  });

  it("shows channels and ceiling in the list view, where the columns are", () => {
    renderPortfolio([item()]);
    fireEvent.click(screen.getByRole("button", { name: /^list$/i }));

    expect(screen.getByText(/instagram · meta_ads/)).toBeInTheDocument();
    expect(screen.getByText(/AED\s?450\.00/)).toBeInTheDocument();
  });

  it("says a proposal is still being generated rather than showing blank facts", () => {
    renderPortfolio([
      item({
        awaitingFirstVersion: true,
        openable: false,
        generation: { status: "generating", detail: "Building the first proposal.", nextAction: null, retryable: false, blocker: null, missingDetails: [] },
        version: null,
        objective: null,
        channels: [],
        spendCeiling: null,
      }),
    ]);
    const card = within(cardsOnly()[0]!);

    expect(card.getByText(/waiting for the first proposal/i)).toBeInTheDocument();
    expect(card.queryByText(/spend ceiling/i)).not.toBeInTheDocument();
    expect(card.queryByText(/^v/)).not.toBeInTheDocument();
  });

  it("distinguishes no paid spend from a ceiling of zero", () => {
    renderPortfolio([item({ spendCeiling: null })]);
    fireEvent.click(screen.getByRole("button", { name: /^list$/i }));

    expect(screen.getByText(/No paid spend/)).toBeInTheDocument();
    expect(screen.queryByText(/0\.00/)).not.toBeInTheDocument();
  });

  it("labels the stage in plain words, never raw database values", () => {
    renderPortfolio([
      item({ id: "a", state: "partially_completed" }),
      item({
        id: "b",
        state: "failed",
        phase: campaignListPhase({
          state: "failed",
          hasVersion: true,
          approvalStatus: "live",
          settledAt: null,
        }),
      }),
    ]);

    // The badge names the stage a client understands, and the closed phase map
    // is what makes raw database text unable to reach the screen at all.
    expect(screen.queryByText(/partially_completed|needs_data|ready_for_review/)).not.toBeInTheDocument();
    expect(screen.getByText("Stopped")).toBeInTheDocument();
  });

  it("renders the update time in the organization's timezone, not the server's", () => {
    renderPortfolio([item({ updatedAt: "2026-08-15T22:30:00.000Z" })]);

    // 22:30 UTC is 02:30 the next day in Asia/Dubai.
    expect(screen.getByText(/16 Aug, 02:30/)).toBeInTheDocument();
  });
});

describe("an empty portfolio explains itself", () => {
  it("offers the two entry points instead of an empty list", () => {
    renderPortfolio([]);

    expect(screen.getByText(/no campaigns yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Campaigns" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /request a campaign/i })).toBeInTheDocument();
  });
});

describe("a campaign with no proposal is still reachable", () => {
  function pending(generation: CampaignListItem["generation"]): CampaignListItem {
    return item({
      awaitingFirstVersion: true,
      openable: false,
      generation,
      version: null,
      objective: null,
      channels: [],
      spendCeiling: null,
    });
  }

  it("links to the detail route, which explains why nothing is there", () => {
    renderPortfolio([pending({ status: "generating", detail: "Building the first proposal.", nextAction: null, retryable: false, blocker: null, missingDetails: [] })]);
    const card = within(cardsOnly()[0]!);
    const href = `/organizations/${ORGANIZATION_ID}/campaigns/c1000000-0000-4000-8000-000000000001`;

    // The detail route does not 404 on a version-less campaign. It names
    // whether the campaign is still being built or whether generation stopped,
    // which is the answer somebody staring at a stalled card came for. The
    // attention strip already linked here; the card used to disagree.
    // The artwork and the title are both links to the same place.
    const links = card.getAllByRole("link", { name: /weekday evening demand lift/i });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link).toHaveAttribute("href", href);
  });

  it("keeps the title readable", () => {
    renderPortfolio([pending({ status: "generating", detail: "Building the first proposal.", nextAction: null, retryable: false, blocker: null, missingDetails: [] })]);

    // Scoped to the card: this campaign also appears in the attention strip,
    // which is a separate preview of the same work.
    expect(within(cardsOnly()[0]!).getByText("Weekday evening demand lift")).toBeInTheDocument();
  });

  it("shows a spinner only while a worker is actually running", () => {
    renderPortfolio([pending({ status: "generating", detail: "Building the first proposal.", nextAction: null, retryable: false, blocker: null, missingDetails: [] })]);
    const card = within(cardsOnly()[0]!);

    expect(card.getByText(/building the first proposal/i)).toBeInTheDocument();
    expect(card.queryByText(/did not finish/i)).not.toBeInTheDocument();
  });

  it("says generation stopped instead of spinning forever", () => {
    // A worker killed by a timeout never writes that it failed, so its row
    // stays claimed. Spinning here would wait on something nobody is doing.
    renderPortfolio([
      pending({
        status: "stalled",
        detail: "Generation stopped responding and did not finish. It can be started again.",
        nextAction: "Start it again.",
        retryable: true,
        blocker: null,
        missingDetails: [],
      }),
    ]);
    const card = within(cardsOnly()[0]!);

    expect(card.getByText(/generation did not finish/i)).toBeInTheDocument();
    expect(card.getByText(/stopped responding/i)).toBeInTheDocument();
  });

  it("names what generation still needs when it failed for want of evidence", () => {
    renderPortfolio([
      pending({
        status: "failed",
        detail: "Some details are missing before this campaign can be built: Brand voice, Primary metric.",
        nextAction: "Add the missing details, then start it again.",
        retryable: true,
        blocker: null,
        missingDetails: ["brand_voice", "primary_metric"],
      }),
    ]);
    const card = within(cardsOnly()[0]!);

    expect(card.getByText(/generation failed/i)).toBeInTheDocument();
    // Each gap is named in words. The stored codes are for engineers; an
    // operator shown `brand_voice` has to translate before they can act.
    expect(card.getByText("Brand voice")).toBeInTheDocument();
    expect(card.getByText("Primary metric")).toBeInTheDocument();
    expect(card.queryByText(/brand_voice/)).not.toBeInTheDocument();
  });

  it("shows a failure in the destructive colour, not as quiet grey text", () => {
    renderPortfolio([
      pending({
        status: "failed",
        detail: "Some details are missing before this campaign can be built: Brand voice.",
        nextAction: "Add the missing details, then start it again.",
        retryable: true,
        blocker: null,
        missingDetails: ["brand_voice"],
      }),
    ]);
    const card = within(cardsOnly()[0]!);

    // A failure rendered in muted grey beside a dashed border reads as a note.
    // This is the design system's own error treatment, so the card cannot
    // drift from every other error surface in the product.
    const alert = card.getByRole("alert");
    expect(alert.className).toContain("text-destructive");
  });

  it("offers to collect the missing details without leaving the campaign", () => {
    renderPortfolio([
      pending({
        status: "failed",
        detail: "Some details are missing before this campaign can be built: Brand voice.",
        nextAction: "Add the missing details, then start it again.",
        retryable: true,
        blocker: null,
        missingDetails: ["brand_voice"],
      }),
    ]);
    const card = within(cardsOnly()[0]!);

    // Sending someone to onboarding to hunt for one field is how the original
    // report ended with the same failure twice.
    expect(card.getByRole("button", { name: /add the missing details/i })).toBeEnabled();
  });

  it("offers no repair for a failure that names no missing details", () => {
    renderPortfolio([
      pending({
        status: "stalled",
        detail: "Generation stopped responding and did not finish. It can be started again.",
        nextAction: "Start it again.",
        retryable: true,
        blocker: null,
        missingDetails: [],
      }),
    ]);
    const card = within(cardsOnly()[0]!);

    expect(card.queryByRole("button", { name: /add the missing details/i })).not.toBeInTheDocument();
  });

  it("offers the restart it promises when generation stopped", () => {
    // The notice says the run can be started again. A sentence describing an
    // action nobody can take is worse than saying nothing at all.
    renderPortfolio([
      pending({
        status: "stalled",
        detail: "Generation stopped responding and did not finish. It can be started again.",
        nextAction: "Start it again.",
        retryable: true,
        blocker: null,
        missingDetails: [],
      }),
    ]);
    const card = within(cardsOnly()[0]!);

    expect(card.getByRole("button", { name: /generate again/i })).toBeEnabled();
  });

  it("does not offer a restart while a worker still holds the run", () => {
    renderPortfolio([pending({ status: "generating", detail: "Building the first proposal.", nextAction: null, retryable: false, blocker: null, missingDetails: [] })]);
    const card = within(cardsOnly()[0]!);

    // No restart while a worker still holds the run — starting a second one
    // would race the first. Opening it is fine; the page says it is building.
    expect(card.queryByRole("button", { name: /generate again/i })).not.toBeInTheDocument();
    expect(card.getByRole("link", { name: /^open/i })).toBeInTheDocument();
  });

  it("says nothing about generation once a proposal exists", () => {
    renderPortfolio([item()]);
    const card = within(cardsOnly()[0]!);

    expect(card.queryByRole("status")).not.toBeInTheDocument();
    expect(card.getAllByRole("link").length).toBeGreaterThan(0);
  });
});

describe("a filter never rewrites the total", () => {
  function twelve(): CampaignListItem[] {
    return Array.from({ length: 12 }, (_, index) =>
      item({
        id: `c100000${index}-0000-4000-8000-00000000000${index % 10}`,
        title: index < 3 ? `Ramadan push ${index}` : `Weekday lunch ${index}`,
      }),
    );
  }

  it("states the true total when nothing is filtered", () => {
    renderPortfolio(twelve());

    expect(screen.getByText("12 campaigns")).toBeInTheDocument();
  });

  it("says 'showing 3 of 12' rather than presenting 3 as the total", () => {
    // A filtered count presented as a total is how somebody concludes work has
    // disappeared.
    renderPortfolio(twelve());
    fireEvent.change(screen.getByRole("searchbox", { name: /search campaigns/i }), {
      target: { value: "ramadan" },
    });

    expect(screen.getByText("Showing 3 of 12 campaigns")).toBeInTheDocument();
  });

  it("still names the true total when a search matches nothing", () => {
    renderPortfolio(twelve());
    fireEvent.change(screen.getByRole("searchbox", { name: /search campaigns/i }), {
      target: { value: "nothing here" },
    });

    expect(screen.getByText(/nothing matches these filters/i)).toBeInTheDocument();
    expect(screen.getByText(/12 campaigns exist here/i)).toBeInTheDocument();
  });
});

describe("the attention count is real", () => {
  it("counts only campaigns that are waiting on a person", () => {
    renderPortfolio([
      // Awaiting review: waiting on somebody.
      item({ id: "c1000000-0000-4000-8000-000000000001" }),
      // Creative authorized and being prepared: waiting on the renderer.
      item({
        id: "c1000000-0000-4000-8000-000000000002",
        phase: campaignListPhase({
          state: "approved",
          hasVersion: true,
          approvalStatus: "live",
          settledAt: null,
        }),
      }),
    ]);

    expect(screen.getByText(/1 is waiting on somebody/i)).toBeInTheDocument();
  });

  it("says plainly when nothing is waiting", () => {
    renderPortfolio([
      item({
        phase: campaignListPhase({
          state: "completed",
          hasVersion: true,
          approvalStatus: "live",
          settledAt: "2026-09-01T00:00:00.000Z",
        }),
      }),
    ]);

    expect(screen.getByText(/none are waiting on you/i)).toBeInTheDocument();
  });
});

describe("the artwork leads, and says when it cannot", () => {
  it("shows the signed preview when there is one", () => {
    const { container } = renderPortfolio([item()], {
      "d1000000-0000-4000-8000-000000000001": "https://example.test/a.png",
    });

    // Queried by element rather than role: the artwork carries an empty alt on
    // purpose, because the title and objective beside it already say what this
    // campaign is, and a screen reader should not hear it twice.
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "https://example.test/a.png",
    );
  });

  it("distinguishes artwork that does not exist yet from artwork that failed to load", () => {
    // Both are an empty rectangle otherwise, and they mean different things.
    renderPortfolio([item({ awaitingFirstVersion: true, bundleVersionId: null })]);
    expect(screen.getByText(/no preview available/i)).toBeInTheDocument();
    expect(screen.getByText(/creative generation begins after approval/i)).toBeInTheDocument();

    cleanup();

    renderPortfolio([item()]);
    expect(screen.getByText(/preview unavailable/i)).toBeInTheDocument();
  });
});

describe("the same campaigns, two ways of looking", () => {
  it("offers a gallery and a list, starting on the gallery", () => {
    renderPortfolio([item()]);

    expect(screen.getByRole("button", { name: /gallery/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /^list$/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("keeps every campaign when the layout changes", () => {
    renderPortfolio([item(), item({ id: "c1000000-0000-4000-8000-000000000002" })]);
    fireEvent.click(screen.getByRole("button", { name: /^list$/i }));

    expect(cardsOnly()).toHaveLength(2);
  });
});

describe("the attention strip counts more than it shows", () => {
  function waitingSet(count: number): CampaignListItem[] {
    return Array.from({ length: count }, (_, index) =>
      item({
        id: `a100000${index}-0000-4000-8000-00000000000${index % 10}`,
        title: `Campaign ${index}`,
      }),
    );
  }

  it("shows at most three previews while naming the real total", () => {
    // The count query and the preview query are separate on purpose: three rows
    // must never be read as "there are three things to do".
    renderPortfolio(waitingSet(7));
    const strip = within(screen.getByRole("region", { name: /needs your attention/i }));

    expect(strip.getAllByRole("listitem")).toHaveLength(3);
    expect(strip.getByText("7")).toBeInTheDocument();
    expect(strip.getByRole("button", { name: /view all 7/i })).toBeInTheDocument();
  });

  it("offers no 'view all' when everything waiting is already shown", () => {
    renderPortfolio(waitingSet(2));
    const strip = within(screen.getByRole("region", { name: /needs your attention/i }));

    expect(strip.queryByRole("button", { name: /view all/i })).not.toBeInTheDocument();
  });

  it("names the specific action, not a generic 'needs attention'", () => {
    renderPortfolio([item()]);
    const strip = within(screen.getByRole("region", { name: /needs your attention/i }));

    expect(strip.getByText("Review proposal")).toBeInTheDocument();
  });

  it("disappears entirely when nothing is waiting", () => {
    renderPortfolio([
      item({
        phase: campaignListPhase({
          state: "completed",
          hasVersion: true,
          approvalStatus: "live",
          settledAt: "2026-09-01T00:00:00.000Z",
        }),
      }),
    ]);

    expect(screen.queryByRole("region", { name: /needs your attention/i })).not.toBeInTheDocument();
  });

  it("keeps its count over every campaign, not over the filtered set", () => {
    renderPortfolio(waitingSet(5));
    fireEvent.change(screen.getByRole("searchbox", { name: /search campaigns/i }), {
      target: { value: "Campaign 1" },
    });

    const strip = within(screen.getByRole("region", { name: /needs your attention/i }));
    expect(strip.getByText("5")).toBeInTheDocument();
  });
});

describe("status filters are groupings, not a new lifecycle", () => {
  it("filters to the campaigns waiting on a review", () => {
    renderPortfolio([
      item({ id: "a1000000-0000-4000-8000-000000000001" }),
      item({
        id: "a1000000-0000-4000-8000-000000000002",
        phase: campaignListPhase({
          state: "approved",
          hasVersion: true,
          approvalStatus: "live",
          settledAt: null,
        }),
      }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Preparing" }));

    expect(cardsOnly()).toHaveLength(1);
    expect(screen.getByText("Showing 1 of 2 campaigns")).toBeInTheDocument();
  });

  it("offers a way back when a filter hides everything", () => {
    renderPortfolio([item()]);
    fireEvent.click(screen.getByRole("button", { name: "Completed" }));

    expect(screen.getByText(/nothing matches these filters/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /clear filters/i }));

    expect(cardsOnly()).toHaveLength(1);
  });
});
