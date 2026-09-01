import { z } from "zod";

import type { MarketProfileDocumentV1 } from "@/domain/growth-intelligence/types";

const boundedText = (maximum: number) => z.string().trim().min(1).max(maximum);

/** Matches PostgreSQL's UTF-8 `C` collation for digest-bound text. */
export function compareCanonicalText(left: string, right: string): number {
  const leftCodePoints = Array.from(left, (character) => character.codePointAt(0)!);
  const rightCodePoints = Array.from(right, (character) => character.codePointAt(0)!);
  const length = Math.min(leftCodePoints.length, rightCodePoints.length);

  for (let index = 0; index < length; index += 1) {
    const difference = leftCodePoints[index]! - rightCodePoints[index]!;
    if (difference !== 0) return difference;
  }

  return leftCodePoints.length - rightCodePoints.length;
}

const normalizedKeySchema = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .regex(/^[a-z][a-z0-9_.-]+$/);
const locationRefSchema = z
  .string()
  .trim()
  .min(2)
  .max(160)
  .regex(/^[a-z0-9][a-z0-9:._-]+$/);

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/\.+$/, "");
}

const domainSchema = z
  .string()
  .trim()
  .min(1)
  .max(254)
  .transform(normalizeDomain)
  .refine(
    (value) =>
      /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(
        value,
      ),
    "A public domain must be a normalized DNS name.",
  );

const publicHttpUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_048)
  .transform((value, context) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      context.addIssue({ code: "custom", message: "A public URL must be a valid HTTP URL." });
      return z.NEVER;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      context.addIssue({ code: "custom", message: "A public URL must use HTTP or HTTPS." });
      return z.NEVER;
    }
    if (url.username || url.password) {
      context.addIssue({ code: "custom", message: "A public URL cannot contain credentials." });
      return z.NEVER;
    }
    url.hash = "";
    return url.toString();
  });

function addDuplicateIssue(
  values: readonly string[],
  context: z.RefinementCtx,
  message: string,
): void {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: "custom", message });
  }
}

function uniqueDomainsSchema(maximum: number) {
  return z
    .array(domainSchema)
    .max(maximum)
    .superRefine((domains, context) =>
      addDuplicateIssue(domains, context, "Domains must be unique after normalization."),
    )
    .transform((domains) => [...domains].sort(compareCanonicalText));
}

const uniqueUrlsSchema = z
  .array(publicHttpUrlSchema)
  .max(20)
  .superRefine((urls, context) =>
    addDuplicateIssue(urls, context, "Public URLs must be unique after normalization."),
  )
  .transform((urls) => [...urls].sort(compareCanonicalText));

const tradeAreaSchema = z
  .object({
    layer: z.literal("trade_area"),
    locationRef: locationRefSchema,
    name: boundedText(160),
    branchId: z.string().uuid(),
    radiusKm: z.number().positive().max(500).optional(),
  })
  .strict();

const citySchema = z
  .object({
    layer: z.literal("city"),
    locationRef: locationRefSchema,
    name: boundedText(160),
    countryCode: z
      .string()
      .trim()
      .length(2)
      .transform((value) => value.toUpperCase())
      .refine((value) => /^[A-Z]{2}$/.test(value), "Country code must use ISO alpha-2 form."),
  })
  .strict();

const countrySchema = z
  .object({
    layer: z.literal("country"),
    locationRef: locationRefSchema,
    name: boundedText(160),
    countryCode: z
      .string()
      .trim()
      .length(2)
      .transform((value) => value.toUpperCase())
      .refine((value) => /^[A-Z]{2}$/.test(value), "Country code must use ISO alpha-2 form."),
  })
  .strict();

const geographySchema = z.discriminatedUnion("layer", [tradeAreaSchema, citySchema, countrySchema]);

const competitorSchema = z
  .object({
    key: normalizedKeySchema,
    name: boundedText(160),
    publicUrl: publicHttpUrlSchema.optional(),
    geographyRefs: z.array(locationRefSchema).min(1).max(20),
    relevanceEvidenceUrls: z.array(publicHttpUrlSchema).min(1).max(10),
    relevanceReason: boundedText(600),
  })
  .strict()
  .superRefine((competitor, context) => {
    addDuplicateIssue(
      competitor.geographyRefs,
      context,
      "Competitor geography references must be unique.",
    );
    addDuplicateIssue(
      competitor.relevanceEvidenceUrls,
      context,
      "Competitor evidence URLs must be unique.",
    );
  })
  .transform((competitor) => ({
    ...competitor,
    geographyRefs: [...competitor.geographyRefs].sort(compareCanonicalText),
    relevanceEvidenceUrls: [...competitor.relevanceEvidenceUrls].sort(compareCanonicalText),
  }));

const topicSchema = z
  .object({
    key: normalizedKeySchema,
    label: boundedText(160),
    provenance: z.enum(["core", "industry_pack", "operator", "ai_proposed"]),
  })
  .strict();

