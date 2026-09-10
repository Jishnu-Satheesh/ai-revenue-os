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
  /** A recommendation the narrator produced. Opaque. */
  recommendationId?: string;
  /** A synthesized intelligence item. Opaque. */
  itemId?: string;
  /** Which store a presentation preference names. Bounded vocabulary. */
  sourceKind?: "synthesis_item" | "channel_recommendation" | "opportunity";
  /** The preferred record. Opaque. */
  sourceId?: string;
  /** Which answer a member gave. Bounded vocabulary, never their reason text. */
  decisionKind?:
    | "acknowledged"
    | "dismissed"
    | "planned"
    | "snoozed"
    | "pinned"
    | "unpinned"
    | "resolved";
  runId?: string;
  /**
   * A poster render, identified by the sha256 over its own inputs. Safe here
   * for the reason the allowlist exists: it names a render without carrying a
   * single character of what was drawn on it.
   */
  renderDigest?: string;
  /**
   * A poster template from the shared catalogue, such as `core_feed_headline`.
   * A registry key chosen by a migration, never a tenant's own text.
   */
  templateKey?: string;
  /**
   * Detector keys a gap-fill narration was asked to cover, such as
   * `funnel.stage_conversion`. Registry keys, never tenant text — the same
   * reason `templateKey` is safe to log.
   */
  detectorKeys?: string[];
  /** A canonical YYYY-MM analysis selection. Opaque calendar label. */
  month?: string;
  /** Inclusive local-date window bounds. Opaque calendar labels, like month. */
  windowStart?: string;
  windowEnd?: string;
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
