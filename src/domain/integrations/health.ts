import type { ConnectionStatus, OperatorHealthState } from "@/domain/integrations/schemas";

export type ConnectionHealth = {
  state: OperatorHealthState;
  reasonCode: string;
  explanation: string;
  lastTestedAt?: string;
  lastSuccessfulSyncAt?: string;
  evaluatedAt: string;
};

export type ConnectionHealthInput = {
  status: ConnectionStatus;
  staleAfterMinutes: number;
  lastTestedAt?: string;
  lastSuccessfulSyncAt?: string;
  nextScheduledSyncAt?: string;
  latestOutcome?: "passed" | "warning" | "failed";
  now?: Date;
};

export function deriveConnectionHealth(input: ConnectionHealthInput): ConnectionHealth {
  const evaluatedAt = (input.now ?? new Date()).toISOString();
  const shared = {
    lastTestedAt: input.lastTestedAt,
    lastSuccessfulSyncAt: input.lastSuccessfulSyncAt,
    nextScheduledSyncAt: input.nextScheduledSyncAt,
    evaluatedAt,
  };

  if (input.status === "disconnected" || input.status === "revoked") {
    return {
      state: "revoked",
      reasonCode: "connection_revoked",
      explanation: "Connection use is disabled.",
      ...shared,
    };
  }

  const staleAfterMs = input.staleAfterMinutes * 60_000;
  const lastSuccessfulAt = input.lastSuccessfulSyncAt
    ? Date.parse(input.lastSuccessfulSyncAt)
    : Number.NaN;
  const nextScheduledAt = input.nextScheduledSyncAt
    ? Date.parse(input.nextScheduledSyncAt)
    : Number.NaN;
  const firstScheduledWindowElapsed = input.lastTestedAt
    ? Date.parse(input.lastTestedAt) + staleAfterMs <= Date.parse(evaluatedAt)
    : false;
  if (
    (Number.isFinite(lastSuccessfulAt) &&
      lastSuccessfulAt + staleAfterMs < Date.parse(evaluatedAt)) ||
    (!input.lastSuccessfulSyncAt &&
      Number.isFinite(nextScheduledAt) &&
      nextScheduledAt < Date.parse(evaluatedAt)) ||
    firstScheduledWindowElapsed
  ) {
    return {
      state: "stale",
      reasonCode: "sync_stale",
      explanation: "Successful synchronization is outside its freshness target.",
      ...shared,
    };
  }
  if (input.latestOutcome === "warning" || input.latestOutcome === "failed") {
    return {
      state: "degraded",
      reasonCode: "latest_check_degraded",
      explanation: "The latest connection check reported a recoverable problem.",
      ...shared,
    };
  }
  if (!input.lastTestedAt || !input.latestOutcome || input.latestOutcome !== "passed") {
    return {
      state: "pending",
      reasonCode: "test_pending",
      explanation: "Connection testing has not yet passed.",
      ...shared,
    };
  }
  return {
    state: "healthy",
    reasonCode: "fresh",
    explanation: "Connection testing and freshness are within target.",
    ...shared,
  };
}
