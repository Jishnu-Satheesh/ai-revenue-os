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
      description="Capture voice, colours, the rules generation must respect, and approval contacts."
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
          name: "palette",
          label: "Brand colours",
          control: "palette",
          description:
            "Given to the image model as the brand's colours. Artwork is checked against them at review, not enforced while it is drawn.",
        },
        {
          name: "brandRules",
          label: "Brand rules",
          control: "brandRules",
          description:
            "The do's and don'ts generation must respect. Absolute rules can stop a campaign being built; preferred ones guide it.",
        },
        {
          name: "restrictedTerms",
          label: "Words never to use",
          control: "tags",
          placeholder: "best in dubai",
          description:
            "Matched literally in generated copy, so enter the wording itself rather than a description of it.",
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
