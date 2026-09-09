import type { OpportunityFeedItem } from "@/modules/decisions/application/ports";
import {
  projectOrganizationRecommendationLane,
  type OrganizationRecommendationLaneRecord,
  type OrganizationRecommendationRecord,
} from "@/modules/analysis/application/read-model";
import type {
  ResearchActivityEvent,
  ResearchItemProvenance,
} from "@/modules/growth-intelligence/application/research-read-model";

/**
 * Composed organization intelligence view (spec 022 section 9).
 *
 * This builder is a pure projection over rows the repositories already
 * scoped to one organization. It starts no work, copies no records across
 * modules, and blends no currencies or evidence classes: a Channel
 * Recommendation keeps its owning-module decision state, a Data Gap never
 * enters the Opportunity or Recommendation counts, and every card keeps its
 * generated date apart from its business evidence window.
 */

export type GrowthIntelligenceSection =
  | "opportunities"
  | "recommendations"
  | "insights"
  | "data_gaps"
  | "timeline";

export type ChannelRecommendationDecision = "acknowledged" | "dismissed" | "planned";

/**
 * Channel narration rows arrive through the analysis module's own
 * organization projection; this module never re-derives label grouping,
 * carry-over ageing, or actionability.
 */
export type ChannelRecommendationRow = OrganizationRecommendationRecord;

export type SynthesizedItemDecision =
  | "acknowledged"
  | "planned"
  | "snoozed"
  | "dismissed"
  | "resolved";

export type SynthesizedItemRow = {
  id: string;
  kind: "insight" | "recommendation" | "data_gap";
  narrative: string;
  fingerprint: string;
  /** Exact synthesis run that produced the item; links research provenance. */
  synthesisRunId: string;
  supportGrade: string;
  freshness: string;
  urgency: string;
  goalAlignment: string;
  /** Canonical activity month the item belongs to. */
  activityMonth: string;
  /** When the synthesis run created the item (UTC instant). */
  generatedAt: string;
  evidenceWindowStart: string | null;
  evidenceWindowEnd: string | null;
  marketObservedAt: string | null;
  missingInput: string | null;
  decision: SynthesizedItemDecision | "pinned" | "unpinned" | null;
  decidedAt: string | null;
  snoozedUntil: string | null;
  pinned: boolean;
};

export type CardSource =
  | { kind: "opportunity"; id: string }
  | { kind: "channel_recommendation"; id: string }
  | { kind: "synthesized_item"; id: string }
  | { kind: "research_pipeline"; id: string };

export type EvidenceWindow = { start: string; end: string };

type CardBase = {
  id: string;
  source: CardSource;
  title: string;
  detail: string;
  generatedAt: string;
  evidenceWindow: EvidenceWindow | null;
  marketObservedAt: string | null;
  decision: string | null;
  decidedAt: string | null;
  /** Required horizon while the decision is a snooze; null otherwise. */
  snoozedUntil: string | null;
  pinned: boolean;
  /** True when an earlier month's unresolved row carries into this view. */
  carriedOver: boolean;
  /** Present only when carriedOver; e.g. "2 months old". */
  ageLabel: string | null;
};

export type OpportunityCard = CardBase & {
  actionKey: string;
  status: OpportunityFeedItem["status"];
  expiresAt: string;
  evidenceTier: OpportunityFeedItem["evidenceTier"];
  impactLowMinor: number;
  impactHighMinor: number;
  expectedContributionMinor: number;
  executionCostMinor: number;
  currency: string;
  timeToImpactDays: number;
  /** Exact stored version the draft request names back. */
  version: number;
  /** The actor-visible draft request, if one was ever admitted. */
  draftRequest: DraftRequestState | null;
};

/** Actor-visible draft request state, resolved by the repository. */
export type DraftRequestState = {
  opportunityId: string;
  status:
    | "pending"
    | "processing"
    | "completed"
    | "retryable_failed"
    | "permanent_failed"
    | "cancelled";
  campaignId: string | null;
  requestedAt: string;
  updatedAt: string;
};

export type RecommendationCard = CardBase & {
  /** Null for synthesized cross-market recommendations with no single channel. */
  channelId: string | null;
  branchId: string | null;
  /**
   * Market-research provenance for items produced by a research pipeline.
   * The builders always set this (null when there is no pipeline lineage);
   * the field stays optional so existing card fixtures keep compiling.
   * The card keeps its deterministic position either way.
   */
  researchProvenance?: ResearchItemProvenance | null;
};

