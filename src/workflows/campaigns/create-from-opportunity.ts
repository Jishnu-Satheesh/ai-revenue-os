import { z } from "zod";

/**
 * The governed-draft worker step (spec 022 section 10.2): claim one durable
 * draft request, freeze exactly one Campaign with its source snapshot, and
 * complete the linkage atomically. Pure orchestration over injected ports so
 * the fencing and outcome rules are unit-proven without a database.
 *
 * Durable semantics: business refusals return outcomes, they never throw. A
 * claim conflict means another worker holds the request, so this delivery
 * stands down silently. Only unexpected transport failures throw, and those
 * are the retryable kind Trigger redelivers.
 */

export const createFromOpportunityPayloadSchema = z.strictObject({
  organizationId: z.string().uuid(),
  requestId: z.string().uuid(),
  claimToken: z.string().uuid(),
  idempotencyKey: z.string().trim().min(16).max(200),
  leaseSeconds: z.number().int().min(30).max(3600),
  correlationId: z.string().uuid(),
});

export type CreateFromOpportunityPayload = z.infer<typeof createFromOpportunityPayloadSchema>;

export type DraftRequestClaim = {
  claim(input: {
    organizationId: string;
    requestId: string;
    claimToken: string;
    leaseSeconds: number;
  }): Promise<{ status: string }>;
  create(input: {
    organizationId: string;
    requestId: string;
    claimToken: string;
    idempotencyKey: string;
  }): Promise<{ campaignId: string; sourceSnapshotId: string | null; status: string }>;
  fail(input: {
    organizationId: string;
    requestId: string;
    claimToken: string;
    retryable: boolean;
    failureCode: string;
  }): Promise<{ status: string }>;
};

export type CreateFromOpportunityOutcome =
  | { outcome: "created"; campaignId: string; sourceSnapshotId: string | null }
  | { outcome: "replayed"; campaignId: string; sourceSnapshotId: string | null }
  | { outcome: "claim_conflict" }
  | { outcome: "failed"; retryable: boolean; failureCode: string };

function failureCodeFor(error: unknown): { retryable: boolean; failureCode: string } {
  const code = (error as { code?: unknown } | null)?.code;
  // Changed prerequisites and invalid states are permanent: retrying the same
  // frozen intent against moved evidence only fails the same way.
  if (code === "22023" || code === "P0002") {
    return { retryable: false, failureCode: "stale_prerequisite" };
  }
  return { retryable: true, failureCode: "worker_error" };
}

export async function createFromOpportunity(
  drafts: DraftRequestClaim,
  input: CreateFromOpportunityPayload,
): Promise<CreateFromOpportunityOutcome> {
  const payload = createFromOpportunityPayloadSchema.parse(input);
  try {
    await drafts.claim({
      organizationId: payload.organizationId,
      requestId: payload.requestId,
      claimToken: payload.claimToken,
      leaseSeconds: payload.leaseSeconds,
    });
  } catch {
    return { outcome: "claim_conflict" };
  }

  try {
    const created = await drafts.create({
      organizationId: payload.organizationId,
      requestId: payload.requestId,
      claimToken: payload.claimToken,
      idempotencyKey: payload.idempotencyKey,
    });
    if (created.status === "replayed") {
      return {
        outcome: "replayed",
        campaignId: created.campaignId,
        sourceSnapshotId: created.sourceSnapshotId,
      };
    }
    return {
      outcome: "created",
      campaignId: created.campaignId,
      sourceSnapshotId: created.sourceSnapshotId,
    };
  } catch (error) {
    const failure = failureCodeFor(error);
    await drafts.fail({
      organizationId: payload.organizationId,
      requestId: payload.requestId,
      claimToken: payload.claimToken,
      retryable: failure.retryable,
      failureCode: failure.failureCode,
    });
    return { outcome: "failed", ...failure };
  }
}
