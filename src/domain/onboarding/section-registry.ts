import {
  approvalModeSchema,
  baselineStatusSchema,
  consentStatusSchema,
  conversionTrackingSchema,
  hasEntries,
  hasMeasurementPeriod,
  hasOpeningHours,
} from "@/domain/onboarding/vocabularies";
import type { OnboardingPhase, OnboardingSectionKey } from "@/domain/onboarding/types";
import { industrySchema } from "@/domain/organizations/industries";
import { findCurrency } from "@/domain/reference/currencies";

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

/**
 * A single deterministic condition a section must meet before it can be marked
 * complete. `field` points at the control that satisfies it so the editor can
 * tell the operator exactly what is still missing instead of failing the save.
 */
export type SectionRequirement = {
  field: string;
  label: string;
  satisfied: boolean;
};

function text(payload: Record<string, unknown>, key: string, minimum = 1) {
  const value = payload[key];
  return typeof value === "string" && value.trim().length >= minimum;
}

function list(payload: Record<string, unknown>, key: string) {
  return hasEntries(payload, key);
}

function member(
  payload: Record<string, unknown>,
  key: string,
  schema: { safeParse: (value: unknown) => { success: boolean } },
) {
  return schema.safeParse(payload[key]).success;
}

function wholeNumber(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function currency(payload: Record<string, unknown>, key: string) {
  return findCurrency(typeof payload[key] === "string" ? (payload[key] as string) : null) !== null;
}

function requirementsFor(
  key: OnboardingSectionKey,
  payload: Record<string, unknown>,
): SectionRequirement[] {
  switch (key) {
    case "business_identity":
      return [
        { field: "name", label: "Organization name", satisfied: text(payload, "name", 2) },
        {
          field: "industry",
          label: "Industry",
          satisfied: member(payload, "industry", industrySchema),
        },
      ];
    case "branches_operations":
      return [
        {
          field: "branches",
          label: "Branches, or a branchless confirmation",
          satisfied: payload.branchlessConfirmed === true || list(payload, "branches"),
        },
        {
          field: "operatingHours",
          label: "Operating hours for at least one day",
          satisfied: hasOpeningHours(payload.operatingHours),
        },
      ];
    case "products_services":
      return [
        {
          field: "items",
          label: "Products or services",
          satisfied: list(payload, "items") || list(payload, "services"),
        },
      ];
    case "channels_presence":
      return [
        {
          field: "channels",
          label: "Owned and marketplace channels",
          satisfied: list(payload, "channels"),
        },
        {
          field: "conversionTrackingStatus",
          label: "Conversion tracking status",
          satisfied: member(payload, "conversionTrackingStatus", conversionTrackingSchema),
        },
      ];
    case "historical_performance":
      return [
        { field: "metrics", label: "Historical metrics", satisfied: list(payload, "metrics") },
        {
          field: "period",
          label: "Measurement period",
          satisfied: hasMeasurementPeriod(payload.period),
        },
        { field: "currency", label: "Currency", satisfied: currency(payload, "currency") },
      ];
    case "customers_consent":
      return [
        { field: "segments", label: "Customer segments", satisfied: list(payload, "segments") },
        {
          field: "consentStatus",
          label: "Consent confirmation source",
          satisfied: member(payload, "consentStatus", consentStatusSchema),
        },
      ];
    case "brand_assets":
      return [
        { field: "brandVoice", label: "Brand voice", satisfied: list(payload, "brandVoice") },
        { field: "languages", label: "Languages", satisfied: list(payload, "languages") },
      ];
    case "governance":
      return [
        { field: "goals", label: "Measurable goals", satisfied: list(payload, "goals") },
        {
          field: "baseline",
          label: "Baseline status",
          satisfied: member(payload, "baseline", baselineStatusSchema),
        },
        {
          field: "budgetMinor",
          label: "Monthly budget",
          satisfied: wholeNumber(payload, "budgetMinor"),
        },
        {
          field: "budgetCurrency",
          label: "Budget currency",
          satisfied: currency(payload, "budgetCurrency"),
        },
        {
          field: "approvalMode",
          label: "Approval mode",
          satisfied: member(payload, "approvalMode", approvalModeSchema),
        },
      ];
    case "integrations_uploads":
      return [
        {
          field: "sources",
          label: "Available integrations and files",
          satisfied: list(payload, "sources"),
        },
      ];
    case "review_readiness":
      return [
        {
          field: "operatorConfirmed",
          label: "Operator confirmation",
          satisfied: payload.operatorConfirmed === true,
        },
      ];
  }
}

/**
 * Reports every completion condition for a section and whether the payload
 * currently satisfies it. The editor uses the unsatisfied entries to explain a
 * draft save; the service uses `canCompleteSection` to enforce the same rule.
 */
export function evaluateSectionCompletion(
  key: OnboardingSectionKey,
  payload: Record<string, unknown>,
): SectionRequirement[] {
  if (payload.unknown === true && key !== "business_identity" && key !== "review_readiness") {
    return requirementsFor(key, payload).map((requirement) => ({
      ...requirement,
      satisfied: true,
    }));
  }
  return requirementsFor(key, payload);
}

export function canCompleteSection(key: OnboardingSectionKey, payload: Record<string, unknown>) {
  return evaluateSectionCompletion(key, payload).every((requirement) => requirement.satisfied);
}
