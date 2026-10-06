import type { OrganizationRole } from "@/domain/organizations/types";
import { encodeAnswerBody } from "./answer-writer";
import type { AgentReportContinuationOutcome } from "./report-intake-continuation";
import type { GovernedTurnOutcome } from "./governed-turn-runner";
import type { AgentTurnEventType } from "../infrastructure/turn-repository";

type ReportSnapshot = Omit<AgentReportContinuationOutcome, "kind" | "reason" | "approvalKind">;
export type ReportTurnPorts = {
  currentRole: () => Promise<OrganizationRole | null>;
  continueReport: () => Promise<AgentReportContinuationOutcome>;
  appendEvent: (input: {
    eventKey: string;
    eventType: AgentTurnEventType;
    payload: Record<string, unknown>;
  }) => Promise<unknown>;
  setApproval: (input: {
    kind: "report_contract" | "report_projection" | "report_correction";
    packageId: string;
  }) => Promise<unknown>;
  finishAssessment: (report: ReportSnapshot) => Promise<GovernedTurnOutcome>;
  complete: (input: { answerBody: string }) => Promise<unknown>;
};

/** Projected source evidence, not upload completion, unlocks the final answer. */
export async function runAgentReportContinuationStep(
  input: { organizationId: string; turnId: string; attachmentId: string },
  ports: ReportTurnPorts,
): Promise<GovernedTurnOutcome | { kind: "awaiting_approval" }> {
  if (!(await ports.currentRole())) return { kind: "revoked" };
  const report = await ports.continueReport();
  if (report.kind === "processing") return { kind: "waiting", nextPollAfterMs: 5000 };
  if (report.kind === "awaiting_approval") {
    await ports.setApproval({ kind: report.approvalKind, packageId: report.packageId });
    return { kind: "awaiting_approval" };
  }
  if (report.kind === "blocked") {
    if (!(await ports.currentRole())) return { kind: "revoked" };
    const copy =
      report.reason === "REPORT_VALIDATION_FAILED"
        ? "The report needs a validation fix before I can assess its performance. Open the report review, correct the flagged rows or mapping, then retry validation."
        : report.reason === "NO_CURRENT_REPORT_EVIDENCE"
          ? "This report has no current projected figures to assess. Open the report review to check its projection and any newer replacement, then retry the source workflow."
          : "The report processing could not finish. Open the report review to see the failed step and retry it; I will continue once its figures are ready.";
    await ports.complete({
      answerBody: encodeAnswerBody({
        body: copy,
        citations: [],
        estimates: [],
        limitations: ["Performance conclusions require current validated report figures."],
        periodSwitch: null,
        links: [{ label: "Open report review", href: report.reportHref }],
      }),
    });
    return { kind: "completed" };
  }
  await ports.appendEvent({
    eventKey: `attachment:${input.attachmentId}:processed`,
    eventType: "report_processed",
    payload: { attachmentId: input.attachmentId, packageId: report.packageId },
  });
  return ports.finishAssessment(report);
}
