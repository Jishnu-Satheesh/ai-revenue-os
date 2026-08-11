"use client";

import { Info } from "lucide-react";

import {
  SectionForm,
  type CostComponentOption,
  type SectionSaveStatus,
} from "@/components/onboarding/sections/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/**
 * What an order costs before profit.
 *
 * The components come from the registered catalog rather than a list written
 * here, so the Restaurant Pack's commission and packaging appear for a
 * restaurant and a distributor's freight and returns appear for a distributor,
 * with no change to this file. See `specs/012-channel-economics-ledger.md`
 * section 6.
 */
export function CostStructureSection({
  components,
  channels,
  currency,
  defaultValues = {},
  onSave,
}: {
  components: readonly CostComponentOption[];
  /** Channels the operator named earlier, offered as scopes for an override. */
  channels: readonly string[];
  currency: string;
  defaultValues?: Record<string, unknown>;
  onSave: (payload: Record<string, unknown>, status: SectionSaveStatus) => Promise<void>;
}) {
  return (
    <SectionForm
      sectionKey="cost_structure"
      title="Cost structure"
      description="Price what you can, leave what you cannot. Nothing here is guessed on your behalf."
      defaultValues={defaultValues}
      onSave={onSave}
      beforeFields={
        components.length === 0 ? (
          <Alert>
            <Info />
            <AlertTitle>No cost components are registered yet</AlertTitle>
            <AlertDescription>
              Cost components come from this organization&apos;s industry pack. Until one is
              registered there is nothing to price here.
            </AlertDescription>
          </Alert>
        ) : null
      }
      fields={[
        {
          name: "costRates",
          label: "What each order costs",
          control: "costRates",
          components,
          channels,
          currency,
          required: true,
          description:
            "A margin is only as trustworthy as its weakest input, so record how well you know each figure rather than rounding up to certainty.",
        },
        {
          name: "effectiveFrom",
          label: "In force from",
          control: "date",
          required: true,
          description:
            "The day these figures started applying. Earlier periods keep the rates that were in force for them, so a commission change never rewrites a margin you have already seen.",
        },
        {
          name: "sourceNotes",
          label: "Source and caveats",
          control: "textarea",
          placeholder: "Contract references, tiers that vary by volume, or costs still unknown",
        },
      ]}
    />
  );
}