export type InsightCard = CardBase & {
  supportGrade: string;
  freshness: string;
  urgency: string;
  /** Owning channel for provenance links; null for synthesized cross-market insights. */
  channelId: string | null;
  branchId: string | null;
};

export type DataGapCard = CardBase & {
  missingInput: string;
  /** Owning channel for the repair link; null for synthesized cross-market gaps. */
  channelId: string | null;
};

export type TimelineEventType =
  | "generated"
  | "acknowledged"
  | "planned"
  | "snoozed"
  | "dismissed"
  | "resolved"
  | "draft-requested"
  | "retry"
  | "draft-created"
  | "draft-failed"
  | "research-started"
  | "research-finished"
  | "research-retried";

export type TimelineEvent = {
  type: TimelineEventType;
  source: CardSource;
  // Titles arrive with the Your-actions research events; every
  // other event kind gains its title with the timeline-titles work.
  title?: string;
  occurredAt: string;
  reason: string | null;
};

export type GrowthIntelligenceViewInput = {
  organizationId: string;
  actorId: string;
  /** Canonical YYYY-MM activity month being viewed. */
  activityMonth: string;
  timeZone: string;
  now: Date;
  opportunities: readonly OpportunityFeedItem[];
  recommendations: readonly ChannelRecommendationRow[];
  items: readonly SynthesizedItemRow[];
  draftRequests?: readonly DraftRequestState[];
  sections?: readonly GrowthIntelligenceSection[];
  /**
   * Research provenance keyed by synthesis run id. Omitted lookups leave
   * cards without provenance; ordering, filters and triage never depend on it.
   */
  researchProvenance?: Readonly<Record<string, ResearchItemProvenance>>;
  /** Named research lifecycle events merged into the timeline. */
  researchActivity?: readonly ResearchActivityEvent[];
};

export type GrowthIntelligenceView = {
  activityMonth: string;
  timeZone: string;
  priorityActions: {
    opportunities: OpportunityCard[];
    recommendations: RecommendationCard[];
  };
  insights: InsightCard[];
  dataGaps: DataGapCard[];
  timeline: TimelineEvent[];
  counts: {
    opportunities: number;
    recommendations: number;
    insights: number;
    dataGaps: number;
  };
};

const ANSWERABLE_OPPORTUNITY_STATUSES: ReadonlySet<OpportunityFeedItem["status"]> = new Set([
  "proposed",
  "awaiting_approval",
]);

const TIER_ORDER = ["computed", "observed", "prior"] as const;

const CANONICAL_MONTH = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

function monthIndex(month: string): number {
  const [year, part] = month.split("-");
  return Number(year) * 12 + Number(part);
}

function ageLabel(months: number): string {
  return months === 1 ? "1 month old" : `${months} months old`;
}

function isExpiredOpportunity(item: OpportunityFeedItem, now: Date): boolean {
  return new Date(item.expiresAt).getTime() <= now.getTime();
}

function compareOpportunities(left: OpportunityFeedItem, right: OpportunityFeedItem): number {
  // ADR 0014 ordering: evidence tier, expected contribution within that tier,
  // then time to impact. No blending across tiers; the sort never mixes
  // currencies into one number.
  const tierDelta =
    TIER_ORDER.indexOf(left.evidenceTier) - TIER_ORDER.indexOf(right.evidenceTier);
  if (tierDelta !== 0) return tierDelta;
  if (left.expectedContributionMinor !== right.expectedContributionMinor) {
    return right.expectedContributionMinor - left.expectedContributionMinor;
  }
  if (left.timeToImpactDays !== right.timeToImpactDays) {
    return left.timeToImpactDays - right.timeToImpactDays;
  }
  return left.id.localeCompare(right.id);
}

function toOpportunityCard(
  item: OpportunityFeedItem,
  draftRequest: DraftRequestState | null,
): OpportunityCard {
  return {
    id: item.id,
    source: { kind: "opportunity", id: item.id },
    title: item.title,
    detail: item.summary,
    generatedAt: item.createdAt,
    evidenceWindow: null,
    marketObservedAt: null,
    decision: null,
    decidedAt: null,
    snoozedUntil: null,
    pinned: false,
    carriedOver: false,
    ageLabel: null,
    actionKey: item.actionKey,
    status: item.status,
    expiresAt: item.expiresAt,
    evidenceTier: item.evidenceTier,
    impactLowMinor: item.impactLowMinor,
    impactHighMinor: item.impactHighMinor,
    expectedContributionMinor: item.expectedContributionMinor,
    executionCostMinor: item.executionCostMinor,
    currency: item.currency,
    timeToImpactDays: item.timeToImpactDays,
    version: item.version,
    draftRequest,
  };
}

