// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { footer, WALKTHROUGH_MAILTO } from "@/components/marketing/content";
import { MarketingFooter } from "@/components/marketing/marketing-footer";

afterEach(cleanup);

describe("MarketingFooter", () => {
  it("shows the tagline", () => {
    render(<MarketingFooter />);

    expect(screen.getByText(footer.tagline)).toBeTruthy();
  });

  it("shows a copyright naming RIO", () => {
    render(<MarketingFooter />);

    expect(screen.getByText(/© \d{4} RIO/)).toBeTruthy();
  });

  it("links sign in and contact with correct targets", () => {
    render(<MarketingFooter />);

    const signIn = screen.getByRole("link", { name: footer.signInLabel });
    const contact = screen.getByRole("link", { name: footer.contactLabel });

    expect(signIn.getAttribute("href")).toBe(footer.signInHref);
    expect(contact.getAttribute("href")).toBe(WALKTHROUGH_MAILTO);
  });
});
