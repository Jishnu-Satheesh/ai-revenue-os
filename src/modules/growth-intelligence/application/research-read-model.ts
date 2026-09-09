import { z } from "zod";

import {
  RESEARCH_PIPELINE_STAGES,
  RESEARCH_PIPELINE_STAGE_DISPLAY,
  isTerminalPipelineStage,
  researchCoverageEntrySchema,
  type ResearchCoverageEntry,
  type ResearchPipelineStage,
} from "@/domain/growth-intelligence/research-pipeline";
import { DomainError } from "@/lib/errors";

/**
 * The authenticated read contract behind pipeline status, retained history
 * and outcome links (Task 11 consumes this; no component lives here).
 *
 * Reads only: every builder below is a pure projection over rows the
 * repository already scoped to one organization through signed-in RLS. The
 * history lookup is display-only and never feeds eligibility: old settings
 * never become current support, and a retained success never becomes the
 * current pipeline.
 */

export const RESEARCH_HISTORY_DEFAULT_LIMIT = 10;
export const RESEARCH_HISTORY_MAX_LIMIT = 50;

export const RESEARCH_ACTIVITY_DEFAULT_LIMIT = 20;
export const RESEARCH_ACTIVITY_MAX_LIMIT = 50;

const stageSchema = z.enum(RESEARCH_PIPELINE_STAGES);
const coverageSchema = z.array(researchCoverageEntrySchema);
const safeCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{2,80}$/);
const timestampSchema = z.string().datetime({ offset: true });

function readFailure(): never {
  throw new DomainError("DOMAIN_ERROR", "Market research status could not be loaded.");
}

export type ResearchSettingsSummary = {
  schemaVersion: 1 | 2;
  topics: string[];
  competitorNames: string[];
  city: string | null;
  countryCode: string | null;
};

type SettingsDocument = {
  schemaVersion: 1 | 2;
  topics?: unknown;
  competitors?: unknown;
  geographies?: unknown;
};

function textList(value: unknown, pick: (entry: Record<string, unknown>) => unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const picked = pick(entry as Record<string, unknown>);
    if (typeof picked === "string" && picked.length > 0) names.push(picked);
  }
  return names;
}

/**
 * The safe settings subset a history row may show. Topics, competitor names
 * and city/country are the operator's own approved scope — never provider
 * payloads, excerpts or credentials. Unknown documents yield null so one
 * unreadable version never fails the whole history read.
 */
export function summarizeResearchSettings(document: unknown): ResearchSettingsSummary | null {
  if (typeof document !== "object" || document === null) return null;
  const record = document as Partial<SettingsDocument>;
  if (record.schemaVersion !== 1 && record.schemaVersion !== 2) return null;
  const geographies = Array.isArray(record.geographies)
    ? (record.geographies as Array<Record<string, unknown>>)
    : [];
  const city = geographies.find((geography) => geography.layer === "city") ?? null;
  const country = geographies.find((geography) => geography.layer === "country") ?? null;
  const cityName = typeof city?.name === "string" ? city.name : null;
  const countryCode =
    typeof country?.countryCode === "string"
      ? (country.countryCode as string)
      : typeof city?.countryCode === "string"
        ? (city.countryCode as string)
        : null;
  return {
    schemaVersion: record.schemaVersion,
    topics: textList(record.topics, (entry) => entry.label),
    competitorNames: textList(record.competitors, (entry) => entry.name),
    city: cityName,
    countryCode,
  };
}

export type ResearchSourceRowInput = {
  id: string;
  url: string;
  domain: string;
  publisher: string | null;
  sourceClass: string;
  availability: string;
  erasedAt: string | null;
  retrievedAt: string;
  publishedAt: string | null;
  observedAt: string | null;
};

export type ResearchSourceDescriptor = {
  id: string;
  url: string;
  domain: string;
  publisher: string | null;
  sourceClass: string;
  /**
   * Erased or unavailable sources render as `source-unavailable`: the
   * descriptor keeps public metadata (URL, publisher) but never stored raw
   * content — excerpts and quotations are not even selected.
   */
  availability: "available" | "source-unavailable";
  retrievedAt: string;
  publishedAt: string | null;
  observedAt: string | null;
};

export function describeResearchSource(row: ResearchSourceRowInput): ResearchSourceDescriptor {
  const available = row.availability === "available" && row.erasedAt === null;
  return {
    id: row.id,
    url: row.url,
    domain: row.domain,
    publisher: row.publisher,
    sourceClass: row.sourceClass,
    availability: available ? "available" : "source-unavailable",
    retrievedAt: row.retrievedAt,
    publishedAt: row.publishedAt,
    observedAt: row.observedAt,
  };
}

