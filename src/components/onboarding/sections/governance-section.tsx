"use client";

import { SectionForm, type SectionSaveStatus } from "@/components/onboarding/sections/shared";
import { approvalModeOptions, baselineStatusOptions } from "@/domain/onboarding/vocabularies";
import { currencyOptions } from "@/domain/reference/currencies";

const currencyChoices = currencyOptions.map((currency) => ({
  value: currency.code,
  label: `${currency.code} — ${currency.label}`,
}));

export function GovernanceSection({
  defaultValues = {},
  onSave,
}: {
  defaultValues?: Record<string, unknown>;
  onSave: (payload: Record<string, unknown>, status: SectionSaveStatus) => Promise<void>;
}) {
  return (
    <SectionForm
      sectionKey="governance"
      title="Goals, budget, constraints, and approvals"
      description="Keep targets measurable, money in minor units, and high-impact actions approval-gated."
      defaultValues={defaultValues}
      onSave={onSave}
      fields={[
        {
          name: "goals",
          label: "Measurable goals",
          control: "tags",
          multiline: true,
          placeholder: "Increase repeat orders by 15% by December 2026",
          required: true,
          description: "One goal per entry, each with a metric and a target.",
        },
        {
          name: "baseline",
          label: "Baseline status",
          control: "radio",
          options: baselineStatusOptions,
          required: true,
        },
        {
          name: "budgetCurrency",
          label: "Budget currency",
          control: "combobox",
          options: currencyChoices,
          placeholder: "Select a currency",
          searchPlaceholder: "Search currencies…",
          required: true,
        },
        {
          name: "budgetMinor",
          label: "Monthly budget",
          control: "money",
          currencyField: "budgetCurrency",
          placeholder: "2500.00",
          required: true,
        },
        {
          name: "approvalMode",
          label: "Approval mode",
          control: "radio",
          options: approvalModeOptions,
          required: true,
          description: "Money-moving and public-brand actions always stay approval-gated.",
        },
        {
          name: "constraints",
          label: "Hard and soft constraints",
          control: "tags",
          multiline: true,
          placeholder: "No discount below the margin floor",
        },
      ]}
    />
  );
}
