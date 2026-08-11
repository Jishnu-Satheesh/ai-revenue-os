import {
  onboardingSectionKeySchema,
  onboardingSectionStatusSchema,
  type OnboardingSectionKey,
  type OnboardingSectionStatus,
} from "@/domain/onboarding/types";

type SectionSnapshot = {
  status: OnboardingSectionStatus;
  payload?: Record<string, unknown>;
};

export type ReadinessInput = {
  sections: Partial<Record<OnboardingSectionKey, SectionSnapshot>>;
};

export type ReadinessReason = {
  id: string;
  label: string;
  satisfied: boolean;
  sectionKey: OnboardingSectionKey;
  critical: boolean;
};

export type ReadinessResult = {
  rubricVersion: "v1";
  overallScore: number;
  capabilityScores: Record<string, number>;
  capabilities: Record<string, { available: boolean; reasonIds: string[] }>;
  criticalBlockers: string[];
  reasons: ReadinessReason[];
  nextActions: Array<{
    reasonId: string;
    owner: "agency_operator" | "client_contact";
    effort: "small" | "medium" | "large";
  }>;
};

const requirements: ReadinessReason[] = [
  {
    id: "business_identity_required",
    label: "Business identity is grounded",
    satisfied: false,
    sectionKey: "business_identity",
    critical: true,
  },
  {
    id: "operations_required",
    label: "Operations are grounded",
    satisfied: false,
    sectionKey: "branches_operations",
    critical: true,
  },
  {
    id: "catalog_required",
    label: "Products or services are available",
    satisfied: false,
    sectionKey: "products_services",
    critical: false,
  },
  {
    id: "conversion_tracking_required",
    label: "Conversion tracking is connected",
    satisfied: false,
    sectionKey: "channels_presence",
    critical: true,
  },
  {
    id: "historical_performance_required",
    label: "Historical performance has a source",
    satisfied: false,
    sectionKey: "historical_performance",
    critical: false,
  },
  {
    id: "cost_structure_required",
    label: "Variable costs are priced",
    satisfied: false,
    sectionKey: "cost_structure",
    // Not critical. A margin with unpriced components grades `indicative` and
    // names what is missing, which is a usable answer; blocking readiness on it
    // would stall every client who does not know their cost of goods yet.
    critical: false,
  },
  {
    id: "customer_consent_required",
    label: "Customer consent is confirmed",
    satisfied: false,
    sectionKey: "customers_consent",
    critical: true,
  },
  {
    id: "brand_assets_required",
    label: "Brand context is available",
    satisfied: false,
    sectionKey: "brand_assets",
    critical: false,
  },
  {
    id: "governance_required",
    label: "Goals, budget, and approvals are defined",
    satisfied: false,
    sectionKey: "governance",
    critical: true,
  },
  {
    id: "integration_required",
    label: "At least one data source is available",
    satisfied: false,
    sectionKey: "integrations_uploads",
    critical: false,
  },
  {
    id: "review_required",
    label: "Operator review is complete",
    satisfied: false,
    sectionKey: "review_readiness",
    critical: true,
  },
];

function hasGroundedSection(section: SectionSnapshot | undefined) {
  return section?.status === "complete";
}

function requirementSatisfied(requirement: ReadinessReason, section: SectionSnapshot | undefined) {
  if (!section) return false;
  if (requirement.id === "customer_consent_required")
    return section.payload?.consentConfirmed === true;
  if (requirement.id === "conversion_tracking_required")
    return section.payload?.conversionTracking === true;
  return hasGroundedSection(section);
}

/**
 * Which requirements make up each capability score, by id.
 *
 * By id and never by position. These were once read out of `requirements` as
 * `reasons[5]` and `reasons[7]`, so inserting a section anywhere above them
 * silently reassigned a capability to whichever requirement landed on that
 * index — which is exactly what happened when cost structure was added, handing
 * outbound retention to it and breaking the consent gate specs/008 requires. A
 * requirement list is edited often; its order is not a contract.
 */
const CAPABILITY_REQUIREMENTS = {
  business_profile: ["business_identity_required"],
  operational_data: ["operations_required"],
  commercial_data: [
    "catalog_required",
    "conversion_tracking_required",
    "historical_performance_required",
  ],
  customer_consent: ["customer_consent_required"],
  governance: ["governance_required"],
} as const satisfies Record<string, readonly string[]>;

/** What each capability may not run without. */
const CAPABILITY_GATES = {
  outbound_retention: "customer_consent_required",
  autonomous_ad_optimization: "conversion_tracking_required",
} as const;

export function calculateReadiness(input: ReadinessInput): ReadinessResult {
  const reasons = requirements.map((requirement) => ({
    ...requirement,
    satisfied: requirementSatisfied(requirement, input.sections[requirement.sectionKey]),
  }));

  const satisfiedById = new Map(reasons.map((reason) => [reason.id, reason.satisfied]));
  const isSatisfied = (id: string) => satisfiedById.get(id) === true;

  const satisfiedCount = reasons.filter((reason) => reason.satisfied).length;
  const criticalBlockers = reasons
    .filter((reason) => reason.critical && !reason.satisfied)
    .map((reason) => reason.id);

  const capabilityScores = Object.fromEntries(
    Object.entries(CAPABILITY_REQUIREMENTS).map(([capability, ids]) => [
      capability,
      Math.round((ids.filter(isSatisfied).length / ids.length) * 100),
    ]),
  );

  const capabilities = Object.fromEntries(
    Object.entries(CAPABILITY_GATES).map(([capability, gateId]) => [
      capability,
      { available: isSatisfied(gateId), reasonIds: isSatisfied(gateId) ? [] : [gateId] },
    ]),
  );

  return {
    rubricVersion: "v1",
    overallScore: Math.round((satisfiedCount / reasons.length) * 100),
    capabilityScores,
    capabilities,
    criticalBlockers,
    reasons,
    nextActions: reasons
      .filter((reason) => !reason.satisfied)
      .map((reason) => ({
        reasonId: reason.id,
        owner: reason.sectionKey === "customers_consent" ? "client_contact" : "agency_operator",
        effort: reason.critical ? "medium" : "small",
      })),
  };
}

export function isOnboardingSectionKey(value: string): value is OnboardingSectionKey {
  return onboardingSectionKeySchema.safeParse(value).success;
}

export function isCompleteSectionStatus(value: string): value is "complete" {
  return onboardingSectionStatusSchema.safeParse(value).success && value === "complete";
}
