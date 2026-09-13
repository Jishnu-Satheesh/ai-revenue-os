import {
  createResearchService,
  ResearchClaimLost,
  researchRunSchema,
  type ResearchRunInput,
  type ResearchRunResult,
  type ResearchServiceDependencies,
} from "@/modules/campaigns/application/research-service";

/**
 * Campaign research as durable work (Task 6, C03).
 *
 * Trigger runs the code; Postgres decides what happened. The run row is
 * claimed with a lease and a token, so a duplicate delivery stands down, a
 * dead worker is taken over once its lease lapses, and a worker that wakes
 * up late cannot complete over the run's rightful successor.
 *
 * The payload carries identifiers only. The staged question, the trigger
 * kind, and the pinned manifest all arrive through the claim-bound loader
 * from the admitted run row — never from payload text.
 */

export type ResearchProposalResult = ResearchRunResult | { status: "claim_lost"; runId: string };

export async function researchProposal(
  raw: ResearchRunInput,
  dependencies: ResearchServiceDependencies,
  signal: AbortSignal,
): Promise<ResearchProposalResult> {
  // Re-parsed rather than trusted: a malformed payload must fail before any
  // tenant-bypassing client exists. The parse throws, which is deliberate —
  // a poison payload retries loudly to the Trigger alert rather than
  // cancelling a run it cannot even name.
  const input = researchRunSchema.parse(raw);

  // An already-aborted delivery cancels the queued run without claiming it:
  // claiming first would spend a lease only to stand down.
  if (signal.aborted) {
    await dependencies.runs.cancel({
      organizationId: input.organizationId,
      runId: input.runId,
    });
    return { status: "cancelled", runId: input.runId };
  }

  const service = createResearchService({
    ...dependencies,
    isCancelled: () => signal.aborted || dependencies.isCancelled(),
  });

  try {
    return await service.run(input);
  } catch (error) {
    // The run is cancelled or owned elsewhere; neither wants this worker
    // retrying billable work. Returned, not thrown, so Trigger stands down.
    if (error instanceof ResearchClaimLost) {
      return { status: "claim_lost", runId: input.runId };
    }
    throw error;
  }
}
