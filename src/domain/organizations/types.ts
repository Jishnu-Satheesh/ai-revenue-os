import { z } from "zod";

export const organizationRoleSchema = z.enum(["owner", "admin", "operator", "viewer"]);
export type OrganizationRole = z.infer<typeof organizationRoleSchema>;

export const organizationStatusSchema = z.enum(["draft_onboarding", "active", "archived"]);
export type OrganizationStatus = z.infer<typeof organizationStatusSchema>;

export const createOrganizationInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  industry: z.string().trim().min(2).max(80),
  countryCode: z.string().length(2).toUpperCase(),
  currency: z.string().length(3).toUpperCase(),
  timezone: z.string().min(1),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationInputSchema>;
