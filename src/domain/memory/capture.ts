/**
 * Shared-capture vocabulary (Spec 023 §§5/9). Pure module: no I/O, no clock,
 * no randomness, no node imports. The database check constraints are the
 * authority; these unions keep TypeScript callers from spelling a value the
 * database would refuse.
 */

export const captureSourceKinds = [
  "channel_finding",
  "channel_recommendation",
  "channel_decision",
  "market_claim",
  "growth_item",
  "growth_decision",
  "campaign_state",
  "campaign_outcome",
  "campaign_lesson",
] as const;
export type CaptureSourceKind = (typeof captureSourceKinds)[number];

export const captureEventKinds = ["recorded", "changed", "withdrawn", "submitted"] as const;
export type CaptureEventKind = (typeof captureEventKinds)[number];

export const captureStatuses = [
  "pending",
  "claimed",
  "completed",
  "obsolete",
  "quarantined",
  "failed",
] as const;
export type CaptureStatus = (typeof captureStatuses)[number];

export const captureSafeCodes = [
  "TRANSIENT_DB",
  "TRANSIENT_THROTTLED",
  "QUARANTINE_UNREGISTERED_ADAPTER",
  "QUARANTINE_INVALID_SHAPE",
  "QUARANTINE_TENANT_MISMATCH",
  "QUARANTINE_RIGHTS_DENIED",
  "QUARANTINE_MISSING_PROVENANCE",
  "OBSOLETE_WITHDRAWN",
  "OBSOLETE_SUPERSEDED",
  "OBSOLETE_DISABLED",
  "ATTEMPTS_EXHAUSTED",
] as const;
export type CaptureSafeCode = (typeof captureSafeCodes)[number];

export const memoryKnowledgeKinds = [
  "observation",
  "recommendation",
  "operator_decision",
  "campaign_state",
  "measured_outcome",
  "lesson",
  "legacy",
] as const;
export type MemoryKnowledgeKind = (typeof memoryKnowledgeKinds)[number];

/** Lease and batch bounds from Spec 023 §5. The SQL enforces them again. */
export const CAPTURE_LEASE_SECONDS = 120 as const;
export const CAPTURE_CLAIM_BATCH_LIMIT = 25 as const;
export const CAPTURE_DUE_SCAN_LIMIT = 100 as const;
export const CAPTURE_MAX_ATTEMPTS = 5 as const;

/**
 * Retry delays after attempts 1–4: 30 seconds, 2 minutes, 10 minutes,
 * 30 minutes. Mirrors the SQL CASE in fail_memory_capture_event so the
 * runner can name the next delay without reading the row back.
 */
export function captureRetryDelayMs(attemptCount: number): number | null {
  switch (attemptCount) {
    case 1:
      return 30_000;
    case 2:
      return 120_000;
    case 3:
      return 600_000;
    case 4:
      return 1_800_000;
    default:
      return null;
  }
}

export type CaptureCompletion =
  | { status: "completed"; captureId: string; projectedItemId: string }
  | { status: "replayed"; captureId: string; projectedItemId: string }
  | { status: "obsolete" | "quarantined"; captureId: string };

export type CaptureFailure =
  | { status: "pending" | "failed" | "obsolete" | "quarantined"; captureId: string };
