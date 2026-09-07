import {
  classifyMarketEvidenceFreshness,
  classifyMarketEvidenceSupport,
} from "@/domain/growth-intelligence/evidence-quality";
import type {
  MarketEvidenceClaimCategory,
  MarketEvidenceFreshness,
  MarketEvidenceSourceClass,
  MarketEvidenceSourceState,
  MarketEvidenceSupportGrade,
  MarketGeographicLayer,
} from "@/domain/growth-intelligence/types";
import type { MarketProfileView } from "@/modules/growth-intelligence/application/ports";

/**
 * The read-only Market Watch builder.
 *
 * It composes already-persisted claims, sources, links, events, and requests
 * into one bounded view. It performs reads only: building a watch never
 * enqueues research, and every signal carries the citation, geography,
 * support, freshness, and limitation context an operator needs to judge it.
 */

export type MarketWatchClaimInput = {
  id: string;
  runId: string;
  profileVersionId: string;
  key: string;
  digest: string;
  subjectKind: string;
  subjectRef: string;
  claimKind: string;
  paraphrase: string;
  quotation: string | null;
  geographicLayer: string;
  geographyRef: string;
  claimCategory: string;
  freshnessClass: string;
  publishedAt: string | null;
  observedAt: string | null;
  staleAt: string;
  expiresAt: string;
  limitations: string[];
};

export type MarketWatchSourceInput = {
  id: string;
  runId: string;
  profileVersionId: string;
  key: string;
  url: string;
  domain: string;
  publisher: string | null;
  sourceClass: string;
  availability: string;
  contentDigest: string | null;
  safeFailureCode: string | null;
  retrievedAt: string;
  publishedAt: string | null;
  observedAt: string | null;
};

export type MarketWatchLinkInput = {
  claimId: string;
  sourceId: string | null;
  relatedClaimId: string | null;
  relation: "supports" | "corroborates" | "contradicts";
};

export type MarketWatchEventInput = {
  claimId: string;
  eventType: "observed" | "expired" | "withdrawn" | "excluded" | "corrected" | "superseded";
  occurredAt: string;
};

export type MarketWatchRequestInput = {
  id: string;
  kind: string;
  triggerReason: string;
  status: string;
  dueAt: string;
  safeFailureCode: string | null;
  correlationId: string;
  attemptCount: number;
  maxAttempts: number;
};

export type MarketWatchSignalState =
  | "current"
  | "stale"
  | "withdrawn"
  | "excluded"
  | "conflicted"
  | "delayed";

export type MarketWatchSignalSource = {
  url: string;
  publisher: string | null;
  sourceClass: MarketEvidenceSourceClass;
  retrievedAt: string;
  publishedAt: string | null;
  observedAt: string | null;
};

export type MarketWatchSignal = {
  claimId: string;
  subjectKind: string;
  subjectRef: string;
  claimKind: string;
  paraphrase: string;
  quotation: string | null;
  geographicLayer: MarketGeographicLayer;
  geographyRef: string;
  supportGrade: MarketEvidenceSupportGrade | null;
  freshness: MarketEvidenceFreshness;
  state: MarketWatchSignalState;
  expired: boolean;
  sources: MarketWatchSignalSource[];
  limitations: string[];
  retrievedAt: string | null;
};

export type MarketWatchRetryableRequest = {
  requestId: string;
  kind: string;
  status: string;
  safeFailureCode: string | null;
};

export type MarketWatchProfileStatus = {
  state: "ready" | "absent" | "disabled" | "unconfirmed";
  currentVersionId: string | null;
  delayedReason: string | null;
};

export type MarketWatchView = {
  signals: MarketWatchSignal[];
  nextCursor: string | null;
  profileStatus: MarketWatchProfileStatus;
  retryableRequests: MarketWatchRetryableRequest[];
};

export type MarketWatchInput = {
  profile: MarketProfileView;
  claims: readonly MarketWatchClaimInput[];
  sources: readonly MarketWatchSourceInput[];
  links: readonly MarketWatchLinkInput[];
  events: readonly MarketWatchEventInput[];
  requests: readonly MarketWatchRequestInput[];
  limit: number;
  cursor: string | null;
  geography: MarketGeographicLayer | null;
  now: string;
  allowBoundedQuotes: boolean;
};

const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;
const TERMINAL_EVENT_STATES = new Set(["withdrawn", "excluded"]);
const CONTEXTUAL_CATEGORIES = new Set(["structural_context", "seasonality"]);

function clampLimit(limit: number): number {
  if (!Number.isInteger(limit)) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(limit, 1), MAX_PAGE_SIZE);
}

