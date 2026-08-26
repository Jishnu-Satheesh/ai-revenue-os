// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { capabilities } from "@/components/marketing/content";
import { FigOpportunityList } from "./fig-opportunity-list";

afterEach(cleanup);

const ranked = capabilities.find((capability) => capability.artifact.kind === "ranked");

describe("FigOpportunityList", () => {
  it("renders the ranked opportunity rows with scores and impacts", () => {
    if (!ranked || ranked.artifact.kind !== "ranked") {
      throw new Error("ranked artifact missing from content");
    }

    render(<FigOpportunityList artifact={ranked.artifact} />);

    expect(screen.getByText("Ranked opportunities")).toBeTruthy();
    for (const row of ranked.artifact.rows) {
      expect(screen.getByText(row.title)).toBeTruthy();
      expect(screen.getByText(String(row.score))).toBeTruthy();
      expect(screen.getByText(row.impact)).toBeTruthy();
    }
  });
});
