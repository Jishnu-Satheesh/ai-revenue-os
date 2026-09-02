import { GrowthIntelligenceError } from "@/domain/growth-intelligence/errors";
import type {
  MarketEvidenceClaimCategory,
  MarketEvidenceFreshness,
  MarketEvidenceSourceClass,
  MarketEvidenceSourceState,
  MarketEvidenceSupportGrade,
} from "@/domain/growth-intelligence/types";

export const MARKET_EVIDENCE_FRESHNESS_REGISTRY_VERSION = 1 as const;

type SupportSource = {
  sourceId: string;
  publisherKey: string;
  sourceClass: MarketEvidenceSourceClass;
  disposition: "supports" | "contradicts";
};

type SupportRationaleCode =
  | "DIRECT_FACT_PRIMARY_SOURCE"
  | "INDEPENDENT_SOURCES_CORROBORATE"
  | "ONE_INDEPENDENT_SOURCE"
  | "CONTEXT_ONLY"
  | "ELIGIBLE_SOURCES_DISAGREE";

export type MarketEvidenceSupportResult = {
  grade: MarketEvidenceSupportGrade;
  rationaleCode: SupportRationaleCode;
  supportingSourceIds: string[];
  contradictingSourceIds: string[];
};

export function classifyMarketEvidenceSupport(input: {
  claimRole: "material" | "contextual";
  claimForm: "direct_fact" | "inference";
  sources: readonly SupportSource[];
}): MarketEvidenceSupportResult {
  const sourceIds = input.sources.map((source) => source.sourceId);
  if (new Set(sourceIds).size !== sourceIds.length) {
    throw new GrowthIntelligenceError(
      "EVIDENCE_SOURCE_DUPLICATE",
      "Market evidence source identities must be unique.",
    );
  }

  const supporting = input.sources.filter((source) => source.disposition === "supports");
  const contradicting = input.sources.filter((source) => source.disposition === "contradicts");
  if (supporting.length === 0) {
    throw new GrowthIntelligenceError(
      "EVIDENCE_SUPPORT_MISSING",
      "A visible claim requires at least one supporting source.",
    );
  }

  const supportingSourceIds = supporting.map((source) => source.sourceId).sort();
  const contradictingSourceIds = contradicting.map((source) => source.sourceId).sort();
  if (contradicting.length > 0) {
    return {
      grade: "conflicted",
      rationaleCode: "ELIGIBLE_SOURCES_DISAGREE",
      supportingSourceIds,
      contradictingSourceIds,
    };
  }

  if (input.claimRole === "contextual") {
    return {
      grade: "contextual",
      rationaleCode: "CONTEXT_ONLY",
      supportingSourceIds,
      contradictingSourceIds,
    };
  }

  if (
    input.claimForm === "direct_fact" &&
    supporting.some(
      (source) => source.sourceClass === "official" || source.sourceClass === "first_party",
    )
  ) {
    return {
      grade: "primary",
      rationaleCode: "DIRECT_FACT_PRIMARY_SOURCE",
      supportingSourceIds,
      contradictingSourceIds,
    };
  }

  if (new Set(supporting.map((source) => source.publisherKey)).size >= 2) {
    return {
      grade: "corroborated",
      rationaleCode: "INDEPENDENT_SOURCES_CORROBORATE",
      supportingSourceIds,
      contradictingSourceIds,
    };
  }

  return {
    grade: "single_source",
    rationaleCode: "ONE_INDEPENDENT_SOURCE",
    supportingSourceIds,
    contradictingSourceIds,
  };
}

const DAY_MS = 86_400_000;

const FRESHNESS_REGISTRY: Readonly<
  Record<MarketEvidenceClaimCategory, { staleAfterDays: number; expiresAfterDays: number }>
> = {
  availability: { staleAfterDays: 0.25, expiresAfterDays: 1 },
  offer: { staleAfterDays: 3, expiresAfterDays: 7 },
  price: { staleAfterDays: 3, expiresAfterDays: 7 },
  event: { staleAfterDays: 7, expiresAfterDays: 14 },
  review_trend: { staleAfterDays: 14, expiresAfterDays: 30 },
  demand_trend: { staleAfterDays: 14, expiresAfterDays: 30 },
  regulation: { staleAfterDays: 30, expiresAfterDays: 90 },
  seasonality: { staleAfterDays: 180, expiresAfterDays: 400 },
  structural_context: { staleAfterDays: 180, expiresAfterDays: 400 },
};

function parseTimestamp(value: string): Date {
  const instant = new Date(value);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) ||
    Number.isNaN(instant.getTime())
  ) {
    throw new GrowthIntelligenceError(
      "EVIDENCE_TIMESTAMP_INVALID",
      "Market evidence timestamp must be a valid UTC instant.",
    );
  }
  return instant;
}

export type MarketEvidenceFreshnessResult = {
  freshness: MarketEvidenceFreshness;
  basisAt: string;
  staleAt: string;
  expiresAt: string;
  sourceState: MarketEvidenceSourceState;
  registryVersion: typeof MARKET_EVIDENCE_FRESHNESS_REGISTRY_VERSION;
};

export function classifyMarketEvidenceFreshness(input: {
  claimCategory: MarketEvidenceClaimCategory;
  observedAt: string | null;
  retrievedAt: string;
  now: string;
  sourceState: MarketEvidenceSourceState;
}): MarketEvidenceFreshnessResult {
  const retrievedAt = parseTimestamp(input.retrievedAt);
  const observedAt = input.observedAt ? parseTimestamp(input.observedAt) : null;
  const now = parseTimestamp(input.now);
  if (observedAt && observedAt.getTime() > retrievedAt.getTime()) {
    throw new GrowthIntelligenceError(
      "EVIDENCE_TIME_ORDER_INVALID",
      "Market evidence observation cannot be later than retrieval.",
    );
  }
  if (now.getTime() < retrievedAt.getTime()) {
    throw new GrowthIntelligenceError(
      "EVIDENCE_TIME_ORDER_INVALID",
      "Market evidence cannot be evaluated before it was retrieved.",
    );
  }

  const basis = observedAt ?? retrievedAt;
  const rule = FRESHNESS_REGISTRY[input.claimCategory];
  const staleAt = new Date(basis.getTime() + rule.staleAfterDays * DAY_MS);
  const expiresAt = new Date(basis.getTime() + rule.expiresAfterDays * DAY_MS);
  const freshness: MarketEvidenceFreshness =
    now.getTime() >= expiresAt.getTime()
      ? "expired"
      : now.getTime() >= staleAt.getTime()
        ? "stale"
        : "current";

  return {
    freshness,
    basisAt: basis.toISOString(),
    staleAt: staleAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    sourceState: input.sourceState,
    registryVersion: MARKET_EVIDENCE_FRESHNESS_REGISTRY_VERSION,
  };
}
