import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  dispatchAnalysisForCleanProjection,
  type ProjectionCompletionSummary,
  selectAutoAnalysisInput,
} from "@/modules/reports/application/auto-analysis";
import { logger } from "@/lib/logger";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const CHANNEL_ID = "22222222-2222-4222-8222-222222222222";
const BRANCH_ID = "33333333-3333-4333-8333-333333333333";
const CORRELATION_ID = "44444444-4444-4444-8444-444444444444";

function cleanCompletion(
  overrides: Partial<ProjectionCompletionSummary> = {},
): ProjectionCompletionSummary {
  return {
    projectionOutcome: "projected",
    packageStatus: "projected",
    channelId: CHANNEL_ID,
    branchId: BRANCH_ID,
    windowStart: "2026-03-01",
    windowEnd: "2026-03-31",
    periodGrain: "day",
    ...overrides,
  };
}

describe("selectAutoAnalysisInput", () => {
  it("selects the package's own window, channel, branch, and grain on a clean projection", () => {
    expect(selectAutoAnalysisInput(cleanCompletion())).toEqual({
      channelId: CHANNEL_ID,
      branchId: BRANCH_ID,
      windowStart: "2026-03-01",
      windowEnd: "2026-03-31",
      periodGrain: "day",
    });
  });

  it("dispatches nothing for a run that ended reconciliation_required", () => {
    expect(
      selectAutoAnalysisInput(cleanCompletion({ packageStatus: "reconciliation_required" })),
    ).toBeNull();
  });

  it("dispatches nothing for a partially projected run", () => {
    expect(
      selectAutoAnalysisInput(
        cleanCompletion({ projectionOutcome: "partially_projected", packageStatus: "partially_projected" }),
      ),
    ).toBeNull();
  });

  it("dispatches nothing for a failed or replayed run", () => {
    expect(selectAutoAnalysisInput(cleanCompletion({ projectionOutcome: "failed" }))).toBeNull();
    expect(
      selectAutoAnalysisInput(cleanCompletion({ projectionOutcome: "completed" })),
    ).toBeNull();
  });

  it("fails closed when the completion row is missing pieces", () => {
    expect(selectAutoAnalysisInput(cleanCompletion({ channelId: null }))).toBeNull();
    expect(selectAutoAnalysisInput(cleanCompletion({ windowEnd: undefined }))).toBeNull();
    expect(selectAutoAnalysisInput(cleanCompletion({ periodGrain: null }))).toBeNull();
  });
});

describe("dispatchAnalysisForCleanProjection", () => {
  it("requests the selected analysis and reports dispatched", async () => {
    const requestAnalysis = vi.fn().mockResolvedValue(true);

    const outcome = await dispatchAnalysisForCleanProjection(
      { organizationId: ORGANIZATION_ID, correlationId: CORRELATION_ID, completion: cleanCompletion() },
      { requestAnalysis },
    );

    expect(outcome).toBe("dispatched");
    expect(requestAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORGANIZATION_ID,
        channelId: CHANNEL_ID,
        branchId: BRANCH_ID,
        windowStart: "2026-03-01",
        windowEnd: "2026-03-31",
        periodGrain: "day",
        correlationId: CORRELATION_ID,
      }),
    );
    const analysisRunId = requestAnalysis.mock.calls[0][0].analysisRunId as string;
    expect(analysisRunId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("never calls transport for a disputed projection", async () => {
    const requestAnalysis = vi.fn().mockResolvedValue(true);

    const outcome = await dispatchAnalysisForCleanProjection(
      {
        organizationId: ORGANIZATION_ID,
        correlationId: CORRELATION_ID,
        completion: cleanCompletion({ packageStatus: "reconciliation_required" }),
      },
      { requestAnalysis },
    );

    expect(outcome).toBe("not_dispatched");
    expect(requestAnalysis).not.toHaveBeenCalled();
  });

  it("reports not_dispatched when the transport does not land", async () => {
    const requestAnalysis = vi.fn().mockResolvedValue(false);

    const outcome = await dispatchAnalysisForCleanProjection(
      { organizationId: ORGANIZATION_ID, correlationId: CORRELATION_ID, completion: cleanCompletion() },
      { requestAnalysis },
    );

    expect(outcome).toBe("not_dispatched");
  });

  it("catches an escape from requestAnalysis and reports not_dispatched instead of throwing", async () => {
    // This call site runs after the completion RPC has already committed the
    // package's new status (see reports.ts). Letting an escape through here
    // would abort the Trigger.dev task and cause a retry that re-claims an
    // already-advanced package, losing the auto-continuation for good rather
    // than merely delaying it -- the same hazard advanceReportPackageOnAdmission
    // guards against for the same reason.
    const requestAnalysis = vi.fn().mockRejectedValue(new Error("transport exploded"));

    await expect(
      dispatchAnalysisForCleanProjection(
        { organizationId: ORGANIZATION_ID, correlationId: CORRELATION_ID, completion: cleanCompletion() },
        { requestAnalysis },
      ),
    ).resolves.toBe("not_dispatched");

    expect(logger.warn).toHaveBeenCalledWith(
      "report_package.analysis_auto_dispatch_failed",
      expect.objectContaining({ organizationId: ORGANIZATION_ID, errorCode: "Error" }),
    );
  });
});
