// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { OutcomeProof, type OutcomeProofData } from "@/components/campaigns/outcome-proof";
import { validateOutcomeWording } from "@/domain/campaigns/measurement";

afterEach(cleanup);

function outcome(overrides: Partial<OutcomeProofData> = {}): OutcomeProofData {
  return {
    id: "o0000000-0000-4000-8000-000000000001",
    verdict: "inconclusive",
    attributionMethod: "observational_prepost",
    primaryMetricKey: "revenue.purchase_value",
    outcomeWindowDays: 14,
    settlementDelayDays: 3,
    baselineSource: "goal_baseline_measured:revenue.purchase_value",
    baselineLookbackDays: 28,
    plannedExposureCount: 6,
    realizedExposureCount: 4,
    guardrailState: "clear",
    realizedSpendMinor: 4000,
    spendCeilingMinor: 10000,
    spendCurrency: "USD",
    estimateMinor: null,
    estimateLowMinor: null,
    estimateHighMinor: null,
    estimateCurrency: null,
    evidenceTier: null,
    truncationCauses: [
      {
        variant_id: "v1",
        cause: "agent_pause",
        rule_key: "diagnostic.ctr_floor",
        at: "2026-08-02T00:00:00.000Z",
      },
    ],
    limitations: ["The preregistered evidence bar was not met."],
    settledAt: "2026-08-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("OutcomeProof", () => {
  it("says plainly when nothing is settled yet", () => {
    render(<OutcomeProof outcome={null} />);
    expect(screen.getByText(/no settled result yet/i)).toBeInTheDocument();
  });

  it("shows hypothesis, exposure, window, guardrail, and limitations", () => {
    render(<OutcomeProof outcome={outcome()} />);

    expect(screen.getByText("Inconclusive")).toBeInTheDocument();
    expect(screen.getAllByText(/revenue\.purchase_value/i).length).toBeGreaterThan(0);
    expect(screen.getByText("6")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("clear")).toBeInTheDocument();
    expect(screen.getAllByText(/preregistered evidence bar was not met/i).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText(/was truncated by agent_pause/i)).toBeInTheDocument();
  });

  it("shows the estimate and its range only when a claim is made", () => {
    const { rerender } = render(
      <OutcomeProof
        outcome={outcome({
          verdict: "validated_outcome",
          evidenceTier: "observed",
          estimateMinor: 200,
          estimateLowMinor: 50,
          estimateHighMinor: 100,
          estimateCurrency: "USD",
        })}
      />,
    );
    expect(screen.getByText(/200 USD · range 50 USD to 100 USD/i)).toBeInTheDocument();

    rerender(<OutcomeProof outcome={outcome()} />);
    expect(screen.queryByText(/range/i)).not.toBeInTheDocument();
  });

  it("renders an inconclusive result without causal wording", () => {
    render(<OutcomeProof outcome={outcome()} />);
    const why =
      screen.getByText(/the campaign ran and its results were recorded/i).textContent ?? "";

    expect(validateOutcomeWording({ text: why, verdict: "inconclusive" })).toEqual([]);
    // A belt-and-braces check on the rendered copy itself.
    expect(why).not.toMatch(
      /\b(caused|impact|effect|lifted|increased|grew|improved|boosted|proven)\b/i,
    );
  });

  it("renders a guardrail breach as a breach, not a success", () => {
    render(
      <OutcomeProof
        outcome={outcome({
          verdict: "guardrail_breach",
          guardrailState: "breached",
          realizedSpendMinor: 10001,
          spendCeilingMinor: 10000,
        })}
      />,
    );
    expect(screen.getByText("Guardrail breach")).toBeInTheDocument();
    expect(screen.getByText("breached")).toBeInTheDocument();
    expect(screen.queryByText("Validated outcome")).not.toBeInTheDocument();
  });
});
