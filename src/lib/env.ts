import "server-only";
import { z } from "zod";

function emptyToUndefined(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

const optionalNonEmptyString = z.preprocess(emptyToUndefined, z.string().min(1).optional());
const optionalUrl = z.preprocess(emptyToUndefined, z.string().url().optional());

const serverEnvSchema = z.object({
  APP_ENV: z.enum(["development", "test", "preview", "production"]).default("development"),
  NEXT_PUBLIC_APP_URL: z.preprocess(
    emptyToUndefined,
    z.string().url().default("http://localhost:3000"),
  ),
  NEXT_PUBLIC_SUPABASE_URL: z.preprocess(emptyToUndefined, z.string().url()),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.preprocess(emptyToUndefined, z.string().min(1)),
  SUPABASE_SERVICE_ROLE_KEY: optionalNonEmptyString,
  // Absent means invitations fall back to copy-link. Email is best-effort on
  // top of a link that always works, never the only way in.
  RESEND_API_KEY: optionalNonEmptyString,
  INVITATION_FROM_ADDRESS: z.preprocess(
    emptyToUndefined,
    z.string().min(3).default("AI Revenue OS <invitations@themarga.in>"),
  ),
  OPENAI_API_KEY: optionalNonEmptyString,
  ANTHROPIC_API_KEY: optionalNonEmptyString,
  GOOGLE_GENERATIVE_AI_API_KEY: optionalNonEmptyString,
  AI_DEFAULT_MODEL: optionalNonEmptyString,
  MEMORY_EMBEDDING_MODEL: optionalNonEmptyString,
  REDIS_URL: optionalNonEmptyString,
  TRIGGER_SECRET_KEY: optionalNonEmptyString,
  TRIGGER_PROJECT_REF: optionalNonEmptyString,
  INTEGRATION_HUB_V1_ORGANIZATION_IDS: optionalNonEmptyString,
  GOVERNED_REPORT_VALIDATION_ORGANIZATION_IDS: optionalNonEmptyString,
  GOVERNED_REPORT_PROJECTION_ORGANIZATION_IDS: optionalNonEmptyString,
  GOVERNED_ECONOMICS_READINESS_ORGANIZATION_IDS: optionalNonEmptyString,
  GOVERNED_CHANNEL_ANALYSIS_ORGANIZATION_IDS: optionalNonEmptyString,
  CAMPAIGNS_V1_ORGANIZATION_IDS: optionalNonEmptyString,
  CAMPAIGN_TEXT_MODEL: optionalNonEmptyString,
  CAMPAIGN_PLAN_MODEL: optionalNonEmptyString,
  CAMPAIGN_PATCH_MODEL: optionalNonEmptyString,
  CAMPAIGN_REPAIR_MODEL: optionalNonEmptyString,
  CAMPAIGN_IMAGE_MODEL: optionalNonEmptyString,
  CAMPAIGN_GENERATION_COST_CEILING_MINOR: optionalNonEmptyString,
  META_APP_ID: optionalNonEmptyString,
  META_APP_SECRET: optionalNonEmptyString,
  /**
   * The token Meta echoes during the subscription handshake. Separate from the
   * app secret on purpose: the secret signs payloads and must never be sent
   * anywhere, while this one is quoted back in a query string by design.
   */
  META_WEBHOOK_VERIFY_TOKEN: optionalNonEmptyString,
  SENTRY_DSN: optionalUrl,
  OTEL_EXPORTER_OTLP_ENDPOINT: optionalUrl,
});

function formatEnvValidationError(error: z.ZodError): string {
  const details = error.issues
    .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
    .join("; ");
  return `Invalid environment configuration: ${details}`;
}

const parsedEnv = serverEnvSchema.safeParse({
  APP_ENV: process.env.APP_ENV,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  INVITATION_FROM_ADDRESS: process.env.INVITATION_FROM_ADDRESS,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  AI_DEFAULT_MODEL: process.env.AI_DEFAULT_MODEL,
  MEMORY_EMBEDDING_MODEL: process.env.MEMORY_EMBEDDING_MODEL,
  REDIS_URL: process.env.REDIS_URL,
  TRIGGER_SECRET_KEY: process.env.TRIGGER_SECRET_KEY,
  TRIGGER_PROJECT_REF: process.env.TRIGGER_PROJECT_REF,
  INTEGRATION_HUB_V1_ORGANIZATION_IDS: process.env.INTEGRATION_HUB_V1_ORGANIZATION_IDS,
  GOVERNED_REPORT_VALIDATION_ORGANIZATION_IDS: process.env.GOVERNED_REPORT_VALIDATION_ORGANIZATION_IDS,
  GOVERNED_REPORT_PROJECTION_ORGANIZATION_IDS: process.env.GOVERNED_REPORT_PROJECTION_ORGANIZATION_IDS,
  GOVERNED_ECONOMICS_READINESS_ORGANIZATION_IDS:
    process.env.GOVERNED_ECONOMICS_READINESS_ORGANIZATION_IDS,
  GOVERNED_CHANNEL_ANALYSIS_ORGANIZATION_IDS: process.env.GOVERNED_CHANNEL_ANALYSIS_ORGANIZATION_IDS,
  CAMPAIGNS_V1_ORGANIZATION_IDS: process.env.CAMPAIGNS_V1_ORGANIZATION_IDS,
  CAMPAIGN_TEXT_MODEL: process.env.CAMPAIGN_TEXT_MODEL,
  CAMPAIGN_PLAN_MODEL: process.env.CAMPAIGN_PLAN_MODEL,
  CAMPAIGN_PATCH_MODEL: process.env.CAMPAIGN_PATCH_MODEL,
  CAMPAIGN_REPAIR_MODEL: process.env.CAMPAIGN_REPAIR_MODEL,
  CAMPAIGN_IMAGE_MODEL: process.env.CAMPAIGN_IMAGE_MODEL,
  CAMPAIGN_GENERATION_COST_CEILING_MINOR: process.env.CAMPAIGN_GENERATION_COST_CEILING_MINOR,
  META_APP_ID: process.env.META_APP_ID,
  META_APP_SECRET: process.env.META_APP_SECRET,
  META_WEBHOOK_VERIFY_TOKEN: process.env.META_WEBHOOK_VERIFY_TOKEN,
  SENTRY_DSN: process.env.SENTRY_DSN,
  OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
});

if (!parsedEnv.success) {
  throw new Error(formatEnvValidationError(parsedEnv.error));
}

export const env = parsedEnv.data;

export type AppEnv = z.infer<typeof serverEnvSchema>;
