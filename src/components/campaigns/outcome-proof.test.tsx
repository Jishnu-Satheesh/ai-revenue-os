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
    primaryMetricKey: "margin.contribution",
    outcomeWindowDays: 14,
    settlementDelayDays: 2,
    baselineSource: "goal_baseline_measured:margin.contribution",
    baselineLookbackDays: 14,
    plannedExposureCount: 6,
    realizedExposureCount: 4,
    guardrailState: "clear",
    realizedSpendMinor: 4000,
    spendCeilingMinor: 10000,
    spendCurrency: "AED",
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

  it("states the hypothesis in words, not backend keys", () => {
    render(<OutcomeProof outcome={outcome()} timeZone="Asia/Dubai" />);

    expect(screen.getByText("Inconclusive")).toBeInTheDocument();
    expect(screen.getByText(/hypothesis/i)).toBeInTheDocument();
    expect(screen.getByText("Contribution margin")).toBeInTheDocument();
    expect(screen.getByText(/measured goal baseline for contribution margin/i)).toBeInTheDocument();
    // The method appears in both the card subtitle and the method row.
    expect(
      screen.getAllByText(/before-and-after comparison \(observational\)/i).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/14 days, plus a 2-day settlement delay/i)).toBeInTheDocument();

    // The raw identifiers stay in the database, never on the screen.
    expect(screen.queryByText(/margin\.contribution/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/goal_baseline_measured/i)).not.toBeInTheDocument();
  });

  it("keeps planned and realized exposure apart, with spend and guardrail beside them", () => {
    render(<OutcomeProof outcome={outcome()} />);

    expect(screen.getByText("Planned exposure")).toBeInTheDocument();
    expect(screen.getByText("Realized exposure")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("AED 40.00")).toBeInTheDocument();
    expect(screen.getByText("AED 100.00")).toBeInTheDocument();
    expect(screen.getByText("Clear")).toBeInTheDocument();
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
    expect(screen.getByText("US$2.00")).toBeInTheDocument();
    expect(screen.getByText(/range US\$0\.50 – US\$1\.00/i)).toBeInTheDocument();

    rerender(<OutcomeProof outcome={outcome()} />);
    expect(screen.queryByText(/^estimate$/i)).not.toBeInTheDocument();
  });

  it("explains why exposure fell short in words", () => {
    render(<OutcomeProof outcome={outcome()} />);

    expect(
      screen.getByText(/one variant was paused automatically by the click-through floor/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/agent_pause/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/diagnostic\.ctr_floor/i)).not.toBeInTheDocument();
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
    expect(screen.getByText("Breached")).toBeInTheDocument();
    expect(screen.queryByText("Validated outcome")).not.toBeInTheDocument();
  });
});
