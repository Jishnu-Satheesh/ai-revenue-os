// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import Governance from "@/components/marketing/governance";
import { governance, receipt } from "@/components/marketing/content";

afterEach(cleanup);

describe("Governance", () => {
  it("renders heading and subheading", () => {
    render(<Governance />);

    expect(screen.getByRole("heading", { name: governance.heading })).toBeTruthy();
    expect(screen.getByText(governance.subheading)).toBeTruthy();
  });

  it("renders every item title and description", () => {
    render(<Governance />);

    for (const item of governance.items) {
      expect(screen.getByText(item.title)).toBeTruthy();
      expect(screen.getByText(item.description)).toBeTruthy();
    }
  });

  it("renders the approval receipt artifact", () => {
    render(<Governance />);

    expect(screen.getByText(`Decision · ${receipt.id}`)).toBeTruthy();
    expect(screen.getByText(receipt.title)).toBeTruthy();
    for (const step of receipt.steps) {
      expect(screen.getByText(step.label)).toBeTruthy();
    }
    expect(screen.getByText(receipt.caption)).toBeTruthy();
  });
});