/**
 * A draft with visible standing keeps its card: pending, processing, a
 * retryable failure awaiting its retry, and a completed draft with its link.
 * Permanent failures and cancellations are terminal and live on in the
 * timeline only.
 */
function isVisibleDraftRequest(request: DraftRequestState | undefined): boolean {
  return (
    request !== undefined &&
    (request.status === "pending" ||
      request.status === "processing" ||
      request.status === "retryable_failed" ||
      request.status === "completed")
  );
}

function channelBase(row: OrganizationRecommendationLaneRecord) {
  return {
    id: row.id,
    source: { kind: "channel_recommendation", id: row.id } as const,
    title: row.headline,
    detail: row.detail,
    generatedAt: row.generatedAt,
    evidenceWindow: { start: row.windowStart, end: row.windowEnd },
    marketObservedAt: null,
    decision: row.decision?.decision ?? null,
    decidedAt: row.decision?.createdAt ?? null,
    snoozedUntil: row.decision?.snoozedUntil ?? null,
    pinned: row.pinned,
    carriedOver: row.carriedOver,
    ageLabel: row.ageLabel,
  };
}

function toRecommendationCardFromChannel(
  row: OrganizationRecommendationLaneRecord,
): RecommendationCard {
  if (row.label !== "recommendation") throw new Error("Recommendation misrouted.");
  return {
    ...channelBase(row),
    channelId: row.channelId,
    branchId: row.branchId,
    researchProvenance: null,
  };
}

function toInsightCardFromChannel(row: OrganizationRecommendationLaneRecord): InsightCard {
  if (row.label !== "observation") throw new Error("Observation misrouted.");
  return {
    ...channelBase(row),
    supportGrade: "contextual",
    freshness: "current",
    urgency: "low",
    channelId: row.channelId,
    branchId: row.branchId,
  };
}

function toDataGapCardFromChannel(row: OrganizationRecommendationLaneRecord): DataGapCard {
  if (row.label !== "needs_data") throw new Error("Data gap misrouted.");
  return { ...channelBase(row), missingInput: row.detail, channelId: row.channelId };
}

function itemCarryOver(row: SynthesizedItemRow, activityMonth: string) {
  const monthsOld = monthIndex(activityMonth) - monthIndex(row.activityMonth);
  const carriedOver = monthsOld > 0;
  return { carriedOver, ageLabel: carriedOver ? ageLabel(monthsOld) : null };
}

function itemBase(row: SynthesizedItemRow, activityMonth: string) {
  return {
    id: row.id,
    source: { kind: "synthesized_item", id: row.id } as const,
    title: row.narrative,
    detail: row.narrative,
    generatedAt: row.generatedAt,
    evidenceWindow:
      row.evidenceWindowStart && row.evidenceWindowEnd
        ? { start: row.evidenceWindowStart, end: row.evidenceWindowEnd }
        : null,
    marketObservedAt: row.marketObservedAt,
    decision: row.decision,
    decidedAt: row.decidedAt,
    snoozedUntil: row.snoozedUntil,
    pinned: row.pinned,
    ...itemCarryOver(row, activityMonth),
  };
}

function toRecommendationCardFromItem(
  row: SynthesizedItemRow,
  activityMonth: string,
  provenance: Readonly<Record<string, ResearchItemProvenance>> = {},
): RecommendationCard {
  if (row.kind !== "recommendation") throw new Error("Item misrouted.");
  return {
    ...itemBase(row, activityMonth),
    channelId: null,
    branchId: null,
    researchProvenance: provenance[row.synthesisRunId] ?? null,
  };
}

function toInsightCardFromItem(row: SynthesizedItemRow, activityMonth: string): InsightCard {
  if (row.kind !== "insight") throw new Error("Item misrouted.");
  return {
    ...itemBase(row, activityMonth),
    supportGrade: row.supportGrade,
    freshness: row.freshness,
    urgency: row.urgency,
    channelId: null,
    branchId: null,
  };
}

