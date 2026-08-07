"use client";

import { SectionForm, type SectionSaveStatus } from "@/components/onboarding/sections/shared";

export function CustomersConsentSection({
  defaultValues = {},
  onSave,
}: {
  defaultValues?: Record<string, string>;
  onSave: (payload: Record<string, string>, status: SectionSaveStatus) => Promise<void>;
}) {
  return (
    <SectionForm
      title="Customers and consent"
      description="Consent must come from the operator or client; AI never infers legal permission."
      defaultValues={defaultValues}
      onSave={onSave}
      fields={[
        {
          name: "segments",
          label: "Customer segments",
          placeholder: "New, repeat, high-value",
          required: true,
        },
        {
          name: "dataAvailability",
          label: "First-party data availability",
          placeholder: "CRM, POS, messaging list",
        },
        {
          name: "consentConfirmed",
          label: "Consent confirmation source",
          placeholder: "Client confirmation or unknown",
          required: true,
        },
        {
          name: "retentionConstraints",
          label: "Retention and contactability constraints",
          placeholder: "Retention period, opt-out rules",
          multiline: true,
        },
      ]}
    />
  );
}
