import { customerNewShareDetector } from "@/domain/analysis/detectors/customer-new-share";
import { funnelStageConversionDetector } from "@/domain/analysis/detectors/funnel-stage-conversion";
import { operationsClosedShareDetector } from "@/domain/analysis/detectors/operations-closed-share";
import { ordersCancellationLossDetector } from "@/domain/analysis/detectors/orders-cancellation-loss";
import { periodCoverageDetector } from "@/domain/analysis/detectors/period-coverage";
import { reconciliationBlockedDetector } from "@/domain/analysis/detectors/reconciliation-blocked";
import { revenueChannelShareDetector } from "@/domain/analysis/detectors/revenue-channel-share";
import { revenuePeriodMovementDetector } from "@/domain/analysis/detectors/revenue-period-movement";
import { revenueWindowGrossDetector } from "@/domain/analysis/detectors/revenue-window-gross";
import type {
  AnalysisEvidence,
  AnalysisGrain,
  DetectorDeclaration,
  DetectorOutcome,
  DetectorScope,
} from "@/domain/analysis/types";

/**
 * The detector registry, per `specs/018` section 11.1.
 *
 * Version 2 appends the four detectors the Talabat performance export unlocked
 * -- funnel stages, avoidable cancellations with the provider's own rejection
 * loss, closed minutes and days, and the new/returning customer mix (see ADRs
 * 0034, 0035, and 0036). The catalogue in section 11.2 still runs to roughly
 * fifty families, and almost every remaining one needs economics inputs or a
 * metric vocabulary no governed report writes. A detector registered against a
 * metric nothing populates answers `needs_data` forever and teaches an operator
 * nothing, so registration still tracks what the report path demonstrably
 * produces today. See ADR 0031.
 */

// 2: funnel stage conversion, cancellation loss, closed share, and customer mix
// join the four detectors of the first shipped slice.
// 3: channel-scoped reported gross revenue supplies the cited VerdictBand base
// without asking an organization-scoped share detector to answer a channel run.
// 4: reported gross revenue can answer from a provider's own span total, so a
// channel that states one figure per export is analysable at all.
// 5: a span is a grain a run can be claimed at, so the span total from 4 is
// reachable. Only the two detectors that can honestly answer without periods
// bind there; the rest are not bound at all, rather than bound and refusing.
export const CHANNEL_ANALYSIS_REGISTRY_VERSION = 5;

export const channelAnalysisDetectors: readonly DetectorDeclaration[] = [
  periodCoverageDetector,
  reconciliationBlockedDetector,
  revenuePeriodMovementDetector,
  revenueChannelShareDetector,
  revenueWindowGrossDetector,
  funnelStageConversionDetector,
  ordersCancellationLossDetector,
  operationsClosedShareDetector,
  customerNewShareDetector,
];

/**
 * The detectors a run may bind.
 *
 * A run names one channel or none, and a detector declares which question it
 * answers. Asking a cross-channel comparison to run inside a single channel's
 * window would give it one channel to compare, and asking a channel detector to
 * run without a channel would give it every channel's rows in one series.
 * Neither is a shape either detector can honestly refuse at calculation time,
 * so the refusal happens here instead.
 */
export function selectDetectors(input: {
  scope: DetectorScope;
  grain: AnalysisGrain;
}): readonly DetectorDeclaration[] {
  return channelAnalysisDetectors.filter(
    (detector) => detector.scope === input.scope && detector.compatibleGrains.includes(input.grain),
  );
}

/** The metric vocabulary a set of detectors needs before any of them can run. */
export function requiredMetricKeys(detectors: readonly DetectorDeclaration[]): string[] {
  return [
    ...new Set(
      detectors.flatMap((detector) => [
        ...detector.requiredMetricKeys,
        ...detector.optionalMetricKeys,
      ]),
    ),
  ].sort();
}

export type AttributedOutcome = {
  detector: DetectorDeclaration;
  outcome: DetectorOutcome;
};

/**
 * Runs each bound detector over the same evidence.
 *
 * Detectors are pure and independent: none sees another's output, and none can
 * make the evidence look different to the next one. A detector that threw would
 * fail the run rather than being skipped, because a registry that quietly drops
 * a detector reports a clean pass over an analysis that did not happen.
 */
export function runDetectors(
  detectors: readonly DetectorDeclaration[],
  evidence: AnalysisEvidence,
): AttributedOutcome[] {
  return detectors.flatMap((detector) =>
    detector.run(evidence).map((outcome) => ({ detector, outcome })),
  );
}
