"use client";

import { SectionForm, type SectionSaveStatus } from "@/components/onboarding/sections/shared";

export function ProductsServicesSection({
  defaultValues = {},
  onSave,
}: {
  defaultValues?: Record<string, string>;
  onSave: (payload: Record<string, string>, status: SectionSaveStatus) => Promise<void>;
}) {
  return (
    <SectionForm
      title="Products or services"
      description="Describe the offer or menu. Upload parsing and row review can add detail later."
      defaultValues={defaultValues}
      onSave={onSave}
      fields={[
        {
          name: "items",
          label: "Products or services",
          placeholder: "Item or service names",
          required: true,
          multiline: true,
        },
        { name: "categories", label: "Categories", placeholder: "Mains; beverages; consulting" },
        { name: "pricing", label: "Pricing context", placeholder: "AED 45 average order" },
        {
          name: "availability",
          label: "Availability and modifiers",
          placeholder: "Seasonal, add-ons, stock notes",
          multiline: true,
        },
      ]}
    />
  );
}
