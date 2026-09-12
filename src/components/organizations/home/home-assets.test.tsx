// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: vi.fn() }),
}));

const mocks = {
  refresh: vi.fn(),
};

import { HomeAssets } from "@/components/organizations/home/home-assets";
import type {
  HomeAsset,
  HomeSection,
} from "@/modules/organizations/application/home-types";

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
    expect(
      screen.getByRole("link", { name: /open the asset library/i }),
    ).toHaveAttribute("href", `/organizations/${ORG_ID}/assets`);

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
