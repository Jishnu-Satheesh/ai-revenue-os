import { z } from "zod";

function emptyToUndefined(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

const optionalNonEmptyString = z.preprocess(emptyToUndefined, z.string().min(1).optional());

/**
 * Meta application credentials are configured as a pair or not at all. A half
 * configured application is a mistake, not a partial capability, so it fails
 * loudly instead of producing an authorization URL that cannot complete.
 *
 * Resolving to a value here says only that the platform holds an application
 * identity. It is not evidence that any organization may publish or advertise:
 * that remains a per-organization capability grant backed by a verified
 * provider contract.
 */
export const metaOAuthApplicationSchema = z
  .object({
    META_APP_ID: optionalNonEmptyString,
    META_APP_SECRET: optionalNonEmptyString,
  })
  .transform((values, ctx) => {
    const appId = values.META_APP_ID as string | undefined;
    const appSecret = values.META_APP_SECRET as string | undefined;

    if (appId === undefined && appSecret === undefined) return null;
    if (appId === undefined || appSecret === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "META_APP_ID and META_APP_SECRET must be configured together.",
      });
      return z.NEVER;
    }

    return { appId, appSecret };
  });

export type MetaOAuthApplication = z.infer<typeof metaOAuthApplicationSchema>;
