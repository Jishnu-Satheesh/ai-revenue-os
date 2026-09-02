// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import ClosingCta from "@/components/marketing/closing-cta";
import { closingCta, WALKTHROUGH_MAILTO } from "@/components/marketing/content";

afterEach(cleanup);

describe("ClosingCta", () => {
  it("renders headline and body", () => {
    render(<ClosingCta />);

    expect(screen.getByRole("heading", { name: closingCta.headline })).toBeTruthy();
    expect(screen.getByText(closingCta.body)).toBeTruthy();
  });

  it("renders a single CTA anchor to WALKTHROUGH_MAILTO with ctaLabel", () => {
    render(<ClosingCta />);

    const links = screen.getAllByRole("link", { name: closingCta.ctaLabel });
    expect(links.length).toBe(1);
    expect(links[0]?.getAttribute("href")).toBe(WALKTHROUGH_MAILTO);
  });
});
