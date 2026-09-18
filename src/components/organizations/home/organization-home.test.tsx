// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: vi.fn() }),
}));

// React's own pending flag is the only thing that shows the refresh state:
// forcing it here pins the visible pending copy without racing the transition.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useTransition: () => [true, (start: () => void) => start()],
  };
});

const mocks = {
  refresh: vi.fn(),
};

import { OrganizationHome } from "@/components/organizations/home/organization-home";
import { buildBehindGrowthSection } from "@/components/organizations/home/home-growth-fixtures";
import styles from "@/components/organizations/home/organization-home.module.css";
import type {
  HomeActivityItem,
  HomeAsset,
  HomeAttentionItem,
  HomeCampaign,
  HomeGoal,
  OrganizationHomeView,
} from "@/modules/organizations/application/home-types";

afterEach(() => {
  cleanup();
  mocks.refresh.mockClear();
});

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN_1 = "44444444-4444-4444-8444-444444444441";
const NOW = "2026-09-11T08:00:00.000Z";

function campaign(overrides: Partial<HomeCampaign> = {}): HomeCampaign {
  return {
    id: CAMPAIGN_1,
    title: "Ramadan Push",
    objective: "Drive iftar orders",
    state: "ready_for_review",
    generation: {
      status: "settled",
      detail: null,
      nextAction: null,
      retryable: false,
      blocker: null,
      missingDetails: [],
    },
    openable: true,
    updatedAt: "2026-09-10T10:00:00.000Z",
    actionLabel: "Review campaign",
    href: `/organizations/${ORG_ID}/campaigns/${CAMPAIGN_1}`,
    cover: null,
    coverLabel: null,
    ...overrides,
  };
}

function asset(overrides: Partial<HomeAsset> = {}): HomeAsset {
  return {
    id: "poster:55555555-5555-4555-8555-555555555551",
    sourceKind: "poster_render",
    label: "Ramadan Push · ramadan-hero · iftar spread",
    sourceLabel: "Finished poster render",
    reviewLabel: "Review not recorded",
    reviewState: "unreviewed",
    recordedAt: "2026-09-09T10:00:00.000Z",
    image: {
      url: "https://signed.example/poster-1",
      alt: "Ramadan poster render",
      width: 1200,
      height: 800,
      expiresAt: "2026-09-11T08:10:00.000Z",
    },
    sourceHref: `/organizations/${ORG_ID}/campaigns/${CAMPAIGN_1}?version=66666666-6666-4666-8666-666666666661`,
    ...overrides,
  };
}

function goal(overrides: Partial<HomeGoal> = {}): HomeGoal {
  return {
    id: "33333333-3333-4333-8333-333333333331",
    name: "Grow orders",
    target: "500 orders",
    deadline: "2026-12-31T20:00:00.000Z",
    scopeLabel: "Organization",
    ...overrides,
  };
}

function attention(overrides: Partial<HomeAttentionItem> = {}): HomeAttentionItem {
  return {
    id: `campaign:${CAMPAIGN_1}`,
    sourceLabel: "Campaign",
    title: "Ramadan Push",
    reason: "Campaign is ready for review.",
    actionLabel: "Review campaign",
    href: `/organizations/${ORG_ID}/campaigns/${CAMPAIGN_1}`,
    ...overrides,
  };
}

function activity(overrides: Partial<HomeActivityItem> = {}): HomeActivityItem {
  return {
    id: `campaign:${CAMPAIGN_1}`,
    label: "Campaign updated",
    title: "Ramadan Push",
    occurredAt: "2026-09-10T10:00:00.000Z",
    href: `/organizations/${ORG_ID}/campaigns/${CAMPAIGN_1}`,
    kind: "campaign",
    ...overrides,
  };
}

