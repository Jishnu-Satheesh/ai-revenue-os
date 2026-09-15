// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  PostPerformance,
  type PostPerformanceSeries,
} from "@/components/campaigns/post-performance";

afterEach(cleanup);

const TIME_ZONE = "Asia/Dubai";

function series(overrides: Partial<PostPerformanceSeries> = {}): PostPerformanceSeries {
  return {
    actionRunId: "b7000000-0000-4000-8000-000000000001",
    postLabel: "Classic Kingfish Curry Presentation",
    points: [
      {
        metricKey: "instagram.post_reach",
        label: "Instagram reach (lifetime)",
        observedAt: "2026-09-13T20:00:00.000Z",
        presence: "observed",
        value: 1200,
      },
      {
        metricKey: "instagram.post_reach",
        label: "Instagram reach (lifetime)",
        observedAt: "2026-09-14T20:00:00.000Z",
        presence: "observed",
        value: 1840,
      },
    ],
    ...overrides,
  };
}

describe("what Instagram is reporting", () => {
  it("says nothing has been collected without implying the post failed", () => {
    render(<PostPerformance series={[]} timeZone={TIME_ZONE} />);

    // "No figures yet" and "reached nobody" are different claims, and only one
    // of them is true before collection has run.
    expect(screen.getByText(/nothing has been collected yet/i)).toBeInTheDocument();
    expect(screen.getByText(/different from a post that reached nobody/i)).toBeInTheDocument();
  });

  it("shows each measure under the name Instagram uses for it", () => {
    render(<PostPerformance series={[series()]} timeZone={TIME_ZONE} />);

    const row = screen.getByRole("row", { name: /Instagram reach/i });
    expect(within(row).getByText("1,840")).toBeInTheDocument();
  });

  it("says on its face that the figures are lifetime totals", () => {
    render(<PostPerformance series={[series()]} timeZone={TIME_ZONE} />);

    // A lifetime total read as a daily figure is the single most likely
    // misreading of this screen.
    expect(screen.getByText(/running total for the life of the post/i)).toBeInTheDocument();
  });

  it("reports a gap as not reported rather than as a zero", () => {
    render(
      <PostPerformance
        series={[
          series({
            points: [
              {
                metricKey: "instagram.post_shares",
                label: "Instagram shares (lifetime)",
                observedAt: "2026-09-14T20:00:00.000Z",
                presence: "absent",
                value: null,
              },
            ],
          }),
        ]}
        timeZone={TIME_ZONE}
      />,
    );

    const row = screen.getByRole("row", { name: /Instagram shares/i });
    expect(within(row).getAllByText(/not reported/i).length).toBeGreaterThan(0);
    expect(within(row).queryByText("0")).not.toBeInTheDocument();
  });

  it("shows growth between the first and latest reading", () => {
    render(<PostPerformance series={[series()]} timeZone={TIME_ZONE} />);

    const row = screen.getByRole("row", { name: /Instagram reach/i });
    expect(within(row).getByText("+640")).toBeInTheDocument();
  });

  it("refuses to call one reading a trend", () => {
    render(
      <PostPerformance
        series={[
          series({
            points: [
              {
                metricKey: "instagram.post_reach",
                label: "Instagram reach (lifetime)",
                observedAt: "2026-09-14T20:00:00.000Z",
                presence: "observed",
                value: 1840,
              },
            ],
          }),
        ]}
        timeZone={TIME_ZONE}
      />,
    );

    // A running total with one reading is a position, not a movement.
    expect(screen.getByText(/a trend needs at least two readings/i)).toBeInTheDocument();
    const row = screen.getByRole("row", { name: /Instagram reach/i });
    expect(within(row).getByText(/only one reading/i)).toBeInTheDocument();
  });

  it("names each post, so two posts are never read as one", () => {
    render(
      <PostPerformance
        series={[
          series(),
          series({
            actionRunId: "b7000000-0000-4000-8000-000000000002",
            postLabel: "Mood-Lit Kingfish Curry",
          }),
        ]}
        timeZone={TIME_ZONE}
      />,
    );

    expect(screen.getByText("Classic Kingfish Curry Presentation")).toBeInTheDocument();
    expect(screen.getByText("Mood-Lit Kingfish Curry")).toBeInTheDocument();
  });

  it("renders the last-read day in the organization's timezone", () => {
    render(<PostPerformance series={[series()]} timeZone={TIME_ZONE} />);

    // 2026-09-14T20:00Z is already 15 September in Dubai. Rendering in UTC
    // would date the reading a day early for most of the client's evening.
    const row = screen.getByRole("row", { name: /Instagram reach/i });
    expect(within(row).getByText("15 Sept")).toBeInTheDocument();
  });
});
