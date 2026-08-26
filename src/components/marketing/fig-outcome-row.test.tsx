// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { capabilities } from "@/components/marketing/content";
import { FigOutcomeRow } from "./fig-outcome-row";

afterEach(cleanup);

const outcome = capabilities.find((capability) => capability.artifact.kind === "outcome");

describe("FigOutcomeRow", () => {
  it("renders the outcome ledger with baseline, measured and delta", () => {
    if (!outcome || outcome.artifact.kind !== "outcome") {
      throw new Error("outcome artifact missing from content");
    }

    render(<FigOutcomeRow artifact={outcome.artifact} />);

    expect(screen.getByText("Outcome ledger")).toBeTruthy();
    expect(screen.getByText(outcome.artifact.action)).toBeTruthy();
    expect(screen.getByText(outcome.artifact.baseline)).toBeTruthy();
    expect(screen.getByText(outcome.artifact.measured)).toBeTruthy();
    expect(screen.getByText(outcome.artifact.delta)).toBeTruthy();
    expect(screen.getByText(outcome.artifact.status)).toBeTruthy();
  });
});
