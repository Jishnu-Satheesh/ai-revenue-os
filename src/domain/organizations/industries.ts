import { z } from "zod";

/**
 * Canonical industry taxonomy. Slugs are stored; labels are presentation only.
 * The platform core stays industry-neutral: this list classifies an organization,
 * it never selects behavior. Industry-specific behavior is installed through an
 * industry pack (`organizations.industry_pack_slug`).
 */
export const industrySlugs = [
  "restaurant",
  "retail",
  "hospitality",
  "healthcare",
  "fitness",
  "beauty",
  "professional_services",
  "real_estate",
  "education",
  "automotive",
  "logistics",
  "events",
  "b2b_software",
  "other",
] as const;

export const industrySchema = z.enum(industrySlugs);
export type IndustrySlug = z.infer<typeof industrySchema>;

export const industryLabels: Record<IndustrySlug, string> = {
  restaurant: "Restaurant and food service",
  retail: "Retail and e-commerce",
  hospitality: "Hotels and hospitality",
  healthcare: "Clinics and healthcare",
  fitness: "Fitness and wellness",
  beauty: "Beauty and personal care",
  professional_services: "Professional services",
  real_estate: "Real estate",
  education: "Education and training",
  automotive: "Automotive",
  logistics: "Logistics and delivery",
  events: "Events and entertainment",
  b2b_software: "B2B software",
  other: "Other",
};

export const industryOptions = industrySlugs.map((value) => ({
  value,
  label: industryLabels[value],
}));

/**
 * Organizations created before the taxonomy existed hold free text such as
 * "Restaurant". Match those onto a slug so stored values converge without
 * discarding the operator's original answer.
 */
export function normalizeIndustry(value: string | null | undefined): IndustrySlug | null {
  if (!value) return null;
  const candidate = value
    .trim()
    .toLowerCase()
    .replaceAll(/[\s-]+/g, "_");
  const direct = industrySlugs.find((slug) => slug === candidate);
  if (direct) return direct;
  const byLabel = industrySlugs.find(
    (slug) => industryLabels[slug].toLowerCase() === value.trim().toLowerCase(),
  );
  return byLabel ?? null;
}