function toDataGapCardFromItem(row: SynthesizedItemRow, activityMonth: string): DataGapCard {
  if (row.kind !== "data_gap") throw new Error("Data gap misrouted.");
  return { ...itemBase(row, activityMonth), missingInput: row.missingInput ?? "unknown", channelId: null };
}

function isVisibleItem(row: SynthesizedItemRow, now: Date): boolean {
  if (row.decision === "dismissed" || row.decision === "resolved") return false;
  if (row.decision === "planned") return false;
  if (row.decision === "snoozed" && row.snoozedUntil) {
    return new Date(row.snoozedUntil).getTime() <= now.getTime();
  }
  return true;
}

function suppressDuplicates<T extends { fingerprint?: string; id: string; generatedAt: string }>(
  rows: readonly T[],
  fingerprintOf: (row: T) => string,
): T[] {
  // Stable fingerprints suppress byte-for-byte or evidence-identical repeats:
  // the earliest generated row wins and later copies never render.
  const seen = new Map<string, T>();
  for (const row of rows) {
    const fingerprint = fingerprintOf(row);
    const existing = seen.get(fingerprint);
    if (!existing || row.generatedAt < existing.generatedAt) {
      seen.set(fingerprint, row);
    }
  }
  return [...seen.values()];
}

function pushTimeline(
  events: TimelineEvent[],
  source: CardSource,
  generatedAt: string,
  decision: string | null,
  decidedAt: string | null,
): void {
  events.push({ type: "generated", source, occurredAt: generatedAt, reason: null });
  if (decision && decidedAt && decision !== "pinned" && decision !== "unpinned") {
    events.push({
      type: decision as TimelineEventType,
      source,
      occurredAt: decidedAt,
      reason: null,
    });
  }
}

const ALL_SECTIONS: readonly GrowthIntelligenceSection[] = [
  "opportunities",
  "recommendations",
  "insights",
  "data_gaps",
  "timeline",
];

/**
 * Compose one organization's intelligence view for an activity month.
 *
 * Reads only: every row arrives tenant-scoped from its owning repository.
 * The month is canonical `YYYY-MM`; the view never relabels evidence.
 */
