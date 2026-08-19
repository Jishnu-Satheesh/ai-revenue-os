// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LearningReview, type LearningProposalData } from "@/components/campaigns/learning-review";

afterEach(cleanup);

function proposal(overrides: Partial<LearningProposalData> = {}): LearningProposalData {
  return {
    id: "d0000000-0000-4000-8000-000000000001",
    campaignId: "c0000000-0000-4000-8000-000000000001",
    verdict: "inconclusive",
    evidenceTier: null,
    plannedExposureCount: 6,
    realizedExposureCount: 4,
    hypothesis:
      "The preregistered plan tested whether creative variants moved the primary metric margin.contribution.",
    observation:
      "The campaign ran with 6 planned exposures against 4 realized. The settled verdict is inconclusive.",
    proposedLesson: "The lesson stays attached to this campaign and claims nothing beyond it.",
    limitations: ["The preregistered evidence bar was not met."],
    suggestedNextTest:
      "Run the same preregistered method again with a larger sample or a longer window before drawing a conclusion.",
    evidenceLinks: [{ kind: "outcome", id: "10000000-0000-4000-8000-000000000001" }],
    status: "proposed",
    targetArtifactType: null,
    decidedBy: null,
    decidedAt: null,
    createdAt: "2026-08-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("LearningReview", () => {
  it("says plainly when no proposal has been drafted yet", () => {
    render(<LearningReview proposal={null} canDecide timeZone="Asia/Dubai" />);
    expect(screen.getByText(/no learning proposal yet/i)).toBeInTheDocument();
  });

  it("shows the evidence trail: verdict, evidence tier, and planned versus realized exposure", () => {
    render(<LearningReview proposal={proposal()} canDecide />);

    expect(screen.getByText("Inconclusive")).toBeInTheDocument();
    expect(screen.getByText("Planned exposure")).toBeInTheDocument();
    expect(screen.getByText("Realized exposure")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("keeps the hypothesis and the observation as two separate sections", () => {
    render(<LearningReview proposal={proposal()} canDecide />);

    expect(screen.getByText("Hypothesis")).toBeInTheDocument();
    expect(screen.getByText("Observation")).toBeInTheDocument();
    expect(screen.getByText(/preregistered plan tested whether/i)).toBeInTheDocument();
    expect(screen.getByText(/settled verdict is inconclusive/i)).toBeInTheDocument();
  });

  it("shows the drafted lesson, the suggested next test, and the limitations", () => {
    render(<LearningReview proposal={proposal()} canDecide />);

    expect(screen.getByText(/lesson stays attached to this campaign/i)).toBeInTheDocument();
    expect(screen.getByText(/same preregistered method again/i)).toBeInTheDocument();
    expect(screen.getByText(/evidence bar was not met/i)).toBeInTheDocument();
  });

  it("offers exactly three choices and calls onDecide with the chosen one", () => {
    const onDecide = vi.fn(async () => ({ ok: true }));

    render(<LearningReview proposal={proposal()} canDecide onDecide={onDecide} />);

    const buttons = [
      screen.getByRole("button", { name: "Dismiss" }),
      screen.getByRole("button", { name: "Keep campaign-only" }),
      screen.getByRole("button", { name: "Submit as reusable recipe" }),
    ];
    expect(buttons).toHaveLength(3);

    fireEvent.click(buttons[1]);
    expect(onDecide).toHaveBeenCalledWith("keep_campaign_only");
  });

  it("submission is phrased as a separate proposal, never a promotion", () => {
    render(<LearningReview proposal={proposal()} canDecide />);
    expect(
      screen.getByText(/file a separate reusable-recipe proposal under ADR 0013/i),
    ).toBeInTheDocument();
    // The honest statement: submitting files a proposal; it does not promote.
    expect(screen.getByText(/nothing is promoted/i)).toBeInTheDocument();
  });

  it("a viewer can read but cannot decide", () => {
    render(<LearningReview proposal={proposal()} canDecide={false} />);

    expect(
      screen.getByText(/viewers can read a proposal but cannot decide it/i),
    ).toBeInTheDocument();
    for (const name of ["Dismiss", "Keep campaign-only", "Submit as reusable recipe"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
  });

  it("renders a decided proposal as closed, with no further choice", () => {
    render(
      <LearningReview
        proposal={proposal({
          status: "submitted_for_promotion",
          targetArtifactType: "reusable_recipe",
        })}
        canDecide
      />,
    );

    expect(screen.getAllByText("Submitted for promotion").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
    expect(
      screen.getByText(/promotion is a separate governed decision and has not happened/i),
    ).toBeInTheDocument();
  });
});