function view(overrides: Partial<OrganizationHomeView> = {}): OrganizationHomeView {
  return {
    organizationId: ORG_ID,
    name: "Al Noor Kitchen",
    description: "Family meals",
    status: "active",
    timeZone: "Asia/Dubai",
    currency: "AED",
    logo: null,
    locations: [
      { id: "22222222-2222-4222-8222-222222222221", name: "Deira", kind: "physical" },
      { id: "22222222-2222-4222-8222-222222222222", name: "Online", kind: "virtual" },
    ],
    branchlessConfirmed: false,
    goals: [goal()],
    focusGoalId: "33333333-3333-4333-8333-333333333331",
    permissions: {
      canCreateCampaign: true,
      canEditCampaign: true,
      canReviewCampaign: true,
      canManageCore: true,
    },
    campaigns: { status: "ready", data: [campaign()], fetchedAt: NOW },
    assets: { status: "ready", data: [asset()], fetchedAt: NOW },
    assetsPartial: false,
    revenue: { status: "disabled" },
    growthProgress: { state: "disabled" },
    attention: [attention()],
    attentionIncomplete: false,
    destinations: [
      {
        key: "channels",
        label: "Channels",
        description: "See channel performance and explore your reports.",
        href: `/organizations/${ORG_ID}/channels`,
      },
      {
        key: "memory",
        label: "Business Memory",
        description: "Keep your business knowledge and decisions together.",
        href: `/organizations/${ORG_ID}/memory`,
      },
    ],
    activity: [activity()],
    ...overrides,
  };
}