const sourcePolicySchema = z
  .object({
    excludedDomains: uniqueDomainsSchema(100),
    excludedPublishers: z.array(boundedText(200)).max(100),
    excludedCompetitorKeys: z.array(normalizedKeySchema).max(50),
    allowBoundedQuotes: z.boolean(),
    maxQuotationCharacters: z.number().int().min(0).max(500),
  })
  .strict()
  .superRefine((policy, context) => {
    addDuplicateIssue(
      policy.excludedPublishers.map((publisher) => publisher.toLowerCase()),
      context,
      "Excluded publishers must be unique.",
    );
    addDuplicateIssue(
      policy.excludedCompetitorKeys,
      context,
      "Excluded competitor keys must be unique.",
    );
    if (policy.allowBoundedQuotes !== policy.maxQuotationCharacters > 0) {
      context.addIssue({
        code: "custom",
        path: ["maxQuotationCharacters"],
        message: "Quotation retention must be zero when bounded quotations are disabled.",
      });
    }
  })
  .transform((policy) => ({
    ...policy,
    excludedPublishers: [...policy.excludedPublishers].sort(compareCanonicalText),
    excludedCompetitorKeys: [...policy.excludedCompetitorKeys].sort(compareCanonicalText),
  }));

const timeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((timeZone) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone }).format();
      return true;
    } catch {
      return false;
    }
  }, "Timezone must be a valid IANA timezone.");

const localTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);

export const marketProfileDocumentV1Schema: z.ZodType<MarketProfileDocumentV1> = z
  .object({
    schemaVersion: z.literal(1),
    publicIdentity: z
      .object({
        approvedName: boundedText(200),
        domains: uniqueDomainsSchema(10),
        publicUrls: uniqueUrlsSchema,
      })
      .strict(),
    nicheDescriptors: z.array(boundedText(120)).min(1).max(12),
    geographies: z.array(geographySchema).min(2).max(100),
    competitors: z.array(competitorSchema).max(50),
    topics: z.array(topicSchema).min(1).max(50),
    sourcePolicy: sourcePolicySchema,
    cadence: z
      .object({
        timeZone: timeZoneSchema,
        dailyLocalTime: localTimeSchema,
        weeklyDay: z.enum([
          "monday",
          "tuesday",
          "wednesday",
          "thursday",
          "friday",
          "saturday",
          "sunday",
        ]),
        weeklyLocalTime: localTimeSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((profile, context) => {
    const geographyKeys = profile.geographies.map(
      (geography) => `${geography.layer}:${geography.locationRef}`,
    );
    addDuplicateIssue(geographyKeys, context, "Geographic scopes must be unique.");
    const tradeAreaBranchIds = profile.geographies
      .filter(
        (geography): geography is z.infer<typeof tradeAreaSchema> =>
          geography.layer === "trade_area",
      )
      .map((geography) => geography.branchId);
    addDuplicateIssue(
      tradeAreaBranchIds,
      context,
      "Each branch may declare one trade area in a profile version.",
    );
    if (!profile.geographies.some((geography) => geography.layer === "city")) {
      context.addIssue({ code: "custom", path: ["geographies"], message: "A city is required." });
    }
    if (!profile.geographies.some((geography) => geography.layer === "country")) {
      context.addIssue({
        code: "custom",
        path: ["geographies"],
        message: "A country is required.",
      });
    }
    addDuplicateIssue(
      profile.nicheDescriptors.map((descriptor) => descriptor.toLowerCase()),
      context,
      "Niche descriptors must be unique.",
    );
    addDuplicateIssue(
      profile.competitors.map((competitor) => competitor.key),
      context,
      "Competitor keys must be unique.",
    );
    addDuplicateIssue(
      profile.topics.map((topic) => topic.key),
      context,
      "Topic keys must be unique.",
    );
    const locationRefs = new Set(profile.geographies.map((geography) => geography.locationRef));
    for (const [index, competitor] of profile.competitors.entries()) {
      if (competitor.geographyRefs.some((reference) => !locationRefs.has(reference))) {
        context.addIssue({
          code: "custom",
          path: ["competitors", index, "geographyRefs"],
          message: "Competitor geography must reference an approved profile scope.",
        });
      }
    }
  })
  .transform((profile) => ({
    ...profile,
    nicheDescriptors: [...profile.nicheDescriptors].sort(compareCanonicalText),
    geographies: [...profile.geographies].sort((left, right) =>
      compareCanonicalText(
        `${left.layer}:${left.locationRef}`,
        `${right.layer}:${right.locationRef}`,
      ),
    ),
    competitors: [...profile.competitors].sort((left, right) =>
      compareCanonicalText(left.key, right.key),
    ),
    topics: [...profile.topics].sort((left, right) => compareCanonicalText(left.key, right.key)),
  }));
