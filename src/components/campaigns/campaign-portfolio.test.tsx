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
    generation: { status: "settled", detail: null, nextAction: null, retryable: false, blocker: null },
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

    expect(screen.getByRole("link", { name: /new campaign brief/i })).toHaveAttribute(
      "href",
      `/organizations/${ORGANIZATION_ID}/campaigns/new`,
    );
    expect(screen.getByRole("link", { name: /start from an opportunity/i })).toHaveAttribute(
      "href",
      `/organizations/${ORGANIZATION_ID}/opportunities`,
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
  it("shows the objective, channels and ceiling once a version exists", () => {
    renderPortfolio([item()]);
    const card = within(screen.getByRole("listitem"));

    expect(card.getByText(/raise incremental gross profit/i)).toBeInTheDocument();
    expect(card.getByText("instagram · meta_ads")).toBeInTheDocument();
    expect(card.getByText(/AED\s?450\.00/)).toBeInTheDocument();
  });

  it("says a proposal is still being generated rather than showing blank facts", () => {
    renderPortfolio([
      item({
        awaitingFirstVersion: true,
        openable: false,
        generation: { status: "generating", detail: "Building the first proposal.", nextAction: null, retryable: false, blocker: null },
        version: null,
        objective: null,
        channels: [],
        spendCeiling: null,
      }),
    ]);
    const card = within(screen.getByRole("listitem"));

    expect(card.getByText(/waiting for the first proposal/i)).toBeInTheDocument();
    expect(card.queryByText(/spend ceiling/i)).not.toBeInTheDocument();
    expect(card.queryByText(/^v/)).not.toBeInTheDocument();
  });

  it("distinguishes no paid spend from a ceiling of zero", () => {
    renderPortfolio([item({ spendCeiling: null })]);

    expect(screen.getByText("No paid spend")).toBeInTheDocument();
    expect(screen.queryByText(/0\.00/)).not.toBeInTheDocument();
  });

  it("labels every campaign state in words rather than raw database values", () => {
    renderPortfolio([
      item({ id: "a", state: "partially_completed" }),
      item({ id: "b", state: "needs_data" }),
      item({ id: "c", state: "failed" }),
    ]);

    expect(screen.getByText("Partially completed")).toBeInTheDocument();
    expect(screen.getByText("Needs data")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.queryByText(/partially_completed|needs_data/)).not.toBeInTheDocument();
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
    expect(screen.getByRole("link", { name: /new campaign brief/i })).toBeInTheDocument();
  });
});

describe("a campaign with no proposal cannot be opened", () => {
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

  it("offers no link at all, rather than a link that 404s", () => {
    renderPortfolio([pending({ status: "generating", detail: "Building the first proposal.", nextAction: null, retryable: false, blocker: null })]);
    const card = within(screen.getByRole("listitem"));

    // Neither the title nor the review control may navigate. The detail route
    // has no version to render, and `disabled` does not stop an anchor.
    expect(card.queryByRole("link")).not.toBeInTheDocument();
    expect(card.getByRole("button", { name: /open/i })).toBeDisabled();
  });

  it("keeps the title readable even though it is no longer a link", () => {
    renderPortfolio([pending({ status: "generating", detail: "Building the first proposal.", nextAction: null, retryable: false, blocker: null })]);

    expect(screen.getByText("Weekday evening demand lift")).toBeInTheDocument();
  });

  it("shows a spinner only while a worker is actually running", () => {
    renderPortfolio([pending({ status: "generating", detail: "Building the first proposal.", nextAction: null, retryable: false, blocker: null })]);
    const card = within(screen.getByRole("listitem"));

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
      }),
    ]);
    const card = within(screen.getByRole("listitem"));

    expect(card.getByText(/generation did not finish/i)).toBeInTheDocument();
    expect(card.getByText(/stopped responding/i)).toBeInTheDocument();
  });

  it("names what generation still needs when it failed for want of evidence", () => {
    renderPortfolio([
      pending({
        status: "failed",
        detail: "Generation needs more information first: brand_voice, objective.",
        nextAction: "Start it again.",
        retryable: true,
        blocker: null,
      }),
    ]);
    const card = within(screen.getByRole("listitem"));

    expect(card.getByText(/generation failed/i)).toBeInTheDocument();
    expect(card.getByText(/brand_voice/)).toBeInTheDocument();
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
      }),
    ]);
    const card = within(screen.getByRole("listitem"));

    expect(card.getByRole("button", { name: /generate again/i })).toBeEnabled();
  });

  it("does not offer a restart while a worker still holds the run", () => {
    renderPortfolio([pending({ status: "generating", detail: "Building the first proposal.", nextAction: null, retryable: false, blocker: null })]);
    const card = within(screen.getByRole("listitem"));

    expect(card.queryByRole("button", { name: /generate again/i })).not.toBeInTheDocument();
    expect(card.getByRole("button", { name: /open/i })).toBeDisabled();
  });

  it("says nothing about generation once a proposal exists", () => {
    renderPortfolio([item()]);
    const card = within(screen.getByRole("listitem"));

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

    expect(screen.getByText(/nothing matches that search/i)).toBeInTheDocument();
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
    expect(screen.getByText(/no artwork yet/i)).toBeInTheDocument();

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

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});
