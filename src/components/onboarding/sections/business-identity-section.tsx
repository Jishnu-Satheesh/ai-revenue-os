"use client";

import { SectionForm, type SectionSaveStatus } from "@/components/onboarding/sections/shared";
import { industryOptions } from "@/domain/organizations/industries";
import { countryOptions } from "@/domain/reference/countries";
import { currencyOptions } from "@/domain/reference/currencies";

const currencyChoices = currencyOptions.map((currency) => ({
  value: currency.code,
  label: `${currency.code} — ${currency.label}`,
}));

export function BusinessIdentitySection({
  defaultValues = {},
  onSave,
}: {
  defaultValues?: Record<string, unknown>;
  onSave: (payload: Record<string, unknown>, status: SectionSaveStatus) => Promise<void>;
}) {
  return (
    <SectionForm
      sectionKey="business_identity"
      title="Business identity"
      description="Confirm the stable context used by every downstream decision."
      defaultValues={defaultValues}
      onSave={onSave}
      fields={[
        {
          name: "name",
          label: "Organization name",
          placeholder: "Al Noor Kitchen",
          required: true,
        },
        {
          name: "industry",
          label: "Industry",
          control: "select",
          options: industryOptions,
          placeholder: "Select an industry",
          required: true,
          description:
            "Classification only. Industry-specific behavior comes from the installed pack.",
        },
        {
          name: "market",
          label: "Primary markets",
          control: "multiselect",
          options: countryOptions,
          placeholder: "Select the countries served",
          searchPlaceholder: "Search countries…",
        },
        {
          name: "baseCurrency",
          label: "Reporting currency",
          control: "combobox",
          options: currencyChoices,
          placeholder: "Select a currency",
          searchPlaceholder: "Search currencies…",
          description: "Used as the default currency for budgets and performance figures.",
        },
        {
          name: "legalIdentity",
          label: "Legal or operating identity",
          placeholder: "Registered trade name, if it differs",
        },
        {
          name: "valueProposition",
          label: "Value proposition",
          control: "textarea",
          placeholder: "What makes this business valuable to its customers?",
        },
      ]}
    />
  );
}
