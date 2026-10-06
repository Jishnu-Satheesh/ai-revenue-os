// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: vi.fn() }),
}));

const mocks = {
  refresh: vi.fn(),
};

import { HomeAssets } from "@/components/organizations/home/home-assets";
import type { HomeAsset, HomeSection } from "@/modules/organizations/application/home-types";

afterEach(() => {
  cleanup();
  mocks.refresh.mockClear();
});

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const TIME_ZONE = "Asia/Dubai";

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
    sourceHref: `/organizations/${ORG_ID}/campaigns/44444444-4444-4444-8444-444444444441?version=66666666-6666-4666-8666-666666666661`,
    ...overrides,
  };
}

function ready(data: readonly HomeAsset[]): HomeSection<readonly HomeAsset[]> {
  return { status: "ready", data, fetchedAt: "2026-09-11T08:00:00.000Z" };
}

function renderGallery(assets: readonly HomeAsset[], partial = false) {
  return render(
    <HomeAssets
      organizationId={ORG_ID}
      organizationName="Al Noor Kitchen"
      timeZone={TIME_ZONE}
      section={ready(assets)}
      partial={partial}
    />,
  );
}

describe("HomeAssets keyboard and dialog", () => {
  it("opens via keyboard, traps tab inside, closes on escape and returns focus", async () => {
    const user = userEvent.setup();
    renderGallery([asset()]);
    const thumbnail = screen.getByRole("button", {
      name: /ramadan push · ramadan-hero · iftar spread/i,
    });
    thumbnail.focus();
    await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();

    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.activeElement).toBe(thumbnail);
  });

  it("keeps the source link when the image fails to load", async () => {
    const user = userEvent.setup();
    renderGallery([asset()]);
    await user.click(
      screen.getByRole("button", { name: /ramadan push · ramadan-hero · iftar spread/i }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.error(screen.getByRole("img", { name: "Ramadan poster render" }));
    expect(await screen.findByText("Preview unavailable")).toBeInTheDocument();
    const source = screen.getByRole("link", { name: /open source/i });
    expect(source).toHaveAttribute(
      "href",
      `/organizations/${ORG_ID}/campaigns/44444444-4444-4444-8444-444444444441?version=66666666-6666-4666-8666-666666666661`,
    );
    expect(dialog.contains(source)).toBe(true);
  });

  it("uses the refreshed url for the same asset id", async () => {
    const user = userEvent.setup();
    const { rerender } = renderGallery([asset()]);
    await user.click(
      screen.getByRole("button", { name: /ramadan push · ramadan-hero · iftar spread/i }),
    );
    await screen.findByRole("dialog");
    rerender(
      <HomeAssets
        organizationId={ORG_ID}
        organizationName="Al Noor Kitchen"
        timeZone={TIME_ZONE}
        section={ready([
          asset({
            image: {
              url: "https://signed.example/poster-1-refreshed",
              alt: "Ramadan poster render",
              width: 1200,
              height: 800,
              expiresAt: "2026-09-11T08:20:00.000Z",
            },
          }),
        ])}
        partial={false}
      />,
    );
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Ramadan poster render" })).toHaveAttribute(
      "src",
      "https://signed.example/poster-1-refreshed",
    );
  });

  it("closes without throwing when the selected asset vanishes on refresh", async () => {
    const user = userEvent.setup();
    const { rerender } = renderGallery([asset()]);
    await user.click(
      screen.getByRole("button", { name: /ramadan push · ramadan-hero · iftar spread/i }),
    );
    await screen.findByRole("dialog");
    expect(() =>
      rerender(
        <HomeAssets
          organizationId={ORG_ID}
          organizationName="Al Noor Kitchen"
          timeZone={TIME_ZONE}
          section={ready([])}
          partial={false}
        />,
      ),
    ).not.toThrow();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("caps the gallery at four with unique accessible names", () => {
    renderGallery([
      asset({ id: "poster:55555555-5555-4555-8555-555555555551", label: "First work" }),
      asset({ id: "poster:55555555-5555-4555-8555-555555555552", label: "Second work" }),
      asset({
        id: "reference:55555555-5555-4555-8555-555555555553",
        sourceKind: "brand_reference",
        label: "Third work",
      }),
      asset({
        id: "reference:55555555-5555-4555-8555-555555555554",
        sourceKind: "brand_reference",
        label: "Fourth work",
      }),
      asset({ id: "poster:55555555-5555-4555-8555-555555555555", label: "Fifth work" }),
    ]);
    expect(screen.getByRole("button", { name: /first work/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /fifth work/i })).not.toBeInTheDocument();
  });
});

describe("HomeAssets gallery thumb shell (C1 parity pin)", () => {
  it("renders title, source kind and review state below the image with a growing tile", () => {
    renderGallery([asset()]);

    const thumbnail = screen.getByRole("button", {
      name: /ramadan push · ramadan-hero · iftar spread/i,
    });
    const image = screen.getByRole("img", { name: "Ramadan poster render" });
    expect(image).toHaveAttribute("src", "https://signed.example/poster-1");
    expect(image).toHaveAttribute("loading", "lazy");

    // The image lives in the fixed-height overflow-hidden band; the meta must
    // NOT be inside that node (that was the clipping trap) but after it, so
    // the tile grows instead of clipping. Sizing itself is a CSS rule
    // citation, not a jsdom observable: .thumbImage is the only fixed height
    // (140px base, 143px at >=960), .thumb carries min-height only.
    const band = image.parentElement;
    expect(band).not.toBeNull();
    const label = screen.getByText("Ramadan Push · ramadan-hero · iftar spread");
    expect(band?.contains(label)).toBe(false);
    expect(thumbnail.contains(label)).toBe(true);
    expect(
      (band?.compareDocumentPosition(label) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(thumbnail.textContent ?? "").toContain("Finished poster render");
    expect(thumbnail.textContent ?? "").toContain("Review not recorded");
  });

  it("shows the shared fallback without losing labels when the thumbnail image fails", () => {
    renderGallery([asset()]);

    fireEvent.error(screen.getByRole("img", { name: "Ramadan poster render" }));

    expect(screen.queryByRole("img", { name: "Ramadan poster render" })).toBeNull();
    expect(screen.getByText("Preview unavailable")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /ramadan push · ramadan-hero · iftar spread/i }),
    ).toBeInTheDocument();
  });
});

describe("HomeAssets thumb band CSS guard", () => {
  it("keeps .thumbImage as a block so the fixed height applies", () => {
    // jsdom cannot do layout: a span stays display:inline and ignores the
    // fixed height, so .thumb's overflow:hidden clips the tile meta. Pin the
    // source rule instead (whitespace-tolerant — property order may move).
    const css = readFileSync(
      join(process.cwd(), "src/components/organizations/home/organization-home.module.css"),
      "utf8",
    );
    expect(css).toMatch(/\.thumbImage\s*\{[^}]*display\s*:\s*block\b/);
  });

  it("rings a keyboard-focused thumb with the branded primary outline", () => {
    // Prototype parity: keyboard focus on a library thumbnail shows a 3px
    // solid primary ring with offset (not the faint browser default). Pin the
    // source rule (whitespace-tolerant — property order may move).
    const css = readFileSync(
      join(process.cwd(), "src/components/organizations/home/organization-home.module.css"),
      "utf8",
    );
    expect(css).toMatch(
      /\.thumb:focus-visible\s*\{[^}]*outline\s*:\s*3px\s+solid\s+var\(--primary\)[^}]*outline-offset\s*:\s*[34]px/,
    );
  });
});

describe("HomeAssets states", () => {
  it("warns on partial loads while keeping survivors", () => {
    renderGallery([asset()], true);
    expect(screen.getByText(/some recent work could not be loaded/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /ramadan push · ramadan-hero · iftar spread/i }),
    ).toBeInTheDocument();
  });

  it("keeps empty and failed distinct", () => {
    const { rerender } = renderGallery([]);
    expect(screen.getByText(/no saved work yet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open the asset library/i })).toHaveAttribute(
      "href",
      `/organizations/${ORG_ID}/assets`,
    );

    rerender(
      <HomeAssets
        organizationId={ORG_ID}
        organizationName="Al Noor Kitchen"
        timeZone={TIME_ZONE}
        section={{ status: "failed", code: "HOME_READ_FAILED" }}
        partial={false}
      />,
    );
    expect(screen.getByText(/recent work could not be loaded/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("omits gated sections silently", () => {
    const { container } = render(
      <HomeAssets
        organizationId={ORG_ID}
        organizationName="Al Noor Kitchen"
        timeZone={TIME_ZONE}
        section={{ status: "disabled" }}
        partial={false}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("HomeAssets review status tags", () => {
  it("shows a success-toned badge with the review label on approved tiles", () => {
    renderGallery([
      asset({
        reviewState: "approved",
        reviewLabel: "Approved reference",
        sourceLabel: "Brand reference",
      }),
    ]);

    const badge = screen.getByText("Approved reference");
    expect(badge.className).toMatch(/bg-success/);
    expect(
      screen.getByRole("button", {
        name: /ramadan push · ramadan-hero · iftar spread, brand reference, approved reference/i,
      }),
    ).toBeInTheDocument();
  });

  it("shows success tone for approved and neutral tone for unreviewed tiles", () => {
    renderGallery([
      asset({
        id: "reference:55555555-5555-4555-8555-555555555561",
        label: "Approved work",
        sourceLabel: "Brand reference",
        reviewState: "approved",
        reviewLabel: "Approved reference",
      }),
      asset({
        id: "poster:55555555-5555-4555-8555-555555555562",
        label: "Unreviewed work",
        sourceLabel: "Finished poster render",
        reviewState: "unreviewed",
        reviewLabel: "Review not recorded",
      }),
    ]);

    // Exact-text match finds the badge: the sub-line reads
    // "Brand reference · Approved reference" so it cannot exact-match.
    const approvedBadge = screen.getByText("Approved reference");
    expect(approvedBadge.className).toMatch(/bg-success/);

    const unreviewedBadge = screen.getByText("Review not recorded");
    expect(unreviewedBadge.className).toMatch(/bg-muted/);

    // Existing aria names are untouched by the badge markup.
    expect(
      screen.getByRole("button", { name: "Approved work, Brand reference, Approved reference" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Unreviewed work, Finished poster render, Review not recorded",
      }),
    ).toBeInTheDocument();
  });

  it("shows the badge in the dialog above the saved-for line", async () => {
    const user = userEvent.setup();
    renderGallery([
      asset({
        reviewState: "approved",
        reviewLabel: "Approved reference",
        sourceLabel: "Brand reference",
      }),
    ]);

    await user.click(
      screen.getByRole("button", { name: /ramadan push · ramadan-hero · iftar spread/i }),
    );
    const dialog = await screen.findByRole("dialog");
    const badge = within(dialog).getByText("Approved reference");
    expect(badge.className).toMatch(/bg-success/);
    const savedFor = screen.getByText(/saved for/i);
    expect(badge.compareDocumentPosition(savedFor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("HomeAssets library parity (Task C)", () => {
  it("shows the reassurance subline under Preview unavailable in the null-image tile", () => {
    renderGallery([asset({ image: null })]);

    expect(screen.getByText("Preview unavailable")).toBeInTheDocument();
    expect(screen.getByText("Your work is still available.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /ramadan push · ramadan-hero · iftar spread/i }),
    ).toBeInTheDocument();
  });

  it("labels the dialog CTA Open source campaign for a campaign sourceHref", async () => {
    const user = userEvent.setup();
    renderGallery([asset()]);
    await user.click(
      screen.getByRole("button", { name: /ramadan push · ramadan-hero · iftar spread/i }),
    );
    const source = await screen.findByRole("link", { name: "Open source campaign" });
    expect(source).toHaveAttribute(
      "href",
      `/organizations/${ORG_ID}/campaigns/44444444-4444-4444-8444-444444444441?version=66666666-6666-4666-8666-666666666661`,
    );
  });

  it("labels the dialog CTA Open Asset Library for the asset-library sourceHref", async () => {
    const user = userEvent.setup();
    renderGallery([
      asset({
        id: "reference:55555555-5555-4555-8555-555555555553",
        sourceKind: "brand_reference",
        label: "Library saved logo",
        sourceHref: `/organizations/${ORG_ID}/assets`,
      }),
    ]);
    await user.click(screen.getByRole("button", { name: /library saved logo/i }));
    const source = await screen.findByRole("link", { name: "Open Asset Library" });
    expect(source).toHaveAttribute("href", `/organizations/${ORG_ID}/assets`);
  });

  it("defaults the dialog CTA to Open source campaign for an unknown sourceHref", async () => {
    const user = userEvent.setup();
    renderGallery([
      asset({
        label: "Odd destination work",
        sourceHref: `/organizations/${ORG_ID}/somewhere-else`,
      }),
    ]);
    await user.click(screen.getByRole("button", { name: /odd destination work/i }));
    const source = await screen.findByRole("link", { name: "Open source campaign" });
    expect(source).toHaveAttribute("href", `/organizations/${ORG_ID}/somewhere-else`);
  });
});
