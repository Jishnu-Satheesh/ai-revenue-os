import { z } from "zod";

const channelKeySchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9.-]{1,80}$/, "Channel key must be a lower-case stable key.");

const channelCategorySchema = z.enum([
  "marketplace",
  "owned_digital",
  "physical",
  "reseller",
  "other",
]);

const channelTemplateKeySchema = channelKeySchema.nullable().optional();

export const channelCreateInputSchema = z
  .object({
    key: channelKeySchema,
    displayName: z.string().trim().min(1).max(160),
    category: channelCategorySchema,
    templateKey: channelTemplateKeySchema,
  })
  .strict();

export const channelUpdateInputSchema = z
  .object({
    displayName: z.string().trim().min(1).max(160).optional(),
    category: channelCategorySchema.optional(),
    templateKey: channelTemplateKeySchema,
    status: z.enum(["active", "archived"]).optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.displayName !== undefined ||
      input.category !== undefined ||
      input.templateKey !== undefined ||
      input.status !== undefined,
    "At least one mutable channel field is required.",
  );

export const channelBranchMappingInputSchema = z
  .object({
    branchId: z.string().uuid(),
    applicability: z.enum(["active", "inactive"]),
    effectiveFrom: z.string().date().nullable().optional(),
    effectiveTo: z.string().date().nullable().optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.effectiveFrom && input.effectiveTo && input.effectiveTo < input.effectiveFrom) {
      context.addIssue({
        code: "custom",
        path: ["effectiveTo"],
        message: "The end date cannot be before the start date.",
      });
    }
  });

export const channelAliasInputSchema = z
  .object({
    alias: z.string().trim().min(1).max(300),
    sourceScope: z.enum([
      "onboarding",
      "normalized_metric",
      "economics_entry",
      "cost_rate",
      "report_package",
      "manual",
    ]),
    effectiveFrom: z.string().date().nullable().optional(),
    effectiveTo: z.string().date().nullable().optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.effectiveFrom && input.effectiveTo && input.effectiveTo < input.effectiveFrom) {
      context.addIssue({
        code: "custom",
        path: ["effectiveTo"],
        message: "The end date cannot be before the start date.",
      });
    }
  });

export type ChannelCreateInput = z.infer<typeof channelCreateInputSchema>;
export type ChannelUpdateInput = z.infer<typeof channelUpdateInputSchema>;
export type ChannelBranchMappingInput = z.infer<typeof channelBranchMappingInputSchema>;
export type ChannelAliasInput = z.infer<typeof channelAliasInputSchema>;