function decodeOffset(cursor: string | null): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      Number.isInteger((parsed as { offset?: unknown }).offset) &&
      (parsed as { offset: number }).offset >= 0
    ) {
      return (parsed as { offset: number }).offset;
    }
  } catch {
    // Fall through to the first page; the route rejects malformed cursors
    // before they reach the builder.
  }
  return 0;
}

function encodeOffset(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}

function isSourceClass(value: string): value is MarketEvidenceSourceClass {
  return (
    value === "official" ||
    value === "first_party" ||
    value === "industry_research" ||
    value === "public_signal"
  );
}

function isGeographicLayer(value: string): value is MarketGeographicLayer {
  return value === "trade_area" || value === "city" || value === "country";
}

function isClaimCategory(value: string): value is MarketEvidenceClaimCategory {
  return (
    value === "availability" ||
    value === "offer" ||
    value === "price" ||
    value === "event" ||
    value === "review_trend" ||
    value === "demand_trend" ||
    value === "regulation" ||
    value === "seasonality" ||
    value === "structural_context"
  );
}

function latestEventFor(
  events: readonly MarketWatchEventInput[],
  claimId: string,
): MarketWatchEventInput | null {
  let latest: MarketWatchEventInput | null = null;
  for (const event of events) {
    if (event.claimId !== claimId) continue;
    if (!latest || event.occurredAt > latest.occurredAt) latest = event;
  }
  return latest;
}

