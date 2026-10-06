import { describe, expect, it, vi } from "vitest";
import { runAgentReportContinuationStep } from "./report-turn-runner";

const ids = {
  organizationId: "10000000-0000-4000-8000-000000000001",
  turnId: "20000000-0000-4000-8000-000000000002",
  attachmentId: "30000000-0000-4000-8000-000000000003",
};
const report = {
  packageId: "40000000-0000-4000-8000-000000000004",
  scope: {
    channelId: "50000000-0000-4000-8000-000000000005",
    branchId: "60000000-0000-4000-8000-000000000006",
    reportType: "performance",
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    currency: "AED",
  },
  status: "projected" as const,
  hasCurrentEvidence: true,
  partial: false,
  reportHref: `/organizations/${ids.organizationId}/integrations?tab=data-sources&package=40000000-0000-4000-8000-000000000004`,
};
function ports() {
  return {
    currentRole: vi.fn(async () => "operator" as const),
    continueReport: vi.fn(async () => ({ ...report, kind: "ready" as const })),
    appendEvent: vi.fn(async () => ({})),
    setApproval: vi.fn(async () => ({})),
    finishAssessment: vi.fn(async () => ({ kind: "completed" as const })),
    complete: vi.fn(async () => ({})),
  };
}
describe("attached report continuation", () => {
  it("keeps the turn open while projection is processing", async () => {
    const p = ports();
    p.continueReport.mockResolvedValue({
      ...report,
      kind: "processing",
      status: "awaiting_projection",
      hasCurrentEvidence: false,
    } as never);
    expect(await runAgentReportContinuationStep(ids, p)).toEqual({
      kind: "waiting",
      nextPollAfterMs: 5000,
    });
    expect(p.finishAssessment).not.toHaveBeenCalled();
    expect(p.complete).not.toHaveBeenCalled();
  });
  it("waits for source-owned approval without writing a final answer", async () => {
    const p = ports();
    p.continueReport.mockResolvedValue({
      ...report,
      kind: "awaiting_approval",
      approvalKind: "report_projection",
      reason: "REPORT_PROJECTION_APPROVAL_REQUIRED",
    } as never);
    expect((await runAgentReportContinuationStep(ids, p)).kind).toBe("awaiting_approval");
    expect(p.setApproval).toHaveBeenCalledWith({
      kind: "report_projection",
      packageId: report.packageId,
    });
    expect(p.finishAssessment).not.toHaveBeenCalled();
    expect(p.complete).not.toHaveBeenCalled();
  });
  it("passes the verified exact scope to analysis and records processing once", async () => {
    const p = ports();
    expect((await runAgentReportContinuationStep(ids, p)).kind).toBe("completed");
    expect(p.finishAssessment).toHaveBeenCalledWith(expect.objectContaining(report));
    expect(p.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "report_processed",
        payload: expect.objectContaining({ packageId: report.packageId }),
      }),
    );
    expect(p.complete).not.toHaveBeenCalled();
  });
  it("offers a repair link for a source failure without inventing performance", async () => {
    const p = ports();
    p.continueReport.mockResolvedValue({
      ...report,
      kind: "blocked",
      status: "validation_failed",
      hasCurrentEvidence: false,
      reason: "REPORT_VALIDATION_FAILED",
    } as never);
    expect((await runAgentReportContinuationStep(ids, p)).kind).toBe("completed");
    expect(p.finishAssessment).not.toHaveBeenCalled();
    expect(p.complete).toHaveBeenCalledWith(
      expect.objectContaining({ answerBody: expect.stringContaining(report.reportHref) }),
    );
    expect(p.complete).toHaveBeenCalledWith(
      expect.objectContaining({ answerBody: expect.stringContaining("validation") }),
    );
  });
  it("does not continue or persist after actor revocation", async () => {
    const p = ports();
    p.currentRole.mockResolvedValue(null as never);
    expect((await runAgentReportContinuationStep(ids, p)).kind).toBe("revoked");
    expect(p.continueReport).not.toHaveBeenCalled();
    expect(p.complete).not.toHaveBeenCalled();
  });
});