describe("OrganizationHome composition", () => {
  it("renders sections in reading order: identity, campaigns, library, attention, goals, destinations, activity", () => {
    render(<OrganizationHome view={view()} />);
    const headings = screen.getAllByRole("heading").map((heading) => heading.textContent ?? "");
    const order = [
      "Al Noor Kitchen",
      "Your campaigns",
      "Your creative library",
      "For your attention",
      "Your focus",
      "Around your business",
      "Recent activity",
    ];
    let cursor = -1;
    for (const expected of order) {
      const index = headings.findIndex(
        (text, position) => position > cursor && text.includes(expected),
      );
      expect(index, `expected heading "${expected}" after position ${cursor}`).toBeGreaterThan(
        cursor,
      );
      cursor = index;
    }
  });

  it("keeps an empty module distinct from a failed one", () => {
    render(
      <OrganizationHome
        view={view({
          campaigns: { status: "failed", code: "HOME_READ_FAILED" },
          assets: { status: "ready", data: [], fetchedAt: NOW },
        })}
      />,
    );
    expect(screen.getByText(/campaigns could not be loaded/i)).toBeInTheDocument();
    expect(screen.getByText(/no saved work yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/recent work could not be loaded/i)).not.toBeInTheDocument();
  });

  it("warns on a partial gallery while keeping survivors", () => {
    render(<OrganizationHome view={view({ assetsPartial: true })} />);
    expect(screen.getByText(/some recent work could not be loaded/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /ramadan push · ramadan-hero · iftar spread/i }),
    ).toBeInTheDocument();
  });

  it("shows pending refresh feedback while refreshing", () => {
    render(
      <OrganizationHome
        view={view({ campaigns: { status: "failed", code: "HOME_READ_FAILED" } })}
      />,
    );
    // The forced pending flag pins this copy; the click-to-refresh wiring is
    // pinned in the section suites with a live transition.
    const retry = screen.getByRole("button", { name: /refreshing/i });
    expect(retry).toBeDisabled();
  });

  it("shows the saved goal target and lists every goal with its scope", async () => {
    const user = userEvent.setup();
    render(
      <OrganizationHome
        view={view({
          goals: [
            goal(),
            goal({
              id: "33333333-3333-4333-8333-333333333332",
              name: "Deira sprint",
              target: "200 orders",
              scopeLabel: "Deira",
            }),
          ],
        })}
      />,
    );
    expect(screen.getByText("500 orders")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /view goals/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Grow orders")).toBeInTheDocument();
    expect(within(dialog).getByText("Deira sprint")).toBeInTheDocument();
    expect(dialog.textContent ?? "").toMatch(/Organization/);
    expect(dialog.textContent ?? "").toMatch(/Deira/);
  });

  it("renders activity from labels and titles only, with no publish wording", () => {
    const { container } = render(
      <OrganizationHome
        view={view({
          activity: [
            activity(),
            activity({
              id: "audit:aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaa1",
              label: "Goal added",
              title: "Grow orders",
              occurredAt: "2026-09-05T10:00:00.000Z",
              href: "#organization-management",
              kind: "organization",
            }),
          ],
        })}
      />,
    );
    expect(screen.getByText("Campaign updated")).toBeInTheDocument();
    expect(screen.getByText("Goal added")).toBeInTheDocument();
    expect(container.textContent ?? "").not.toMatch(/published/i);
    expect(container.textContent ?? "").not.toMatch(/payload/i);
  });

  it("marks long and RTL names to render in their own direction at narrow widths", () => {
    render(
      <OrganizationHome
        view={view({
          name: "مطبخ النور للعائلات الكبيرة جدا",
          campaigns: {
            status: "ready",
            data: [campaign({ title: "مطبخ النور حملة رمضان الكبيرة" })],
            fetchedAt: NOW,
          },
          attention: [],
          activity: [],
        })}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveAttribute("dir", "auto");
    expect(screen.getByRole("heading", { name: /مطبخ النور حملة/ })).toHaveAttribute("dir", "auto");
  });

  it("shows the viewer campaign wording with no create or manage affordances", () => {
    render(
      <OrganizationHome
        view={view({
          permissions: {
            canCreateCampaign: false,
            canEditCampaign: false,
            canReviewCampaign: false,
            canManageCore: false,
          },
          campaigns: {
            status: "ready",
            data: [campaign({ actionLabel: "View campaign" })],
            fetchedAt: NOW,
          },
        })}
      />,
    );
    const campaigns = screen.getByRole("region", { name: "Your campaigns" });
    expect(within(campaigns).getByRole("link", { name: "View campaign" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /new campaign/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /manage/i })).not.toBeInTheDocument();
  });
});

describe("OrganizationHome destinations parity (D1)", () => {
  it("renders borderless cells with the icon above the title, arrow and description", () => {
    render(<OrganizationHome view={view()} />);
    const region = screen.getByRole("region", { name: "Around your business" });
    const links = within(region).getAllByRole("link");
    expect(links).toHaveLength(2);
    const channels = within(region).getByRole("link", { name: /channels/i });
    expect(
      within(channels).getByText("See channel performance and explore your reports."),
    ).toBeInTheDocument();
    // Icon-above treatment: the decorative icon precedes the title in DOM order,
    // and the title carries an onward arrow icon (a second svg).
    const icon = channels.querySelector("svg");
    expect(icon).not.toBeNull();
    const title = within(channels).getByText("Channels");
    expect(
      (icon as Element).compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(channels.querySelectorAll("svg")).toHaveLength(2);
  });

  it("reflows gated destinations with no placeholder cells", () => {
    const orgId = ORG_ID;
    render(
      <OrganizationHome
        view={view({
          destinations: [
            {
              key: "channels",
              label: "Channels",
              description: "See channel performance and explore your reports.",
              href: `/organizations/${orgId}/channels`,
            },
            {
              key: "growth",
              label: "Growth Intelligence",
              description: "Explore findings, recommendations and your actions.",
              href: `/organizations/${orgId}/growth-intelligence`,
            },
            {
              key: "memory",
              label: "Business Memory",
              description: "Keep your business knowledge and decisions together.",
              href: `/organizations/${orgId}/memory`,
            },
          ],
        })}
      />,
    );
    const region = screen.getByRole("region", { name: "Around your business" });
    // Odd count, one gate hidden: exactly the authorized links, every one named.
    const links = within(region).getAllByRole("link");
    expect(links).toHaveLength(3);
    for (const link of links) {
      expect(link.getAttribute("href")).toBeTruthy();
      expect(link.textContent?.trim()).not.toBe("");
    }
  });

  it("omits the destinations section when nothing is authorized", () => {
    render(<OrganizationHome view={view({ destinations: [] })} />);
    expect(screen.queryByRole("region", { name: "Around your business" })).not.toBeInTheDocument();
  });
});

describe("OrganizationHome activity parity (D2)", () => {
  it("caps rows at five with a per-kind icon, label before bold title, and zoned date", () => {
    const items = [
      activity({
        id: "campaign:c1",
        label: "Campaign updated",
        title: "Ramadan Push",
        occurredAt: "2026-09-10T10:00:00.000Z",
        kind: "campaign",
      }),
      activity({
        id: "poster:p1",
        label: "Poster rendered",
        title: "Iftar spread",
        occurredAt: "2026-09-09T10:00:00.000Z",
        kind: "asset",
      }),
      activity({
        id: "audit:g1",
        label: "Goal added",
        title: "Grow orders",
        occurredAt: "2026-09-08T10:00:00.000Z",
        kind: "organization",
      }),
      activity({
        id: "campaign:c2",
        label: "Campaign updated",
        title: "Second push",
        occurredAt: "2026-09-07T10:00:00.000Z",
        kind: "campaign",
      }),
      activity({
        id: "poster:p2",
        label: "Reference added",
        title: "Brand mark",
        occurredAt: "2026-09-06T10:00:00.000Z",
        kind: "asset",
      }),
      activity({
        id: "audit:g2",
        label: "Location added",
        title: "Deira",
        occurredAt: "2026-09-05T10:00:00.000Z",
        kind: "organization",
      }),
    ];
    render(<OrganizationHome view={view({ activity: items })} />);
    const region = screen.getByRole("region", { name: "Recent activity" });
    const rows = within(region).getAllByRole("listitem");
    expect(rows).toHaveLength(5);
    expect(within(region).queryByText("Deira")).not.toBeInTheDocument();
    // Per-kind icon mapping: campaign Megaphone, asset Images, goal/org Target.
    expect(rows[0].querySelector("svg.lucide-megaphone")).not.toBeNull();
    expect(rows[1].querySelector("svg.lucide-images")).not.toBeNull();
    expect(rows[2].querySelector("svg.lucide-target")).not.toBeNull();
    for (const row of rows) {
      const icon = row.querySelector("svg");
      expect(icon).not.toBeNull();
      // Icon-left treatment: the decorative icon precedes the label text.
      const label = within(row).getByText(
        /Campaign updated|Poster rendered|Goal added|Reference added/,
      );
      expect(
        (icon as Element).compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    // Emphasis order: small gray label first, bold title second.
    const firstLabel = within(rows[0]).getByText("Campaign updated");
    const firstTitle = within(rows[0]).getByText("Ramadan Push");
    expect(
      firstLabel.compareDocumentPosition(firstTitle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(region).getByText("10 Sep 2026 · 14:00, Asia/Dubai")).toBeInTheDocument();
  });

  it("links a row only when the view carries an href", () => {
    render(
      <OrganizationHome
        view={view({
          activity: [
            activity({
              id: "audit:g1",
              label: "Goal added",
              title: "Grow orders",
              href: null,
              kind: "organization",
            }),
            activity({
              id: "campaign:c1",
              label: "Campaign updated",
              title: "Ramadan Push",
              kind: "campaign",
            }),
          ],
        })}
      />,
    );
    const region = screen.getByRole("region", { name: "Recent activity" });
    expect(within(region).getByRole("link", { name: "Ramadan Push" })).toBeInTheDocument();
    expect(within(region).queryByRole("link", { name: "Grow orders" })).toBeNull();
    expect(within(region).getByText("Grow orders")).toBeInTheDocument();
  });
});

describe("OrganizationHome attention wording", () => {
  it("counts what is shown and states partial checks explicitly", () => {
    render(
      <OrganizationHome
        view={view({
          attention: [
            attention(),
            attention({
              id: "org:missing-goals",
              sourceLabel: "Organization",
              title: "Add a goal",
              reason: "No organization goal is on file yet.",
              actionLabel: "Add it",
              href: "#organization-management",
            }),
          ],
          attentionIncomplete: true,
        })}
      />,
    );
    expect(screen.getByText("2 shown")).toBeInTheDocument();
    expect(screen.getByText(/not everything could be checked/i)).toBeInTheDocument();
    expect(
      screen.queryByText("Nothing in the recent work shown needs attention."),
    ).not.toBeInTheDocument();
  });

  it("states a fully-checked empty list exactly once", () => {
    render(<OrganizationHome view={view({ attention: [], attentionIncomplete: false })} />);
    expect(
      screen.getByText("Nothing in the recent work shown needs attention."),
    ).toBeInTheDocument();
  });
});

describe("OrganizationHome header", () => {
  it("shows the eyebrow, sentence-case status, and active-location count", () => {
    render(<OrganizationHome view={view()} />);
    expect(screen.getByText("Your organization")).toBeInTheDocument();
    expect(screen.getByText("Active organization")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2 active locations" })).toBeInTheDocument();
  });

  it("captions the campaigns and library sections with the reference copy", () => {
    render(<OrganizationHome view={view()} />);
    expect(screen.getByText("Recent work, ready to pick up.")).toBeInTheDocument();
    expect(screen.getByText("A little of what makes your business yours.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Asset Library" })).toHaveAttribute(
      "href",
      `/organizations/${ORG_ID}/assets`,
    );
  });

  it("names each attention row's source", () => {
    render(<OrganizationHome view={view()} />);
    const attention = screen.getByRole("region", { name: "For your attention" });
    expect(within(attention).getByText("Campaign")).toBeInTheDocument();
  });

  it("renders activity timestamps with the org timezone name", () => {
    render(<OrganizationHome view={view()} />);
    const activity = screen.getByRole("region", { name: "Recent activity" });
    expect(within(activity).getByText("10 Sep 2026 · 14:00, Asia/Dubai")).toBeInTheDocument();
  });

  it("prompts managers with the reference goal copy linked to management", () => {
    render(<OrganizationHome view={view({ goals: [], focusGoalId: null })} />);
    expect(screen.getByText("What are you working towards?")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "your organization details" })).toHaveAttribute(
      "href",
      "#organization-management",
    );
  });

  it("keeps the viewer goal prompt neutral with no management path", () => {
    render(
      <OrganizationHome
        view={view({
          goals: [],
          focusGoalId: null,
          permissions: {
            canCreateCampaign: false,
            canEditCampaign: false,
            canReviewCampaign: false,
            canManageCore: false,
          },
        })}
      />,
    );
    expect(screen.getByText("No goals on file yet.")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "your organization details" }),
    ).not.toBeInTheDocument();
  });

  it("links management to its anchor and creation to the campaign route", () => {
    render(<OrganizationHome view={view()} />);
    expect(screen.getByRole("link", { name: /manage/i })).toHaveAttribute(
      "href",
      "#organization-management",
    );
    expect(screen.getByRole("link", { name: /new campaign/i })).toHaveAttribute(
      "href",
      `/organizations/${ORG_ID}/campaigns/new`,
    );
  });

  it("opens the read-only locations dialog from the context row", async () => {
    const user = userEvent.setup();
    render(<OrganizationHome view={view()} />);
    await user.click(screen.getByRole("button", { name: /2 active locations/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Deira")).toBeInTheDocument();
    expect(within(dialog).getByText("Online")).toBeInTheDocument();
  });

  it("renders the avatar box with initials when no logo qualified", () => {
    render(<OrganizationHome view={view({ logo: null })} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Al Noor Kitchen");
    expect(screen.queryByRole("img", { name: /logo/i })).not.toBeInTheDocument();
    const avatar = screen.getByRole("img", { name: "Al Noor Kitchen avatar" });
    expect(avatar).toHaveAttribute("aria-hidden", "false");
    expect(avatar.textContent).toBe("AN");
  });
});

describe("OrganizationHome polish (FIX E)", () => {
  it("treats the attention count as a warning-tone pill with exact N shown text", () => {
    render(<OrganizationHome view={view()} />);
    const pill = screen.getByText("1 shown");
    expect(pill.className).toContain("bg-warning/18");
  });

  it("closes the composition with the home footer line", () => {
    const { container } = render(<OrganizationHome view={view()} />);
    const footer = container.querySelector("footer");
    expect(footer?.textContent).toBe("Organization home · the place to return to your work.");
  });

  it("captions the destinations and activity headers with the reference copy", () => {
    render(<OrganizationHome view={view()} />);
    expect(screen.getByText("Explore your workspace")).toBeInTheDocument();
    expect(screen.getByText("Campaign, asset and organization updates")).toBeInTheDocument();
  });

  it("shows View goals with an onward arrow for a single saved goal", async () => {
    const user = userEvent.setup();
    render(<OrganizationHome view={view()} />);
    const trigger = screen.getByRole("button", { name: /view goals/i });
    expect(trigger.querySelector("svg.lucide-arrow-right")).not.toBeNull();
    // One goal is not "plus more": the overflow line stays multi-goal only.
    expect(screen.queryByText(/plus .* more/i)).not.toBeInTheDocument();
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Grow orders")).toBeInTheDocument();
  });

  it("keeps a single branch goal reachable when no org focus is set", async () => {
    const user = userEvent.setup();
    render(
      <OrganizationHome
        view={view({
          goals: [
            goal({
              id: "33333333-3333-4333-8333-333333333332",
              name: "Deira sprint",
              target: "200 orders",
              scopeLabel: "Deira",
            }),
          ],
          focusGoalId: null,
        })}
      />,
    );
    await user.click(screen.getByRole("button", { name: /view goals/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Deira sprint")).toBeInTheDocument();
  });

  it("shows no View goals trigger when no goals are on file", () => {
    render(<OrganizationHome view={view({ goals: [], focusGoalId: null })} />);
    expect(screen.queryByRole("button", { name: /view goals/i })).not.toBeInTheDocument();
  });

  it("insets only the asset dialog, leaving locations/goals dialogs on shared padding", async () => {
    const user = userEvent.setup();
    const assetClass = styles.assetDialogContent;
    expect(assetClass).toBeTruthy();
    render(<OrganizationHome view={view()} />);
    await user.click(screen.getByRole("button", { name: /ramadan push · ramadan-hero/i }));
    expect((await screen.findByRole("dialog")).className.split(" ")).toContain(assetClass);
    cleanup();
    render(<OrganizationHome view={view()} />);
    await user.click(screen.getByRole("button", { name: /2 active locations/i }));
    expect((await screen.findByRole("dialog")).className.split(" ")).not.toContain(assetClass);
    cleanup();
    render(<OrganizationHome view={view()} />);
    await user.click(screen.getByRole("button", { name: /view goals/i }));
    expect((await screen.findByRole("dialog")).className.split(" ")).not.toContain(assetClass);
  });
});

describe("OrganizationHome growth section", () => {
  it("mounts the fixed-projection section first with its stable identity", () => {
    render(
      <OrganizationHome
        view={view({ revenue: { status: "disabled" }, growthProgress: buildBehindGrowthSection(ORG_ID) })}
      />,
    );
    const section = screen.getByRole("region", { name: "Current vs projected growth" });
    expect(section.getAttribute("id")).toBe("home-revenue");
    const campaigns = screen.getByRole("region", { name: "Your campaigns" });
    expect(
      (section.compareDocumentPosition(campaigns) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    ).toBe(true);
    expect(screen.getByText("Below the projection")).toBeTruthy();
    expect(screen.getByText("AED 24,000 behind")).toBeTruthy();
  });

  it("shows the shaped growth failure without breaking the lower home", () => {
    render(
      <OrganizationHome
        view={view({
          revenue: { status: "disabled" },
          growthProgress: { state: "failed", reasonCode: "SOURCE_READ_FAILED" },
        })}
      />,
    );
    expect(screen.getByText("Growth outlook is unavailable right now")).toBeTruthy();
    // This file pins the refresh transition to pending, so the retry control
    // reads as refreshing; the live copy is pinned in the section suites.
    expect(screen.getByRole("button", { name: /refreshing/i })).toBeTruthy();
    expect(screen.getByText("Your campaigns")).toBeTruthy();
  });
});
