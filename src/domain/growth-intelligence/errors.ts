export type GrowthIntelligenceErrorCode =
  | "EVIDENCE_SUPPORT_MISSING"
  | "EVIDENCE_SOURCE_DUPLICATE"
  | "EVIDENCE_TIMESTAMP_INVALID"
  | "EVIDENCE_TIME_ORDER_INVALID"
  | "GEOGRAPHY_HIERARCHY_INVALID";

export class GrowthIntelligenceError extends Error {
  readonly name = "GrowthIntelligenceError";

  constructor(
    public readonly code: GrowthIntelligenceErrorCode,
    message: string,
  ) {
    super(message);
  }
}