export function buildGrowthIntelligenceView(input: GrowthIntelligenceViewInput): GrowthIntelligenceView {
  if (!CANONICAL_MONTH.test(input.activityMonth)) {
    throw new Error(`Activity month must be canonical YYYY-MM, got ${input.activityMonth}.`);
  }
  const sections = new Set(input.sections ?? ALL_SECTIONS);

  const timeline: TimelineEvent[] = [];
  const wantTimeline = sections.has("timeline");

  const requestsByOpportunity = new Map(
    (input.draftRequests ?? []).map((request) => [request.opportunityId, request]),
  );
  const opportunities =
    sections.has("opportunities") || wantTimeline
      ? [...input.opportunities]
          .filter(
            (item) =>
              item.organizationId === input.organizationId &&
              ((ANSWERABLE_OPPORTUNITY_STATUSES.has(item.status) &&
                !isExpiredOpportunity(item, input.now)) ||
                isVisibleDraftRequest(requestsByOpportunity.get(item.id))),
          )
          .sort(compareOpportunities)
          .map((item) => toOpportunityCard(item, requestsByOpportunity.get(item.id) ?? null))
      : [];
  if (wantTimeline) {
    // History covers every organization opportunity, including terminal
    // requests whose cards no longer stand. The lane above decides what the
    // actor can still act on; this loop decides what happened.
    for (const item of input.opportunities) {
      if (item.organizationId !== input.organizationId) continue;
      const source = { kind: "opportunity", id: item.id } as const;
      timeline.push({
        type: "generated",
        source,
        occurredAt: item.createdAt,
        reason: null,
      });
      const draft = requestsByOpportunity.get(item.id);
      if (draft) {
        timeline.push({
          type: "draft-requested",
          source,
          occurredAt: draft.requestedAt,
          reason: null,
        });
        if (draft.status === "completed") {
          timeline.push({
            type: "draft-created",
            source,
            occurredAt: draft.updatedAt,
            reason: null,
          });
        } else if (draft.status === "retryable_failed") {
          timeline.push({
            type: "retry",
            source,
            occurredAt: draft.updatedAt,
            reason: null,
          });
        } else if (draft.status === "permanent_failed") {
          timeline.push({
            type: "draft-failed",
            source,
            occurredAt: draft.updatedAt,
            reason: null,
          });
        }
      }
    }
  }

  // Channel lanes come from the analysis module's own projection: only
  // actionable rows stay in the lane, decided ones live on in the timeline.
  // A Channel Recommendation is never copied into growth_intelligence_items,
  // so identity stays with its source kind on every surface.
  // An actor's own preference snooze hides the row for that actor alone while
  // its horizon is future; organization policy and other members see no change.
  const visibleRecommendations = input.recommendations.filter(
    (row) =>
      row.preferenceSnoozedUntil === null ||
      new Date(row.preferenceSnoozedUntil).getTime() <= input.now.getTime(),
  );
  const channelLanes = projectOrganizationRecommendationLane(
    visibleRecommendations,
    input.activityMonth,
  );
  const recommendations: RecommendationCard[] = sections.has("recommendations")
    ? channelLanes.recommendations
        .filter((row) => row.actionable)
        .map(toRecommendationCardFromChannel)
    : [];

  const uniqueItems = suppressDuplicates(input.items, (row) => row.fingerprint);
  const visibleItems = uniqueItems.filter((row) => isVisibleItem(row, input.now));

  if (sections.has("recommendations")) {
    const provenance = input.researchProvenance ?? {};
    for (const row of visibleItems.filter((item) => item.kind === "recommendation")) {
      recommendations.push(toRecommendationCardFromItem(row, input.activityMonth, provenance));
    }
  }

  const insights: InsightCard[] = sections.has("insights")
    ? [
        ...channelLanes.insights
          .filter((row) => row.actionable)
          .map(toInsightCardFromChannel),
        ...visibleItems
          .filter((row) => row.kind === "insight")
          .map((row) => toInsightCardFromItem(row, input.activityMonth)),
      ]
    : [];

  const dataGaps: DataGapCard[] = sections.has("data_gaps")
    ? [
        ...channelLanes.dataGaps
          .filter((row) => row.actionable)
          .map(toDataGapCardFromChannel),
        ...visibleItems
          .filter((row) => row.kind === "data_gap")
          .map((row) => toDataGapCardFromItem(row, input.activityMonth)),
      ]
    : [];

  if (wantTimeline) {
    for (const row of [
      ...channelLanes.recommendations,
      ...channelLanes.insights,
      ...channelLanes.dataGaps,
    ]) {
      pushTimeline(
        timeline,
        { kind: "channel_recommendation", id: row.id },
        row.generatedAt,
        row.decision?.decision ?? null,
        row.decision?.createdAt ?? null,
      );
    }
    for (const row of uniqueItems) {
      pushTimeline(
        timeline,
        { kind: "synthesized_item", id: row.id },
        row.generatedAt,
        row.decision,
        row.decidedAt,
      );
    }
    for (const event of input.researchActivity ?? []) {
      timeline.push({
        type:
          event.kind === "started"
            ? "research-started"
            : event.kind === "finished"
              ? "research-finished"
              : "research-retried",
        source: { kind: "research_pipeline", id: event.pipelineId },
        title: event.title,
        occurredAt: event.occurredAt,
        reason: null,
      });
    }
    timeline.sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
  }

  // Identical lifecycle deliveries collapse to one named event: a retried
  // pipeline emits one start and one terminal event per transition, never a
  // duplicated row for the same instant.
  const seenTimelineKeys = new Set<string>();
  const timelineEvents = wantTimeline
    ? timeline.filter((event) => {
        const key = `${event.type}|${event.source.kind}|${event.source.id}|${event.occurredAt}`;
        if (seenTimelineKeys.has(key)) return false;
        seenTimelineKeys.add(key);
        return true;
      })
    : [];

  return {
    activityMonth: input.activityMonth,
    timeZone: input.timeZone,
    priorityActions: {
      opportunities: sections.has("opportunities") ? opportunities : [],
      recommendations,
    },
    insights,
    dataGaps,
    timeline: wantTimeline ? timelineEvents.slice(0, 50) : [],
    counts: {
      opportunities: sections.has("opportunities") ? opportunities.length : 0,
      recommendations: recommendations.length,
      insights: insights.length,
      dataGaps: dataGaps.length,
    },
  };
}
