import { z } from "zod";

import {
  buildReconciliationLookup,
  type ReconciliationEvidence,
  type ReconciliationLookupDefinition,
} from "@/domain/integrations/reconciliation";
import type { MetaRequestOutcome } from "@/modules/integrations/providers/meta/client";

/**
 * Resolving a write whose outcome nobody knows.
 *
 * One rule dominates everything else here: **only a definite "no" releases a
 * retry.** A lookup that times out, errors, or returns something unreadable
 * leaves the invocation unknown, because "I could not find out" and "it did not
 * happen" are different answers and treating them alike republishes a post that
 * already went out.
 *
 * That asymmetry is deliberate and costs something. An invocation can stay
 * unknown for a long time and eventually need an operator. That is the cheaper
 * failure: a stuck record is recoverable, a duplicate public post is not.
 */

export type ReconciliationFinding =
  | { finding: "confirmed"; externalReference: string; providerStatus: string | null }
  | { finding: "absent" }
  | { finding: "still_unknown"; reason: string };

export type ReconciliationLookupCaller = {
  request<T>(input: {
    method: "GET" | "POST";
    path: readonly string[];
    schema: z.ZodType<T>;
    signal: AbortSignal;
  }): Promise<MetaRequestOutcome<T>>;
};

export type ReconcileUnknownInput = {
  definition: ReconciliationLookupDefinition;
  evidence: ReconciliationEvidence;
  /** Statuses the contract documents as meaning "no such object". */
  absentStatuses: readonly number[];
  client: ReconciliationLookupCaller;
  signal: AbortSignal;
};

export async function reconcileUnknownInvocation(
  input: ReconcileUnknownInput,
): Promise<ReconciliationFinding> {
  const lookup = buildReconciliationLookup(input.definition, input.evidence);

  if (lookup.outcome === "impossible") {
    // Nothing was learned, so nothing changes. Releasing a retry here would be
    // acting on the absence of a question rather than the absence of an object.
    return {
      finding: "still_unknown",
      reason: `lookup_impossible:${lookup.missing.join(",")}`,
    };
  }

  // Only the identity field the contract names. A lookup that accepted any
  // shape could read a success out of an error envelope.
  const schema = z.object({
    [input.definition.resultIdentityField]: z.string().min(1),
    status: z.string().optional(),
  });

  const result = await input.client.request({
    method: lookup.method,
    path: lookup.path,
    schema,
    signal: input.signal,
  });

  if (result.outcome === "unknown") {
    return { finding: "still_unknown", reason: `lookup_${result.reason}` };
  }

  if (result.outcome === "failed") {
    // Absence is a claim about the world, so only a status the contract
    // documents as meaning "no such object" may be read that way. Every other
    // failure leaves the question open.
    if (input.absentStatuses.includes(result.status)) {
      return { finding: "absent" };
    }
    return { finding: "still_unknown", reason: result.failureCode };
  }

  const identity = (result.data as Record<string, unknown>)[input.definition.resultIdentityField];

  if (typeof identity !== "string" || identity.length === 0) {
    return { finding: "still_unknown", reason: "lookup_identity_missing" };
  }

  const status = (result.data as Record<string, unknown>).status;

  return {
    finding: "confirmed",
    externalReference: identity,
    providerStatus: typeof status === "string" ? status : null,
  };
}
