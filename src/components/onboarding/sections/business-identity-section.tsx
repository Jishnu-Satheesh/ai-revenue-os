"use client";

import { SectionForm, type SectionSaveStatus } from "@/components/onboarding/sections/shared";

export function BusinessIdentitySection({
  defaultValues = {},
  onSave,
}: {
  defaultValues?: Record<string, string>;
  onSave: (payload: Record<string, string>, status: SectionSaveStatus) => Promise<void>;
}) {
  return (
    <SectionForm
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
        { name: "industry", label: "Industry", placeholder: "Restaurant", required: true },
        {
          name: "legalIdentity",
          label: "Legal or operating identity",
          placeholder: "Optional registered name",
        },
        {
          name: "valueProposition",
          label: "Value proposition",
          placeholder: "What makes this business valuable?",
          multiline: true,
        },
      ]}
    />
  );
}
