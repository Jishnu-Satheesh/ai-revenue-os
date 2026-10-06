/**
 * A closed allowlist, not a bag. Every field here is an opaque identifier or a
 * bounded code, so no call site can log a customer's email, a token, or a
 * provider payload by reaching for a convenient extra key.
 */
type LogContext = {
  organizationId?: string;
  accountId?: string;
  /** The user a member change acted on. Opaque UUID, like the other ids here. */
  userId?: string;
  invitationId?: string;
  /** A captured public lead row. Opaque UUID, like the other ids here. */
  leadId?: string;
  /** A stable reason code. Never the message shown to the caller. */
  refusalCode?: string;
  branchId?: string;
  correlationId?: string;
  decisionId?: string;
  opportunityId?: string;
  campaignId?: string;
  /** A launch approval row. Opaque UUID, like the other ids here. */
  launchApprovalId?: string;
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
  /** An agent chat thread. Opaque UUID, like the other ids here. */
  threadId?: string;
  /** A message inside an agent chat thread. Opaque UUID, like threadId. */
  messageId?: string;
  /**
   * The agent router's classified intent. Bounded vocabulary, never the
   * user message or any model text.
   */
  intent?:
    | "answer_memory"
    | "business_advice"
    | "channel_assessment"
    | "report_intake"
    | "research_once"
    | "watch"
    | "campaign_advice"
    | "profile_scope_change";
  /** The router's confidence. Bounded vocabulary. */
  confidence?: "high" | "medium" | "low";
  /**
   * Stable routing reason codes (e.g. `DEEPTHINK_UPGRADE_REQUIRED`). Codes
   * chosen by the platform, never tenant text. Closed union (Slice C F4):
   * a code must be added here before any call site may log it, so a new
   * lane cannot smuggle free text through this field.
   */
  reasonCodes?: AgentReasonCode[];
  /**
   * A thrown error's constructor name, such as `ZodError`. A code identifier
   * chosen by the platform, never tenant text — the message itself stays out
   * because it can quote whatever the tenant sent in.
   */
  errorName?: string;
  /**
   * A finished output's version row. Opaque UUID, like the other ids here.
   */
  deliverableVersionId?: string;
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

/**
 * Closed agent reason-code vocabulary (Slice C F4).
 *
 * Every entry is minted verbatim by a deterministic disposal site: the
 * agent router (`routeAgentMessage`), the campaign-advice eligibility
 * check, the research-lane gate, the context-pack budget refusal, or the
 * scope-registry collision path. No model text, no tenant text. Adding a
 * new code means adding it here plus `logger.test.ts` — the log line is
 * the fence, so the fence stays closed by construction.
 */
export const AGENT_REASON_CODES = [
  // Router (`src/modules/agent-router/application/router-service.ts`).
  "PROVIDER_FAIL_CLOSED",
  "VIEWER_RESTRICTED",
  "MODEL_PROPOSAL_OVERRIDDEN",
  "RESEARCH_REQUIRES_MANAGE",
  "WATCH_REQUIRES_MANAGE",
  "CAMPAIGN_REQUIRES_CREATE",
  "PROFILE_REQUIRES_MANAGE",
  "LOW_CONFIDENCE_FALLBACK",
  "DEEPTHINK_UPGRADE_REQUIRED",
  "DEEPTHINK_AUTO_ESCALATED",
  "MISSING_FIELDS_CAPPED",
  "QUESTIONNAIRE_REQUIRED",
  "MODEL_PROPOSAL_ACCEPTED",
  "DUPLICATE_WATCH_CANDIDATE",
  // Campaign advice (`campaign-advise.ts` eligibility).
  "ADVICE_NO_OPPORTUNITY",
  "EVIDENCE_NOT_FREEZABLE",
  "PROFILE_UNBOUND",
  "POLICY_BLOCKED",
  "CAPABILITY_BLOCKED",
  "SCHEDULE_BLOCKED",
  "AUDIENCE_NOT_READY",
  // Research lane gate + worker blocks.
  "CREDENTIAL_MISSING",
  "LANE_DISABLED",
  "PROVIDER_NOT_QUALIFIED",
  "AGENT_CHAT_DISABLED",
  "WATCH_UPDATE_UNAVAILABLE",
  // Context-pack budget refusal.
  "CONTEXT_PACK_OVERSIZED",
  // Scope-registry collision (M10 migration).
  "SCOPE_FINGERPRINT_COLLISION",
] as const;

export type AgentReasonCode = (typeof AGENT_REASON_CODES)[number];

/**
 * Narrows service-returned codes to the closed log vocabulary. Producers
 * are closed (they mint only the codes above), so an unknown entry means
 * the producer and this union drifted — it is dropped rather than logged,
 * and the drift is fixed by extending `AGENT_REASON_CODES`, never by
 * widening this field back to `string[]`.
 */
export function toAgentReasonCodes(codes: readonly string[]): AgentReasonCode[] {
  const known = new Set<string>(AGENT_REASON_CODES);
  return codes.filter((code): code is AgentReasonCode => known.has(code));
}

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
