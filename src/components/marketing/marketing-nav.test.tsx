// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { nav, WALKTHROUGH_MAILTO } from "@/components/marketing/content";
import { MarketingNav } from "@/components/marketing/marketing-nav";

afterEach(cleanup);

describe("MarketingNav", () => {
  it("renders the product name as the logo text", () => {
    render(<MarketingNav />);

    expect(screen.getByText(nav.productName)).toBeTruthy();
  });

  it("links sign in to /login", () => {
    render(<MarketingNav />);

    const signIn = screen.getByRole("link", { name: nav.signInLabel });
    expect(signIn.getAttribute("href")).toBe(nav.signInHref);
  });

  it("links the walkthrough call to action to the mailto address", () => {
    render(<MarketingNav />);

    const cta = screen.getByRole("link", { name: nav.ctaLabel });
    expect(cta.getAttribute("href")).toBe(WALKTHROUGH_MAILTO);
  });
});
