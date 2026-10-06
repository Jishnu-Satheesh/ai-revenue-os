import type { OrganizationRole } from "@/domain/organizations/types";
import type { AnalysisGrain } from "@/domain/analysis/types";
import { addLocalDays, localDaysBetween } from "@/domain/analysis/calendar";
import {
  defaultAnalysisWindow,
  isWindowCovered,
  mergeCoverageSegments,
} from "@/domain/analysis/window-selection";
import { hasOrganizationPermission } from "@/domain/access/permissions";
import { normalizeChannelAlias } from "@/domain/channels/normalization";
import { extractAgentReportPeriod } from "./report-intake-scope";
import type {
  CurrentChannelRunResult,
  CurrentChannelRunScope,
} from "@/modules/analysis/application/current-run";

export type ChannelAssessmentInput = {
  organizationId: string;
  actorId: string;
  role: OrganizationRole;
  question: string;
  correlationId: string;
  channelId?: string;
  branchId?: string;
  from?: string;
  to?: string;
  allowDispatch?: boolean;
  allowPeriodFallback?: boolean;
  /** Server-owned receipt for a dispatched run that has not claimed yet. */
  pendingAnalysisRunId?: string;
  analysisRunId?: string;
  now?: string;
};

export type AgentChannel = {
  id: string;
  key: string;
  displayName: string;
  status: "active" | "archived";
  aliases: readonly string[];
};

export type AgentChannelWindow = {
  windowStart: string;
  windowEnd: string;
  grain: AnalysisGrain;
  governedRowCount: number;
  timeZone: string;
};

export type ChannelAssessmentReads = {
  listChannels: () => Promise<readonly AgentChannel[]>;
  loadWindows: (channelId: string) => Promise<readonly AgentChannelWindow[]>;
  resolveWindow: (
    channelId: string,
    from: string,
    to: string,
  ) => Promise<Omit<CurrentChannelRunScope, "organizationId" | "channelId" | "branchId"> | null>;
  currentRun: (scope: CurrentChannelRunScope) => Promise<CurrentChannelRunResult>;
  loadRunForWindow: (
    channelId: string,
    from: string,
    to: string,
  ) => Promise<{
    id: string;
    status: "running" | "completed" | "failed";
    findingCount: number;
  } | null>;
  readResult: (runId: string) => Promise<{
    findings: readonly { id: string; kind: string; code: string }[];
    recommendations: readonly {
      id: string;
      label: "observation" | "recommendation" | "needs_data";
      headline: string;
      detail: string;
      supportedActions: readonly string[];
      citationFindingIds: readonly string[];
    }[];
  }>;
  consumeAllowance: () => Promise<boolean>;
  dispatchAnalysis: (
    scope: CurrentChannelRunScope & { analysisRunId: string; correlationId: string },
  ) => Promise<boolean>;
  dispatchNarration: (channelId: string, runId: string, correlationId: string) => Promise<boolean>;
};

type Period = { start: string; end: string };
type PeriodSwitch = {
  requestedStart: string;
  requestedEnd: string;
  selectedStart: string;
  selectedEnd: string;
  reason: string;
};

export type ChannelAssessmentOutcome =
  | {
      status: "needs_scope";
      field: "channel" | "period";
      options: readonly { id: string; label: string }[];
    }
  | {
      status: "not_available";
      reason:
        | "channel_not_found"
        | "no_governed_report"
        | "analysis_permission_required"
        | "analysis_not_started"
        | "rate_limited"
        | "dispatch_failed"
        | "feature_disabled"
        | "invalid_period"
        | "read_permission_required";
      channelId?: string;
      period?: Period;
    }
  | {
      status: "in_progress";
      stage: "running" | "narrating" | "analysis_started";
      channelId: string;
      channelName: string;
      runId?: string;
      auditHref?: string;
      period: Period;
      periodSwitch: PeriodSwitch | null;
      nextPollAfterMs: number;
    }
  | {
      status: "ready";
      channelId: string;
      channelName: string;
      runId: string;
      auditHref: string;
      summary: string;
      evidenceRefs: readonly string[];
      period: Period;
      periodSwitch: PeriodSwitch | null;
    };

function mentionsName(question: string, name: string): boolean {
  const normalized = normalizeChannelAlias(name);
  if (!normalized) return false;
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "u").test(
    normalizeChannelAlias(question),
  );
}

function auditHref(organizationId: string, channelId: string, runId: string): string {
  return `/organizations/${organizationId}/channels/${channelId}?runId=${runId}`;
}

function localDay(now: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(now));
}

