// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { howItWorks, howItWorksIntro, timeline } from "@/components/marketing/content";
import HowItWorks from "@/components/marketing/how-it-works";

afterEach(cleanup);

describe("the how-it-works heading", () => {
  it("states the path from data to action", () => {
    render(<HowItWorks />);

    expect(
      screen.getByRole("heading", { level: 2, name: "From fragmented data to measured actions." }),
    ).toBeTruthy();
  });
});

describe("the how-it-works steps", () => {
  it("renders every step number from 01 through 04", () => {
    render(<HowItWorks />);

    for (const step of howItWorks) {
      expect(screen.getByText(step.step)).toBeTruthy();
    }
  });

  it("renders every step title in the list and the timeline", () => {
    render(<HowItWorks />);

    for (const step of howItWorks) {
      expect(screen.getAllByText(step.title).length).toBeGreaterThanOrEqual(1);
    }
  });

  it("renders every step description", () => {
    render(<HowItWorks />);

    for (const step of howItWorks) {
      expect(screen.getByText(step.description)).toBeTruthy();
    }
  });
});

describe("the timeline strip", () => {
  it("renders the intro copy and the gantt week ticks", () => {
    render(<HowItWorks />);

    expect(screen.getByText(howItWorksIntro)).toBeTruthy();
    for (const week of timeline.weeks) {
      expect(screen.getByText(week)).toBeTruthy();
    }
  });
});
