import type { OnboardingPhase, OnboardingSectionKey } from "@/domain/onboarding/types";

export type OnboardingSectionDefinition = {
  key: OnboardingSectionKey;
  phase: OnboardingPhase;
  label: string;
  description: string;
};

export const onboardingSectionRegistry: readonly OnboardingSectionDefinition[] = [
  {
    key: "business_identity",
    phase: "foundation",
    label: "Business identity",
    description: "Name, industry, market, currency, and operating identity.",
  },
  {
    key: "branches_operations",
    phase: "foundation",
    label: "Branches and operations",
    description: "Locations, hours, capacity, service areas, and contacts.",
  },
  {
    key: "products_services",
    phase: "commercial_context",
    label: "Products or services",
    description: "Catalog, menu, offers, availability, and source data.",
  },
  {
    key: "channels_presence",
    phase: "commercial_context",
    label: "Channels and digital presence",
    description: "Owned channels, marketplaces, profiles, and attribution.",
  },
  {
    key: "historical_performance",
    phase: "commercial_context",
    label: "Historical performance",
    description: "Revenue, orders, margin, acquisition, and repeat activity.",
  },
  {
    key: "customers_consent",
    phase: "customer_context",
    label: "Customers and consent",
    description: "Segments, first-party data, consent, and contactability.",
  },
  {
    key: "brand_assets",
    phase: "customer_context",
    label: "Brand assets",
    description: "Voice, languages, assets, claims, and approvers.",
  },
  {
    key: "governance",
    phase: "governance",
    label: "Goals, budget, and approvals",
    description: "Targets, budgets, constraints, risk, and approval modes.",
  },
  {
    key: "integrations_uploads",
    phase: "data_intake",
    label: "Integrations and data uploads",
    description: "Provider availability, permissions, and manual sources.",
  },
  {
    key: "review_readiness",
    phase: "review",
    label: "Review and readiness",
    description: "Blockers, requests, score, and next actions.",
  },
];

export function getOnboardingSectionDefinition(key: OnboardingSectionKey) {
  return onboardingSectionRegistry.find((section) => section.key === key);
}

function hasCollection(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return Array.isArray(value) && value.length > 0;
}

export function canCompleteSection(key: OnboardingSectionKey, payload: Record<string, unknown>) {
  if (payload.unknown === true && key !== "business_identity" && key !== "review_readiness") {
    return true;
  }

  switch (key) {
    case "business_identity":
      return (
        typeof payload.name === "string" &&
        payload.name.trim().length >= 2 &&
        typeof payload.industry === "string" &&
        payload.industry.trim().length >= 2
      );
    case "branches_operations":
      return payload.branchlessConfirmed === true || hasCollection(payload, "branches");
    case "products_services":
      return hasCollection(payload, "items") || hasCollection(payload, "services");
    case "channels_presence":
      return hasCollection(payload, "channels");
    case "historical_performance":
      return hasCollection(payload, "metrics");
    case "customers_consent":
      return payload.consentConfirmed === true || payload.unknown === true;
    case "brand_assets":
      return typeof payload.brandVoice === "string" && payload.brandVoice.trim().length > 0;
    case "governance":
      return hasCollection(payload, "goals") && typeof payload.approvalMode === "string";
    case "integrations_uploads":
      return hasCollection(payload, "sources");
    case "review_readiness":
      return payload.operatorConfirmed === true;
  }
}