export function buildMarketWatch(input: MarketWatchInput): MarketWatchView {
  const profileState: MarketWatchProfileStatus["state"] = !input.profile.profile
    ? "absent"
    : !input.profile.profile.enabled
      ? "disabled"
      : !input.profile.profile.currentVersionId
        ? "unconfirmed"
        : "ready";

  const sourcesById = new Map(input.sources.map((source) => [source.id, source]));
  const linksByClaim = new Map<string, MarketWatchLinkInput[]>();
  for (const link of input.links) {
    const existing = linksByClaim.get(link.claimId) ?? [];
    existing.push(link);
    linksByClaim.set(link.claimId, existing);
  }
  const claimsById = new Map(input.claims.map((claim) => [claim.id, claim]));

  const eligible =
    profileState === "ready"
      ? input.claims.filter(
          (claim) => !input.geography || claim.geographicLayer === input.geography,
        )
      : [];

  const signals: MarketWatchSignal[] = [];
  for (const claim of eligible) {
    if (!isGeographicLayer(claim.geographicLayer) || !isClaimCategory(claim.claimCategory)) {
      continue;
    }
    const latestEvent = latestEventFor(input.events, claim.id);
    if (latestEvent && TERMINAL_EVENT_STATES.has(latestEvent.eventType)) {
      signals.push({
        claimId: claim.id,
        subjectKind: claim.subjectKind,
        subjectRef: claim.subjectRef,
        claimKind: claim.claimKind,
        paraphrase: claim.paraphrase,
        quotation: input.allowBoundedQuotes ? claim.quotation : null,
        geographicLayer: claim.geographicLayer,
        geographyRef: claim.geographyRef,
        supportGrade: null,
        freshness: "stale",
        state: latestEvent.eventType as "withdrawn" | "excluded",
        expired: false,
        sources: [],
        limitations: claim.limitations,
        retrievedAt: null,
      });
      continue;
    }

    const claimLinks = linksByClaim.get(claim.id) ?? [];
    const supportingIds = [
      ...new Set(
        claimLinks
          .filter(
            (link) =>
              link.sourceId !== null &&
              (link.relation === "supports" || link.relation === "corroborates"),
          )
          .map((link) => link.sourceId as string),
      ),
    ];
    const supporting = supportingIds
      .map((id) => sourcesById.get(id))
      .filter(
        (source): source is MarketWatchSourceInput & { sourceClass: MarketEvidenceSourceClass } =>
          !!source && source.availability === "available" && isSourceClass(source.sourceClass),
      );
    // Claims with no supporting source cannot be graded, so they are not
    // eligible signals. The classifier refuses them rather than guessing.
    if (supporting.length === 0) continue;

    const contradictingIds = [
      ...new Set(
        claimLinks
          .filter((link) => link.relation === "contradicts" && link.relatedClaimId !== null)
          .flatMap((link) => {
            const related = claimsById.get(link.relatedClaimId as string);
            if (!related) return [];
            return (linksByClaim.get(related.id) ?? [])
              .filter((relatedLink) => relatedLink.sourceId !== null)
              .map((relatedLink) => relatedLink.sourceId as string);
          }),
      ),
    ];
    const contradicting = contradictingIds
      .map((id) => sourcesById.get(id))
      .filter(
        (source): source is MarketWatchSourceInput & { sourceClass: MarketEvidenceSourceClass } =>
          !!source && isSourceClass(source.sourceClass),
      );

    const classifierSources = [
      ...supporting.map((source) => ({
        sourceId: source.id,
        publisherKey: (source.publisher ?? source.domain).toLowerCase(),
        sourceClass: source.sourceClass,
        disposition: "supports" as const,
      })),
      ...contradicting.map((source) => ({
        sourceId: source.id,
        publisherKey: (source.publisher ?? source.domain).toLowerCase(),
        sourceClass: source.sourceClass,
        disposition: "contradicts" as const,
      })),
    ];
    // Role and form are derived from stored structure until synthesis owns
    // claim extraction: background categories stay contextual, and a direct
    // fact needs a primary-class source behind it.
    const claimRole = CONTEXTUAL_CATEGORIES.has(claim.claimCategory)
      ? ("contextual" as const)
      : ("material" as const);
    const claimForm = supporting.some(
      (source) => source.sourceClass === "official" || source.sourceClass === "first_party",
    )
      ? ("direct_fact" as const)
      : ("inference" as const);
    const support = classifyMarketEvidenceSupport({
      claimRole,
      claimForm,
      sources: classifierSources,
    });

    // Signal freshness uses the earliest supporting retrieval
    // (ascending-sort take-first). This is a deliberate conservative choice:
    // one fresh mirror must not mask older evidence behind the same claim.
    const [retrievedAt] = supporting.map((source) => source.retrievedAt).sort();
    if (!retrievedAt) continue;
    const sourceState: MarketEvidenceSourceState =
      latestEvent && (latestEvent.eventType === "withdrawn" || latestEvent.eventType === "excluded")
        ? latestEvent.eventType
        : "active";
    let freshness;
    try {
      freshness = classifyMarketEvidenceFreshness({
        claimCategory: claim.claimCategory,
        observedAt: claim.observedAt,
        retrievedAt,
        now: input.now,
        sourceState,
      });
    } catch {
      continue;
    }

    const conflicted =
      support.grade === "conflicted" || claimLinks.some((link) => link.relation === "contradicts");
    signals.push({
      claimId: claim.id,
      subjectKind: claim.subjectKind,
      subjectRef: claim.subjectRef,
      claimKind: claim.claimKind,
      paraphrase: claim.paraphrase,
      quotation: input.allowBoundedQuotes ? claim.quotation : null,
      geographicLayer: claim.geographicLayer,
      geographyRef: claim.geographyRef,
      supportGrade: support.grade,
      freshness: freshness.freshness,
      state: conflicted ? "conflicted" : freshness.freshness === "current" ? "current" : "stale",
      expired: freshness.freshness === "expired",
      sources: supporting.map((source) => ({
        url: source.url,
        publisher: source.publisher,
        sourceClass: source.sourceClass,
        retrievedAt: source.retrievedAt,
        publishedAt: source.publishedAt,
        observedAt: source.observedAt,
      })),
      limitations: claim.limitations,
      retrievedAt,
    });
  }

  const limit = clampLimit(input.limit);
  const offset = decodeOffset(input.cursor);
  const page = signals.slice(offset, offset + limit);
  // A full page may hide more signals; the next page proves the end by
  // returning short. Geography filtering runs after DB keyset pagination
  // upstream of this builder, so a filtered page may be short (or empty)
  // while nextCursor stays live: callers must keep following the cursor
  // rather than treating a short page as the end.
  const nextCursor = page.length === limit ? encodeOffset(offset + limit) : null;

  const retryableRequests = input.requests
    .filter((request) => request.status === "failed" && request.attemptCount < request.maxAttempts)
    .map((request) => ({
      requestId: request.id,
      kind: request.kind,
      status: request.status,
      safeFailureCode: request.safeFailureCode,
    }));

  const pendingWork = input.requests.some(
    (request) => request.status === "pending" || request.status === "claimed",
  );
  const delayedReason =
    signals.length > 0
      ? null
      : profileState !== "ready"
        ? `Market Watch is delayed: the Market Profile is ${profileState}.`
        : pendingWork
          ? "Market Watch is delayed: research is still running."
          : null;

  return {
    signals: page,
    nextCursor,
    profileStatus: {
      state: profileState,
      currentVersionId: input.profile.profile?.currentVersionId ?? null,
      delayedReason,
    },
    retryableRequests,
  };
}
