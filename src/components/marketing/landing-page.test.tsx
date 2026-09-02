// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { LandingPage } from "./landing-page";
import { footer, governance, hero, howItWorks } from "./content";

afterEach(cleanup);

describe("LandingPage", () => {
  it("renders every public section in order", () => {
    render(<LandingPage />);

    expect(screen.getByText(hero.headline)).toBeTruthy();
    expect(screen.getByText("Built around decisions, not dashboards.")).toBeTruthy();
    expect(screen.getByText("From fragmented data to measured actions.")).toBeTruthy();
    expect(screen.getByText(governance.heading)).toBeTruthy();
    expect(screen.getByText("Know exactly what to do next.")).toBeTruthy();
    expect(screen.getByText(footer.tagline)).toBeTruthy();
  });

  it("renders the full step sequence with unique numbers and descriptions", () => {
    render(<LandingPage />);
    for (const step of howItWorks) {
      expect(screen.getAllByText(step.step)).toHaveLength(1);
      expect(screen.getAllByText(step.description)).toHaveLength(1);
      expect(screen.getAllByText(step.title).length).toBeGreaterThanOrEqual(1);
    }
  });
});
