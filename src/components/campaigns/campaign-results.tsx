"use client";

import { FlaskConical } from "lucide-react";

import {
  LearningReview,
  type LearningDecision,
  type LearningProposalData,
} from "@/components/campaigns/learning-review";
import { OutcomeProof, type OutcomeProofData } from "@/components/campaigns/outcome-proof";
import {
  PostPerformance,
  type PostPerformanceSeries,
} from "@/components/campaigns/post-performance";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

/**
 * What actually happened, and what was learned from it.
 *
 * Nothing here is gated on a live approval. A campaign that ran and settled
 * keeps its proof after its authority lapses — C09 requires that a rollback
 * stop new admissions while leaving history readable, and a result that
 * disappeared when its approval expired would be the opposite of that.
 *
 * The empty state says why there is no result rather than showing a blank. "Not
 * measured yet" and "measured and found nothing" are different claims, and only
 * the first one is true before the outcome window closes.
 */
export function CampaignResults({
  outcome,
  learningProposal,
  canDecideLearning,
  timeZone,
  onDecideLearning,
  measurement,
  postPerformance,
}: Readonly<{
  outcome: OutcomeProofData | null;
  learningProposal: LearningProposalData | null;
  canDecideLearning: boolean;
  timeZone: string;
  onDecideLearning: (
    decision: LearningDecision,
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
  /** The preregistered plan, so an unsettled campaign can say what it waits for. */
  measurement: {
    primaryMetricKey: string;
    outcomeWindowDays: number;
    minimumEvidenceTier: string;
  } | null;
  /**
   * What the provider is reporting about each published post.
   *
   * Deliberately separate from the settled outcome above. These are the
   * provider's own diagnostics and are never evidence of incremental gross
   * profit (ADR 0019); the verdict is, and conflating them would let a busy
   * post read as a profitable one.
   *
   * `null` means the figures could not be read, which is not the same as none
   * having been collected.
   */
  postPerformance: readonly PostPerformanceSeries[] | null;
}>) {
  return (
    <div className="flex flex-col gap-6">
      {postPerformance === null ? (
        <p className="text-sm text-muted-foreground" role="status">
          The figures Instagram reports could not be read just now. Nothing here says a post did
          badly — it says we could not ask.
        </p>
      ) : (
        <PostPerformance series={postPerformance} timeZone={timeZone} />
      )}

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Result</h2>
          <p className="text-sm text-muted-foreground">
            The settled verdict and the proof behind it: what was hypothesized, what actually
            delivered, what it cost, and why the verdict carries its label.
          </p>
        </div>

        {outcome === null ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FlaskConical />
              </EmptyMedia>
              <EmptyTitle>No result has been measured yet</EmptyTitle>
              <EmptyDescription>
                {measurement === null ? (
                  "Nothing has settled, so there is no result to show. This is not a result of zero."
                ) : (
                  <>
                    Measuring <span className="font-medium">{measurement.primaryMetricKey}</span>{" "}
                    over {measurement.outcomeWindowDays} days. Below the{" "}
                    {measurement.minimumEvidenceTier} evidence tier the conclusion is inconclusive,
                    not a smaller number.
                  </>
                )}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <OutcomeProof outcome={outcome} timeZone={timeZone} />
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Learning</h2>
          <p className="text-sm text-muted-foreground">
            A lesson the evidence loop drafted from this campaign&apos;s own settled outcome. It
            stays attached to this campaign until you decide otherwise.
          </p>
        </div>
        <LearningReview
          proposal={learningProposal}
          canDecide={canDecideLearning}
          timeZone={timeZone}
          onDecide={onDecideLearning}
        />
      </section>
    </div>
  );
}
