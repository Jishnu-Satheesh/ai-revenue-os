"use client";

import { SectionForm, type SectionSaveStatus } from "@/components/onboarding/sections/shared";

export function GovernanceSection({
  defaultValues = {},
  onSave,
}: {
  defaultValues?: Record<string, string>;
  onSave: (payload: Record<string, string>, status: SectionSaveStatus) => Promise<void>;
}) {
  return (
    <SectionForm
      title="Goals, budget, constraints, and approvals"
      description="Keep targets measurable, money in minor units, and high-impact actions approval-gated."
      defaultValues={defaultValues}
      onSave={onSave}
      fields={[
        {
          name: "goals",
          label: "Measurable goals",
          placeholder: "Increase repeat orders by 15%",
          required: true,
          multiline: true,
        },
        {
          name: "baseline",
          label: "Baseline status",
          placeholder: "Known, estimated, or unknown",
          required: true,
        },
        {
          name: "budgetMinor",
          label: "Monthly budget (minor units)",
          placeholder: "250000",
          required: true,
        },
        { name: "budgetCurrency", label: "Budget currency", placeholder: "AED", required: true },
        {
          name: "approvalMode",
          label: "Approval mode",
          placeholder: "Recommendation only or approval required",
          required: true,
        },
        {
          name: "constraints",
          label: "Hard and soft constraints",
          placeholder: "No discount below margin floor",
          multiline: true,
        },
      ]}
    />
  );
}
