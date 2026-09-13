import { z } from "zod";

import {
  admitResearchRequest,
  researchMoneySchema,
  researchTriggerKindSchema,
  type ResearchAdmissionRefusal,
  type ResearchMoney,
  type ResearchTriggerKind,
} from "@/domain/campaigns/research-policy";
import {
  isResearchPersistenceFailure,
  type ResearchPolicyRepository,
} from "@/modules/campaigns/infrastructure/research-policy-repository";

/**
 * The service that owns research admission.
 *
 * Admission runs in two passes that agree by construction: the domain
 * pre-check reads the ledger and produces the precise refusal reason, then
 * the governed writer rechecks every limit under lock and is the final word.
 * A race lost between the two passes surfaces as the writer's refusal, never
 * as an overrun — the pre-check is advisory, the function is authority.
 *
 * It deliberately does NOT re-implement the checks. A second copy of a money
 * rule is a copy that will eventually disagree with the one that counts.
 */

const uuidSchema = z.string().uuid();

export const admitResearchSchema = z.strictObject({
  triggerKind: researchTriggerKindSchema,
  requestedBudget: researchMoneySchema,
  knownPolicyVersion: z.number().int().positive().nullable().default(null),
  sourceFingerprint: z.string().trim().min(8).max(200).nullable().default(null),
  /** The staged question, stored on the run row — never in a worker payload. */
  researchQuestion: z.string().trim().min(1).max(2000).nullable().default(null),
  requestDigest: z.string().regex(/^[0-9a-f]{64}$/, "A digest must be SHA-256 hex."),
  idempotencyKey: z.string().trim().min(8).max(200),
});
export type AdmitResearchInput = z.input<typeof admitResearchSchema>;

export type ResearchAdmissionOutcome =
  | {
      status: "admitted" | "replayed";
      runId: string;
      policyVersion: number;
      reservedBudget: ResearchMoney;
    }
  | { status: "refused"; reasonCode: ResearchAdmissionRefusal }
  | { status: "forbidden" | "unavailable" | "invalid" };

export function createResearchPolicyService(dependencies: {
  repository: ResearchPolicyRepository;
  now: () => Date;
}) {
  return {
    async admit(input: {
      organizationId: string;
      request: AdmitResearchInput;
    }): Promise<ResearchAdmissionOutcome> {
      const parsed = admitResearchSchema.parse(input.request);

      let ledger;
      try {
        ledger = await dependencies.repository.readLedger({
          organizationId: input.organizationId,
        });
      } catch (error) {
        return ledgerFailure(error);
      }

      // Advisory pre-check: names the reason without spending anything. The
      // writer below rechecks under lock; a disagreement resolves in the
      // writer's favour.
      const preview = admitResearchRequest({
        policy: ledger.policy,
        knownPolicyVersion: parsed.knownPolicyVersion,
        triggerKind: parsed.triggerKind,
        requestedBudget: parsed.requestedBudget,
        pendingCount: ledger.pendingCount,
        windowSpentMinor: ledger.windowSpentMinor,
        lastAdmittedAt: ledger.lastAdmittedAt,
        now: dependencies.now(),
      });
      if (preview.outcome === "refused") {
        return { status: "refused", reasonCode: preview.reasonCode };
      }

      try {
        const saved = await dependencies.repository.requestRun({
          organizationId: input.organizationId,
          triggerKind: parsed.triggerKind,
          budgetMinor: parsed.requestedBudget.amountMinor,
          allowanceCurrency: parsed.requestedBudget.currency,
          sourceFingerprint: parsed.sourceFingerprint,
          researchQuestion: parsed.researchQuestion,
          requestDigest: parsed.requestDigest,
          idempotencyKey: parsed.idempotencyKey,
          knownPolicyVersion: parsed.knownPolicyVersion,
        });
        return {
          status: saved.outcome === "replayed" ? "replayed" : "admitted",
          runId: saved.runId,
          policyVersion: preview.policyVersion,
          reservedBudget: preview.reservedBudget,
        };
      } catch (error) {
        return writerFailure(error);
      }
    },
  };
}

export type ResearchPolicyService = ReturnType<typeof createResearchPolicyService>;

function ledgerFailure(error: unknown): ResearchAdmissionOutcome {
  if (!isResearchPersistenceFailure(error)) return { status: "unavailable" };
  if (error.kind === "forbidden") return { status: "forbidden" };
  return { status: "unavailable" };
}

function writerFailure(error: unknown): ResearchAdmissionOutcome {
  if (!isResearchPersistenceFailure(error)) return { status: "unavailable" };
  switch (error.kind) {
    case "refused":
      // The lock saw a world newer than the preview: its refusal wins.
      return { status: "refused", reasonCode: error.reasonCode };
    case "forbidden":
      return { status: "forbidden" };
    case "invalid":
      return { status: "invalid" };
    default:
      return { status: "unavailable" };
  }
}

export type { ResearchTriggerKind };
