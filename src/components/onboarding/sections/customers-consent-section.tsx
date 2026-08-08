"use client";

import { SectionForm, type SectionSaveStatus } from "@/components/onboarding/sections/shared";
import {
  consentStatusOptions,
  customerSegmentOptions,
  firstPartyDataOptions,
} from "@/domain/onboarding/vocabularies";

export function CustomersConsentSection({
  defaultValues = {},
  onSave,
}: {
  defaultValues?: Record<string, unknown>;
  onSave: (payload: Record<string, unknown>, status: SectionSaveStatus) => Promise<void>;
}) {
  return (
    <SectionForm
      sectionKey="customers_consent"
      title="Customers and consent"
      description="Consent must come from the operator or client; AI never infers legal permission."
      defaultValues={defaultValues}
      onSave={onSave}
      fields={[
        {
          name: "segments",
          label: "Customer segments",
          control: "multiselect",
          options: customerSegmentOptions,
          placeholder: "Select the segments that exist today",
          required: true,
        },
        {
          name: "dataAvailability",
          label: "First-party data availability",
          control: "multiselect",
          options: firstPartyDataOptions,
          placeholder: "Select every source that holds customer records",
        },
        {
          name: "consentStatus",
          label: "Consent confirmation source",
          control: "radio",
          options: consentStatusOptions,
          required: true,
          description: "Recording this honestly is what keeps outbound activity lawful.",
        },
        {
          name: "retentionConstraints",
          label: "Retention and contactability constraints",
          control: "textarea",
          placeholder: "Retention period, opt-out handling, channel restrictions",
        },
      ]}
    />
  );
}
