export type MarketGeographicLayer = "trade_area" | "city" | "country";

export type MarketProfilePublicIdentity = {
  approvedName: string;
  domains: string[];
  publicUrls: string[];
};

export type MarketProfileTradeArea = {
  layer: "trade_area";
  locationRef: string;
  name: string;
  branchId: string;
  radiusKm?: number;
};

export type MarketProfileCity = {
  layer: "city";
  locationRef: string;
  name: string;
  countryCode: string;
};

export type MarketProfileCountry = {
  layer: "country";
  locationRef: string;
  name: string;
  countryCode: string;
};

export type MarketProfileGeography =
  | MarketProfileTradeArea
  | MarketProfileCity
  | MarketProfileCountry;

export type MarketProfileCompetitor = {
  key: string;
  name: string;
  publicUrl?: string;
  geographyRefs: string[];
  relevanceEvidenceUrls: string[];
  relevanceReason: string;
};

export type MarketProfileTopic = {
  key: string;
  label: string;
  provenance: "core" | "industry_pack" | "operator" | "ai_proposed";
};

export type MarketProfileSourcePolicy = {
  excludedDomains: string[];
  excludedPublishers: string[];
  excludedCompetitorKeys: string[];
  allowBoundedQuotes: boolean;
  maxQuotationCharacters: number;
};

export type MarketProfileCadence = {
  timeZone: string;
  dailyLocalTime: string;
  weeklyDay: "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
  weeklyLocalTime: string;
};

export type MarketProfileDocumentV1 = {
  schemaVersion: 1;
  publicIdentity: MarketProfilePublicIdentity;
  nicheDescriptors: string[];
  geographies: MarketProfileGeography[];
  competitors: MarketProfileCompetitor[];
  topics: MarketProfileTopic[];
  sourcePolicy: MarketProfileSourcePolicy;
  cadence: MarketProfileCadence;
};

export type GrowthIntelligenceRequestKind =
  | "profile_discovery"
  | "market_research"
  | "weekly_synthesis"
  | "business_evidence_changed"
  | "evidence_reassessment";

export type GrowthIntelligenceTriggerReason =
  | "profile_confirmed"
  | "profile_revised"
  | "daily_due"
  | "weekly_due"
  | "business_evidence_current"
  | "source_policy_changed"
  | "evidence_expired"
  | "source_changed"
  | "manual_retry";

export type GrowthIntelligenceRequestFingerprintInput = {
  organizationId: string;
  branchId: string | null;
  channelId: string | null;
  kind: GrowthIntelligenceRequestKind;
  triggerReason: GrowthIntelligenceTriggerReason;
  businessEvidenceDigest: string | null;
  marketProfileVersionId: string;
  sourcePolicyDigest: string;
  researchRuleVersion: string;
  localTimeBucket: string;
  synthesisVersionTuple: string | null;
  playbookVersionTuple: string | null;
};

export type MarketEvidenceSourceClass =
  | "official"
  | "first_party"
  | "industry_research"
  | "public_signal";

export type MarketEvidenceSupportGrade =
  | "primary"
  | "corroborated"
  | "single_source"
  | "contextual"
  | "conflicted";

export type MarketEvidenceClaimCategory =
  | "availability"
  | "offer"
  | "price"
  | "event"
  | "review_trend"
  | "demand_trend"
  | "regulation"
  | "seasonality"
  | "structural_context";

export type MarketEvidenceFreshness = "current" | "stale" | "expired";
export type MarketEvidenceSourceState = "active" | "withdrawn" | "excluded";

export type MarketGeographyContext = {
  layer: MarketGeographicLayer;
  locationRef: string;
  parentLocationRefs: readonly string[];
};

export type GeographicCompatibility = {
  compatible: boolean;
  relation: "exact" | "broader_with_limitation" | "narrower_not_generalizable" | "unrelated";
  limitationCode:
    | "BROADER_MARKET_INFERENCE"
    | "NARROWER_EVIDENCE_CANNOT_PROVE_BROADER_SCOPE"
    | "GEOGRAPHY_NOT_RELEVANT"
    | null;
};

export type MarketEvidenceMaterialSnapshot = {
  subjectKind: string;
  subjectRef: string;
  claimKind: string;
  contentDigest: string;
  supportGrade: MarketEvidenceSupportGrade;
  freshness: MarketEvidenceFreshness;
  sourceState: MarketEvidenceSourceState;
  geography: {
    layer: MarketGeographicLayer;
    locationRef: string;
  };
  sourceIds: string[];
  corroboratingClaimIds: string[];
  contradictingClaimIds: string[];
  limitationCodes: string[];
  retrievedAt: string;
  expiresAt: string;
  narrativeDigest: string;
};
