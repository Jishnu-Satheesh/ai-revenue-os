import { z } from "zod";

import type { PreflightRefusalCode } from "@/domain/tools/policy";

/**
 * The only way a campaign action reaches the outside world.
 *
 * A worker names a registered tool key and hands over a parsed action. It never
 * receives a credential, never chooses an endpoint, and never imports provider
 * `fetch` code — the adapter is selected here, and only after the database has
 * granted a claim. That ordering is the whole point: a worker that could reach
 * an adapter before claiming could call a provider the platform had not
 * authorized.
 */

const uuidSchema = z.string().uuid();
const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * Tool keys are a closed set. A string the registry does not know is refused
 * before anything is claimed, so a typo cannot become an unrecognised action
 * that quietly does nothing, and an invented key cannot reach a provider.
 */
export const TOOL_KEYS = [
  "meta.publish_image",
  "meta.publish_story",
  "meta.ads.run_bounded_experiment",
] as const;

export const toolKeySchema = z.enum(TOOL_KEYS);
export type ToolKey = z.infer<typeof toolKeySchema>;

export const executeActionInputSchema = z.strictObject({
  organizationId: uuidSchema,
  actionRunId: uuidSchema,
  toolKey: toolKeySchema,
  /** Which organization capability this action consumes. */
  capabilityKey: z.string().trim().min(2).max(120),
  idempotencyKey: z.string().trim().min(8).max(200),
  requestDigest: sha256HexSchema,
  /** Facts the campaign schema cannot prove, evaluated by the worker. */
  assertedFacts: z.strictObject({
    credentialHealthy: z.boolean(),
    trackingReady: z.boolean(),
    consentWithdrawn: z.boolean(),
  }),
  leaseSeconds: z.number().int().positive().max(3_600).optional(),
});
export type ExecuteActionInput = z.infer<typeof executeActionInputSchema>;

export type ClaimResult =
  | {
      outcome: "claimed";
      claimToken: string;
      attempt: number;
      reservationMinor: number | null;
      currency: string | null;
    }
  | { outcome: "refused"; reasonCodes: readonly PreflightRefusalCode[] }
  | { outcome: "already_claimed" }
  | { outcome: "already_completed"; receiptId: string }
  | { outcome: "provider_outcome_unknown"; invocationId: string };

/**
 * What an adapter reports back.
 *
 * `unknown` is a first-class outcome rather than a kind of failure. A timeout
 * after the request was sent is genuinely different from a rejection: the
 * provider may have done the thing, and treating it as a failure would invite a
 * retry that publishes or spends twice.
 */
export type AdapterOutcome =
  | {
      status: "succeeded";
      externalReference: string;
      providerStatus: string;
      permalink?: string;
      occurredAt: string;
      payloadDigest: string;
      normalized: Record<string, unknown>;
      settledMinor?: number;
    }
  | { status: "failed"; failureCode: string }
  | { status: "unknown"; failureCode: string };

export type ToolAdapter = {
  readonly toolKey: ToolKey;
  invoke(input: {
    organizationId: string;
    actionRunId: string;
    idempotencyKey: string;
    signal: AbortSignal;
  }): Promise<AdapterOutcome>;
};

export type ToolGatewayStore = {
  claim(input: {
    organizationId: string;
    actionRunId: string;
    capabilityKey: string;
    assertedFacts: ExecuteActionInput["assertedFacts"];
    leaseSeconds: number;
  }): Promise<ClaimResult>;
  recordInvocation(input: {
    organizationId: string;
    actionRunId: string;
    claimToken: string;
    toolKey: ToolKey;
    idempotencyKey: string;
    requestDigest: string;
  }): Promise<string>;
  complete(input: {
    organizationId: string;
    actionRunId: string;
    claimToken: string;
    invocationId: string;
    receipt: Extract<AdapterOutcome, { status: "succeeded" }>;
  }): Promise<string>;
  fail(input: {
    organizationId: string;
    actionRunId: string;
    claimToken: string;
    invocationId: string;
    failureCode: string;
    outcomeUnknown: boolean;
  }): Promise<void>;
};

export type ExecuteActionResult =
  | { status: "published"; receiptId: string; externalReference: string }
  | { status: "refused"; reasonCodes: readonly PreflightRefusalCode[] }
  | { status: "skipped"; reason: "already_claimed" }
  | { status: "replayed"; receiptId: string }
  | { status: "failed"; failureCode: string }
  | { status: "provider_outcome_unknown"; invocationId: string };
