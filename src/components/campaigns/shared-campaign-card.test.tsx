// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from "sonner";
import {
  resolveCampaignStateChip,
  SharedCampaignCard,
  SharedCompactCampaignRow,
  WAITING_DESCRIPTION,
  type SharedCampaignCardProps,
} from "@/components/campaigns/shared-campaign-card";
import type { CampaignGeneration } from "@/modules/campaigns/application/studio-view";

afterEach(() => {
  cleanup();
  mocks.refresh.mockClear();
  vi.unstubAllGlobals();
});

const settled: CampaignGeneration = {
  status: "settled",
  detail: null,
  nextAction: null,
  retryable: false,
  blocker: null,
  missingDetails: [],
};

const HREF = "/organizations/org-1/campaigns/camp-1";

function props(overrides: Partial<SharedCampaignCardProps> = {}): SharedCampaignCardProps {
  return {
    title: "Weekday lunch edit",
    description: "A new reason to make lunch a ritual.",
    href: HREF,
    updatedAt: "2026-09-10T10:00:00.000Z",
    timeZone: "Asia/Dubai",
    stateLabel: "Ready for review",
    stateTone: "warning",
    previewUrl: "https://signed.example/cover.png",
    coverAlt: "Campaign artwork",
    imageFit: "cover",
    coverChip: null,
    fallbackHint: null,
    generation: settled,
    primaryAction: { label: "Review campaign", href: HREF },
    restart: null,
    repair: null,
    ...overrides,
  };
}

describe("resolveCampaignStateChip", () => {
  it("maps ready_for_review to Ready for review in amber", () => {
    expect(resolveCampaignStateChip({ state: "ready_for_review" })).toEqual({
      label: "Ready for review",
      tone: "warning",
    });
  });

  it("maps the portfolio review phases to Ready for review, never bare need review", () => {
    expect(resolveCampaignStateChip({ phase: "review" })).toEqual({
      label: "Ready for review",
      tone: "warning",
    });
    expect(resolveCampaignStateChip({ phase: "proposal" })).toEqual({
      label: "Ready for review",
      tone: "warning",
    });
  });

  it("keeps drafts green", () => {
    expect(resolveCampaignStateChip({ state: "draft" })).toEqual({
      label: "Draft",
      tone: "success",
    });
  });

  it("keeps the portfolio phase vocabulary for the rest, tinting needs-look states amber", () => {
    expect(resolveCampaignStateChip({ phase: "creating" })).toEqual({
      label: "Preparing",
      tone: "success",
    });
    expect(resolveCampaignStateChip({ phase: "stopped", state: "failed" })).toEqual({
      label: "Stopped",
      tone: "warning",
    });
  });
});

describe("SharedCampaignCard artwork", () => {
  it("overlays Finished render on the image by default", () => {
    const { container } = render(<SharedCampaignCard {...props()} />);
    const chip = screen.getByText("Finished render");
    expect(chip.tagName).toBe("SPAN");
    // The chip shares its container with the artwork image: it overlays the
    // art instead of rendering as a plain-text line in the info block.
    expect(chip.parentElement?.querySelector("img")).toBeInTheDocument();
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "https://signed.example/cover.png",
    );
  });

  it("shows the caller's cover label verbatim when provided", () => {
    render(<SharedCampaignCard {...props({ coverChip: "Campaign image" })} />);
    expect(screen.getByText("Campaign image")).toBeInTheDocument();
    expect(screen.queryByText("Finished render")).not.toBeInTheDocument();
  });

  it("renders an honest fallback with no image when there is no preview", () => {
    const { container } = render(
      <SharedCampaignCard
        {...props({ previewUrl: null, fallbackHint: "Creative generation begins after approval" })}
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("No preview available")).toBeInTheDocument();
    expect(screen.getByText("Creative generation begins after approval")).toBeInTheDocument();
  });

  it("is shaped like the prototype card with a green hover", () => {
    const { container } = render(<SharedCampaignCard {...props()} />);
    const card = container.querySelector('[data-slot="card"]');
    expect(card?.className).toContain("rounded-2xl");
    expect(card?.className).toContain("overflow-hidden");
    expect(card?.className).toContain("hover:border-[#b6c8b8]");
  });
});