function validPeriod(from: string, to: string): boolean {
  try {
    return (
      /^\d{4}-\d{2}-\d{2}$/.test(from) &&
      /^\d{4}-\d{2}-\d{2}$/.test(to) &&
      localDaysBetween(from, to) >= 0 &&
      localDaysBetween(from, to) <= 400
    );
  } catch {
    return false;
  }
}

function summarizeResult(
  result: Awaited<ReturnType<ChannelAssessmentReads["readResult"]>>,
): string {
  if (result.findings.length === 0) {
    return "The governed analysis completed with no findings. This does not prove the channel had no issues or that performance improved.";
  }
  const lines = result.recommendations.slice(0, 5).map((item) => {
    const action = item.supportedActions[0];
    const label =
      item.label === "needs_data"
        ? "Data needed"
        : item.label === "recommendation"
          ? "Suggested action"
          : "Observation";
    return `${label}: ${item.headline.slice(0, 180).replace(/[.\s]+$/, "")}. ${item.detail.slice(0, 420)}${action ? ` First step: ${action.slice(0, 180)}` : ""}`;
  });
  return [
    `The governed analysis recorded ${result.findings.length} finding${result.findings.length === 1 ? "" : "s"}.`,
    ...lines,
  ]
    .join("\n")
    .slice(0, 3_000);
}

