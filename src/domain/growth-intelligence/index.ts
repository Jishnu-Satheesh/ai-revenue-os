export * from "@/domain/growth-intelligence/types";
export { GrowthIntelligenceError } from "@/domain/growth-intelligence/errors";
export { marketProfileDocumentV1Schema } from "@/domain/growth-intelligence/schemas";
export { createMarketProfileDigest } from "@/domain/growth-intelligence/profile-digest";
export { createGrowthIntelligenceRequestFingerprint } from "@/domain/growth-intelligence/request-fingerprint";
export {
  classifyMarketEvidenceFreshness,
  classifyMarketEvidenceSupport,
  MARKET_EVIDENCE_FRESHNESS_REGISTRY_VERSION,
} from "@/domain/growth-intelligence/evidence-quality";
export { evaluateGeographicCompatibility } from "@/domain/growth-intelligence/geography";
export {
  createMarketEvidenceMaterialFingerprint,
  hasMaterialMarketEvidenceChange,
} from "@/domain/growth-intelligence/material-change";
