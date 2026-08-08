"use client";

import { SectionForm, type SectionSaveStatus } from "@/components/onboarding/sections/shared";

export function BranchesOperationsSection({
  defaultValues = {},
  onSave,
}: {
  defaultValues?: Record<string, unknown>;
  onSave: (payload: Record<string, unknown>, status: SectionSaveStatus) => Promise<void>;
}) {
  return (
    <SectionForm
      sectionKey="branches_operations"
      title="Branches and operations"
      description="Capture where work happens and record branchless operations explicitly."
      defaultValues={defaultValues}
      onSave={onSave}
      fields={[
        {
          name: "branchlessConfirmed",
          label: "Branchless operation",
          control: "switch",
          switchLabel: "This business operates without physical branches",
        },
        {
          name: "branches",
          label: "Branches",
          control: "tags",
          placeholder: "Jumeirah",
          required: true,
          description: "Add one branch at a time. Leave empty only if the business is branchless.",
        },
        {
          name: "operatingHours",
          label: "Operating hours",
          control: "weeklyHours",
          required: true,
          description: "The recurring weekly pattern customers can rely on.",
        },
        {
          name: "serviceArea",
          label: "Service areas",
          control: "tags",
          placeholder: "Dubai Marina",
          description: "Delivery zones, districts, or regions covered.",
        },
        {
          name: "capacity",
          label: "Capacity and constraints",
          control: "textarea",
          placeholder: "Seats, order throughput, staffing limits",
        },
      ]}
    />
  );
}
