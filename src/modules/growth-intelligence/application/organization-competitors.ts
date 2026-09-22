import { z } from "zod";

import { normalizeCompetitorName } from "@/domain/growth-intelligence/brief";

/**
 * Organisation competitors for the New research dialog (Track C1 P2).
 *
 * Competitors named in the dialog are saved permanently on the organisation so
 * the next research starts from what the operator already knows. Rows
 * de-duplicate by normalized name (case and whitespace folding only, matching
 * the brief contract — diacritics and non-Latin scripts stay distinct).
 */

const publicHttpUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }, "A competitor website must be a valid public HTTP or HTTPS URL.");

export const organizationCompetitorSchema = z
  .object({
    id: z.string().uuid(),
    organizationId: z.string().uuid(),
    name: z.string().trim().min(1).max(160),
    website: publicHttpUrlSchema.nullable(),
    locationHint: z.string().trim().min(1).max(240).nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

export type OrganizationCompetitor = z.infer<typeof organizationCompetitorSchema>;

export const createOrganizationCompetitorBodySchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    website: z.string().trim().max(2_048).optional(),
    locationHint: z.string().trim().max(240).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.website !== undefined && input.website.length > 0) {
      const parsed = publicHttpUrlSchema.safeParse(input.website);
      if (!parsed.success) {
        context.addIssue({
          code: "custom",
          path: ["website"],
          message: "A competitor website must be a valid public HTTP or HTTPS URL.",
        });
      }
    }
    if (input.locationHint !== undefined && input.locationHint.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["locationHint"],
        message: "A location hint must not be empty when provided.",
      });
    }
  });

export const updateOrganizationCompetitorBodySchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    website: z.string().trim().max(2_048).nullable().optional(),
    locationHint: z.string().trim().max(240).nullable().optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.name !== undefined && input.name.length === 0) {
      context.addIssue({ code: "custom", path: ["name"], message: "A competitor name is required." });
    }
    if (typeof input.website === "string" && input.website.length > 0) {
      const parsed = publicHttpUrlSchema.safeParse(input.website);
      if (!parsed.success) {
        context.addIssue({
          code: "custom",
          path: ["website"],
          message: "A competitor website must be a valid public HTTP or HTTPS URL.",
        });
      }
    }
    if (typeof input.locationHint === "string" && input.locationHint.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["locationHint"],
        message: "A location hint must not be empty when provided.",
      });
    }
    if (input.name === undefined && input.website === undefined && input.locationHint === undefined) {
      context.addIssue({ code: "custom", message: "Provide at least one field to update." });
    }
  });

export type CreateOrganizationCompetitorBody = z.infer<
  typeof createOrganizationCompetitorBodySchema
>;
export type UpdateOrganizationCompetitorBody = z.infer<
  typeof updateOrganizationCompetitorBodySchema
>;

export function toNormalizedCompetitorName(name: string): string {
  return normalizeCompetitorName(name);
}

/**
 * De-duplicate competitor rows by normalized name, keeping the first
 * occurrence. Used when folding dialog competitors into organisation storage
 * so one organisation never holds the same rival twice under different
 * capitalisation or spacing.
 */
export function deduplicateCompetitorsByName<T extends { name: string }>(
  rows: readonly T[],
): T[] {
  const seen = new Set<string>();
  const kept: T[] = [];
  for (const row of rows) {
    const key = toNormalizedCompetitorName(row.name);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(row);
  }
  return kept;
}
