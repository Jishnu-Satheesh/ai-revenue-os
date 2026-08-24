import { describe, expect, it } from "vitest";

import { reconciliationBlockedDetector } from "@/domain/analysis/detectors/reconciliation-blocked";
import { evidence, held, OTHER_CHANNEL, point } from "@/domain/analysis/test-fixtures";

describe("evidence.reconciliation_blocked", () => {
  it("says so plainly when nothing is waiting on a decision", () => {
    const [outcome] = reconciliationBlockedDetector.run(evidence());

    expect(outcome.kind).toBe("observation");
    expect(outcome.code).toBe("NO_EVIDENCE_HELD");
    expect(outcome.kind === "observation" && outcome.measurement?.numerator).toBe(0);
  });

  it("names the reconciliation record rather than the figure being held", () => {
    const [outcome] = reconciliationBlockedDetector.run(
      evidence({ heldEvidence: [held({ reconciliationId: "reconciliation-1" })] }),
    );

    expect(outcome.kind).toBe("finding");
    expect(outcome.code).toBe("EVIDENCE_HELD_FOR_DECISION");
    expect(outcome.evidence).toEqual([
      { kind: "report_projection_reconciliation", role: "held_evidence", id: "reconciliation-1" },
    ]);
    // No held value appears anywhere in the outcome.
    expect(outcome.kind === "finding" && outcome.measurement).toEqual({
      valueKind: "count",
      numerator: 1,
    });
  });

  it("is high severity when the held record blocks a period nothing else covers", () => {
    const [outcome] = reconciliationBlockedDetector.run(
      evidence({ heldEvidence: [held({ periodStart: "2026-01-04", periodEnd: "2026-01-04" })] }),
    );

    expect(outcome.kind === "finding" && outcome.severity).toBe("high");
    expect(outcome.kind === "finding" && outcome.priority).toBe(10);
  });

  it("is medium severity when every period it covers already has evidence", () => {
    const points = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05"].map(
      (date) => point(date, 1_000),
    );

    const [outcome] = reconciliationBlockedDetector.run(
      evidence({ points, heldEvidence: [held()] }),
    );

    expect(outcome.kind === "finding" && outcome.severity).toBe("medium");
    expect(outcome.kind === "finding" && outcome.priority).toBe(30);
  });

  it("ignores a record held for a different channel", () => {
    const [outcome] = reconciliationBlockedDetector.run(
      evidence({ heldEvidence: [held({ channelId: OTHER_CHANNEL })] }),
    );

    expect(outcome.code).toBe("NO_EVIDENCE_HELD");
  });

  it("ignores a record whose period does not touch the window", () => {
    const [outcome] = reconciliationBlockedDetector.run(
      evidence({ heldEvidence: [held({ periodStart: "2025-12-01", periodEnd: "2025-12-31" })] }),
    );

    expect(outcome.code).toBe("NO_EVIDENCE_HELD");
  });

  it("clips the reported period to the window it was asked about", () => {
    const [outcome] = reconciliationBlockedDetector.run(
      evidence({ heldEvidence: [held({ periodStart: "2025-12-20", periodEnd: "2026-01-31" })] }),
    );

    expect(outcome.periodStart).toBe("2026-01-01");
    expect(outcome.periodEnd).toBe("2026-01-05");
  });
});
