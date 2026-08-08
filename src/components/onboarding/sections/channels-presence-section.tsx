"use client";

import { SectionForm, type SectionSaveStatus } from "@/components/onboarding/sections/shared";
import {
  accountOwnershipOptions,
  channelOptions,
  conversionTrackingOptions,
} from "@/domain/onboarding/vocabularies";

export function ChannelsPresenceSection({
  defaultValues = {},
  onSave,
}: {
  defaultValues?: Record<string, unknown>;
  onSave: (payload: Record<string, unknown>, status: SectionSaveStatus) => Promise<void>;
}) {
  return (
    <SectionForm
      sectionKey="channels_presence"
      title="Channels and digital presence"
      description="List owned channels and account ownership without collecting credentials."
      defaultValues={defaultValues}
      onSave={onSave}
      fields={[
        {
          name: "channels",
          label: "Owned and marketplace channels",
          control: "multiselect",
          options: channelOptions,
          placeholder: "Select every active channel",
          searchPlaceholder: "Search channels…",
          required: true,
        },
        {
          name: "profiles",
          label: "Public profile links",
          control: "tags",
          placeholder: "https://instagram.com/alnoorkitchen",
          description: "Add one URL or handle at a time.",
        },
        {
          name: "accountOwnership",
          label: "Account ownership",
          control: "select",
          options: accountOwnershipOptions,
          placeholder: "Who owns the channel accounts?",
        },
        {
          name: "conversionTrackingStatus",
          label: "Conversion tracking",
          control: "radio",
          options: conversionTrackingOptions,
          required: true,
          description:
            "Only a verified end-to-end setup counts as connected for readiness scoring.",
        },
      ]}
    />
  );
}
