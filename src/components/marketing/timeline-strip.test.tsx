// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { timeline } from "@/components/marketing/content";
import { TimelineStrip } from "./timeline-strip";

afterEach(cleanup);

describe("TimelineStrip", () => {
  it("renders all eight week ticks", () => {
    render(<TimelineStrip />);

    for (const week of timeline.weeks) {
      expect(screen.getByText(week)).toBeTruthy();
    }
  });

  it("renders every phase lane label", () => {
    render(<TimelineStrip />);

    for (const phase of timeline.phases) {
      expect(screen.getByText(phase.label)).toBeTruthy();
    }
  });

  it("renders the state legend", () => {
    render(<TimelineStrip />);

    expect(screen.getByText("Complete")).toBeTruthy();
    expect(screen.getByText("In progress")).toBeTruthy();
    expect(screen.getByText("Upcoming")).toBeTruthy();
  });
});
