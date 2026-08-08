"use client";

import { SectionForm, type SectionSaveStatus } from "@/components/onboarding/sections/shared";
import {
  performanceMetricOptions,
  performanceSourceOptions,
} from "@/domain/onboarding/vocabularies";
import { currencyOptions } from "@/domain/reference/currencies";

const currencyChoices = currencyOptions.map((currency) => ({
  value: currency.code,
  label: `${currency.code} — ${currency.label}`,
}));

export function HistoricalPerformanceSection({
  defaultValues = {},
  onSave,
}: {
  defaultValues?: Record<string, unknown>;
  onSave: (payload: Record<string, unknown>, status: SectionSaveStatus) => Promise<void>;
}) {
  return (
    <SectionForm
      sectionKey="historical_performance"
      title="Historical performance"
      description="Record sourced metrics with their period, currency, and quality."
      defaultValues={defaultValues}
      onSave={onSave}
      fields={[
        {
          name: "metrics",
          label: "Historical metrics",
          control: "multiselect",
          options: performanceMetricOptions,
          placeholder: "Select the metrics that exist",
          searchPlaceholder: "Search metrics…",
          required: true,
          description: "Pick only metrics that can be evidenced, not ones that could be estimated.",
        },
        {
          name: "period",
          label: "Measurement period",
          control: "monthRange",
          required: true,
          description: "The closed window these figures cover.",
        },
        {
          name: "currency",
          label: "Currency",
          control: "combobox",
          options: currencyChoices,
          placeholder: "Select a currency",
          searchPlaceholder: "Search currencies…",
          required: true,
        },
        {
          name: "source",
          label: "Source and quality",
          control: "select",
          options: performanceSourceOptions,
          placeholder: "Where do these figures come from?",
        },
        {
          name: "sourceNotes",
          label: "Source notes",
          control: "textarea",
          placeholder: "Known gaps, refunds handling, or reconciliation caveats",
        },
      ]}
    />
  );
}
