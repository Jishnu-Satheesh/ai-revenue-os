"use client";

import { SectionForm, type SectionSaveStatus } from "@/components/onboarding/sections/shared";

export function BranchesOperationsSection({
  defaultValues = {},
  onSave,
}: {
  defaultValues?: Record<string, string>;
  onSave: (payload: Record<string, string>, status: SectionSaveStatus) => Promise<void>;
}) {
  return (
    <SectionForm
      title="Branches and operations"
      description="Capture where work happens and record branchless operations explicitly."
      defaultValues={defaultValues}
      onSave={onSave}
      fields={[
        {
          name: "branches",
          label: "Branches",
          placeholder: "Jumeirah; Downtown",
          required: true,
          description: "Separate branches with semicolons.",
        },
        {
          name: "operatingHours",
          label: "Operating hours",
          placeholder: "Mon–Sun, 10:00–23:00",
          required: true,
        },
        {
          name: "serviceArea",
          label: "Service area",
          placeholder: "Dubai Marina and nearby areas",
        },
        {
          name: "capacity",
          label: "Capacity and constraints",
          placeholder: "Seats, order capacity, staffing limits",
          multiline: true,
        },
      ]}
    />
  );
}
