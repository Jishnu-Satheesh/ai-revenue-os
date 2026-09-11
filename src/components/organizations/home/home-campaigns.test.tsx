// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: vi.fn() }),
}));

const mocks = {
  refresh: vi.fn(),
};

import { HomeCampaigns } from "@/components/organizations/home/home-campaigns";
import type {
  HomeCampaign,
  HomeSection,
} from "@/modules/organizations/application/home-types";

afterEach(() => {
  cleanup();
  mocks.refresh.mockClear();
});

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN_1 = "44444444-4444-4444-8444-444444444441";
const CAMPAIGN_2 = "44444444-4444-4444-8444-444444444442";
const CAMPAIGN_3 = "44444444-4444-4444-8444-444444444443";
const TIME_ZONE = "Asia/Dubai";

function campaign(overrides: Partial<HomeCampaign> = {}): HomeCampaign {
  return {
    id: CAMPAIGN_1,
    title: "Ramadan Push",
    objective: "Drive iftar orders",
    state: "ready_for_review",
    generation: { status: "settled", detail: null },
    openable: true,
    updatedAt: "2026-09-10T10:00:00.000Z",
    actionLabel: "Review campaign",
    href: `/organizations/${ORG_ID}/campaigns/${CAMPAIGN_1}`,
    cover: null,
    coverLabel: null,
    ...overrides,
  };
}

function ready(data: readonly HomeCampaign[]): HomeSection<readonly HomeCampaign[]> {
  return { status: "ready", data, fetchedAt: "2026-09-11T08:00:00.000Z" };
}

describe("HomeCampaigns layouts", () => {
  it("renders one campaign as a single card with no compact row", () => {
    render(
      <HomeCampaigns
        organizationId={ORG_ID}
        timeZone={TIME_ZONE}
        section={ready([campaign()])}
        canCreateCampaign
      />,
    );
    expect(screen.getByRole("heading", { name: "Ramadan Push" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /review campaign/i })).toHaveAttribute(
      "href",
      `/organizations/${ORG_ID}/campaigns/${CAMPAIGN_1}`,
    );
    expect(screen.queryByRole("link", { name: /third campaign/i })).not.toBeInTheDocument();
  });

  it("renders two large cards for two campaigns", () => {
    render(
      <HomeCampaigns
        organizationId={ORG_ID}
        timeZone={TIME_ZONE}
        section={ready([
          campaign(),
          campaign({ id: CAMPAIGN_2, title: "Second Push", actionLabel: "View campaign" }),
        ])}
        canCreateCampaign
      />,
    );
    expect(screen.getByRole("heading", { name: "Ramadan Push" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Second Push" })).toBeInTheDocument();
  });

  it("renders the third campaign once, as a compact row", () => {
    render(
      <HomeCampaigns
        organizationId={ORG_ID}
        timeZone={TIME_ZONE}
        section={ready([
          campaign(),
          campaign({
            id: CAMPAIGN_2,
            title: "Second Push",
            actionLabel: "View campaign",
            href: `/organizations/${ORG_ID}/campaigns/${CAMPAIGN_2}`,
          }),
          campaign({
            id: CAMPAIGN_3,
            title: "Third Push",
            actionLabel: "View campaign",
            href: `/organizations/${ORG_ID}/campaigns/${CAMPAIGN_3}`,
          }),
        ])}
        canCreateCampaign
      />,
    );
    expect(screen.getByRole("heading", { name: "Ramadan Push" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Second Push" })).toBeInTheDocument();
    // The third record appears exactly once: a named compact row, never a third cover card.
    expect(screen.getAllByText("Third Push")).toHaveLength(1);
    const thirdLink = screen
      .getAllByRole("link", { name: "View campaign" })
      .find(
        (link) =>
          link.getAttribute("href") ===
          `/organizations/${ORG_ID}/campaigns/${CAMPAIGN_3}`,
      );
    expect(thirdLink).toBeDefined();
  });

  it("routes a no-version campaign to the portfolio with a portfolio label", () => {
    render(
      <HomeCampaigns
        organizationId={ORG_ID}
        timeZone={TIME_ZONE}
        section={ready([
          campaign({
            openable: false,
            actionLabel: "View in Campaigns",
            href: `/organizations/${ORG_ID}/campaigns`,
          }),
        ])}
        canCreateCampaign
      />,
    );
    const link = screen.getByRole("link", { name: /view in campaigns/i });
    expect(link).toHaveAttribute("href", `/organizations/${ORG_ID}/campaigns`);
  });

  it("preserves the fallback artwork label instead of hiding it", () => {
    render(
      <HomeCampaigns
        organizationId={ORG_ID}
        timeZone={TIME_ZONE}
        section={ready([
          campaign({
            cover: {
              url: "https://signed.example/cover",
              alt: "Campaign artwork",
              width: 1200,
              height: 800,
              expiresAt: "2026-09-11T08:10:00.000Z",
            },
            coverLabel: "Campaign image",
          }),
        ])}
        canCreateCampaign
      />,
    );
    expect(screen.getByText("Campaign image")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Campaign artwork" })).toBeInTheDocument();
  });

  it("shows viewer wording with no creation affordance", () => {
    render(
      <HomeCampaigns
        organizationId={ORG_ID}
        timeZone={TIME_ZONE}
        section={ready([
          campaign({ state: "draft", actionLabel: "View campaign" }),
        ])}
        canCreateCampaign={false}
      />,
    );
    expect(screen.getByRole("link", { name: /view campaign/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /new campaign/i })).not.toBeInTheDocument();
  });
});

describe("HomeCampaigns states", () => {
  it("keeps empty and failed visually distinct, with a working retry on failure", () => {
    const { rerender } = render(
      <HomeCampaigns
        organizationId={ORG_ID}
        timeZone={TIME_ZONE}
        section={ready([])}
        canCreateCampaign
      />,
    );
    expect(screen.getByText(/no campaigns yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/could not be loaded/i)).not.toBeInTheDocument();

    rerender(
      <HomeCampaigns
        organizationId={ORG_ID}
        timeZone={TIME_ZONE}
        section={{ status: "failed", code: "HOME_READ_FAILED" }}
        canCreateCampaign
      />,
    );
    expect(screen.getByText(/campaigns could not be loaded/i)).toBeInTheDocument();
    expect(screen.queryByText(/no campaigns yet/i)).not.toBeInTheDocument();

    const retry = screen.getByRole("button", { name: /retry/i });
    expect(retry).toBeEnabled();
    fireEvent.click(retry);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("omits gated sections silently", () => {
    const { container } = render(
      <HomeCampaigns
        organizationId={ORG_ID}
        timeZone={TIME_ZONE}
        section={{ status: "disabled" }}
        canCreateCampaign={false}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
