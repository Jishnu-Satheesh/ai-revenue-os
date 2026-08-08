"use client";

import { SectionForm, type SectionSaveStatus } from "@/components/onboarding/sections/shared";
import { productCategoryOptions } from "@/domain/onboarding/vocabularies";
import { currencyOptions } from "@/domain/reference/currencies";

const currencyChoices = currencyOptions.map((currency) => ({
  value: currency.code,
  label: `${currency.code} — ${currency.label}`,
}));

export function ProductsServicesSection({
  defaultValues = {},
  onSave,
}: {
  defaultValues?: Record<string, unknown>;
  onSave: (payload: Record<string, unknown>, status: SectionSaveStatus) => Promise<void>;
}) {
  return (
    <SectionForm
      sectionKey="products_services"
      title="Products or services"
      description="Describe the offer or menu. Upload parsing and row review can add detail later."
      defaultValues={defaultValues}
      onSave={onSave}
      fields={[
        {
          name: "items",
          label: "Products or services",
          control: "tags",
          placeholder: "Chicken machboos",
          required: true,
          description: "Add the headline items. A catalog upload can fill in the long tail.",
        },
        {
          name: "categories",
          label: "Categories",
          control: "multiselect",
          options: productCategoryOptions,
          placeholder: "Select the categories on offer",
        },
        {
          name: "averageOrderCurrency",
          label: "Pricing currency",
          control: "combobox",
          options: currencyChoices,
          placeholder: "Select a currency",
          searchPlaceholder: "Search currencies…",
        },
        {
          name: "averageOrderValueMinor",
          label: "Average order value",
          control: "money",
          currencyField: "averageOrderCurrency",
          placeholder: "45.00",
          description: "Typical spend per order or engagement.",
        },
        {
          name: "availability",
          label: "Availability and modifiers",
          control: "textarea",
          placeholder: "Seasonal items, add-ons, stock limits",
        },
      ]}
    />
  );
}
