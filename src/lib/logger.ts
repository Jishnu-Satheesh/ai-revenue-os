/**
 * A closed allowlist, not a bag. Every field here is an opaque identifier or a
 * bounded code, so no call site can log a customer's email, a token, or a
 * provider payload by reaching for a convenient extra key.
 */
type LogContext = {
  organizationId?: string;
  accountId?: string;
  invitationId?: string;
  /** A stable reason code. Never the message shown to the caller. */
  refusalCode?: string;
  branchId?: string;
  correlationId?: string;
  decisionId?: string;
  opportunityId?: string;
  campaignId?: string;
  connectionId?: string;
  dataSourceId?: string;
  /** An organization-owned channel. Opaque, and not a provider connection. */
  channelId?: string;
  runId?: string;
  workerId?: string;
  durationMs?: number;
  errorCode?: string;
  failurePaths?: string;
  httpStatus?: number;
  /**
   * Counts and money only. This type is an allowlist on purpose: anything not
   * named here cannot be logged, which is what keeps prompts, generated copy
   * and customer text out of the log stream by construction.
   */
  variantsRequested?: number;
  variantsStored?: number;
  variantsRefused?: number;
  costMinor?: number;
  /** Campaign metric collection counts, kept to the same opaque-count rule. */
  metricsConsidered?: number;
  metricsRecorded?: number;
};

function write(level: "info" | "warn" | "error", message: string, context: LogContext = {}) {
  const payload = { level, message, ...context, timestamp: new Date().toISOString() };
  const output = JSON.stringify(payload);
  if (level === "error") console.error(output);
  else if (level === "warn") console.warn(output);
  else console.info(output);
}

export const logger = {
  info: (message: string, context?: LogContext) => write("info", message, context),
  warn: (message: string, context?: LogContext) => write("warn", message, context),
  error: (message: string, context?: LogContext) => write("error", message, context),
};