/** Deterministic channel resolution, source-owned analysis, and bounded result. */
export async function assessChannelForAgent(
  input: ChannelAssessmentInput,
  reads: ChannelAssessmentReads,
): Promise<ChannelAssessmentOutcome> {
  if (
    !hasOrganizationPermission(input.role, "channel.read") ||
    !hasOrganizationPermission(input.role, "report.read")
  ) {
    return { status: "not_available", reason: "read_permission_required" };
  }

  if (!input.from && !input.to) {
    const explicitPeriod = extractAgentReportPeriod(input.question);
    if (explicitPeriod)
      input = { ...input, from: explicitPeriod.periodStart, to: explicitPeriod.periodEnd };
  }
  const channels = (await reads.listChannels()).filter((channel) => channel.status === "active");
  const options = (items: readonly AgentChannel[]) =>
    items.slice(0, 8).map((channel) => ({ id: channel.id, label: channel.displayName }));
  const matched = input.channelId
    ? channels.filter((channel) => channel.id === input.channelId)
    : channels.filter((channel) =>
        [channel.displayName, channel.key, ...channel.aliases].some((name) =>
          mentionsName(input.question, name),
        ),
      );
  const selected =
    matched.length === 1
      ? matched[0]
      : channels.length === 1 && !input.channelId
        ? channels[0]
        : null;
  if (!selected) {
    if (input.channelId && matched.length === 0)
      return { status: "not_available", reason: "channel_not_found" };
    return {
      status: "needs_scope",
      field: "channel",
      options: options(matched.length > 1 ? matched : channels),
    };
  }

  if ((input.from && !input.to) || (!input.from && input.to)) {
    return { status: "needs_scope", field: "period", options: [] };
  }
  if (input.from && input.to && !validPeriod(input.from, input.to)) {
    return { status: "not_available", reason: "invalid_period", channelId: selected.id };
  }

  const windows = await reads.loadWindows(selected.id);
  if (windows.length === 0)
    return { status: "not_available", reason: "no_governed_report", channelId: selected.id };
  const latest = [...windows].sort((a, b) => b.windowEnd.localeCompare(a.windowEnd))[0];
  const today = localDay(input.now ?? new Date().toISOString(), latest.timeZone);
  const recent = { start: addLocalDays(today, -29), end: today };
  const requested = input.from && input.to ? { start: input.from, end: input.to } : recent;
  let selection: { from: string; to: string } | null = null;
  if (input.from && input.to) {
    const covered = isWindowCovered(input.from, input.to, mergeCoverageSegments(windows));
    if (covered) selection = { from: input.from, to: input.to };
  }
  if (!selection && input.allowPeriodFallback !== false) {
    const eligible = input.from
      ? windows.filter((window) => window.windowEnd < input.from!)
      : windows;
    selection = defaultAnalysisWindow({ today, windows: eligible });
  }
  if (!selection)
    return {
      status: "not_available",
      reason: "no_governed_report",
      channelId: selected.id,
      period: requested,
    };

  const resolved = await reads.resolveWindow(selected.id, selection.from, selection.to);
  if (!resolved)
    return {
      status: "not_available",
      reason: "no_governed_report",
      channelId: selected.id,
      period: requested,
    };
  const scope: CurrentChannelRunScope = {
    organizationId: input.organizationId,
    channelId: selected.id,
    branchId: input.branchId ?? null,
    windowStart: resolved.windowStart,
    windowEnd: resolved.windowEnd,
    grain: resolved.grain,
    timeZone: resolved.timeZone,
  };
  const period = { start: scope.windowStart, end: scope.windowEnd };
  const switched = input.from
    ? period.start !== requested.start || period.end !== requested.end
    : !isWindowCovered(requested.start, requested.end, mergeCoverageSegments(windows));
  const periodSwitch: PeriodSwitch | null = switched
    ? {
        requestedStart: requested.start,
        requestedEnd: requested.end,
        selectedStart: period.start,
        selectedEnd: period.end,
        reason:
          "The requested recent period has no complete governed report; using the latest eligible reported period.",
      }
    : null;

  const current = await reads.currentRun(scope);
  if (current.kind === "ready") {
    const result = await reads.readResult(current.analysisRunId);
    const evidenceRefs = [
      ...new Set([
        ...result.findings.slice(0, 50).map((finding) => finding.id),
        ...result.recommendations.slice(0, 20).map((item) => item.id),
      ]),
    ];
    return {
      status: "ready",
      channelId: selected.id,
      channelName: selected.displayName,
      runId: current.analysisRunId,
      auditHref: auditHref(input.organizationId, selected.id, current.analysisRunId),
      summary: summarizeResult(result),
      evidenceRefs,
      period,
      periodSwitch,
    };
  }

  if (current.kind === "running") {
    const run = await reads.loadRunForWindow(selected.id, period.start, period.end);
    return {
      status: "in_progress",
      stage: "running",
      channelId: selected.id,
      channelName: selected.displayName,
      ...(run
        ? { runId: run.id, auditHref: auditHref(input.organizationId, selected.id, run.id) }
        : {}),
      period,
      periodSwitch,
      nextPollAfterMs: 2_000,
    };
  }

  if (current.kind === "narrating") {
    if (input.allowDispatch && hasOrganizationPermission(input.role, "report.retry")) {
      const dispatched = await reads.dispatchNarration(
        selected.id,
        current.analysisRunId,
        input.correlationId,
      );
      if (!dispatched)
        return {
          status: "not_available",
          reason: "dispatch_failed",
          channelId: selected.id,
          period,
        };
    }
    return {
      status: "in_progress",
      stage: "narrating",
      channelId: selected.id,
      channelName: selected.displayName,
      runId: current.analysisRunId,
      auditHref: auditHref(input.organizationId, selected.id, current.analysisRunId),
      period,
      periodSwitch,
      nextPollAfterMs: 2_000,
    };
  }

  if (input.pendingAnalysisRunId && (current.kind === "missing" || current.kind === "stale")) {
    return {
      status: "in_progress",
      stage: "analysis_started",
      channelId: selected.id,
      channelName: selected.displayName,
      runId: input.pendingAnalysisRunId,
      auditHref: auditHref(input.organizationId, selected.id, input.pendingAnalysisRunId),
      period,
      periodSwitch,
      nextPollAfterMs: 10_000,
    };
  }
  if (input.pendingAnalysisRunId && current.kind === "failed") {
    const latestRun = await reads.loadRunForWindow(selected.id, period.start, period.end);
    if (latestRun?.id === input.pendingAnalysisRunId && latestRun.status === "failed")
      return { status: "not_available", reason: "dispatch_failed", channelId: selected.id, period };
    // A previous failed run remains the newest row until this dispatched
    // worker claims. It is not a failure receipt for the new run.
    return {
      status: "in_progress",
      stage: "analysis_started",
      channelId: selected.id,
      channelName: selected.displayName,
      runId: input.pendingAnalysisRunId,
      auditHref: auditHref(input.organizationId, selected.id, input.pendingAnalysisRunId),
      period,
      periodSwitch,
      nextPollAfterMs: 10_000,
    };
  }

  if (!hasOrganizationPermission(input.role, "report.retry")) {
    return {
      status: "not_available",
      reason: "analysis_permission_required",
      channelId: selected.id,
      period,
    };
  }
  if (!input.allowDispatch)
    return {
      status: "not_available",
      reason: "analysis_not_started",
      channelId: selected.id,
      period,
    };
  if (!(await reads.consumeAllowance()))
    return { status: "not_available", reason: "rate_limited", channelId: selected.id, period };
  const analysisRunId = input.analysisRunId ?? crypto.randomUUID();
  if (
    !(await reads.dispatchAnalysis({ ...scope, analysisRunId, correlationId: input.correlationId }))
  ) {
    return { status: "not_available", reason: "dispatch_failed", channelId: selected.id, period };
  }
  return {
    status: "in_progress",
    stage: "analysis_started",
    channelId: selected.id,
    channelName: selected.displayName,
    runId: analysisRunId,
    auditHref: auditHref(input.organizationId, selected.id, analysisRunId),
    period,
    periodSwitch,
    nextPollAfterMs: 2_000,
  };
}
