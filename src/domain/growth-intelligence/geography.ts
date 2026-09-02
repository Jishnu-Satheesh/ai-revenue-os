import { GrowthIntelligenceError } from "@/domain/growth-intelligence/errors";
import type {
  GeographicCompatibility,
  MarketGeographicLayer,
  MarketGeographyContext,
} from "@/domain/growth-intelligence/types";

const LAYER_RANK: Readonly<Record<MarketGeographicLayer, number>> = {
  trade_area: 0,
  city: 1,
  country: 2,
};

function assertValidHierarchy(geography: MarketGeographyContext): void {
  if (
    geography.locationRef.trim().length === 0 ||
    geography.parentLocationRefs.includes(geography.locationRef) ||
    new Set(geography.parentLocationRefs).size !== geography.parentLocationRefs.length
  ) {
    throw new GrowthIntelligenceError(
      "GEOGRAPHY_HIERARCHY_INVALID",
      "A market geography must have a non-empty identity and unique parent locations excluding itself.",
    );
  }
}

/**
 * Decides whether an external market geography may support the business scope.
 * Broader evidence is advice-only unless its limitation travels with the claim.
 */
export function evaluateGeographicCompatibility(input: {
  businessGeography: MarketGeographyContext;
  evidenceGeography: MarketGeographyContext;
}): GeographicCompatibility {
  assertValidHierarchy(input.businessGeography);
  assertValidHierarchy(input.evidenceGeography);

  if (
    input.businessGeography.layer === input.evidenceGeography.layer &&
    input.businessGeography.locationRef === input.evidenceGeography.locationRef
  ) {
    return { compatible: true, relation: "exact", limitationCode: null };
  }

  if (
    LAYER_RANK[input.evidenceGeography.layer] > LAYER_RANK[input.businessGeography.layer] &&
    input.businessGeography.parentLocationRefs.includes(input.evidenceGeography.locationRef)
  ) {
    return {
      compatible: true,
      relation: "broader_with_limitation",
      limitationCode: "BROADER_MARKET_INFERENCE",
    };
  }

  if (
    LAYER_RANK[input.evidenceGeography.layer] < LAYER_RANK[input.businessGeography.layer] &&
    input.evidenceGeography.parentLocationRefs.includes(input.businessGeography.locationRef)
  ) {
    return {
      compatible: false,
      relation: "narrower_not_generalizable",
      limitationCode: "NARROWER_EVIDENCE_CANNOT_PROVE_BROADER_SCOPE",
    };
  }

  return {
    compatible: false,
    relation: "unrelated",
    limitationCode: "GEOGRAPHY_NOT_RELEVANT",
  };
}
