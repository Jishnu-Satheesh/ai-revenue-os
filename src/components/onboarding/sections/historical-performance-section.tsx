"use client";

import { SectionForm, type SectionSaveStatus } from "@/components/onboarding/sections/shared";

export function HistoricalPerformanceSection({
  defaultValues = {},
  onSave,
}: {
  defaultValues?: Record<string, string>;
  onSave: (payload: Record<string, string>, status: SectionSaveStatus) => Promise<void>;
}) {
  return (
    <SectionForm
      title="Historical performance"
      description="Record sourced metrics with their period, currency, and quality."
      defaultValues={defaultValues}
      onSave={onSave}
      fields={[
        {
          name: "metrics",
          label: "Historical metrics",
          placeholder: "Revenue, orders, margin, repeat purchase",
          required: true,
          multiline: true,
        },
        {
          name: "period",
          label: "Measurement period",
          placeholder: "Jan–Jun 2026",
          required: true,
        },
        {
          name: "source",
          label: "Source and quality",
          placeholder: "POS export; operator supplied",
        },
        { name: "currency", label: "Currency", placeholder: "AED", required: true },
      ]}
    />
  );
}