export type RetryEligibility = { eligible: boolean; reason: string | null };

/**
 * Retry eligibility from the live pipeline stage only. History rows never
 * feed this: only an actually `synthesis_failed` pipeline may reclaim its
 * failed child through the governed retry RPC.
 */
export function resolveRetryEligibility(stage: ResearchPipelineStage): RetryEligibility {
  switch (stage) {
    case "synthesis_failed":
      return { eligible: true, reason: null };
    case "queued":
    case "researching":
    case "preparing_insights":
      return { eligible: false, reason: "Research is still running; retry is not available yet." };
    case "research_failed":
      return {
        eligible: false,
        reason: "Research did not finish; start new research instead of retrying analysis.",
      };
    case "no_findings":
      return {
        eligible: false,
        reason: "No usable findings were saved; start new research instead.",
      };
    case "ready":
    case "partial":
      return { eligible: false, reason: "Insights already finished; no retry is needed." };
    case "cancelled":
      return {
        eligible: false,
        reason: "This run was replaced or cancelled; start new research instead.",
      };
  }
}

export function researchStatusPath(organizationId: string, pipelineId: string): string {
  return `/api/organizations/${organizationId}/market-profile/research/${pipelineId}`;
}

export function researchRetryPath(organizationId: string, pipelineId: string): string {
  return `${researchStatusPath(organizationId, pipelineId)}/retry`;
}

export function researchWorkspacePath(organizationId: string): string {
  return `/organizations/${organizationId}/growth-intelligence#insights`;
}

export type ResearchPipelineRowInput = {
  pipelineId: string;
  organizationId: string;
  branchId: string;
  marketProfileId: string;
  marketProfileVersionId: string;
  researchRequestId: string | null;
  synthesisRequestId: string | null;
  stage: string;
  coverage: unknown;
  observedAt: string;
  stageChangedAt: string;
  safeFailureCode: string | null;
  branchName: string | null;
  versionDocument: unknown;
  currentVersionId: string | null;
  sources: readonly ResearchSourceRowInput[];
  claimCount: number;
};

export type ResearchPipelineView = {
  pipelineId: string;
  organizationId: string;
  branchId: string;
  /** Branch name, or the legacy "Organization" label when the branch or the settings predate branches. */
  scopeLabel: string;
  legacyScope: boolean;
  stage: ResearchPipelineStage;
  stageDisplay: string;
  active: boolean;
  observedAt: string;
  stageChangedAt: string;
  settingsSummary: ResearchSettingsSummary | null;
  /**
   * Whether the row's settings equal the profile's current version. Display
   * only: a false value marks earlier settings and never current support.
   */
  settingsMatchCurrent: boolean | null;
  coverage: ResearchCoverageEntry[];
  sourceCount: number;
  claimCount: number;
  sources: ResearchSourceDescriptor[];
  safeFailureCode: string | null;
  retry: RetryEligibility;
  outcomeLinks: {
    self: string;
    retry: string | null;
    workspace: string | null;
  };
};

const pipelineInputSchema = z
  .object({
    pipelineId: z.string().uuid(),
    organizationId: z.string().uuid(),
    branchId: z.string().uuid(),
    marketProfileId: z.string().uuid(),
    marketProfileVersionId: z.string().uuid(),
    researchRequestId: z.string().uuid().nullable(),
    synthesisRequestId: z.string().uuid().nullable(),
    stage: stageSchema,
    coverage: coverageSchema,
    observedAt: timestampSchema,
    stageChangedAt: timestampSchema,
    safeFailureCode: safeCodeSchema.nullable(),
    branchName: z.string().min(1).max(160).nullable(),
    currentVersionId: z.string().uuid().nullable(),
    claimCount: z.number().int().min(0),
  })
  .strict();

/**
 * Assemble one pipeline status view. The row carries its own version
 * document, so a failed replacement keeps its prior settings: current
 * profile settings are never substituted in.
 */
