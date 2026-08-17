// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CampaignPortfolio } from "@/components/campaigns/campaign-portfolio";
import type { CampaignListItem } from "@/modules/campaigns/application/studio-view";

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
    generation: { status: "settled", detail: null },
    version: 2,
    objective: "Raise incremental gross profit on weekday evenings",
    channels: ["instagram", "meta_ads"],
    spendCeiling: { amountMinor: 45_000, currency: "AED" },
    ...overrides,
  };
}

function renderPortfolio(campaigns: readonly CampaignListItem[]) {
  return render(
    <CampaignPortfolio
      organizationId={ORGANIZATION_ID}
      campaigns={campaigns}
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
        generation: { status: "generating", detail: "Building the first proposal." },
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
    renderPortfolio([pending({ status: "generating", detail: "Building the first proposal." })]);
    const card = within(screen.getByRole("listitem"));

    // Neither the title nor the review control may navigate. The detail route
    // has no version to render, and `disabled` does not stop an anchor.
    expect(card.queryByRole("link")).not.toBeInTheDocument();
    expect(card.getByRole("button", { name: /review/i })).toBeDisabled();
  });

  it("keeps the title readable even though it is no longer a link", () => {
    renderPortfolio([pending({ status: "generating", detail: "Building the first proposal." })]);

    expect(screen.getByText("Weekday evening demand lift")).toBeInTheDocument();
  });

  it("shows a spinner only while a worker is actually running", () => {
    renderPortfolio([pending({ status: "generating", detail: "Building the first proposal." })]);
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
      }),
    ]);
    const card = within(screen.getByRole("listitem"));

    expect(card.getByText(/generation failed/i)).toBeInTheDocument();
    expect(card.getByText(/brand_voice/)).toBeInTheDocument();
  });

  it("says nothing about generation once a proposal exists", () => {
    renderPortfolio([item()]);
    const card = within(screen.getByRole("listitem"));

    expect(card.queryByRole("status")).not.toBeInTheDocument();
    expect(card.getAllByRole("link").length).toBeGreaterThan(0);
  });
});
