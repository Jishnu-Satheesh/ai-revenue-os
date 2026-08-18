import { z } from "zod";

export const organizationRoleSchema = z.enum(["owner", "admin", "operator", "viewer"]);
export type OrganizationRole = z.infer<typeof organizationRoleSchema>;

/**
 * Authority inside the agency, which is a different question from authority
 * inside a client. An account `member` holds a seat; what they can actually do
 * in a client is their organization role. See `specs/017-account-identity-and-access.md`.
 */
export const accountRoleSchema = z.enum(["owner", "admin", "member"]);
export type AccountRole = z.infer<typeof accountRoleSchema>;

/**
 * Mirrors `private.organization_role_rank`. Access is a union of grants and the
 * effective role is the highest-ranked one, so anything comparing two roles must
 * agree with the database on their order.
 *
 * This is for presentation only. The database decides access; a browser that
 * disagrees renders the wrong control, it does not grant anything.
 */
const organizationRoleRanks: Readonly<Record<OrganizationRole, number>> = {
  viewer: 1,
  operator: 2,
  admin: 3,
  owner: 4,
};

export function organizationRoleRank(role: OrganizationRole): number {
  return organizationRoleRanks[role];
}

export function isAtLeastOrganizationRole(
  role: OrganizationRole,
  minimum: OrganizationRole,
): boolean {
  return organizationRoleRank(role) >= organizationRoleRank(minimum);
}

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

/**
 * `constraintKey` is the stable identity a constraint's versions hang off.
 * `name` is user-facing and mutable, so it cannot serve that purpose. Saving a
 * key that is already in force at the same scope supersedes the incumbent
 * rather than creating a second active row; see
 * `specs/013-margin-firewall.md` section 4.1.
 */
export const constraintInputSchema = z
  .object({
    constraintKey: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_.-]{1,120}$/, "Constraint key must be a lower-case slug."),
    name: z.string().trim().min(2).max(160),
    constraintType: z.string().trim().min(2).max(80),
    value: z.unknown().refine((value) => value !== undefined, "Constraint value is required."),
    severity: z.enum(["soft", "hard"]).default("hard"),
    source: z.string().trim().min(1).max(120).default("user"),
    scopeKind: z.enum(["organization", "branch", "channel"]).default("organization"),
    scopeRef: z.string().trim().min(1).max(200).nullish(),
    effectiveFrom: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Effective date must be an ISO date.")
      .nullish(),
  })
  .superRefine((constraint, context) => {
    if (constraint.scopeKind === "organization" && constraint.scopeRef)
      context.addIssue({
        code: "custom",
        path: ["scopeRef"],
        message: "Organization-scoped constraints cannot name a subject.",
      });
    if (constraint.scopeKind !== "organization" && !constraint.scopeRef)
      context.addIssue({
        code: "custom",
        path: ["scopeRef"],
        message: "Branch and channel constraints must name a subject.",
      });
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