export function buildResearchPipelineView(input: ResearchPipelineRowInput): ResearchPipelineView {
  const parsed = pipelineInputSchema.safeParse({
    pipelineId: input.pipelineId,
    organizationId: input.organizationId,
    branchId: input.branchId,
    marketProfileId: input.marketProfileId,
    marketProfileVersionId: input.marketProfileVersionId,
    researchRequestId: input.researchRequestId,
    synthesisRequestId: input.synthesisRequestId,
    stage: input.stage,
    coverage: input.coverage,
    observedAt: input.observedAt,
    stageChangedAt: input.stageChangedAt,
    safeFailureCode: input.safeFailureCode,
    branchName: input.branchName,
    currentVersionId: input.currentVersionId,
    claimCount: input.claimCount,
  });
  if (!parsed.success) readFailure();
  const row = parsed.data;
  const settingsSummary = summarizeResearchSettings(input.versionDocument);
  // A v1 settings document predates branch profiles: it is organization
  // scope even when the envelope names a branch. A missing branch record
  // likewise falls back to the legacy label instead of failing the read.
  const legacyScope = row.branchName === null || settingsSummary?.schemaVersion === 1;
  const retry = resolveRetryEligibility(row.stage);
  const findingsAvailable =
    row.stage === "ready" || row.stage === "partial" || row.stage === "synthesis_failed";
  return {
    pipelineId: row.pipelineId,
    organizationId: row.organizationId,
    branchId: row.branchId,
    scopeLabel: legacyScope ? "Organization" : row.branchName!,
    legacyScope,
    stage: row.stage,
    stageDisplay: RESEARCH_PIPELINE_STAGE_DISPLAY[row.stage],
    active: !isTerminalPipelineStage(row.stage),
    observedAt: row.observedAt,
    stageChangedAt: row.stageChangedAt,
    settingsSummary,
    settingsMatchCurrent:
      row.currentVersionId === null ? null : input.marketProfileVersionId === row.currentVersionId,
    coverage: row.coverage,
    sourceCount: input.sources.length,
    claimCount: row.claimCount,
    sources: input.sources.map(describeResearchSource),
    safeFailureCode: row.safeFailureCode,
    retry,
    outcomeLinks: {
      self: researchStatusPath(row.organizationId, row.pipelineId),
      retry: retry.eligible ? researchRetryPath(row.organizationId, row.pipelineId) : null,
      workspace: findingsAvailable ? researchWorkspacePath(row.organizationId) : null,
    },
  };
}

export type ResearchPipelineHistoryView = {
  pipelines: ResearchPipelineView[];
  nextCursor: string | null;
};

export function clampHistoryLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return RESEARCH_HISTORY_DEFAULT_LIMIT;
  if (value < 1) return RESEARCH_HISTORY_DEFAULT_LIMIT;
  return Math.min(value, RESEARCH_HISTORY_MAX_LIMIT);
}

export function clampActivityLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return RESEARCH_ACTIVITY_DEFAULT_LIMIT;
  if (value < 1) return RESEARCH_ACTIVITY_DEFAULT_LIMIT;
  return Math.min(value, RESEARCH_ACTIVITY_MAX_LIMIT);
}

const historyCursorSchema = z
  .object({ createdAt: timestampSchema, id: z.string().uuid() })
  .strict();

export type ResearchHistoryCursor = z.infer<typeof historyCursorSchema>;

export function encodeResearchHistoryCursor(cursor: ResearchHistoryCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeResearchHistoryCursor(
  value: string | null | undefined,
): ResearchHistoryCursor | null {
  if (!value) return null;
  try {
    const parsed = historyCursorSchema.safeParse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export type ResearchActivityKind = "started" | "finished" | "retried";

export type ResearchActivityEvent = {
  kind: ResearchActivityKind;
  pipelineId: string;
  branchId: string;
  scopeLabel: string;
  title: string;
  occurredAt: string;
  stage: ResearchPipelineStage | null;
};

/**
 * Name one research lifecycle event for Your actions: a start, a terminal
 * outcome, or a labelled retry. Titles carry branch scope and stage only —
 * never invented progress percentages.
 */
export function describeResearchActivityEvent(input: {
  kind: ResearchActivityKind;
  pipelineId: string;
  branchId: string;
  scopeLabel: string;
  stage: ResearchPipelineStage | null;
  occurredAt: string;
}): ResearchActivityEvent {
  const stageDisplay = input.stage ? RESEARCH_PIPELINE_STAGE_DISPLAY[input.stage] : null;
  let title: string;
  switch (input.kind) {
    case "started":
      title = `Market research started — ${input.scopeLabel}`;
      break;
    case "finished":
      title = `Market research ${stageDisplay ?? "finished"} — ${input.scopeLabel}`;
      break;
    case "retried":
      title = `Market analysis retried — ${input.scopeLabel}`;
      break;
  }
  return {
    kind: input.kind,
    pipelineId: input.pipelineId,
    branchId: input.branchId,
    scopeLabel: input.scopeLabel,
    title,
    occurredAt: input.occurredAt,
    stage: input.stage,
  };
}

export type ResearchItemProvenance = {
  pipelineId: string;
  branchId: string;
  stage: ResearchPipelineStage;
  /** Exact status route the UI links to. */
  statusPath: string;
  /** Claim ids the synthesis item cited — historical citation, not live support. */
  supportingClaimIds: string[];
};

export function researchItemProvenancePath(organizationId: string, pipelineId: string): string {
  return researchStatusPath(organizationId, pipelineId);
}
