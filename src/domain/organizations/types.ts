import { z } from "zod";

export const organizationRoleSchema = z.enum(["owner", "admin", "operator", "viewer"]);
export type OrganizationRole = z.infer<typeof organizationRoleSchema>;

export const organizationStatusSchema = z.enum(["draft_onboarding", "active", "archived"]);
export type OrganizationStatus = z.infer<typeof organizationStatusSchema>;

export const createOrganizationInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  industry: z.string().trim().min(2).max(80),
  countryCode: z.string().length(2).toUpperCase(),
  currency: z.string().length(3).toUpperCase(),
  timezone: z.string().min(1),
  industryPackSlug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .default("core"),
  firstBranch: z
    .object({
      name: z.string().trim().min(2).max(120),
      slug: z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      kind: z.enum(["physical", "virtual"]).default("physical"),
      timezone: z.string().min(1).optional(),
      currency: z.string().length(3).toUpperCase().optional(),
    })
    .nullable()
    .optional(),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationInputSchema>;

export const branchInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  kind: z.enum(["physical", "virtual"]).default("physical"),
  timezone: z.string().min(1),
  currency: z.string().length(3).toUpperCase(),
  serviceArea: z.record(z.string(), z.unknown()).default({}),
  operatingHours: z.record(z.string(), z.unknown()).default({}),
  contactDetails: z.record(z.string(), z.unknown()).default({}),
  capacityMetadata: z.record(z.string(), z.unknown()).default({}),
});
export type BranchInput = z.infer<typeof branchInputSchema>;

export const businessProfileInputSchema = z.object({
  businessModel: z.string().trim().max(500).nullable().optional(),
  valueProposition: z.string().trim().max(1000).nullable().optional(),
  customerSegments: z.array(z.unknown()).default([]),
  brandContext: z.record(z.string(), z.unknown()).default({}),
  languages: z.array(z.string().min(2).max(20)).default([]),
  operatingModel: z.record(z.string(), z.unknown()).default({}),
  source: z.string().trim().min(1).max(120).default("user"),
});
export type BusinessProfileInput = z.infer<typeof businessProfileInputSchema>;

export const businessFactInputSchema = z.object({
  branchId: z.string().uuid().nullable().optional(),
  factKey: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z][a-z0-9_.-]{1,120}$/),
  value: z.unknown(),
  source: z.string().trim().min(1).max(120),
  sourceReference: z.string().trim().max(500).nullable().optional(),
  status: z.enum(["verified", "imported", "inferred", "stale"]).default("imported"),
  confidence: z.number().min(0).max(1).nullable().optional(),
  effectiveFrom: z.string().date().nullable().optional(),
  effectiveTo: z.string().date().nullable().optional(),
});
export type BusinessFactInput = z.infer<typeof businessFactInputSchema>;

export const goalInputSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    metric: z.string().trim().min(2).max(120),
    baselineStatus: z.enum(["known", "unknown", "estimated"]),
    baselineValue: z.number().nullable().optional(),
    targetValue: z.number(),
    unit: z.string().trim().min(1).max(40),
    currency: z.string().length(3).toUpperCase().nullable().optional(),
    deadline: z.string().date().nullable().optional(),
    scopeKind: z.enum(["organization", "branch"]).default("organization"),
    scopeBranchId: z.string().uuid().nullable().optional(),
    ownerId: z.string().uuid().nullable().optional(),
    priority: z.number().int().min(1).max(5).default(3),
  })
  .superRefine((goal, context) => {
    if (goal.scopeKind === "branch" && !goal.scopeBranchId)
      context.addIssue({
        code: "custom",
        path: ["scopeBranchId"],
        message: "A branch is required for branch-scoped goals.",
      });
    if (goal.scopeKind === "organization" && goal.scopeBranchId)
      context.addIssue({
        code: "custom",
        path: ["scopeBranchId"],
        message: "Organization goals cannot include a branch.",
      });
  });
export type GoalInput = z.infer<typeof goalInputSchema>;

export const constraintInputSchema = z.object({
  name: z.string().trim().min(2).max(160),
  constraintType: z.string().trim().min(2).max(80),
  value: z.unknown(),
  severity: z.enum(["soft", "hard"]).default("hard"),
  source: z.string().trim().min(1).max(120).default("user"),
  isActive: z.boolean().default(true),
});
export type ConstraintInput = z.infer<typeof constraintInputSchema>;

export const policyInputSchema = z.object({
  policyType: z.string().trim().min(2).max(80),
  name: z.string().trim().min(2).max(160),
  mode: z
    .enum([
      "recommendation_only",
      "approval_required",
      "bounded_auto_execution",
      "fully_autonomous",
    ])
    .default("approval_required"),
  configuration: z.record(z.string(), z.unknown()).default({}),
  monthlyBudgetMinor: z.number().int().nonnegative().nullable().optional(),
  budgetCurrency: z.string().length(3).toUpperCase().nullable().optional(),
});
export type PolicyInput = z.infer<typeof policyInputSchema>;
