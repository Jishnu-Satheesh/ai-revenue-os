"use client";

import { SectionForm, type SectionSaveStatus } from "@/components/onboarding/sections/shared";
import { brandVoiceOptions } from "@/domain/onboarding/vocabularies";
import { languageOptions } from "@/domain/reference/languages";

export function BrandAssetsSection({
  defaultValues = {},
  onSave,
}: {
  defaultValues?: Record<string, unknown>;
  onSave: (payload: Record<string, unknown>, status: SectionSaveStatus) => Promise<void>;
}) {
  return (
    <SectionForm
      sectionKey="brand_assets"
      title="Brand assets and communication style"
      description="Capture voice, languages, claims restrictions, and approval contacts."
      defaultValues={defaultValues}
      onSave={onSave}
      fields={[
        {
          name: "brandVoice",
          label: "Brand voice",
          control: "multiselect",
          options: brandVoiceOptions,
          placeholder: "Select the traits that describe the voice",
          required: true,
        },
        {
          name: "languages",
          label: "Languages",
          control: "multiselect",
          options: languageOptions,
          placeholder: "Select every language used with customers",
          searchPlaceholder: "Search languages…",
          required: true,
        },
        {
          name: "assetSources",
          label: "Asset sources",
          control: "tags",
          placeholder: "Brand guidelines drive folder",
          description: "Where approved logos, imagery, and guidelines live.",
        },
        {
          name: "claimsRestrictions",
          label: "Claims and approvals",
          control: "textarea",
          placeholder: "Claims to avoid, regulated wording, and who approves copy",
        },
      ]}
    />
  );
}
