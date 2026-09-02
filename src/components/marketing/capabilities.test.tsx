// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { capabilities, capabilitiesIntro } from "@/components/marketing/content";
import Capabilities from "@/components/marketing/capabilities";

afterEach(cleanup);

describe("the capabilities heading", () => {
  it("states what the product is built around", () => {
    render(<Capabilities />);

    expect(
      screen.getByRole("heading", { level: 2, name: "Built around decisions, not dashboards." }),
    ).toBeTruthy();
  });
});

describe("the capability split", () => {
  it("renders the intro copy in the supporting column", () => {
    render(<Capabilities />);

    expect(screen.getByText(capabilitiesIntro)).toBeTruthy();
  });
});

describe("the FIG trio", () => {
  it("renders every capability title and description", () => {
    render(<Capabilities />);

    for (const capability of capabilities) {
      expect(screen.getByText(capability.title)).toBeTruthy();
      expect(screen.getByText(capability.description)).toBeTruthy();
    }
  });

  it("labels each vignette FIG 01 through FIG 03", () => {
    render(<Capabilities />);

    for (const capability of capabilities) {
      expect(screen.getByText(capability.fig)).toBeTruthy();
    }
  });

  it("renders the twin fact card artifact", () => {
    render(<Capabilities />);

    expect(screen.getByText("Digital twin")).toBeTruthy();
    expect(screen.getByText("Weekend footfall")).toBeTruthy();
    expect(screen.getByText("GBP · verified")).toBeTruthy();
  });

  it("renders the ranked opportunity list artifact", () => {
    render(<Capabilities />);

    expect(screen.getByText("Ranked opportunities")).toBeTruthy();
    expect(screen.getByText("Weekend family bundle")).toBeTruthy();
    expect(screen.getByText("AED 3,200–4,600 / mo est.")).toBeTruthy();
  });

  it("renders the outcome ledger artifact", () => {
    render(<Capabilities />);

    expect(screen.getByText("Outcome ledger")).toBeTruthy();
    expect(screen.getByText("AED 3,100 / wk")).toBeTruthy();
    expect(screen.getByText("AED 3,900 / wk")).toBeTruthy();
    expect(screen.getByText("+AED 800 est.")).toBeTruthy();
    expect(screen.getByText("Settled")).toBeTruthy();
  });
});