describe("SharedCampaignCard body", () => {
  it("shows the state tag above the title and description only", () => {
    render(<SharedCampaignCard {...props()} />);
    expect(screen.getByText("Ready for review").className).toContain("bg-warning/18");
    expect(screen.getByRole("heading", { name: "Weekday lunch edit" })).toBeInTheDocument();
    expect(screen.getByText("A new reason to make lunch a ritual.")).toBeInTheDocument();
  });

  it("falls back to the waiting line when no proposal exists yet", () => {
    render(<SharedCampaignCard {...props({ description: null })} />);
    expect(screen.getByText(WAITING_DESCRIPTION)).toBeInTheDocument();
  });

  it("renders no failure box and no repair trigger for a settled campaign", () => {
    render(<SharedCampaignCard {...props()} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add the missing details/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("SharedCampaignCard generation states", () => {
  const generating: CampaignGeneration = {
    status: "generating",
    detail: "Building the first proposal.",
    nextAction: null,
    retryable: false,
    blocker: null,
    missingDetails: [],
  };

  it("keeps a small inline status line while generating", () => {
    render(<SharedCampaignCard {...props({ generation: generating })} />);
    expect(screen.getByRole("status")).toHaveTextContent("Building the first proposal.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows only the missing-details trigger on failure, never an Alert box", () => {
    render(
      <SharedCampaignCard
        {...props({
          generation: {
            status: "failed",
            detail: "Some details are missing before this campaign can be built.",
            nextAction: "Add the missing details, then start it again.",
            retryable: true,
            blocker: null,
            missingDetails: ["brand_voice"],
          },
          repair: {
            organizationId: "org-1",
            campaignId: "camp-1",
            missingDetails: ["brand_voice"],
            metricOptions: [],
            currency: null,
          },
        })}
      />,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Generation failed")).not.toBeInTheDocument();
    expect(screen.queryByText("brand_voice")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add the missing details/i })).toBeEnabled();
  });

  it("shows nothing in the body for a failure with no missing details", () => {
    render(
      <SharedCampaignCard
        {...props({
          generation: {
            status: "stalled",
            detail: "Generation stopped responding and did not finish.",
            nextAction: "Start it again.",
            retryable: true,
            blocker: null,
            missingDetails: [],
          },
          primaryAction: null,
          restart: { organizationId: "org-1", campaignId: "camp-1", label: "Generate again" },
        })}
      />,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add the missing details/i })).not.toBeInTheDocument();
  });
});

describe("SharedCampaignCard foot", () => {
  it("keeps the updated date left and the verbatim green action link right", () => {
    const { container } = render(<SharedCampaignCard {...props()} />);
    const card = within(container.querySelector('[data-slot="card"]') as HTMLElement);
    // 2026-09-10T10:00Z is 10 Sep in Asia/Dubai, rendered short with no year.
    const date = card.getByText("10 Sep");
    expect(date.closest("time")).toHaveAttribute("dateTime", "2026-09-10T10:00:00.000Z");
    const cta = card.getByRole("link", { name: /review campaign/i });
    expect(cta).toHaveAttribute("href", HREF);
    expect(cta.className).toContain("text-primary");
    expect(cta.querySelector("svg")).not.toBeNull();
  });

  it("renders the restart with the same green link style and arrow", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <SharedCampaignCard
        {...props({
          primaryAction: null,
          restart: { organizationId: "org-1", campaignId: "camp-1", label: "Generate again" },
        })}
      />,
    );
    const restart = screen.getByRole("button", { name: /generate again/i });
    expect(restart.className).toContain("text-primary");
    expect(restart.querySelector("svg")).not.toBeNull();

    fireEvent.click(restart);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      "/api/organizations/org-1/campaigns/camp-1/generate",
    );
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(vi.mocked(toast.success)).toHaveBeenCalled();
  });
});

describe("SharedCompactCampaignRow", () => {
  it("renders title, verbatim reason, Needs attention tag and View link", () => {
    render(
      <SharedCompactCampaignRow
        title="The afternoon pause"
        reason="No proposal yet · generation stopped"
        href="/organizations/org-1/campaigns"
        ctaLabel="View"
        ariaLabel="Third campaign"
      />,
    );
    const row = screen.getByLabelText("Third campaign");
    expect(within(row).getByText("The afternoon pause")).toBeInTheDocument();
    expect(within(row).getByText("No proposal yet · generation stopped")).toBeInTheDocument();
    expect(within(row).getByText("Needs attention").className).toContain("bg-warning/18");
    const cta = within(row).getByRole("link", { name: /^view/i });
    expect(cta).toHaveAttribute("href", "/organizations/org-1/campaigns");
    expect(cta.className).toContain("text-primary");
    expect(cta.querySelector("svg")).not.toBeNull();
    expect(within(row).queryByRole("button")).toBeNull();
  });

  it("omits the reason line when there is nothing truthful to put there", () => {
    render(
      <SharedCompactCampaignRow
        title="The afternoon pause"
        reason={null}
        href="/organizations/org-1/campaigns"
        ctaLabel="View"
      />,
    );
    expect(screen.getByText("The afternoon pause")).toBeInTheDocument();
    expect(screen.queryByText(/generation stopped/)).not.toBeInTheDocument();
  });
});
