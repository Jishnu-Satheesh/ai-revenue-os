"use client";

import { SectionForm, type SectionSaveStatus } from "@/components/onboarding/sections/shared";

export function BrandAssetsSection({
  defaultValues = {},
  onSave,
}: {
  defaultValues?: Record<string, string>;
  onSave: (payload: Record<string, string>, status: SectionSaveStatus) => Promise<void>;
}) {
  return (
    <SectionForm
      title="Brand assets and communication style"
      description="Capture voice, languages, claims restrictions, and approval contacts."
      defaultValues={defaultValues}
      onSave={onSave}
      fields={[
        {
          name: "brandVoice",
          label: "Brand voice",
          placeholder: "Warm, direct, premium",
          required: true,
        },
        { name: "languages", label: "Languages", placeholder: "Arabic, English", required: true },
        {
          name: "assetSources",
          label: "Asset sources",
          placeholder: "Logo folder, approved imagery, guidelines",
        },
        {
          name: "claimsRestrictions",
          label: "Claims and approvals",
          placeholder: "Claims to avoid and who approves copy",
          multiline: true,
        },
      ]}
    />
  );
}
