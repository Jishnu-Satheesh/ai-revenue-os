"use client";

import { SectionForm, type SectionSaveStatus } from "@/components/onboarding/sections/shared";

export function ChannelsPresenceSection({
  defaultValues = {},
  onSave,
}: {
  defaultValues?: Record<string, string>;
  onSave: (payload: Record<string, string>, status: SectionSaveStatus) => Promise<void>;
}) {
  return (
    <SectionForm
      title="Channels and digital presence"
      description="List owned channels and account ownership without collecting credentials."
      defaultValues={defaultValues}
      onSave={onSave}
      fields={[
        {
          name: "channels",
          label: "Owned and marketplace channels",
          placeholder: "Website; Instagram; Talabat",
          required: true,
          multiline: true,
        },
        {
          name: "profiles",
          label: "Public profiles",
          placeholder: "Website, Google Business Profile, WhatsApp",
        },
        {
          name: "accountOwnership",
          label: "Account ownership",
          placeholder: "Client-owned; agency-managed",
        },
        {
          name: "conversionTracking",
          label: "Conversion tracking",
          placeholder: "Connected, partial, or missing",
          required: true,
        },
      ]}
    />
  );
}
