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

export function calculateReadiness(input: ReadinessInput): ReadinessResult {
  const reasons = requirements.map((requirement) => ({
    ...requirement,
    satisfied: requirementSatisfied(requirement, input.sections[requirement.sectionKey]),
  }));
  const satisfiedCount = reasons.filter((reason) => reason.satisfied).length;
  const criticalBlockers = reasons
    .filter((reason) => reason.critical && !reason.satisfied)
    .map((reason) => reason.id);
  const capabilityScores = {
    business_profile: reasons[0].satisfied ? 100 : 0,
    operational_data: reasons[1].satisfied ? 100 : 0,
    commercial_data: reasons.slice(2, 5).filter((reason) => reason.satisfied).length * 33,
    customer_consent: reasons[5].satisfied ? 100 : 0,
    governance: reasons[7].satisfied ? 100 : 0,
  };

  return {
    rubricVersion: "v1",
    overallScore: Math.round((satisfiedCount / reasons.length) * 100),
    capabilityScores,
    capabilities: {
      outbound_retention: {
        available: reasons[5].satisfied,
        reasonIds: reasons[5].satisfied ? [] : ["customer_consent_required"],
      },
      autonomous_ad_optimization: {
        available: reasons[3].satisfied,
        reasonIds: reasons[3].satisfied ? [] : ["conversion_tracking_required"],
      },
    },
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
