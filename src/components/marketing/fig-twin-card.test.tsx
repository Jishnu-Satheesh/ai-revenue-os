// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { capabilities } from "@/components/marketing/content";
import { FigTwinCard } from "./fig-twin-card";

afterEach(cleanup);

const facts = capabilities.find((capability) => capability.artifact.kind === "facts");

describe("FigTwinCard", () => {
  it("renders the twin fact ledger", () => {
    if (!facts || facts.artifact.kind !== "facts") {
      throw new Error("facts artifact missing from content");
    }

    render(<FigTwinCard artifact={facts.artifact} />);

    expect(screen.getByText("Digital twin")).toBeTruthy();
    for (const row of facts.artifact.rows) {
      expect(screen.getByText(row.label)).toBeTruthy();
      expect(screen.getByText(row.value)).toBeTruthy();
      expect(screen.getByText(row.source)).toBeTruthy();
    }
  });
});
